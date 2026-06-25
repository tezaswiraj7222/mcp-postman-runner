# Assessment, Triage & Reporting

The runner gives you deterministic `assertions` plus the raw `responseBody`. Turn that into a
judged verdict per case, then a clear ticket comment.

## Per-case classification

| Verdict | When |
| --- | --- |
| ✅ **PASS** | All assertions passed **and** the body matches the ticket's intent. |
| ❌ **FAIL** | An assertion failed because the API behaved wrongly (a real defect). |
| ⚠️ **WARNING** | Behaves consistently but **disagrees with the ticket spec** (likely outdated spec / undocumented behaviour) — needs PO/dev confirmation, not necessarily a bug. |
| 🟦 **NEEDS-DATA** | Couldn't validate due to missing/empty test data (e.g. no rows to page through), not an API fault. |
| ⛔ **BLOCKED** | Couldn't run meaningfully — dependency down, environment issue, auth unavailable, or production-like execution was not explicitly approved. |

Always record **expected vs actual** and a short response excerpt for FAIL and WARNING.

## Triage: defect vs data/env vs spec-drift vs acceptable

Ask, in order:
0. **Was the target environment approved for execution?** Production-like URLs, auth sources,
   scopes, or real customer data require explicit user approval for the exact run, even for GET.
   Without that approval, do not execute; classify the run as **BLOCKED / safety gate** and ask for
   an approved non-prod target or explicit approval.

1. **Did the request even reach the endpoint logic?** 503/timeout/411 from a gateway or a downed
   dependency → **BLOCKED** (env), not a defect. (e.g. internal location-service down → all 503.)
2. **Is the response empty because there's no data?** Empty `content` where data was expected →
   **NEEDS-DATA**; configure/seed data and re-run before judging.
3. **Does the actual behaviour contradict the ticket but match the live docs/implementation?**
   → **WARNING / spec-drift** (e.g. `language` string vs ticket's `languageId` int). Raise as a
   question to confirm the intended contract; don't file as a bug yet.
4. **Is it a 5xx for a client mistake, a wrong status, wrong/missing field, broken pagination/sort,
   or inconsistent validation?** → **FAIL** (defect). Examples seen in practice:
   - `?sort=asc` → 400 "Unable to find property for sort" (needs `sort=<field>,<dir>`): doc/UX
     defect — the documented default is invalid as-is and the 400 is undocumented.
   - `?page=ABC` → silent 200 default while `?size=ABC` → 400: **validation inconsistency** defect.
   - non-existent id → 500 instead of 404: defect.
5. **Undocumented but harmless** (e.g. an extra helpful field) → note as an observation.

## Acceptance-criteria coverage

Map every AC to the cases that exercise it and give each AC a verdict. Call out ACs that are **not
externally testable** (e.g. "503 when internal service is down") and recommend a dev/integration
test instead of leaving them silently unverified.

## Ticket comment template

Post one comment with `addCommentToJiraIssue` (markdown):

```markdown
## 🤖 Automated API Test Run — <TICKET>

**Endpoint**: `<METHOD> <path>`
**Environment**: <env name> (`<base url>`, scope `<scope>`)
**Execution approval**: <non-prod target confirmed | production approved by <user> at <time> | blocked by safety gate>
**Executed via**: Postman collection `<collection>` → folder `<TICKET>`, run by mcp-postman-runner.
**Date**: <YYYY-MM-DD>

### Summary
| Total | ✅ Pass | ❌ Fail | ⚠️ Warning | 🟦 Needs-data | ⛔ Blocked |
| --- | --- | --- | --- | --- | --- |
| N | … | … | … | … | … |

### Results
| TC | Scenario | Expected | Actual | Verdict | Note |
| --- | --- | --- | --- | --- | --- |
| TC-01 | Happy path | 200 + list | 200 | ✅ | … |
| TC-0x | … | … | … | … | … |

### Issues for PO / Dev
1. **<Defect>** — what's wrong, expected vs actual, response excerpt, suggested fix.
2. **<Spec drift / question>** — ticket says X, API/docs say Y → confirm intended contract.
3. **<Validation inconsistency>** — …

### Acceptance Criteria coverage
| AC | Description | Verdict | Evidence |
| --- | --- | --- | --- |
| AC1 | … | ✅ | … |
| AC3 | 503 on dependency outage | ⛔ not externally testable | recommend dev integration test |

> Notes: <data/env caveats, performance observations (informational), docs-parity gaps>.
```

## Reporting principles

- Lead with the counts; make FAIL/WARNING immediately scannable.
- Be specific: include the exact param, expected vs actual status, and a trimmed response excerpt
  (redact secrets/PII).
- Separate "fix the API" (defects) from "fix the ticket/docs" (spec-drift) so the PO knows what to act on.
- Keep performance numbers as context only; never present latency as pass/fail.
- Don't transition the ticket or edit other fields unless explicitly asked.
