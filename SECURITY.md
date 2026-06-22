# Security Policy

## Supported Versions

Only the latest published version on npm is supported with security updates.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

### How to Report

Please report security issues privately to **t.raj@maxxton.com** (or open a GitHub
security advisory). Do **not** open a public issue for an undisclosed vulnerability.

### What to Include

- A description of the issue and its impact
- Steps to reproduce (a minimal collection/environment that triggers it, with secrets redacted)
- Affected version(s) and environment

### Response Timeline

- Acknowledgement within 3 business days
- A remediation plan or fix target within 10 business days where feasible

## Security Model

This server is **credential-less by design**: it holds no Postman, Jira, or target-API
secrets. Each call carries the collection (and optional environment) JSON supplied by the
caller, and the server uses only what it is handed.

### What the server does with your data

- **Variables & secrets** from the environment (e.g. a `clientSecret` used to fetch a token)
  are kept **in memory for the duration of a single run** and are not persisted.
- **No request/response body logging.** The server does not log collection contents, tokens,
  or response bodies. Response bodies returned to the caller are truncated at 20k characters.
- **Script execution.** Pre-request and `pm.test` scripts contained in the collection are
  executed with Node's `Function` constructor inside the server process. **Only run
  collections you trust** — a malicious collection's scripts run with the server's
  privileges (this is the same trust model as running a collection in Postman/newman).

### Best Practices

- Treat Postman environments that contain secrets as sensitive; do not commit them.
- Prefer non-production credentials and test environments for automated runs.
- If you deploy this as a shared remote service, require an auth token and restrict network access.

## Known Considerations

- **Arbitrary script execution:** by design the server runs the JS in the collection's
  pre-request/test scripts. Do not point it at untrusted collections.
- **Outbound requests:** the server makes the HTTP calls defined in the collection, from
  wherever it runs. Place it where that egress is acceptable.
