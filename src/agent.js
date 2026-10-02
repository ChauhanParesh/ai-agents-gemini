import 'dotenv/config';
import { createAgentRuntime } from './agentCore.js';

async function main() {
  const runtime = await createAgentRuntime();

  try {
    console.log(`Loaded ${runtime.toolDefs.length} tools: ${runtime.toolDefs.map((t) => t.name).join(', ')}\n`);

    const question =
      process.argv.slice(2).join(' ') ||
      'Save a note titled "demo" with content "hello from the free agent", then list all notes, ' +
        'get the weather in Mumbai, and search the web for the latest Node.js LTS version.';

    console.log(`User: ${question}\n`);
    const contents = runtime.newConversation();
    const { text, model } = await runtime.sendMessage(contents, question, ({ name, args }) => {
      console.log(`  -> tool call: ${name}(${JSON.stringify(args)})`);
    });
    console.log(`\nAgent (${model}): ${text}`);
  } finally {
    // Always close the MCP child process, even on error — leaving it open and
    // then calling process.exit() can crash Node's libuv loop on Windows.
    await runtime.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
