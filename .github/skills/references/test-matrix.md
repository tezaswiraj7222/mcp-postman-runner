# 360° API Test Matrix

Walk every category. **Include a category only if the endpoint has that surface**, and say why you
skipped the others. For each included scenario, produce a concrete case: ID, name, method, URL +
params, precondition/seed, expected status, and the assertions to attach.

Before any executable case, include a safety gate entry for the target environment, base URL,
auth source/scope, HTTP methods, and data sensitivity. If the target is production-like and the
user has not explicitly approved that exact run, stop before execution and mark the run BLOCKED.
GET/read-only does not bypass this gate.

Legend for applicability: 🟢 almost always · 🟡 if the surface exists · 🔵 write-methods only.

---

## 1. Functional / Happy path 🟢

- Default valid request returns the documented success status (200/201/204).
- Response body is well-formed JSON (or matches the documented content type).
- The core entity/collection is returned with the expected top-level shape.
- Values satisfy the acceptance criteria (e.g. "each city has cityId, stateId, translations").
- Map **each AC** to at least one case here.

## 2. Schema & contract validation 🟢

- Every documented field is present with the correct **type**.
- **Nullability** matches docs (a field documented non-null must never be null; note fields that
  are nullable in practice, e.g. `stateId`).
- **Enums**: values fall within the documented set.
- **No contract drift**: compare ticket spec ↔ external docs ↔ actual response. Flag mismatches
  (classic example: ticket says `languageId:int` but API returns `language:"nl"`). These are
  usually WARNINGs needing PO confirmation, not hard fails.
- No unexpected/undocumented fields silently added (note, don't necessarily fail).
- Date/number/currency formats match the documented format.

## 3. Pagination 🟡 (if the response is a page envelope)

- `size` honoured: `content.length <= size`.
- `page` navigation: `page=1` differs from `page=0` (when `totalElements > size`).
- **Metadata consistency**: `numberOfElements == content.length`;
  `totalPages == ceil(totalElements / size)`; `first`/`last` flags correct on first/last pages.
- **Beyond last page** returns `200` with empty `content` (NOT 404/500).
- Boundary sizes: `size=1`, `size=max`; behaviour for `size=0` and very large `size` (documented?).
- Default page size when params omitted matches the documented default.

## 4. Sorting 🟡

- `sort` ascending and descending actually order the results (compare first vs last item).
- Sort by each sortable field; multi-field sort if supported.
- **Invalid/unknown sort property** — observe and document (e.g. `sort=asc` may 400 with
  "Unable to find property for sort" if the API expects `sort=<field>,<dir>`). Confirm the
  documented contract; an undocumented 400 is a doc/UX issue.

## 5. Filtering 🟡

- Each filter narrows results correctly (every returned item matches the filter).
- Combined filters (AND semantics) behave as documented.
- Filter that matches nothing → `200` with empty `content` (not an error).
- Invalid filter value/field → documented behaviour (400 vs ignored).
- Filters documented but absent from the ticket → flag for confirmation, then test if confirmed.

## 6. Input validation / negative 🟢

- **Wrong type** for params (`page=ABC`, `size=XYZ`) → `400` with a validation message, **never 500**.
- **Out-of-range / negative** (`size=-5`, `page=-1`) → `400` or a documented graceful default —
  whichever the contract states; flag **inconsistency** (e.g. `size=ABC`→400 but `size=-5`→silent 200).
- **Missing required** param → `4xx`, not 500.
- **Boundary values**: min/max, zero, empty string.
- **Malformed path param** (non-existent id, wrong type) → `404`/`400`, **not 500**.
- Special characters / very long values / basic injection strings in params → safe handling (no 500).

## 7. Authentication & authorization 🟢

- Valid token → success.
- **Missing / malformed token** → `401`.
- **Expired token** → `401` (and the pre-request refresh path works on a fresh run).
- **Insufficient scope / wrong permissions / wrong distribution-channel** → `403`.
- Cross-tenant/cross-concern access is denied where applicable.

## 8. Status codes & error contract 🟢

- The correct code for every scenario (200/201/204/400/401/403/404/409/422/429/500/503).
- **Error body shape is consistent**: e.g. `errorCode`, `message`, `traceId`, `path`, `parameters`.
- Error messages are meaningful and don't leak internals/stack traces.
- 5xx never returned for client mistakes (those are 4xx).

## 9. Dependency / failure-mode 🟡 (if the endpoint calls another service)

- Upstream/internal dependency unavailable → documented code (often `503`) with **no partial data**.
- Timeouts handled gracefully.
- (May only be testable in dev/integration; mark BLOCKED if not externally reproducible.)

## 10. Data integrity & cross-field consistency 🟡

- Referential consistency (e.g. `stateId` points to a real state; ids resolve).
- Cross-field invariants (totals add up; date ranges valid; computed fields correct).
- No duplicate entries; stable ordering for equal sort keys.

## 11. Headers & content negotiation 🟡

- `Content-Type: application/json` on success and error.
- `Accept` honoured; unsupported `Accept` → `406` if documented.
- Caching/ETag headers if the contract specifies them.
- CORS headers if the API is browser-facing.

## 12. Internationalisation 🟡 (if responses carry translations/locale)

- Translation/locale variants present and correct (e.g. `translations[]` with `nl`, `it`).
- Locale param/header changes the returned language where supported.

## 13. Idempotency & side effects

- **GET/HEAD**: safe & idempotent from an HTTP semantics perspective — repeated calls should not
  change state. This is **not** permission to run them in production; production-like reads still
  need explicit user approval because they may access real customer data.
- 🔵 **POST**: not idempotent — each call creates; verify created entity; clean up.
- 🔵 **PUT/PATCH**: idempotent — repeating yields the same state; verify the update applied.
- 🔵 **DELETE**: deleting again → `404`/`410`; verify gone.
- 🔵 For write methods: confirm the environment is safe for writes; prefer create→verify→cleanup flows.

## 14. Documentation parity 🟢

- Endpoint appears in the developer/API docs.
- All params, fields, and **status codes** (incl. observed 400/503) are documented.
- Flag undocumented parameters or behaviours discovered during testing.

---

## Performance — observe, don't gate

Capture `timeMs` per request for context, but **do not** assert latency thresholds in a functional
pass (CI/network noise makes it flaky). Load/perf belongs in a dedicated tool (e.g. k6). Note any
egregiously slow call as an observation, not a FAIL.

## Selection guidance

A typical paginated GET reference endpoint yields ~10–18 cases: 1–2 functional, 1–2 schema/contract,
4–6 pagination, 2 sorting, 1–3 filtering, 3–4 negative/validation, 1–2 auth, plus docs parity and a
dependency failure-mode note. Scale up/down with the endpoint's surface; always include negative,
auth, and contract checks even when the ticket only lists happy paths.
