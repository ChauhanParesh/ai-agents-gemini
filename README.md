# ai-agent-gemini

Same agent pattern as [`ai-agent`](../ai-agent) — direct API calls, web search, and MCP tool calling in one loop — but with **nothing that requires a paid key**:

| Piece | Backend | Cost |
|---|---|---|
| LLM | [Google Gemini API](https://aistudio.google.com/apikey) (`gemini-3.8-flash`, auto-falls back to `gemini-3.5-flash` / `gemini-3.5-flash-lite`) | Free tier, free API key, no credit card |
| Web search | DuckDuckGo HTML scrape | Free, no key at all |
| Direct API tool | Open-Meteo weather API | Free, no key at all |
| MCP server | Your own `notesServer.js`, run locally | Free, no key at all |

## Setup

Requires **Node 20+** (the Gemini SDK's HTTP layer needs a Node version with a native `File` global).

```bash
npm install
cp .env.example .env
```

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Google account, no billing required) and put it in `.env`:

```
GEMINI_API_KEY=AIza...
```

## Run

```bash
npm start
# or with your own prompt:
node src/agent.js "Save a note about today's standup, then search the web for the current Node.js LTS version"
```

Or run the web chat UI instead:

```bash
npm run ui
```

Then open `http://localhost:3000`. It's an Express server ([server.js](server.js)) serving a small chat frontend ([public/](public)) — same agent underneath, shows tool calls inline as it makes them, keeps one conversation in memory (reset with the UI's button or `POST /api/reset`).

While developing the server, use the hot-reload variant instead — Node's built-in `--watch` restarts it automatically whenever `server.js` or anything under `src/` changes (edits to `public/*` never needed a restart; Express serves those fresh from disk every request):

```bash
npm run ui:dev
```

## Model fallback and retry

Gemini's free tier can return `503 UNAVAILABLE` (overloaded) or `429 RESOURCE_EXHAUSTED` (rate limit / quota). [`src/geminiRetry.js`](src/geminiRetry.js) handles both automatically:

- **Retries with exponential backoff** (up to 3 retries, ~1s/2s/4s + jitter, or the server's own suggested delay when it gives one) on transient errors (429, 500, 502, 503, 504) before giving up on a model.
- **Falls back to the next model** in the list — `GEMINI_MODEL` (default `gemini-3.8-flash`) → `gemini-3.5-flash` → `gemini-3.5-flash-lite` — once a model's retries are exhausted, or immediately on a non-retryable error (e.g. 404 if a model name gets deprecated).
- **Recognizes a daily-quota 429 specifically** (newer/limited-preview models can have a free tier as low as ~20 requests/day) and skips straight to the next model with zero wasted retries, then parks that model in a 1-hour cooldown so later calls don't even attempt it until the cooldown passes.
- **Sticky**: once a fallback model succeeds, later turns start from that model instead of re-trying an overloaded/exhausted primary on every single message. Resets to the top of the list once every model in it has failed (the cooldown still protects daily-exhausted ones from being retried too soon).

You'll see this in the console as `[gemini] ... retrying in ...` / `... falling back to ...` / `... parking it for ...` / `... skipped — ... cooling down ...` lines.

## How it differs from the Claude version

- **LLM client**: [`@google/genai`](https://www.npmjs.com/package/@google/genai) instead of `@anthropic-ai/sdk`. Gemini's function-calling message shape is different from Claude's (tool results go back as a `user`-role turn with `functionResponse` parts, no per-call `id` — see [`src/agentCore.js`](src/agentCore.js)).
- **Tool schema**: Gemini wants JSON Schema with uppercase type names (`STRING`, `OBJECT`, ...) and rejects empty `properties: {}` on no-arg tools. [`src/schemaAdapter.js`](src/schemaAdapter.js) converts our plain JSON Schema tool defs to that shape.
- **Web search**: Claude's version used Anthropic's native server-side search tool. Gemini's equivalent (Google Search grounding) isn't guaranteed to be free on every account tier, so this version uses a keyless DuckDuckGo scrape instead — see [`src/tools/webSearch.js`](src/tools/webSearch.js).
- **MCP server and direct API tool are unchanged** — `notesServer.js` and `get_weather` are plain MCP/JSON-Schema, not tied to any LLM provider, so they're reused as-is.

## Project layout

```
server.js                   # Express backend for the web chat UI
public/                     # chat UI frontend (plain HTML/CSS/JS, no build step)
src/
  agent.js                  # CLI entrypoint
  agentCore.js               # shared agent loop — used by both agent.js and server.js
  geminiRetry.js              # retry + exponential backoff + model fallback
  schemaAdapter.js             # JSON Schema -> Gemini functionDeclarations
  tools/
    localTools.js              # calculator, get_time
    directApi.js                # get_weather (Open-Meteo, no key)
    webSearch.js                 # DuckDuckGo scrape (no key)
  mcp/
    config.js                    # MCP servers to spawn/connect to
    client.js                     # MCP client: connects, lists tools, dispatches calls
    servers/
      notesServer.js               # your own MCP server (add/list/search/delete notes)
data/
  notes.json                      # created at runtime by the notes MCP server
```

## Swapping in a different free LLM

If you'd rather run fully local with no cloud account at all, swap `src/agent.js`'s Gemini client for [Ollama](https://ollama.com) (`POST http://localhost:11434/api/chat` with a `tools` array in OpenAI function-calling format, using a tool-capable model like `llama3.1` or `qwen2.5`). The rest of the project — MCP client/server, direct API tool, web search — stays exactly the same; only the LLM call and response parsing change.
