# Assertion Cookbook (Postman `pm.test`)

Copy and adapt these into each request's **test** script. The runner evaluates them and returns
per-assertion pass/fail. Keep one logical check per `pm.test` so failures are pinpointed. Name each
request after its case ID (e.g. `TC-03 pagination size=5`).

Standard preamble (safe body parse):

```javascript
const sc = pm.response.code;
let b; try { b = pm.response.json(); } catch (e) { b = null; }
```

## Auth request (only if the collection has no auth pre-request)

A POST that exchanges credentials for a token, as the **first** request in the folder:

```javascript
const json = pm.response.json();
pm.environment.set("token", json.access_token || json.token);
pm.test("auth succeeded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
pm.test("token present", () => pm.expect(pm.environment.get("token")).to.be.a("string").and.not.empty);
```

Subsequent requests send `Authorization: Bearer {{token}}`.

## Happy path (200 + structure)

```javascript
pm.test("status is 200", () => pm.expect(sc).to.eql(200));
pm.test("body is JSON", () => pm.expect(b).to.not.eql(null));
pm.test("has content array", () => pm.expect(Array.isArray(b.content)).to.be.true);
pm.test("has page metadata", () => pm.expect(b).to.have.property("totalElements"));
```

## Schema / contract (types, nullability, drift)

```javascript
const item = b && b.content && b.content[0];
pm.test("status is 200", () => pm.expect(sc).to.eql(200));
pm.test("cityId is integer", () => pm.expect(Number.isInteger(item.cityId)).to.be.true);
pm.test("has stateId property", () => pm.expect(item).to.have.property("stateId"));
pm.test("translations is array", () => pm.expect(Array.isArray(item.translations)).to.be.true);
// Contract-drift guard — assert the TICKET's spec so a mismatch surfaces as a documented WARNING:
pm.test("translation has languageId (ticket spec)", () => pm.expect(item.translations[0]).to.have.property("languageId"));
```

## Pagination

```javascript
// size honoured
pm.test("content length <= size", () => pm.expect(b.content.length).to.be.at.most(5));
pm.test("first flag true on page 0", () => pm.expect(b.first).to.be.true);
// metadata consistency
pm.test("numberOfElements equals content length", () => pm.expect(b.numberOfElements).to.eql(b.content.length));
pm.test("totalPages equals ceil(total/size)", () => pm.expect(b.totalPages).to.eql(Math.ceil(b.totalElements / 5)));
// beyond last page
pm.test("beyond last → 200", () => pm.expect(sc).to.eql(200));
pm.test("beyond last → empty content", () => pm.expect(b.content.length).to.eql(0));
```

Cross-page difference (run page=0 first and stash an id, compare on page=1):

```javascript
// on page 0:  pm.environment.set("firstIdP0", String(b.content[0].cityId));
// on page 1:
pm.test("page 1 differs from page 0", () => pm.expect(String(b.content[0].cityId)).to.not.eql(pm.environment.get("firstIdP0")));
```

## Sorting

```javascript
pm.test("status is 200", () => pm.expect(sc).to.eql(200));
const ids = b.content.map(x => x.cityId);
pm.test("ascending order", () => pm.expect(ids).to.eql([...ids].sort((a, z) => a - z)));
// invalid sort property — document the observed contract:
pm.test("sort=asc returns 200 (per ticket)", () => pm.expect(sc).to.eql(200)); // will FAIL if API needs sort=<field>,<dir>
```

## Filtering

```javascript
pm.test("status is 200", () => pm.expect(sc).to.eql(200));
pm.test("every item matches filter stateId=5", () => pm.expect(b.content.every(x => x.stateId === 5)).to.be.true);
// no-match filter:
pm.test("no matches → empty 200", () => { pm.expect(sc).to.eql(200); pm.expect(b.content.length).to.eql(0); });
```

## Negative / validation

```javascript
// wrong type
pm.test("invalid type → 400", () => pm.expect(sc).to.eql(400));
pm.test("not a server error", () => pm.expect(sc).to.not.eql(500));
// error contract shape
pm.test("error body has errorCode + message", () => { pm.expect(b).to.have.property("errorCode"); pm.expect(b).to.have.property("message"); });
// non-existent id
pm.test("non-existent id → 404 (not 500)", () => { pm.expect(sc).to.eql(404); pm.expect(sc).to.not.eql(500); });
```

## Auth / authorization

```javascript
// missing/invalid token (send a bad/empty Authorization header for this request)
pm.test("unauthorized → 401", () => pm.expect(sc).to.eql(401));
// insufficient permission/scope
pm.test("forbidden → 403", () => pm.expect(sc).to.eql(403));
```

## Headers

```javascript
pm.test("content-type is json", () => pm.expect(pm.response.headers.get("Content-Type") || "").to.include("application/json"));
```

## Write methods

The runner supports common POST/PUT/PATCH/DELETE bodies (`raw`, JSON, `urlencoded`, `formdata`,
and GraphQL), but execution is blocked unless `allowWrites: true` is passed after explicit user
approval. Use `preview_requests` first to inspect the resolved URL, body preview, and safety flags.

```javascript
// POST create
pm.test("created → 201", () => pm.expect(sc).to.be.oneOf([200, 201]));
pm.test("returns id", () => pm.expect(b).to.have.property("id"));
// pm.environment.set("createdId", String(b.id));   // for a follow-up GET/DELETE
// PUT idempotent update
pm.test("update → 200", () => pm.expect(sc).to.eql(200));
// DELETE then re-GET
pm.test("deleted → 204/200", () => pm.expect(sc).to.be.oneOf([200, 204]));
```

## Tips

- Guard every body access (`b && b.content && b.content[0]`) so a script doesn't throw before its
  assertion runs.
- Prefer explicit expected values from the ticket so drift surfaces as a failed assertion rather
  than silently passing.
- Keep negative-case requests in the same folder; the shared token from the pre-request still applies.
