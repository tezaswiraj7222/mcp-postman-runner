# Contributing to mcp-postman-runner

Thanks for your interest in improving the project! 🎉

## Code of Conduct

Be respectful and constructive. Assume good intent.

## How Can I Contribute?

### Reporting Bugs

Open a GitHub issue with: what you expected, what happened, a minimal collection/environment
to reproduce (secrets redacted), the package version, and your Node version.

### Suggesting Features

Open an issue describing the use case and the behaviour you'd like. Keep the scope tight —
this server intentionally replicates only the slice of newman needed to run a folder and
evaluate its scripts.

### Pull Requests

1. Fork and branch from `master`.
2. Make your change with tests.
3. Ensure `npm run typecheck`, `npm test`, and `npm run build` all pass.
4. Use Conventional Commits (see below) — the release is automated from them.

## Development Setup

### Prerequisites

- Node.js >= 18
- npm >= 9

### Getting Started

```bash
# Clone your fork
git clone https://github.com/<you>/mcp-postman-runner.git
cd mcp-postman-runner

# Install dependencies
npm install

# Type-check, test, build (tsc --noEmit → esbuild bundle → terser minify)
npm run typecheck
npm test
npm run build

# Run locally as a stdio MCP server
node dist/index.js --help
```

### Testing Your Changes

Tests use [vitest](https://vitest.dev/) and live next to the code as `*.test.ts`. They mock
the global `fetch` and exercise the real tool handlers — no network required.

```bash
npm test          # run once
npm run test:watch
```

## Coding Guidelines

### TypeScript

- Strict mode is on. Prefer explicit types on public functions.
- ESM only (`"type": "module"`, NodeNext resolution). Import local files with the `.js` suffix.

### Project Layout

- `src/engine.ts` — execution engine (variable resolution, `pm` sandbox, request execution).
- `src/tools/*.ts` — MCP tool registrations (`register*Tools(server)`), one concern per file.
- `src/annotations.ts` — reusable MCP annotation presets.
- `src/server.ts` / `src/index.ts` — server assembly + CLI entry.

### Adding / Changing a Tool

Register tools inside a `register*Tools(server)` function using `server.registerTool(name,
{ title, description, annotations, inputSchema }, handler)` with a zod `inputSchema` and an
annotation preset from `annotations.ts`. Return results via the `toolResult` / `toolError`
helpers in `utils.ts`. Add a test in the matching `*.test.ts`.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: …` → minor release
- `fix: …` / `perf: …` / `refactor: …` → patch release
- `docs:` / `chore:` / `test:` / `ci:` / `style:` → no release
- `feat!:` or a `BREAKING CHANGE:` footer → major release

## Questions?

Open an issue or email t.raj@maxxton.com.
