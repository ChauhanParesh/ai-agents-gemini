import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpServers } from './config.js';

const PREFIX = 'mcp__';

// Connects to every configured MCP server, exposes their tools in a neutral
// { name, description, input_schema } shape (plain JSON Schema, lowercase
// types), and dispatches tool calls back to the right server. The neutral
// shape gets adapted to whatever the LLM provider expects in agent.js.
export class McpToolRegistry {
  #clients = new Map(); // serverId -> Client
  #toolOwners = new Map(); // prefixedName -> { serverId, originalName }

  async connectAll() {
    for (const server of mcpServers) {
      const client = new Client({ name: `agent-client-${server.id}`, version: '1.0.0' });
      const transport = new StdioClientTransport({ command: server.command, args: server.args });
      await client.connect(transport);
      this.#clients.set(server.id, client);
    }
  }

  /** Returns tools as [{ name, description, input_schema }]. */
  async listToolDefs() {
    const defs = [];
    for (const [serverId, client] of this.#clients) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const prefixedName = `${PREFIX}${serverId}__${tool.name}`;
        this.#toolOwners.set(prefixedName, { serverId, originalName: tool.name });
        defs.push({
          name: prefixedName,
          description: `[MCP:${serverId}] ${tool.description ?? ''}`,
          input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
        });
      }
    }
    return defs;
  }

  isMcpTool(name) {
    return this.#toolOwners.has(name);
  }

  async callTool(prefixedName, args) {
    const owner = this.#toolOwners.get(prefixedName);
    if (!owner) throw new Error(`Unknown MCP tool: ${prefixedName}`);
    const client = this.#clients.get(owner.serverId);
    const result = await client.callTool({ name: owner.originalName, arguments: args ?? {} });
    const text = (result.content ?? [])
      .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
      .join('\n');
    return text;
  }

  async closeAll() {
    for (const client of this.#clients.values()) {
      await client.close();
    }
  }
}
