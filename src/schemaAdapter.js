// Converts our neutral tool defs ({ name, description, input_schema }, plain
// JSON Schema with lowercase types) into Gemini's functionDeclarations shape,
// which wants uppercase type strings (STRING, OBJECT, ...) and errors on an
// empty `properties` object, so no-arg tools must omit `parameters` entirely.

const TYPE_MAP = {
  object: 'OBJECT',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
};

// Fields MCP servers' JSON Schema output (via zod-to-json-schema) may include
// that Gemini's API doesn't recognize and will reject as unknown properties.
const UNSUPPORTED_KEYS = ['$schema', '$id', 'additionalProperties'];

function convertSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  for (const key of UNSUPPORTED_KEYS) delete out[key];
  if (typeof out.type === 'string') {
    out.type = TYPE_MAP[out.type.toLowerCase()] ?? out.type.toUpperCase();
  }
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [key, convertSchema(value)]),
    );
  }
  if (out.items) out.items = convertSchema(out.items);
  return out;
}

export function toGeminiFunctionDeclarations(toolDefs) {
  return toolDefs.map((tool) => {
    const decl = { name: tool.name, description: tool.description };
    const props = tool.input_schema?.properties;
    if (props && Object.keys(props).length > 0) {
      decl.parameters = convertSchema(tool.input_schema);
    }
    return decl;
  });
}
