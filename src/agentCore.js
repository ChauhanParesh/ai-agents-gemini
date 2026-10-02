// Shared agent runtime: builds the tool set, talks to Gemini, dispatches tool
// calls. Used by both the CLI (src/agent.js) and the web UI (server.js) so
// neither duplicates the loop.

import { GoogleGenAI } from '@google/genai';
import { McpToolRegistry } from './mcp/client.js';
import { localToolDefs, runLocalTool } from './tools/localTools.js';
import { directApiToolDefs, runDirectApiTool } from './tools/directApi.js';
import { webSearchToolDefs, runWebSearchTool } from './tools/webSearch.js';
import { toGeminiFunctionDeclarations } from './schemaAdapter.js';
import { createGeminiCaller } from './geminiRetry.js';

// Tried in order: your configured primary, then the standard Flash model,
// then the cheaper/faster Lite model. Falls further down the list when a
// model is overloaded (503) or otherwise failing after its retries.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];
const MAX_TURNS = 10;

const localToolNames = new Set(localToolDefs.map((t) => t.name));
const directApiToolNames = new Set(directApiToolDefs.map((t) => t.name));
const webSearchToolNames = new Set(webSearchToolDefs.map((t) => t.name));

/**
 * Connects to all configured MCP servers and returns a ready-to-use runtime:
 *   - toolDefs: the full merged tool list (for logging/inspection)
 *   - newConversation(): a fresh `contents` array to pass to sendMessage
 *   - sendMessage(contents, userText, onToolCall): sends a message, runs any
 *     tool calls Gemini requests, mutates `contents` in place with the full
 *     turn (so the same array can be reused for the next message), and
 *     returns { text, model } — `model` is whichever candidate actually
 *     answered (see geminiRetry.js), not necessarily the configured primary.
 *   - close(): shuts down the MCP child process(es). Always call this before
 *     exiting, even on error — an open MCP transport can crash Node's event
 *     loop on process.exit (observed on Windows).
 */
export async function createAgentRuntime() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and put it in .env',
    );
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const generateContent = createGeminiCaller(ai, MODEL_CANDIDATES);
  const mcp = new McpToolRegistry();
  await mcp.connectAll();

  const toolDefs = [...localToolDefs, ...directApiToolDefs, ...webSearchToolDefs, ...(await mcp.listToolDefs())];
  const functionDeclarations = toGeminiFunctionDeclarations(toolDefs);

  async function dispatchTool(name, args) {
    if (mcp.isMcpTool(name)) return mcp.callTool(name, args);
    if (localToolNames.has(name)) return runLocalTool(name, args);
    if (directApiToolNames.has(name)) return runDirectApiTool(name, args);
    if (webSearchToolNames.has(name)) return runWebSearchTool(name, args);
    throw new Error(`No handler for tool "${name}"`);
  }

  function newConversation() {
    return [];
  }

  async function sendMessage(contents, userText, onToolCall) {
    contents.push({ role: 'user', parts: [{ text: userText }] });
    let lastModel;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { response, model } = await generateContent({
        contents,
        config: { tools: [{ functionDeclarations }] },
      });

      lastModel = model;
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const functionCallParts = parts.filter((p) => p.functionCall);

      contents.push({ role: 'model', parts });

      if (functionCallParts.length === 0) {
        return { text: response.text ?? '', model };
      }

      const responseParts = [];
      for (const part of functionCallParts) {
        const { name, args } = part.functionCall;
        let result;
        try {
          result = await dispatchTool(name, args ?? {});
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        onToolCall?.({ name, args: args ?? {}, result });
        responseParts.push({ functionResponse: { name, response: { result: String(result) } } });
      }
      // Newer Gemini API versions dropped the dedicated "function" role for
      // tool results — they go back as a "user" turn instead, same as
      // Claude's tool_result convention.
      contents.push({ role: 'user', parts: responseParts });
    }

    return { text: '(stopped after too many tool-call turns)', model: lastModel };
  }

  return { toolDefs, newConversation, sendMessage, close: () => mcp.closeAll() };
}
