# Publishing

This package is published to npm automatically by **semantic-release** from Conventional
Commits. Manual publishing is the fallback.

## Published files

Only the built output and a few docs ship (see `files` in `package.json` and `.npmignore`):

- `dist/` (bundled, minified `index.js` with shebang)
- `assets/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `SECURITY.md`

Source `.ts`, tests, configs, `.github/`, and `docs/` are excluded from the tarball.

## Automated release (recommended)

1. Land commits on `master` using Conventional Commits (`feat:`, `fix:`, `feat!:`, …).
2. The **Release** GitHub Actions workflow (`.github/workflows/publish.yml`) runs
   `build` → `test` → `npx semantic-release`, which:
   - determines the next version from commits,
   - updates `CHANGELOG.md` and `package.json`,
   - publishes to npm (with provenance) and creates the GitHub release.

### Required CI secrets

- `NPM_TOKEN` — npm automation token with publish rights (or configure npm Trusted Publishing/OIDC).
- `GH_ACTION_TOKEN` — token allowed to push the release commit/tag and create releases.

## Manual release (fallback)

```bash
npm run typecheck && npm test && npm run build
npm pack --dry-run     # inspect tarball contents
npm login
npm publish            # unscoped public
# or, for a scoped name (@org/…):
npm publish --access public
```

## Versioning

Semantic Versioning (`MAJOR.MINOR.PATCH`), driven by commit types:
`fix`/`perf`/`refactor` → patch, `feat` → minor, `feat!`/`BREAKING CHANGE` → major.

## First-publish checklist

- [ ] Confirm the package name is free: `npm view mcp-postman-runner` (404 = available),
      or scope it `@your-org/…` and publish `--access public`. The name must match the plugin's
      `.mcp.json` args.
- [ ] Set the real `repository.url`, `bugs.url`, and `homepage` in `package.json`.
- [ ] Verify after publish: `npx -y mcp-postman-runner@latest --version`.
