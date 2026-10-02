#!/usr/bin/env node
// A standalone MCP server exposing "notes" tools over stdio.
// Run standalone for debugging with: node src/mcp/servers/notesServer.js
// Normally it's spawned automatically by the agent's MCP client (see src/mcp/client.js).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', '..', '..', 'data', 'notes.json');

async function loadNotes() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function saveNotes(notes) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(notes, null, 2));
}

const server = new McpServer({ name: 'notes-server', version: '1.0.0' });

server.registerTool(
  'add_note',
  {
    title: 'Add note',
    description: 'Save a new note with a title and body text.',
    inputSchema: { title: z.string(), content: z.string() },
  },
  async ({ title, content }) => {
    const notes = await loadNotes();
    const note = { id: crypto.randomUUID(), title, content, createdAt: new Date().toISOString() };
    notes.push(note);
    await saveNotes(notes);
    return { content: [{ type: 'text', text: `Saved note ${note.id}: "${title}"` }] };
  },
);

server.registerTool(
  'list_notes',
  {
    title: 'List notes',
    description: 'List all saved notes (id, title, createdAt).',
    inputSchema: {},
  },
  async () => {
    const notes = await loadNotes();
    const summary = notes.map(({ id, title, createdAt }) => ({ id, title, createdAt }));
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },
);

server.registerTool(
  'search_notes',
  {
    title: 'Search notes',
    description: 'Search notes by a keyword found in the title or content.',
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const notes = await loadNotes();
    const q = query.toLowerCase();
    const matches = notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
    return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
  },
);

server.registerTool(
  'delete_note',
  {
    title: 'Delete note',
    description: 'Delete a note by its id.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const notes = await loadNotes();
    const remaining = notes.filter((n) => n.id !== id);
    const deleted = remaining.length !== notes.length;
    await saveNotes(remaining);
    return { content: [{ type: 'text', text: deleted ? `Deleted ${id}` : `No note with id ${id}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
