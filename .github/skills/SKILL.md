---
name: test-api-from-ticket
description: >-
  Design, execute, and assess a 360° API test pass for a Jira ticket. Use when the user says
  "test the API for MXTS-12345", "QA this endpoint", "run API tests for this ticket",
  "create test cases for a ticket in Postman", or "validate the API in this ticket". Reads the
  ticket and the endpoint contract, derives an exhaustive but relevant test matrix (happy path,
  schema/contract, pagination, sorting, filtering, negative/validation, auth, status & error
  contract, data integrity, headers, i18n, docs parity), builds a Postman folder of requests
  with deterministic pm.test scripts, executes them via the postman-runner MCP, assesses each
  result (PASS / FAIL / NEEDS-DATA / BLOCKED / WARNING), and posts a structured comment on the
  ticket. Distinguishes real defects from data/environment issues and from outdated ticket specs.
---

# Test an API from a Jira ticket — 360° design, execution & assessment

You are acting as a senior API QA engineer. Your job is not to "hit the endpoint once" — it is to
**design a thorough test pass, run it, and assess it with judgement**. Be exhaustive about the
scenarios that *apply*, ruthless about relevance, and precise about classification.

## Operating principles

1. **Derive coverage from the contract, not guesswork.** Every test case must trace to something:
   an acceptance criterion, a documented parameter/field, a status code, or a known risk pattern.
2. **Cover 360°, but only what applies.** Walk the full category catalog in
   `references/test-matrix.md` and include a category only when the endpoint has that surface
   (e.g. skip pagination if the response isn't paginated). State explicitly which categories you
   skipped and why.
3. **Assert deterministically, judge semantically.** Each request carries `pm.test` scripts the
   runner evaluates (status, schema shape, contract rules). You then read the response bodies for
   meaning the scripts can't capture.
4. **Classify honestly.** A non-2xx is not automatically a defect, and a 2xx is not automatically a
   pass. Separate **real defect** vs **test-data/environment issue** vs **ticket spec is outdated**
   vs **undocumented-but-acceptable behaviour**. Use the rubric in
   `references/assessment-and-reporting.md`.
5. **Never fabricate.** If a scenario can't be validated (missing data, dependency down), mark it
   NEEDS-DATA / BLOCKED — do not guess the outcome.
6. **Confirm before writing.** Get the user's sign-off on targets and the test matrix before
   creating anything in Postman.
7. **Production is blocked by default.** Never execute requests against production or
   production-like targets unless the user explicitly approves that exact run. This applies to
   GET/read-only requests too.

## Inputs to confirm first

- **Ticket key** (e.g. `MXTS-12345`).
- **Postman workspace + collection** to work in (list and ask if not given — never guess).
- **Environment** holding base URL, auth URL/credentials, and variables (e.g. the per-concern env).
- **Target environment** (dev/acc/prod) and any **seed data** needed (valid IDs for path params).
- **Environment safety classification**: dev/test/acc/staging/prod. Treat production-like base URLs,
  production auth URLs, real customer scopes, or URLs without an explicit non-prod marker as
  production-like until the user confirms otherwise.
- **Explicit production approval**, when applicable: before running any production-like request,
  ask the user to approve the exact base URL, environment/auth source, scope/concern, HTTP methods,
  and data sensitivity for this run. Do not infer approval from the ticket mentioning production.

Do not create or run anything until workspace, collection, environment, environment safety,
and the test matrix are confirmed. If the target is production-like and explicit approval is not
given, stop before execution and mark the run BLOCKED by safety gate.

## Step 1 — Understand the endpoint

Fetch the ticket (`getJiraIssue`, include comments) and extract:

- HTTP method(s), path, and **path/query params** (type, required, default, allowed values).
- The **response contract**: fields, types, nullability, enums, pagination envelope.
- **Acceptance criteria** (map each to one or more test cases later).
- **Documented status codes** and error shapes; **auth/permission** requirements.
- **Dependencies** (e.g. an internal service the endpoint calls) — these drive failure-mode tests.
- Cross-check against external docs (e.g. developers portal) and the OpenAPI/Swagger spec where
  available; note any **drift** between ticket, docs, and implementation up front.

If the ticket already contains a QA test-case list or prior run, reuse and extend it — do not
discard prior knowledge.

## Step 2 — Derive the test matrix

Walk `references/test-matrix.md` category by category. For each applicable category, enumerate
concrete cases with: ID, name, method, URL + params, precondition/seed, expected status, and the
specific assertions. Include boundary and negative cases, not just happy paths. Tie each case to an
AC or a risk. Present the matrix to the user as a table and get confirmation. Note skipped
categories with a one-line reason.

Include an **execution safety row** in the matrix: target environment, base URL, auth source/scope,
HTTP methods, expected data access, and whether production approval is required/received. If that
row is not confirmed, do not build or run requests.

## Step 3 — Build the Postman folder

In the confirmed workspace + collection, create a folder named exactly the **ticket key**. **There is no dedicated create-folder tool** — create it via `putCollection` (fetch the whole collection, append a folder object to the top-level `item` array, replace). See `references/postman-folder-setup.md` for the exact technique and pitfalls. Auth is
typically handled by the collection's pre-request script (token via `pm.sendRequest`) — reuse it;
otherwise add an auth request first (see `references/assertion-cookbook.md`). Then create **one
request per test case** (`createCollectionRequest` with the folder id), each with:

- the method, URL (built from `{{baseUrl}}`/env vars) and params for that case,
- `Authorization: Bearer {{token}}` (or the collection's auth),
- deterministic **`pm.test` scripts** for that case — copy/adapt from the cookbook. Name each
  request after its case ID so results map back cleanly.

## Step 4 — Execute

Fetch the finished collection + environment JSON, then call the runner's **`preview_requests`**
first with `{ collection, folderName: "<ticket key>", environment }`. Review the preview's resolved
URLs, auth source/scope, body previews, `writeRequests`, and `safety` object with the user.

If the preview reports production-like targets and the user has not explicitly approved that exact
run, do **not** call `run_folder`/`run_request`; report BLOCKED and ask for an approved non-prod
target or explicit approval. If the preview reports write methods and the user has not approved
mutation in that target, also stop before execution.

Only after approval, call **`run_folder`**. Pass `allowProduction: true` only when production-like
execution is explicitly approved, and pass `allowWrites: true` only when write methods are
explicitly approved. Include a short `approvalNote` naming what was approved. Re-run a single case
with `run_request` using the same safety flags. The runner resolves variables, runs the pre-request
auth, fires each request, and evaluates the `pm.test` scripts, returning per-request `status`,
`timeMs`, `assertions[]`, redacted request diagnostics, response metadata, and `responseBody`.

## Step 5 — Assess & classify

For every case combine the deterministic `assertions` with a semantic read of `responseBody`
against the ticket's intent. Classify each as **PASS / FAIL / NEEDS-DATA / BLOCKED / WARNING** and,
for non-passes, triage **defect vs data/env vs spec-drift vs undocumented-acceptable** using the
rubric in `references/assessment-and-reporting.md`. Capture expected-vs-actual and a short response
excerpt for every FAIL/WARNING.

## Step 6 — Comment on the ticket

Post one structured comment (`addCommentToJiraIssue`) using the template in
`references/assessment-and-reporting.md`: run header (endpoint, env, date), summary counts,
per-case results table, an "Issues for PO/Dev" section (defects + spec-drift questions), and AC
coverage. Be factual and concise; link the Postman folder. Do not transition the ticket unless asked.

## Guardrails

- Confirm targets + matrix before writing to Postman; never put real secrets in requests or comments.
- The runner fires requests from wherever it runs — ensure network access to the target API.
- Always call `preview_requests` before `run_folder` / `run_request` and review its `safety` object.
- If `run_folder` can't find the folder, call `list_folders` or pass an explicit `folderId`.
- GET/read-only/idempotent does **not** waive the environment safety gate. Production-like reads can
   expose or touch real customer data and still require explicit approval before execution.
- For **write methods (POST/PUT/PATCH/DELETE)** also confirm the target environment is safe for
   writes and prefer idempotent/cleanup-aware cases (see the matrix). The runner blocks writes by
   default; pass `allowWrites: true` only after explicit approval. Never run write methods in
   production unless the user explicitly asks for that exact production write run and cleanup plan.
