/**
 * Core execution engine — the slice of newman this MCP replicates.
 *
 * Resolves `{{variables}}`, runs collection + item pre-request scripts (so token-auth
 * patterns work via a minimal `pm.sendRequest`), fires each request with the global
 * `fetch`, and evaluates the embedded `pm.test` scripts through a small `pm`/`expect`
 * sandbox. No external dependencies.
 */

const MAX_BODY_CHARS = 20_000;

/* ============ types ============ */

export interface PmAssertion {
  name: string;
  passed: boolean;
  error: string | null;
}
export interface RequestResult {
  name: string;
  method: string | null;
  url: string | null;
  status: number | null;
  statusText: string | null;
  timeMs: number | null;
  assertionsPassed: number;
  assertionsFailed: number;
  assertions: PmAssertion[];
  responseBody: string | null;
  requestError: string | null;
}
export interface RunSummary {
  totalRequests: number;
  requestsErrored: number;
  assertionsTotal: number;
  assertionsFailed: number;
  anyFailure: boolean;
}
export interface RunOutput {
  summary: RunSummary;
  results: RequestResult[];
}
export interface FolderInfo {
  name: string;
  id: string | null;
  path: string;
  requestCount: number;
}
export interface RunOptions {
  collection: any;
  environment?: any;
  folderId?: string;
  folderName?: string;
  requestName?: string;
  timeoutMs?: number;
}
type Vars = Record<string, string>;

/* ============ chai-like expect (subset used by Postman test scripts) ============ */

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
function typeOf(v: any): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}
function j(v: any): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

class Assertion {
  actual: any;
  negate = false;
  constructor(actual: any) { this.actual = actual; }

  get to(): this { return this; }
  get be(): this { return this; }
  get been(): this { return this; }
  get is(): this { return this; }
  get that(): this { return this; }
  get which(): this { return this; }
  get and(): this { return this; }
  get has(): this { return this; }
  get have(): this { return this; }
  get with(): this { return this; }
  get at(): this { return this; }
  get of(): this { return this; }
  get deep(): this { return this; }
  get not(): this { this.negate = !this.negate; return this; }

  private _check(okValue: boolean, msg: string): void {
    const pass = this.negate ? !okValue : okValue;
    if (!pass) throw new Error(msg + (this.negate ? " (negated)" : ""));
  }

  get true(): this { this._check(this.actual === true, `expected ${j(this.actual)} to be true`); return this; }
  get false(): this { this._check(this.actual === false, `expected ${j(this.actual)} to be false`); return this; }
  get null(): this { this._check(this.actual === null, `expected ${j(this.actual)} to be null`); return this; }
  get undefined(): this { this._check(this.actual === undefined, `expected value to be undefined`); return this; }
  get ok(): this { this._check(!!this.actual, `expected ${j(this.actual)} to be truthy`); return this; }
  get empty(): this {
    const v = this.actual;
    const isEmpty = v == null || (typeof v === "string" && v.length === 0) ||
      (Array.isArray(v) && v.length === 0) || (typeof v === "object" && Object.keys(v).length === 0);
    this._check(isEmpty, `expected ${j(v)} to be empty`); return this;
  }

  equal(v: any): this { this._check(this.actual === v, `expected ${j(this.actual)} to equal ${j(v)}`); return this; }
  eql(v: any): this { this._check(deepEqual(this.actual, v), `expected ${j(this.actual)} to deeply equal ${j(v)}`); return this; }
  eqls(v: any): this { return this.eql(v); }
  property(name: string, val?: any): this {
    const has = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, name);
    this._check(has, `expected ${j(this.actual)} to have property '${name}'`);
    if (arguments.length > 1 && has) this._check(deepEqual(this.actual[name], val), `expected property '${name}' to equal ${j(val)}`);
    return this;
  }
  most(n: number): this { this._check(this.actual <= n, `expected ${j(this.actual)} to be at most ${n}`); return this; }
  least(n: number): this { this._check(this.actual >= n, `expected ${j(this.actual)} to be at least ${n}`); return this; }
  above(n: number): this { this._check(this.actual > n, `expected ${j(this.actual)} to be above ${n}`); return this; }
  below(n: number): this { this._check(this.actual < n, `expected ${j(this.actual)} to be below ${n}`); return this; }
  within(a: number, b: number): this { this._check(this.actual >= a && this.actual <= b, `expected ${j(this.actual)} within ${a}..${b}`); return this; }
  include(v: any): this {
    const ok = typeof this.actual === "string" ? this.actual.includes(v)
      : Array.isArray(this.actual) ? this.actual.some((x: any) => deepEqual(x, v)) : false;
    this._check(ok, `expected ${j(this.actual)} to include ${j(v)}`); return this;
  }
  contain(v: any): this { return this.include(v); }
  oneOf(arr: any[]): this { this._check(arr.some((x) => deepEqual(x, this.actual)), `expected ${j(this.actual)} to be one of ${j(arr)}`); return this; }
  a(type: string): this { this._check(typeOf(this.actual) === type, `expected ${j(this.actual)} to be a ${type}`); return this; }
  an(type: string): this { return this.a(type); }
  match(re: RegExp): this { this._check(re.test(String(this.actual)), `expected ${j(this.actual)} to match ${re}`); return this; }
  status(code: number): this {
    const c = this.actual && this.actual.code !== undefined ? this.actual.code : this.actual;
    this._check(c === code, `expected status ${code} but got ${c}`); return this;
  }
}
function expect(actual: any): Assertion { return new Assertion(actual); }

/* ============ variable resolution ============ */

export function resolveVars(str: any, vars: Vars): any {
  if (typeof str !== "string") return str;
  let out = str;
  let prev: string | null = null;
  let guard = 0;
  while (out !== prev && guard++ < 10) {
    prev = out;
    out = out.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
      const key = String(k).trim();
      return vars[key] !== undefined ? vars[key]! : m;
    });
  }
  return out;
}

/* ============ pm sandbox ============ */

function makePm(vars: Vars, response: any, pending: Promise<unknown>[]) {
  const env = {
    get: (k: string) => (vars[k] !== undefined ? vars[k] : undefined),
    set: (k: string, v: any) => { vars[k] = typeof v === "string" ? v : String(v); },
    unset: (k: string) => { delete vars[k]; },
    has: (k: string) => vars[k] !== undefined,
  };
  const results: PmAssertion[] = [];
  const pm: any = {
    environment: env,
    variables: { get: env.get, set: env.set },
    collectionVariables: { get: env.get, set: env.set },
    expect,
    response: response || undefined,
    test: (name: string, fn: () => void) => {
      try { fn(); results.push({ name, passed: true, error: null }); }
      catch (e: any) { results.push({ name, passed: false, error: e?.message ?? String(e) }); }
    },
    sendRequest: (req: any, cb?: (err: any, resp: any) => void) => {
      const url = typeof req === "string" ? req : req.url;
      const method = (typeof req === "object" && req.method) || "GET";
      const p = (async () => {
        try {
          const r = await fetch(resolveVars(url, vars), { method });
          const text = await r.text();
          const resp = { code: r.status, status: r.statusText, json: () => JSON.parse(text), text: () => text };
          if (cb) cb(null, resp);
        } catch (e) { if (cb) cb(e, null); }
      })();
      pending.push(p);
      return p;
    },
  };
  pm._results = results;
  return pm;
}

async function runScript(execLines: (string | null)[] | undefined, vars: Vars, response: any, opts: { allowSend?: boolean } = {}): Promise<PmAssertion[]> {
  if (!execLines || execLines.length === 0) return [];
  const body = execLines.filter((l) => l != null).join("\n");
  const pending: Promise<unknown>[] = [];
  const pm = makePm(vars, response, pending);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("pm", "console", body) as (pm: any, c: Console) => void;
  fn(pm, console);
  if (opts.allowSend && pending.length) await Promise.allSettled(pending);
  return pm._results as PmAssertion[];
}

/* ============ collection helpers ============ */

function countReq(folder: any): number {
  let n = 0;
  for (const it of folder.item || []) n += Array.isArray(it.item) ? countReq(it) : 1;
  return n;
}

export function listFolders(collection: any): FolderInfo[] {
  const out: FolderInfo[] = [];
  const walk = (items: any[], trail: string[]) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) {
        out.push({ name: it.name, id: it.id || it._postman_id || null, path: [...trail, it.name].join(" / "), requestCount: countReq(it) });
        walk(it.item, [...trail, it.name]);
      }
    }
  };
  walk(collection.item, []);
  return out;
}

export function findFolder(collection: any, sel: { folderId?: string; folderName?: string }): any | null {
  let found: any = null;
  const target = sel.folderName ? String(sel.folderName).trim().toLowerCase() : null;
  const walk = (items: any[]) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) {
        if (sel.folderId && (it.id === sel.folderId || it._postman_id === sel.folderId)) found = it;
        else if (!sel.folderId && target && String(it.name).trim().toLowerCase() === target && !found) found = it;
        walk(it.item);
      }
    }
  };
  walk(collection.item);
  return found;
}

export function flattenRequests(node: any): any[] {
  const reqs: any[] = [];
  const walk = (items: any[]) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) walk(it.item);
      else if (it.request) reqs.push(it);
    }
  };
  walk(node.item ? node.item : [node]);
  return reqs;
}

/* ============ request execution ============ */

function rawUrl(req: any): string {
  const u = req.url;
  if (!u) return "";
  if (typeof u === "string") return u;
  return u.raw || "";
}
function getEventExec(item: any, listen: string): (string | null)[] | null {
  for (const ev of item.event || []) if (ev.listen === listen && ev.script) return ev.script.exec || [];
  return null;
}

function truncate(text: string | null): string | null {
  if (text == null) return null;
  return text.length > MAX_BODY_CHARS
    ? text.slice(0, MAX_BODY_CHARS) + `\n…[truncated ${text.length - MAX_BODY_CHARS} chars]`
    : text;
}

async function executeItem(item: any, ctx: { vars: Vars; collectionPre: (string | null)[] | null; timeoutMs: number }): Promise<RequestResult> {
  const { vars, collectionPre, timeoutMs } = ctx;
  if (collectionPre) await runScript(collectionPre, vars, undefined, { allowSend: true });
  const itemPre = getEventExec(item, "prerequest");
  if (itemPre) await runScript(itemPre, vars, undefined, { allowSend: true });

  const url = resolveVars(rawUrl(item.request), vars);
  const method = (item.request.method || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  for (const h of item.request.header || []) if (h && h.key) headers[h.key] = resolveVars(h.value, vars);

  const started = Date.now();
  let status: number | null = null;
  let statusText: string | null = null;
  let text: string | null = null;
  let reqErr: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { method, headers, signal: ctrl.signal });
    clearTimeout(timer);
    status = r.status;
    statusText = r.statusText;
    text = await r.text();
  } catch (e: any) {
    reqErr = String(e?.message ?? e);
  }
  const timeMs = Date.now() - started;

  const response = {
    code: status, status: statusText, responseTime: timeMs,
    json: () => JSON.parse(text as string), text: () => text,
    to: new Assertion({ code: status }),
  };
  let assertions: PmAssertion[] = [];
  const testExec = getEventExec(item, "test");
  if (testExec && reqErr == null) assertions = await runScript(testExec, vars, response, { allowSend: false });

  return {
    name: item.name || "(unnamed)",
    method, url, status, statusText, timeMs,
    assertionsPassed: assertions.filter((a) => a.passed).length,
    assertionsFailed: assertions.filter((a) => !a.passed).length,
    assertions,
    responseBody: truncate(text),
    requestError: reqErr,
  };
}

function collectVars(collection: any, environment: any): Vars {
  const vars: Vars = {};
  for (const v of (collection && collection.variable) || []) vars[v.key] = v.value;
  for (const v of (environment && environment.values) || []) if (v.enabled !== false) vars[v.key] = v.value;
  return vars;
}

export async function runFolder(opts: RunOptions): Promise<RunOutput> {
  const { collection, environment, folderId, folderName, requestName, timeoutMs } = opts;
  const vars = collectVars(collection, environment);
  const collectionPre = getEventExec(collection, "prerequest");

  let items: any[];
  if (folderId || folderName) {
    const folder = findFolder(collection, { folderId, folderName });
    if (!folder) {
      const avail = listFolders(collection).map((f) => f.path).join(", ");
      throw new Error(`Folder ${folderId || folderName} not found. Available: ${avail || "(none)"}`);
    }
    items = flattenRequests(folder);
  } else {
    items = flattenRequests(collection);
  }
  if (requestName) {
    const want = String(requestName).trim().toLowerCase();
    items = items.filter((i) => String(i.name).trim().toLowerCase() === want);
  }

  const ctx = { vars, collectionPre, timeoutMs: timeoutMs ?? 30_000 };
  const results: RequestResult[] = [];
  for (const item of items) results.push(await executeItem(item, ctx)); // sequential: shared token/vars

  const assertionsTotal = results.reduce((n, r) => n + r.assertions.length, 0);
  const assertionsFailed = results.reduce((n, r) => n + r.assertionsFailed, 0);
  return {
    summary: {
      totalRequests: results.length,
      requestsErrored: results.filter((r) => r.requestError).length,
      assertionsTotal,
      assertionsFailed,
      anyFailure: assertionsFailed > 0 || results.some((r) => r.requestError),
    },
    results,
  };
}

export { expect, Assertion };
