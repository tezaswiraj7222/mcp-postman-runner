/**
 * Core execution engine — the slice of newman this MCP replicates.
 *
 * Resolves `{{variables}}`, runs collection + item pre-request scripts (so token-auth
 * patterns work via a minimal `pm.sendRequest`), fires each request with the global
 * `fetch`, and evaluates the embedded `pm.test` scripts through a small `pm`/`expect`
 * sandbox. No external dependencies.
 */

import crypto from "crypto";

const MAX_BODY_CHARS = 20_000;
const BODY_PREVIEW_CHARS = 500;
const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|passwd|api[-_]?key|client[-_]?secret)/i;

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
  request: RequestDiagnostics | null;
  status: number | null;
  statusText: string | null;
  timeMs: number | null;
  assertionsPassed: number;
  assertionsFailed: number;
  assertions: PmAssertion[];
  responseBody: string | null;
  response: ResponseDiagnostics | null;
  requestError: string | null;
  warnings: string[];
}
export interface RunSummary {
  totalRequests: number;
  requestsErrored: number;
  assertionsTotal: number;
  assertionsFailed: number;
  anyFailure: boolean;
  durationMs: number;
  methodCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  bytesReceived: number;
}
export interface RunOutput {
  summary: RunSummary;
  results: RequestResult[];
}
export interface SafetyOptions {
  allowProduction?: boolean;
  allowWrites?: boolean;
  approvalNote?: string;
}
export interface SafetyAssessment {
  blocked: boolean;
  productionLikeTargets: string[];
  writeMethods: string[];
  warnings: string[];
  approvalNote: string | null;
}
export interface RequestBodyDiagnostics {
  mode: string | null;
  sent: boolean;
  contentType: string | null;
  bytes: number | null;
  preview: string | null;
  previewTruncated: boolean;
}
export interface RequestDiagnostics {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: RequestBodyDiagnostics;
}
export interface ResponseDiagnostics {
  contentType: string | null;
  bytes: number;
  bodyTruncated: boolean;
}
export interface RequestPreview {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: RequestBodyDiagnostics;
  warnings: string[];
}
export interface PreviewOutput {
  summary: {
    totalRequests: number;
    methodCounts: Record<string, number>;
    writeRequests: number;
    warnings: number;
  };
  safety: SafetyAssessment;
  requests: RequestPreview[];
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
  safety?: SafetyOptions;
}
type Vars = Record<string, string>;
type RequestBodyBuild = {
  body: any;
  mode: string;
  contentType?: string;
  bytes: number | null;
  preview: string | null;
  previewTruncated: boolean;
  warnings: string[];
};
type BuiltRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  fetchBody: any;
  body: RequestBodyDiagnostics;
  warnings: string[];
};
type SafetyTarget = { label: string; url: string };
const SAFE_NON_PROD_HOST_RE = /(^localhost$|^127\.|^0\.0\.0\.0$|\.local$|dev|test|qa|uat|acc|stage|staging|sandbox|mock|example)/i;
const EXPLICIT_PROD_HOST_RE = /(^api\.|prod|production|live)/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  get ok(): this {
    if (this.actual && typeof this.actual === "object" && typeof this.actual.code === "number") {
      const code = this.actual.code;
      this._check(code === 200, `expected response status 200 OK but got ${code}`);
      return this;
    }
    this._check(!!this.actual, `expected ${j(this.actual)} to be truthy`);
    return this;
  }
  get success(): this {
    if (this.actual && typeof this.actual === "object" && typeof this.actual.code === "number") {
      const code = this.actual.code;
      this._check(code >= 200 && code < 300, `expected response status 2xx but got ${code}`);
      return this;
    }
    this._check(!!this.actual, `expected ${j(this.actual)} to be truthy`);
    return this;
  }
  get clientError(): this {
    if (this.actual && typeof this.actual === "object" && typeof this.actual.code === "number") {
      const code = this.actual.code;
      this._check(code >= 400 && code < 500, `expected client error status 4xx but got ${code}`);
      return this;
    }
    throw new Error("clientError assertion is only valid for responses");
  }
  get serverError(): this {
    if (this.actual && typeof this.actual === "object" && typeof this.actual.code === "number") {
      const code = this.actual.code;
      this._check(code >= 500 && code < 600, `expected server error status 5xx but got ${code}`);
      return this;
    }
    throw new Error("serverError assertion is only valid for responses");
  }
  get error(): this {
    if (this.actual && typeof this.actual === "object" && typeof this.actual.code === "number") {
      const code = this.actual.code;
      this._check(code >= 400 && code < 600, `expected error status 4xx/5xx but got ${code}`);
      return this;
    }
    throw new Error("error assertion is only valid for responses");
  }
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
      if (vars[key] !== undefined) {
        return vars[key]!;
      }
      if (key === "$guid" || key === "$randomUUID") {
        return crypto.randomUUID();
      }
      if (key === "$timestamp") {
        return Math.floor(Date.now() / 1000).toString();
      }
      if (key === "$isoTimestamp") {
        return new Date().toISOString();
      }
      if (key === "$randomInt") {
        return Math.floor(Math.random() * 1001).toString();
      }
      return m;
    });
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lowerName);
}

function redactValue(key: string, value: string): string {
  return SENSITIVE_KEY_RE.test(key) ? "<redacted>" : value;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key] = redactValue(key, value);
  return out;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_KEY_RE.test(key)) parsed.searchParams.set(key, "<redacted>");
    }
    if (parsed.username) parsed.username = "<redacted>";
    if (parsed.password) parsed.password = "<redacted>";
    return parsed.toString();
  } catch {
    return url;
  }
}

function redactPayloadPreview(text: string, contentType?: string): string {
  const type = contentType || "";
  if (type.includes("json")) {
    try {
      const redact = (value: any): any => {
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === "object") {
          const out: Record<string, any> = {};
          for (const [key, child] of Object.entries(value)) out[key] = SENSITIVE_KEY_RE.test(key) ? "<redacted>" : redact(child);
          return out;
        }
        return value;
      };
      return JSON.stringify(redact(JSON.parse(text)));
    } catch {
      return text;
    }
  }
  if (type.includes("x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_KEY_RE.test(key)) params.set(key, "<redacted>");
    }
    return params.toString();
  }
  return text;
}

function previewText(text: string, contentType?: string): { preview: string; truncated: boolean } {
  const redacted = redactPayloadPreview(text, contentType);
  return {
    preview: redacted.length > BODY_PREVIEW_CHARS ? redacted.slice(0, BODY_PREVIEW_CHARS) + "..." : redacted,
    truncated: redacted.length > BODY_PREVIEW_CHARS,
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function inferRawContentType(bodyObj: any, raw: string): string | undefined {
  const language = String(bodyObj?.options?.raw?.language || "").toLowerCase();
  if (language === "json") return "application/json";
  if (language === "xml") return "application/xml";
  if (language === "html") return "text/html";
  if (language === "javascript") return "application/javascript";
  if (language === "text") return "text/plain";
  const trimmed = raw.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { JSON.parse(trimmed); return "application/json"; } catch { return undefined; }
  }
  return undefined;
}

function getRequestBody(bodyObj: any, vars: Vars, headers: Record<string, string>): RequestBodyBuild | null {
  if (!bodyObj || bodyObj.disabled === true) return null;
  const mode = bodyObj.mode;
  if (!mode) return null;

  if (mode === "raw" && typeof bodyObj.raw === "string") {
    const raw = resolveVars(bodyObj.raw, vars);
    const contentType = inferRawContentType(bodyObj, raw);
    const preview = previewText(raw, contentType);
    return { body: raw, mode, contentType, bytes: byteLength(raw), preview: preview.preview, previewTruncated: preview.truncated, warnings: [] };
  }

  if (mode === "urlencoded" && Array.isArray(bodyObj.urlencoded)) {
    const params = new URLSearchParams();
    for (const param of bodyObj.urlencoded) {
      if (param.disabled !== true && param.key) {
        params.append(resolveVars(param.key, vars), resolveVars(param.value || "", vars));
      }
    }
    const body = params.toString();
    const contentType = "application/x-www-form-urlencoded";
    const preview = previewText(body, contentType);
    return {
      body,
      mode,
      contentType,
      bytes: byteLength(body),
      preview: preview.preview,
      previewTruncated: preview.truncated,
      warnings: [],
    };
  }

  if (mode === "formdata" && Array.isArray(bodyObj.formdata)) {
    const fd = new FormData();
    const warnings: string[] = [];
    let fields = 0;
    for (const item of bodyObj.formdata) {
      if (item.disabled !== true && item.key) {
        fields++;
        if (item.type === "file") {
          warnings.push(`formdata file field "${item.key}" cannot load local files; appended file source as a string placeholder`);
          fd.append(resolveVars(item.key, vars), item.src || item.value || "");
        } else {
          fd.append(resolveVars(item.key, vars), resolveVars(item.value || "", vars));
        }
      }
    }
    return { body: fd, mode, bytes: null, preview: `[FormData: ${fields} field${fields === 1 ? "" : "s"}]`, previewTruncated: false, warnings };
  }

  if (mode === "graphql" && bodyObj.graphql) {
    try {
      const query = resolveVars(bodyObj.graphql.query, vars);
      const variables = bodyObj.graphql.variables
        ? JSON.parse(resolveVars(bodyObj.graphql.variables, vars))
        : undefined;
      return {
        body: JSON.stringify({ query, variables }),
        mode,
        contentType: "application/json",
        bytes: byteLength(JSON.stringify({ query, variables })),
        preview: previewText(JSON.stringify({ query, variables }), "application/json").preview,
        previewTruncated: previewText(JSON.stringify({ query, variables }), "application/json").truncated,
        warnings: [],
      };
    } catch (e: any) {
      return { body: undefined, mode, bytes: null, preview: null, previewTruncated: false, warnings: [`invalid GraphQL variables JSON: ${e?.message ?? String(e)}`] };
    }
  }

  if (mode === "file") {
    return { body: undefined, mode, bytes: null, preview: null, previewTruncated: false, warnings: ["Postman file body mode is not supported by this runner"] };
  }

  return { body: undefined, mode, bytes: null, preview: null, previewTruncated: false, warnings: [`unsupported request body mode: ${mode}`] };
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
    globals: env,
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
      const method = ((typeof req === "object" && req.method) || "GET").toUpperCase();
      const sendHeaders: Record<string, string> = {};
      let sendBody: any = undefined;

      if (typeof req === "object" && req !== null) {
        const rawHeaders = req.header || req.headers;
        if (rawHeaders) {
          if (Array.isArray(rawHeaders)) {
            for (const h of rawHeaders) {
              if (h && h.key && h.disabled !== true) {
                sendHeaders[h.key] = resolveVars(h.value, vars);
              }
            }
          } else if (typeof rawHeaders === "object") {
            for (const [k, v] of Object.entries(rawHeaders)) {
              sendHeaders[k] = resolveVars(String(v), vars);
            }
          }
        }

        if (req.body) {
          if (typeof req.body === "string") {
            sendBody = resolveVars(req.body, vars);
          } else if (typeof req.body === "object") {
            const bodyResult = getRequestBody(req.body, vars, sendHeaders);
            if (bodyResult) {
              sendBody = bodyResult.body;
              if (bodyResult.contentType && !hasHeader(sendHeaders, "Content-Type")) {
                sendHeaders["Content-Type"] = bodyResult.contentType;
              }
            }
          }
        }
      }

      const p = (async () => {
        try {
          const fetchOptions: any = {
            method,
            headers: sendHeaders,
          };
          if (sendBody !== undefined && method !== "GET" && method !== "HEAD") {
            fetchOptions.body = sendBody;
          }
          const r = await fetch(resolveVars(url, vars), fetchOptions);
          const text = await r.text();
          const resp = {
            code: r.status,
            status: r.statusText,
            json: () => JSON.parse(text),
            text: () => text,
            headers: {
              get: (name: string) => r.headers.get(name),
              has: (name: string) => r.headers.has(name),
            },
          };
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

function pathQueryUrl(req: any): string {
  const raw = rawUrl(req);
  if (raw) return raw;
  const u = req.url;
  if (!u || typeof u === "string") return raw;
  const protocol = u.protocol ? `${u.protocol}://` : "";
  const host = Array.isArray(u.host) ? u.host.join(".") : (u.host || "");
  const path = Array.isArray(u.path) ? u.path.join("/") : (u.path || "");
  const query = Array.isArray(u.query)
    ? u.query
      .filter((q: any) => q && q.disabled !== true && q.key)
      .map((q: any) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? "")}`)
      .join("&")
    : "";
  const base = `${protocol}${host}${path ? `/${path}` : ""}`;
  return query ? `${base}?${query}` : base;
}

function getEventExec(item: any, listen: string): (string | null)[] | null {
  for (const ev of item.event || []) if (ev.listen === listen && ev.script) return ev.script.exec || [];
  return null;
}

function truncate(text: string | null): string | null {
  if (text == null) return null;
  return text.length > MAX_BODY_CHARS
    ? text.slice(0, MAX_BODY_CHARS) + `\n...[truncated ${text.length - MAX_BODY_CHARS} chars]`
    : text;
}

function defaultBodyDiagnostics(mode: string | null = null): RequestBodyDiagnostics {
  return { mode, sent: false, contentType: null, bytes: null, preview: null, previewTruncated: false };
}

function buildRequest(request: any, vars: Vars): BuiltRequest {
  const url = resolveVars(pathQueryUrl(request), vars);
  const method = (request.method || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  for (const h of request.header || []) {
    if (h && h.key && h.disabled !== true) {
      headers[h.key] = resolveVars(h.value, vars);
    }
  }

  const bodyResult = getRequestBody(request.body, vars, headers);
  const warnings = bodyResult ? [...bodyResult.warnings] : [];
  let fetchBody: any = undefined;
  let body = defaultBodyDiagnostics(request.body?.mode ?? null);
  if (bodyResult) {
    if (bodyResult.contentType && !hasHeader(headers, "Content-Type")) {
      headers["Content-Type"] = bodyResult.contentType;
    }
    if (bodyResult.body !== undefined && method !== "GET" && method !== "HEAD") {
      fetchBody = bodyResult.body;
      const contentType = bodyResult.contentType || Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] || null;
      body = {
        mode: bodyResult.mode,
        sent: true,
        contentType,
        bytes: bodyResult.bytes,
        preview: bodyResult.preview,
        previewTruncated: bodyResult.previewTruncated,
      };
    } else if (bodyResult.body !== undefined) {
      warnings.push(`body was defined but omitted for ${method} requests`);
      body = {
        mode: bodyResult.mode,
        sent: false,
        contentType: bodyResult.contentType || null,
        bytes: bodyResult.bytes,
        preview: bodyResult.preview,
        previewTruncated: bodyResult.previewTruncated,
      };
    }
  }

  return { method, url, headers, fetchBody, body, warnings };
}

function requestDiagnostics(built: BuiltRequest): RequestDiagnostics {
  return {
    method: built.method,
    url: redactUrl(built.url),
    headers: redactHeaders(built.headers),
    body: built.body,
  };
}

function isProductionLikeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) return false;
    if (SAFE_NON_PROD_HOST_RE.test(parsed.hostname)) return false;
    return EXPLICIT_PROD_HOST_RE.test(parsed.hostname) || ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function environmentTargets(environment: any): SafetyTarget[] {
  const targets: SafetyTarget[] = [];
  for (const value of (environment && environment.values) || []) {
    if (value?.enabled === false || typeof value?.value !== "string") continue;
    if (!/url|uri|endpoint/i.test(String(value.key))) continue;
    const candidate = value.value;
    if (/^https?:\/\//i.test(candidate)) targets.push({ label: `environment.${value.key}`, url: candidate });
  }
  return targets;
}

function assessSafety(requests: Array<{ method: string; url: string }>, environment: any, safety?: SafetyOptions): SafetyAssessment {
  const targets: SafetyTarget[] = [
    ...requests.map((request) => ({ label: `${request.method} ${request.url}`, url: request.url })),
    ...environmentTargets(environment),
  ];
  const productionLikeTargets = Array.from(new Set(
    targets
      .filter((target) => isProductionLikeUrl(target.url))
      .map((target) => redactUrl(target.url)),
  ));
  const writeMethods = Array.from(new Set(requests.filter((request) => WRITE_METHODS.has(request.method)).map((request) => request.method))).sort();
  const warnings: string[] = [];
  if (productionLikeTargets.length > 0 && !safety?.allowProduction) {
    warnings.push("production-like target detected; pass allowProduction with an approval note to execute");
  }
  if (writeMethods.length > 0 && !safety?.allowWrites) {
    warnings.push("write methods detected; pass allowWrites after confirming the target is safe for mutation");
  }
  if ((productionLikeTargets.length > 0 && safety?.allowProduction) || (writeMethods.length > 0 && safety?.allowWrites)) {
    if (!safety?.approvalNote?.trim()) warnings.push("approvalNote is required when allowProduction or allowWrites is used");
  }
  return {
    blocked: warnings.length > 0,
    productionLikeTargets,
    writeMethods,
    warnings,
    approvalNote: safety?.approvalNote || null,
  };
}

function assertRunnable(safety: SafetyAssessment): void {
  if (!safety.blocked) return;
  throw new Error(`Safety gate blocked execution: ${safety.warnings.join("; ")}`);
}

async function executeItem(item: any, ctx: { vars: Vars; collectionPre: (string | null)[] | null; timeoutMs: number }): Promise<RequestResult> {
  const { vars, collectionPre, timeoutMs } = ctx;
  if (collectionPre) await runScript(collectionPre, vars, undefined, { allowSend: true });
  const itemPre = getEventExec(item, "prerequest");
  if (itemPre) await runScript(itemPre, vars, undefined, { allowSend: true });

  const built = buildRequest(item.request, vars);

  const started = Date.now();
  let status: number | null = null;
  let statusText: string | null = null;
  let text: string | null = null;
  let reqErr: string | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const fetchOptions: any = {
      method: built.method,
      headers: built.headers,
      signal: ctrl.signal,
    };
    if (built.fetchBody !== undefined) {
      fetchOptions.body = built.fetchBody;
    }
    const r = await fetch(built.url, fetchOptions);
    clearTimeout(timer);
    status = r.status;
    statusText = r.statusText;
    responseHeaders = r.headers;
    text = await r.text();
  } catch (e: any) {
    reqErr = String(e?.message ?? e);
  }
  const timeMs = Date.now() - started;

  const response = {
    code: status, status: statusText, responseTime: timeMs,
    json: () => JSON.parse(text as string), text: () => text,
    to: new Assertion({ code: status }),
    headers: {
      get: (name: string) => (responseHeaders ? responseHeaders.get(name) : null),
      has: (name: string) => (responseHeaders ? responseHeaders.has(name) : false),
    },
  };
  let assertions: PmAssertion[] = [];
  const testExec = getEventExec(item, "test");
  if (testExec && reqErr == null) assertions = await runScript(testExec, vars, response, { allowSend: false });

  return {
    name: item.name || "(unnamed)",
    method: built.method,
    url: redactUrl(built.url),
    request: requestDiagnostics(built),
    status,
    statusText,
    timeMs,
    assertionsPassed: assertions.filter((a) => a.passed).length,
    assertionsFailed: assertions.filter((a) => !a.passed).length,
    assertions,
    responseBody: truncate(text),
    response: text == null ? null : {
      contentType: responseHeaders ? responseHeaders.get("content-type") : null,
      bytes: byteLength(text),
      bodyTruncated: text.length > MAX_BODY_CHARS,
    },
    requestError: reqErr,
    warnings: built.warnings,
  };
}

function collectVars(collection: any, environment: any): Vars {
  const vars: Vars = {};
  for (const v of (collection && collection.variable) || []) vars[v.key] = v.value;
  for (const v of (environment && environment.values) || []) if (v.enabled !== false) vars[v.key] = v.value;
  return vars;
}

export async function runFolder(opts: RunOptions): Promise<RunOutput> {
  const { collection, environment, folderId, folderName, requestName, timeoutMs, safety } = opts;
  const vars = collectVars(collection, environment);
  const collectionPre = getEventExec(collection, "prerequest");
  const runStarted = Date.now();

  const items = selectItems({ collection, folderId, folderName, requestName });
  const builtForSafety = items.map((item) => buildRequest(item.request, vars));
  assertRunnable(assessSafety(builtForSafety, environment, safety));

  const ctx = { vars, collectionPre, timeoutMs: timeoutMs ?? 30_000 };
  const results: RequestResult[] = [];
  for (const item of items) results.push(await executeItem(item, ctx)); // sequential: shared token/vars

  const assertionsTotal = results.reduce((n, r) => n + r.assertions.length, 0);
  const assertionsFailed = results.reduce((n, r) => n + r.assertionsFailed, 0);
  const methodCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.method || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const statusCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.status == null ? "ERROR" : String(r.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    summary: {
      totalRequests: results.length,
      requestsErrored: results.filter((r) => r.requestError).length,
      assertionsTotal,
      assertionsFailed,
      anyFailure: assertionsFailed > 0 || results.some((r) => r.requestError),
      durationMs: Date.now() - runStarted,
      methodCounts,
      statusCounts,
      bytesReceived: results.reduce((n, r) => n + (r.response?.bytes || 0), 0),
    },
    results,
  };
}

function selectItems(opts: { collection: any; folderId?: string; folderName?: string; requestName?: string }): any[] {
  const { collection, folderId, folderName, requestName } = opts;
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
  return items;
}

export function previewRequests(opts: RunOptions): PreviewOutput {
  const { collection, environment, folderId, folderName, requestName, safety } = opts;
  const vars = collectVars(collection, environment);
  const builtRequests: Array<BuiltRequest & { name: string }> = selectItems({ collection, folderId, folderName, requestName }).map((item) => ({
    name: item.name || "(unnamed)",
    ...buildRequest(item.request, vars),
  }));
  const requests = builtRequests.map<RequestPreview>((built) => {
    return {
      name: built.name,
      method: built.method,
      url: redactUrl(built.url),
      headers: redactHeaders(built.headers),
      body: built.body,
      warnings: built.warnings,
    };
  });
  const methodCounts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {});
  return {
    summary: {
      totalRequests: requests.length,
      methodCounts,
      writeRequests: requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method)).length,
      warnings: requests.reduce((n, r) => n + r.warnings.length, 0),
    },
    safety: assessSafety(builtRequests, environment, safety),
    requests,
  };
}

export { expect, Assertion };
