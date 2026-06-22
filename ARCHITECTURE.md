# Architecture

`mcp-postman-runner` is a small, single-purpose MCP server. It executes a folder of a
Postman collection and returns structured results. It is **stateless** and **credential-less**:
every call carries the collection (and optional environment) JSON, and the server uses only what
it is handed.

## Module layout

```
src/
├── index.ts          # CLI entry (--help/--version/--verbose) + stdio transport + graceful shutdown
├── server.ts         # createServer(): builds the McpServer and registers tool groups
├── annotations.ts    # reusable MCP tool annotation presets (READ_ONLY, EXECUTE)
├── utils.ts          # toolResult() / toolError() — wrap values as MCP CallToolResult
├── engine.ts         # the execution engine (no SDK dependency — pure logic, unit-testable)
└── tools/
    ├── runner.ts     # registerRunnerTools(): list_folders, run_folder, run_request (zod schemas)
    └── runner.test.ts# vitest: mocks global fetch, exercises the real handlers
```

The **engine** is deliberately decoupled from the MCP layer so it can be unit-tested without a
transport, and so the same logic could be wrapped in a different transport (e.g. HTTP) later.

## Request lifecycle (`run_folder`)

```
collection + environment JSON
        │
        ▼
 collectVars()  ── merge collection.variable + environment.values → vars{}
        │
        ▼
 findFolder(folderId|folderName) → flattenRequests()   (ordered list of request items)
        │
        ▼  for each item, sequentially (so variables/token are shared):
        │
        ├─ run collection-level pre-request script   ┐  pm sandbox; pm.sendRequest awaited
        ├─ run item-level pre-request script          ┘  (auth token written into vars{})
        ├─ resolveVars(url/headers) → fetch(...)        (per-request timeout via AbortController)
        └─ run item test script over the response      → pm.test results collected
        │
        ▼
 { summary, results[] }   (status, timeMs, assertions[], responseBody, requestError)
```

## The `pm` sandbox

Pre-request and test scripts are executed with `new Function("pm", "console", body)`. A minimal
`pm` object is provided:

- `pm.test(name, fn)` — runs `fn`, captures thrown assertion errors as `{ name, passed, error }`.
- `pm.expect(value)` — a chai-like `Assertion` (subset): `eql`/`equal`/`deep`, `true`/`false`/
  `null`/`undefined`/`ok`/`empty`, `have.property`, `most`/`least`/`above`/`below`/`within`,
  `include`/`oneOf`/`a`/`an`/`match`, `status`, and negation via `.not`.
- `pm.response` — `{ code, status, responseTime, json(), text() }` (only inside test scripts).
- `pm.environment` / `pm.variables` — `get`/`set` backed by the run's `vars{}` (so a token set in
  pre-request is visible to later requests).
- `pm.sendRequest(req, cb)` — performs a `fetch` and invokes the callback with a response-like
  object; pre-request execution awaits any in-flight `sendRequest` before continuing.

This is **not** a full Postman runtime. It implements the common subset used by API smoke/contract
tests. Unsupported `pm.*` calls will throw inside the script and surface as a failed assertion or a
script error — extend `engine.ts` as needed.

## Design decisions

- **Engine vs transport split** — logic in `engine.ts`, MCP wiring in `tools/` + `server.ts`.
- **Sequential execution** — requests in a folder run in order to share the auth token and any
  variables a pre-request sets, mirroring a Postman collection run.
- **Exactly one HTTP call per request** — the engine controls execution 1:1, so results never
  duplicate.
- **Truncated bodies** — response bodies are capped at 20k chars to stay context-friendly.
- **No newman, no credential store** — keeps the install tiny and the trust surface small.

## Build & release

- **Build:** `tsc --noEmit` (typecheck) → `esbuild` bundle (ESM, externals) → `terser` minify →
  `dist/index.js` with a `#!/usr/bin/env node` shebang. `bin` points at `dist/index.js`.
- **Release:** semantic-release on `master` (Conventional Commits) versions, updates the
  CHANGELOG, and publishes to npm via the GitHub Actions workflow.
