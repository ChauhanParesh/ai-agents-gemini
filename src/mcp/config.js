import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Every MCP server the agent should connect to at startup.
// Add more entries here to plug in additional MCP servers (your own,
// or third-party ones like @modelcontextprotocol/server-filesystem).
export const mcpServers = [
  {
    id: 'notes',
    command: process.execPath, // current node executable
    args: [path.join(__dirname, 'servers', 'notesServer.js')],
  },
];
