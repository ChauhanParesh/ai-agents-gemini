import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRuntime } from './src/agentCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const runtime = await createAgentRuntime();
console.log(`Loaded ${runtime.toolDefs.length} tools: ${runtime.toolDefs.map((t) => t.name).join(', ')}`);

// Single shared conversation — this is a local single-user demo UI, so one
// in-memory history is enough. Reset via POST /api/reset or the UI's button.
let contents = runtime.newConversation();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tools', (_req, res) => {
  res.json({ tools: runtime.toolDefs.map((t) => ({ name: t.name, description: t.description })) });
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const toolCalls = [];
  try {
    const { text, model } = await runtime.sendMessage(contents, message, (call) => toolCalls.push(call));
    res.json({ text, toolCalls, model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (_req, res) => {
  contents = runtime.newConversation();
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log(`\nUI running at http://localhost:${PORT}\n`);
});

async function shutdown() {
  server.close();
  await runtime.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
