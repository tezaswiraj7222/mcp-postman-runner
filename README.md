# mcp-postman-runner

> Run the requests in a Postman collection folder — and get structured, assertion-level results back — straight from your AI assistant.

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that executes a
**folder** of a Postman collection: it resolves `{{variables}}`, runs the collection + item
**pre-request scripts** (so token-auth patterns work), previews or fires each request, supports
read and write-method payloads, and evaluates embedded **`pm.test`** scripts — then returns status,
timing, request diagnostics, response metadata, body, and per-assertion pass/fail.

It replicates only the slice of [newman](https://github.com/postmanlabs/newman) needed for
agent-driven API testing, with **no runtime dependencies** beyond the MCP SDK and zod.

## 🎯 Why use this

The Postman connector/API can *create* requests but can't *run* them. This server is the
**execution engine** in a Jira → Postman → assess → comment workflow:

```text
Jira ticket ─► derive test cases ─► create a Postman folder (named = ticket key) with pm.test scripts
   ─► run_folder (this MCP) ─► assess responses ─► comment results on the ticket
```

### Supported AI assistants

Any MCP client — Claude Desktop, Claude Cowork, GitHub Copilot (VS Code), Cursor, Windsurf, etc.

## ✨ Features

- **Folder execution** — run every request in a folder, in order, sharing variables across the run.
- **Preflight previews** — inspect resolved URLs, methods, redacted headers, body mode/preview,
  write-request count, and safety warnings before sending any HTTP traffic.
- **Auth that just works** — collection/item pre-request scripts run (incl. `pm.sendRequest`), so a token fetched once flows to the rest of the folder.
- **Write-method payload support** — execute POST/PUT/PATCH/DELETE tests with raw, JSON,
  urlencoded, form-data, and GraphQL body modes.
- **Safety gates** — production-like targets and write methods are blocked unless the caller passes
  explicit approval flags for that run.
- **Assertion evaluation** — the embedded `pm.test` scripts run via a minimal `pm`/`expect` sandbox; you get deterministic pass/fail per assertion.
- **Structured output** — status, time, redacted request diagnostics, response body metadata,
  truncated response body, and assertion details for each request, ready for an agent to assess.
- **Credential-less** — holds no secrets; the caller passes the collection/environment JSON.
- **Zero runtime deps** — only `@modelcontextprotocol/sdk` and `zod`.

## 📋 Prerequisites

- **Node.js >= 18** (uses the global `fetch`).
- Network access from wherever this runs to the API under test.
- A Postman collection (and optional environment) JSON — typically fetched via the Postman API/connector.

## 🚀 Quick start

Add to your MCP client config:

```jsonc
{
  "mcpServers": {
    "postman-runner": {
      "command": "npx",
      "args": ["-y", "mcp-postman-runner@latest"]
    }
  }
}
```

`npx` fetches and caches the package on first launch. CLI help: `npx -y mcp-postman-runner@latest --help`.

## 🛠️ Tools

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `list_folders` | List folders in a collection (name, id, path, request count) | `collection` |
| `preview_requests` | Resolve a folder/request without HTTP execution; return redacted targets, bodies, safety warnings, and write counts | `collection`, `folderName?`/`folderId?`, `requestName?`, `environment?`, `allowProduction?`, `allowWrites?`, `approvalNote?` |
| `run_folder` | Run every request in a folder; return results + assertions | `collection`, `folderName` *(e.g. the Jira ticket key)* or `folderId`, `environment?`, `timeoutRequestMs?`, `allowProduction?`, `allowWrites?`, `approvalNote?` |
| `run_request` | Run a single named request (re-run one case) | `collection`, `requestName`, `folderName?`/`folderId?`, `environment?`, `allowProduction?`, `allowWrites?`, `approvalNote?` |

All tools take the **collection JSON** (the `collection` object from the Postman API /
connector's `getCollection`), and optionally an **environment JSON**.

### Safety-first workflow

1. Fetch the collection and environment JSON from Postman.
2. Use `list_folders` to choose the exact folder.
3. Use `preview_requests` to inspect resolved URLs, HTTP methods, redacted auth, body previews,
   `writeRequests`, and `safety` warnings.
4. If the target is production-like, get explicit approval for the exact base URL, auth source,
   scope/tenant, HTTP methods, and data sensitivity, then pass `allowProduction: true` with an
   `approvalNote`.
5. If the folder contains POST/PUT/PATCH/DELETE requests, confirm the environment is safe for
   mutation, then pass `allowWrites: true` with an `approvalNote`.
6. Call `run_folder` or `run_request` only after the preview is approved.

By default, the runner blocks production-like targets and write methods. This is deliberate:
GET/read-only requests can expose real data, and write-method requests can mutate state.

### `preview_requests` result

```jsonc
{
  "summary": {
    "totalRequests": 3,
    "methodCounts": { "GET": 1, "POST": 1, "PUT": 1 },
    "writeRequests": 2,
    "warnings": 0
  },
  "safety": {
    "blocked": true,
    "productionLikeTargets": ["https://api.example.com/v1/orders"],
    "writeMethods": ["POST", "PUT"],
    "warnings": [
      "production-like target detected; pass allowProduction with an approval note to execute",
      "write methods detected; pass allowWrites after confirming the target is safe for mutation"
    ],
    "approvalNote": null
  },
  "requests": [
    {
      "name": "TC-02 create order",
      "method": "POST",
      "url": "https://api-dev.example.net/v1/orders?api_key=%3Credacted%3E",
      "headers": { "Authorization": "<redacted>", "Content-Type": "application/json" },
      "body": {
        "mode": "raw",
        "sent": true,
        "contentType": "application/json",
        "bytes": 42,
        "preview": "{\"name\":\"Demo\",\"password\":\"<redacted>\"}",
        "previewTruncated": false
      },
      "warnings": []
    }
  ]
}
```

### `run_folder` / `run_request` result

```jsonc
{
  "summary": {
    "totalRequests": 9,
    "requestsErrored": 0,
    "assertionsTotal": 24,
    "assertionsFailed": 4,
    "anyFailure": true,
    "durationMs": 1420,
    "methodCounts": { "GET": 7, "POST": 1, "PUT": 1 },
    "statusCounts": { "200": 7, "400": 2 },
    "bytesReceived": 21860
  },
  "results": [
    {
      "name": "TC-01 Happy path", "method": "GET",
      "url": "https://api-dev.example.net/api/v2/countries/states/cities",
      "request": {
        "method": "GET",
        "url": "https://api-dev.example.net/api/v2/countries/states/cities",
        "headers": { "Authorization": "<redacted>" },
        "body": { "mode": null, "sent": false, "contentType": null, "bytes": null, "preview": null, "previewTruncated": false }
      },
      "status": 200, "statusText": "OK", "timeMs": 142,
      "assertionsPassed": 3, "assertionsFailed": 0,
      "assertions": [ { "name": "status is 200", "passed": true, "error": null } ],
      "response": { "contentType": "application/json", "bytes": 2186, "bodyTruncated": false },
      "responseBody": "{ ... }",   // truncated at 20k chars
      "warnings": []
    }
  ]
}
```

### Write-method payload support

The runner supports the common Postman body modes used for POST/PUT/PATCH/DELETE tests:

| Postman body mode | Runner behavior |
| --- | --- |
| `raw` | Resolves variables and sends the raw string. If Postman marks it as JSON, or the body parses as JSON, `Content-Type: application/json` is inferred when missing. |
| `urlencoded` | Sends `application/x-www-form-urlencoded` and skips disabled params. |
| `formdata` | Sends `FormData` fields and skips disabled fields. File fields are represented as string placeholders and returned as warnings; local file loading is intentionally not performed. |
| `graphql` | Sends `{ query, variables }` as JSON and reports invalid variables JSON as a warning. |
| `file` / unsupported modes | Request preview/result includes a warning; local file body upload is not implemented. |

Bodies are sent only for methods where HTTP payloads make sense. If a body is defined on `GET` or
`HEAD`, the runner omits it and records a warning.

## 🔬 How it works

1. **Variables** — merges collection variables + environment values; resolves `{{var}}` (nested, iteratively).
2. **Request build** — builds resolved URL, headers, method, body, redacted diagnostics, and safety warnings.
3. **Preview or execute** — `preview_requests` stops after request build; `run_folder` / `run_request` continue only if safety gates pass.
4. **Auth / pre-request** — execution runs collection-level then item-level pre-request scripts. `pm.sendRequest` is supported, so the common "POST the auth URL, store the token, reuse it" pattern works; the token is cached in the run's variables.
5. **Request** — fires with `fetch` (per-request timeout), including supported write-method bodies.
6. **Assertions** — runs the request's `test` script through a `pm`/`expect` sandbox and records each `pm.test` result.

### Supported `pm` subset

`pm.test`, `pm.expect` (`eql`/`equal`/`deep`, `true`/`false`/`null`, `have.property`,
`at.most`/`least`, `above`/`below`, `within`, `include`, `oneOf`, `a`/`an`, `match`, `empty`,
negation via `.not`), `pm.response.code`/`.json()`/`.text()`, `pm.environment` & `pm.variables`
get/set, and `pm.sendRequest`. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for details.

## 🔌 Platform integration

### Claude Desktop

Add the server to `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "postman-runner": {
      "command": "npx",
      "args": ["-y", "mcp-postman-runner@latest"]
    }
  }
}
```

Restart Claude Desktop. A safe prompt pattern is: fetch the Postman collection/environment, call
`preview_requests`, show the safety summary, and only run the folder after you approve the target.

### GitHub Copilot in VS Code

Register the same `npx -y mcp-postman-runner@latest` command in your VS Code MCP/tool setup. A
useful Jira-driven flow is:

1. Fetch the Jira ticket and endpoint contract.
2. Use a Postman connector to fetch `getCollection(model: "full")` and `getEnvironment(...)`.
3. Call `list_folders` and choose the ticket folder.
4. Call `preview_requests` and inspect `safety`, resolved target URLs, and write-method payloads.
5. Call `run_folder` with `allowProduction` / `allowWrites` only when explicitly approved.
6. Ask Copilot to classify results into PASS / FAIL / WARNING / NEEDS-DATA / BLOCKED.

### Cursor and Windsurf

Configure an MCP server named `postman-runner` with:

```jsonc
{
  "command": "npx",
  "args": ["-y", "mcp-postman-runner@latest"]
}
```

Then provide the agent with collection/environment JSON from a Postman connector, the Postman API,
or sanitized fixtures. This MCP does not authenticate to Postman; it only runs the JSON you pass in.

### Postman connector / API workflow

Use this server alongside a Postman connector:

1. `getCollection(model: "full")` → pass the returned `collection` object here.
2. `getEnvironment(...)` → pass the returned `environment` object when variables/auth are needed.
3. `preview_requests({ collection, environment, folderName })` → inspect resolved requests and safety gates.
4. `run_folder({ collection, environment, folderName, allowWrites, allowProduction, approvalNote })` → execute after approval.

For Jira-driven testing, name the Postman folder after the ticket key so runner results map cleanly
back to test-case IDs and ticket comments.

## 🔒 Security

Credential-less by design; secrets in the passed environment are kept in memory for one run and
never logged. Returned diagnostics redact sensitive-looking headers, query parameters, and JSON/form
body keys. **Only run collections you trust** — their pre-request/`pm.test` scripts execute in the
server process. See [`SECURITY.md`](./SECURITY.md).

Before running against production or production-like targets, use `preview_requests` and get
explicit approval for the exact base URL, auth source, scope, methods, and data sensitivity. GET
requests can still expose real data; write methods can mutate state.

## 🤝 Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Uses Conventional Commits + semantic-release.

## 📜 License

[MIT](./LICENSE)

## 🔗 Links

- Issues: <https://github.com/tezaswiraj7222/mcp-postman-runner/issues>
- MCP: <https://modelcontextprotocol.io>
