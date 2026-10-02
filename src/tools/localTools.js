// A couple of trivial in-process tools, useful as a baseline / for testing
// the agent loop without hitting any network or MCP server.

export const localToolDefs = [
  {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression, e.g. "12 * (3 + 4)".',
    input_schema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    name: 'get_time',
    description: 'Get the current server time in ISO format.',
    input_schema: { type: 'object', properties: {} },
  },
];

export async function runLocalTool(name, input) {
  switch (name) {
    case 'calculator':
      // eslint-disable-next-line no-eval
      return String(Function(`"use strict"; return (${input.expression});`)());
    case 'get_time':
      return new Date().toISOString();
    default:
      throw new Error(`Unknown local tool: ${name}`);
  }
}
