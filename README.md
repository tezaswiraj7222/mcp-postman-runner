# mcp-postman-runner

> Run the requests in a Postman collection folder — and get structured, assertion-level results back — straight from your AI assistant.

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that executes a
**folder** of a Postman collection: it resolves `{{variables}}`, runs the collection + item
**pre-request scripts** (so token-auth patterns work), fires each request, and evaluates the
embedded **`pm.test`** scripts — then returns status, timing, body, and per-assertion pass/fail.

It replicates only the slice of [newman](https://github.com/postmanlabs/newman) needed for
agent-driven API testing, with **no runtime dependencies** beyond the MCP SDK and zod.

## 🎯 Why use this

The Postman connector/API can *create* requests but can't *run* them. This server is the
**execution engine** in a Jira → Postman → assess → comment workflow:

```
Jira ticket ─► derive test cases ─► create a Postman folder (named = ticket key) with pm.test scripts
   ─► run_folder (this MCP) ─► assess responses ─► comment results on the ticket
```

### Supported AI assistants

Any MCP client — Claude Desktop, Claude Cowork, GitHub Copilot (VS Code), Cursor, Windsurf, etc.

## ✨ Features

- **Folder execution** — run every request in a folder, in order, sharing variables across the run.
- **Auth that just works** — collection/item pre-request scripts run (incl. `pm.sendRequest`), so a token fetched once flows to the rest of the folder.
- **Assertion evaluation** — the embedded `pm.test` scripts run via a minimal `pm`/`expect` sandbox; you get deterministic pass/fail per assertion.
- **Structured output** — status, time, response body (truncated), and assertion details for each request, ready for an agent to assess.
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
| `run_folder` | Run every request in a folder; return results + assertions | `collection`, `folderName` *(e.g. the Jira ticket key)* or `folderId`, `environment?`, `timeoutRequestMs?` |
| `run_request` | Run a single named request (re-run one case) | `collection`, `requestName`, `folderName?`/`folderId?`, `environment?` |

All tools take the **collection JSON** (the `collection` object from the Postman API /
connector's `getCollection`), and optionally an **environment JSON**.

### `run_folder` / `run_request` result

```jsonc
{
  "summary": { "totalRequests": 9, "requestsErrored": 0, "assertionsTotal": 24, "assertionsFailed": 4, "anyFailure": true },
  "results": [
    {
      "name": "TC-01 Happy path", "method": "GET",
      "url": "https://api-dev.example.net/api/v2/countries/states/cities",
      "status": 200, "statusText": "OK", "timeMs": 142,
      "assertionsPassed": 3, "assertionsFailed": 0,
      "assertions": [ { "name": "status is 200", "passed": true, "error": null } ],
      "responseBody": "{ … }"   // truncated at 20k chars
    }
  ]
}
```

## 🔬 How it works

1. **Variables** — merges collection variables + environment values; resolves `{{var}}` (nested, iteratively).
2. **Auth / pre-request** — runs the collection-level then item-level pre-request scripts. `pm.sendRequest` is supported, so the common "POST the auth URL, store the token, reuse it" pattern works; the token is cached in the run's variables.
3. **Request** — builds the URL/headers/method, fires it with `fetch` (per-request timeout).
4. **Assertions** — runs the request's `test` script through a `pm`/`expect` sandbox and records each `pm.test` result.

### Supported `pm` subset

`pm.test`, `pm.expect` (`eql`/`equal`/`deep`, `true`/`false`/`null`, `have.property`,
`at.most`/`least`, `above`/`below`, `within`, `include`, `oneOf`, `a`/`an`, `match`, `empty`,
negation via `.not`), `pm.response.code`/`.json()`/`.text()`, `pm.environment` & `pm.variables`
get/set, and `pm.sendRequest`. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for details.

## 🔒 Security

Credential-less by design; secrets in the passed environment are kept in memory for one run and
never logged. **Only run collections you trust** — their pre-request/`pm.test` scripts execute in
the server process. See [`SECURITY.md`](./SECURITY.md).

## 🤝 Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Uses Conventional Commits + semantic-release.

## 📜 License

[MIT](./LICENSE)

## 🔗 Links

- Issues: https://github.com/tezaswiraj7222/mcp-postman-runner/issues
- MCP: https://modelcontextprotocol.io
