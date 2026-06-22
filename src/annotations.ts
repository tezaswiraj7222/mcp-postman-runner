/**
 * Reusable MCP tool annotation presets.
 *
 * These hints help MCP clients categorise and prioritise tools. All properties are
 * hints only — they are not enforced by the protocol.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools#annotations
 */

/** Read-only tool — safe to call, no side-effects (e.g. inspecting a collection). */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Execution tool — sends the requests defined in the collection to the outside world.
 * Side-effects depend entirely on the requests in the folder (GETs are safe; the
 * collection may contain writes), so this is neither read-only nor guaranteed idempotent.
 */
export const EXECUTE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
