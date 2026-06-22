import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap any JSON-serialisable value as a standard MCP text result. */
export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an error message as an MCP error result. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}
