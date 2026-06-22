import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRunnerTools } from "./runner.js";
import { Assertion } from "../engine.js";

// Capture the handlers registered by registerRunnerTools.
type Handler = (args: any) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
const handlers = new Map<string, Handler>();
const fakeServer = {
  registerTool: (name: string, _def: unknown, handler: Handler) => { handlers.set(name, handler); },
} as any;
registerRunnerTools(fakeServer);

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

// ---- Mock the global fetch: auth endpoint + cities endpoint behaviours ----
let authCalls = 0;
let cityCalls = 0;
beforeEach(() => {
  authCalls = 0;
  cityCalls = 0;
  vi.stubGlobal("fetch", async (url: string, _opts?: any) => {
    if (url.includes("/api/v1/authenticate")) {
      authCalls++;
      return { status: 200, statusText: "OK", text: async () => JSON.stringify({ access_token: "TOK123", expires_in: 3600 }) } as any;
    }
    if (url.includes("test-payload-echo")) {
      const reqHeaders = _opts?.headers || {};
      const reqBody = _opts?.body || null;
      return {
        status: 200,
        statusText: "OK",
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : reqHeaders[name] || null),
          has: (name: string) => name.toLowerCase() === "content-type" || reqHeaders[name] !== undefined,
        },
        text: async () => JSON.stringify({
          headers: reqHeaders,
          body: typeof reqBody === "string" ? reqBody : (reqBody instanceof URLSearchParams ? reqBody.toString() : (reqBody ? "[FormData]" : null)),
        }),
      } as any;
    }
    cityCalls++;
    const u = new URL(url);
    const size = u.searchParams.get("size");
    const sort = u.searchParams.get("sort");
    const page = u.searchParams.get("page");
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ cityId: i + 1, stateId: 6002, translations: [{ name: "X", language: "nl" }] }));
    if (sort === "asc") return { status: 400, statusText: "Bad Request", text: async () => JSON.stringify({ errorCode: "DB-920" }) } as any;
    if (size === "ABC") return { status: 400, statusText: "Bad Request", text: async () => JSON.stringify({ errorCode: "ThirdParty-129" }) } as any;
    if (page === "9999") return { status: 200, statusText: "OK", text: async () => JSON.stringify({ content: [], number: 9999, size: 2, numberOfElements: 0, totalElements: 19191, totalPages: 9596, first: false, last: true }) } as any;
    const n = size && /^\d+$/.test(size) ? Number(size) : 20;
    return { status: 200, statusText: "OK", text: async () => JSON.stringify({ content: mk(n), number: 0, size: n, numberOfElements: n, totalElements: 19191, totalPages: Math.ceil(19191 / n), first: true, last: false }) } as any;
  });
});

const U = "{{url}}api/v2/countries/states/cities";
const H = [{ key: "Authorization", value: "bearer {{token}}" }];
const test = (exec: string[]) => ({ listen: "test", script: { exec } });
const collection = {
  info: { name: "Jira-Automation-collection" },
  variable: [{ key: "url", value: "https://api-dev.example.net/" }],
  event: [{ listen: "prerequest", script: { exec: [
    "const token=pm.environment.get('token');const authURL=pm.environment.get('authenticationURL');",
    "if(!token){pm.sendRequest({method:'POST',url:authURL},(e,r)=>{pm.environment.set('token', r.json().access_token);});}",
  ] } }],
  item: [{ name: "Jira Issues", id: "F1", item: [
    { name: "TC-01 happy", request: { method: "GET", header: H, url: { raw: U } }, event: [test([
      "const sc=pm.response.code;let b=pm.response.json();",
      "pm.test('TC-01 200', ()=>pm.expect(sc).to.eql(200));",
      "pm.test('TC-01 content array', ()=>pm.expect(Array.isArray(b.content)).to.be.true);",
    ]) ] },
    { name: "TC-02 schema", request: { method: "GET", header: H, url: { raw: U } }, event: [test([
      "let b=pm.response.json();const item=b.content[0];",
      "pm.test('TC-02 languageId present', ()=>pm.expect(item.translations[0]).to.have.property('languageId'));",
    ]) ] },
    { name: "TC-05 sort asc", request: { method: "GET", header: H, url: { raw: U + "?sort=asc" } }, event: [test([
      "pm.test('TC-05 200', ()=>pm.expect(pm.response.code).to.eql(200));",
    ]) ] },
  ] }],
};
const environment = { name: "RVP", values: [
  { key: "url", value: "https://api-dev.example.net/", enabled: true },
  { key: "authenticationURL", value: "https://api-dev.example.net/api/v1/authenticate?x=1", enabled: true },
  { key: "token", value: "", enabled: true },
] };

describe("list_folders", () => {
  it("returns folders with request counts", async () => {
    const out = parse(await handlers.get("list_folders")!({ collection }));
    expect(out.folders[0].name).toBe("Jira Issues");
    expect(out.folders[0].requestCount).toBe(3);
  });
});

describe("run_folder", () => {
  it("authenticates once, runs each request once, evaluates pm.test scripts", async () => {
    const out = parse(await handlers.get("run_folder")!({ collection, environment, folderId: "F1" }));
    expect(out.results).toHaveLength(3);     // no duplicate executions
    expect(authCalls).toBe(1);               // token fetched once, then cached
    expect(cityCalls).toBe(3);               // one HTTP per request
    const byName: Record<string, any> = Object.fromEntries(out.results.map((r: any) => [r.name.split(" ")[0], r]));
    expect(byName["TC-01"].assertionsFailed).toBe(0);
    expect(byName["TC-02"].assertionsFailed).toBe(1);   // languageId missing -> language
    expect(byName["TC-05"].status).toBe(400);
    expect(byName["TC-05"].assertionsFailed).toBe(1);   // ticket expected 200
    expect(out.summary.anyFailure).toBe(true);
  });

  it("errors when no folder selector is given", async () => {
    const res = await handlers.get("run_folder")!({ collection });
    expect(res.isError).toBe(true);
  });
});

describe("run_request", () => {
  it("runs a single named request", async () => {
    const out = parse(await handlers.get("run_request")!({ collection, environment, folderId: "F1", requestName: "TC-01 happy" }));
    expect(out.results).toHaveLength(1);
    expect(out.results[0].name).toBe("TC-01 happy");
  });
});

describe("extra sandbox and engine features", () => {
  const collectionExtra = {
    info: { name: "Extra Features Collection" },
    item: [
      {
        name: "Test Folder",
        id: "F2",
        item: [
          {
            name: "TC-Body-Raw",
            request: {
              method: "POST",
              header: [
                { key: "Content-Type", value: "application/json" },
                { key: "X-Custom-Header", value: "Custom-Val-{{$randomInt}}" },
                { key: "X-Disabled", value: "Yes", disabled: true }
              ],
              body: {
                mode: "raw",
                raw: "{\"uuid\":\"{{$randomUUID}}\",\"ts\":\"{{$timestamp}}\"}"
              },
              url: { raw: "https://api-dev.example.net/test-payload-echo" }
            },
            event: [
              test([
                "const code = pm.response.code;",
                "const body = pm.response.json();",
                "pm.test('Response code is 200 via ok', () => pm.response.to.be.ok);",
                "pm.test('Assert success status code', () => pm.response.to.be.success);",
                "pm.test('Custom header is present', () => pm.expect(body.headers['X-Custom-Header']).to.match(/Custom-Val-\\d+/));",
                "pm.test('Disabled header is absent', () => pm.expect(body.headers['X-Disabled']).to.be.undefined);",
                "pm.test('Response body contains uuid field', () => pm.expect(body.body).to.include('uuid'));",
                "pm.test('Response headers helper works', () => {",
                "  pm.expect(pm.response.headers.has('Content-Type')).to.be.true;",
                "  pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
                "});"
              ])
            ]
          },
          {
            name: "TC-Send-Request",
            request: {
              method: "GET",
              url: { raw: "https://api-dev.example.net/test-payload-echo" }
            },
            event: [
              test([
                "pm.globals.set('my_global', 'val123');",
                "pm.sendRequest({",
                "  url: 'https://api-dev.example.net/test-payload-echo',",
                "  method: 'POST',",
                "  header: { 'X-Auth': 'Bearer ' + pm.globals.get('my_global') },",
                "  body: { mode: 'raw', raw: 'hello' }",
                "}, (err, res) => {",
                "  pm.test('sendRequest response is 200', () => pm.expect(res.code).to.eql(200));",
                "  const data = res.json();",
                "  pm.test('sendRequest forwarded body', () => pm.expect(data.body).to.eql('hello'));",
                "  pm.test('sendRequest forwarded headers', () => pm.expect(data.headers['X-Auth']).to.eql('Bearer val123'));",
                "  pm.test('sendRequest headers helper', () => pm.expect(res.headers.get('Content-Type')).to.include('application/json'));",
                "});"
              ])
            ]
          }
        ]
      }
    ]
  };

  it("resolves dynamic variables, handles bodies, parses response headers, and implements globals", async () => {
    const out = parse(await handlers.get("run_folder")!({ collection: collectionExtra, folderId: "F2" }));
    expect(out.results).toHaveLength(2);
    expect(out.summary.anyFailure).toBe(false); // All assertions must pass!
    expect(out.results[0].assertionsFailed).toBe(0);
    expect(out.results[1].assertionsFailed).toBe(0);
  });

  it("verifies special Assertion response code checkers", () => {
    const res200 = new Assertion({ code: 200 });
    const res400 = new Assertion({ code: 400 });
    const res500 = new Assertion({ code: 500 });

    // Success / OK assertions
    expect(() => res200.ok).not.to.throw();
    expect(() => res400.ok).to.throw();
    expect(() => res200.success).not.to.throw();

    // Client/Server/General Error assertions
    expect(() => res400.clientError).not.to.throw();
    expect(() => res200.clientError).to.throw();

    expect(() => res500.serverError).not.to.throw();
    expect(() => res200.serverError).to.throw();

    expect(() => res400.error).not.to.throw();
    expect(() => res500.error).not.to.throw();
    expect(() => res200.error).to.throw();
  });
});
