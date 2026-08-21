/* Runs public/sw.js's real handlers in Node with stubbed caches/fetch.
   This does NOT prove the browser registers it. It proves the decisions that would
   actually hurt production: caching an auth redirect as the shell, caching /api data,
   or failing to fall back to the shell when the origin is down. */
import fs from "node:fs";

const ORIGIN = "http://localhost:5199";
const log = [];
let netMode = "up";        // up | down | redirect
let fetchCalls = 0;

class FakeCache {
  constructor(name) { this.name = name; this.map = new Map(); }
  async put(reqOrUrl, res) {
    const key = new URL(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url, ORIGIN).pathname;
    this.map.set(key, res);
    log.push(`PUT ${this.name} ${key}`);
  }
  async match(reqOrUrl) {
    const key = new URL(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url, ORIGIN).pathname;
    return this.map.get(key);
  }
  async keys() { return [...this.map.keys()]; }
}
const cacheStore = new Map();
globalThis.caches = {
  async open(name) {
    if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache(name));
    return cacheStore.get(name);
  },
  async keys() { return [...cacheStore.keys()]; },
  async delete(n) { return cacheStore.delete(n); },
  async match(key, { cacheName } = {}) {
    const c = cacheStore.get(cacheName);
    return c ? c.match(key) : undefined;
  },
};

const mkRes = (body, { status = 200, type = "text/html", resType = "basic" } = {}) => {
  const r = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(r, "type", { value: resType });
  return r;
};

globalThis.fetch = async (req) => {
  fetchCalls++;
  if (netMode === "down") throw new TypeError("Failed to fetch");
  /* ⚠️ RESOLVE RELATIVE PATHS. A real service worker resolves fetch("/index.html")
     against its scope; `new URL(relative)` throws. Without this the install precache
     failed inside its own try/catch and the suite blamed the worker. */
  const raw = typeof req === "string" ? req : req.url;
  const p = new URL(raw, ORIGIN).pathname;
  if (netMode === "redirect") {
    const r = mkRes("", { status: 302, type: "text/html" });
    return r;
  }
  if (p.startsWith("/assets/")) return mkRes("BUNDLE", { type: "application/javascript" });
  return mkRes('<html><script src="/assets/index-abc.js"></script>'
    + '<link rel="stylesheet" href="/assets/index-def.css"></html>');
};

const handlers = {};
globalThis.self = {
  location: new URL(ORIGIN + "/"),
  addEventListener: (t, fn) => { handlers[t] = fn; },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
  registration: { unregister: async () => { log.push("UNREGISTERED"); } },
};

eval(fs.readFileSync("public/sw.js", "utf8"));

/* ⚠️ AWAIT THE waitUntil PROMISE, not the handler. A lifecycle handler returns
   undefined — it hands its real work to event.waitUntil(). `await handlers.install(...)`
   therefore awaited nothing and every assertion ran before the precache finished, which
   read as "the worker caches nothing". */
async function lifecycle(name) {
  let work;
  await handlers[name]({ waitUntil: (p) => { work = p; } });
  if (work) await work;
}

/* drive one fetch event and return what the worker responded with (or null when it
   passed the request through untouched) */
async function drive(path, { mode = "navigate", origin = ORIGIN } = {}) {
  const req = new Request(origin + path);
  Object.defineProperty(req, "mode", { value: mode });
  let promise = null;
  handlers.fetch({ request: req, respondWith: (p) => { promise = p; } });
  if (!promise) return { passedThrough: true };
  try { return { res: await promise }; } catch (e) { return { threw: e.message }; }
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

/* 0. INSTALL must leave both caches populated — the regression that started this.
      A first visit registers the worker AFTER the page and bundle have already loaded,
      so lazy caching left Cache Storage empty until a second load. */
netMode = "up";
await lifecycle("install");
check("install precaches the shell", log.includes("PUT shell-v1 /index.html"), log.join(" | "));
check("install precaches the hashed assets parsed out of the shell",
  log.includes("PUT assets-v1 /assets/index-abc.js") && log.includes("PUT assets-v1 /assets/index-def.css"),
  log.join(" | "));

/* An install behind the sign-in gate must cache NOTHING rather than a redirect. */
{
  const saved = [...log]; log.length = 0; cacheStore.clear();
  netMode = "redirect";
  await lifecycle("install");
  check("install behind an auth redirect caches nothing",
    !log.some((l) => l.startsWith("PUT")), log.join(" | ") || "(nothing cached)");
  log.length = 0; cacheStore.clear();
  netMode = "up";
  await lifecycle("install");   // restore a populated state
  saved.length = 0;
}

await lifecycle("activate");

/* 1. server UP: navigation goes to network AND the shell gets cached */
netMode = "up";
let r = await drive("/");
check("navigation online serves network 200", r.res?.status === 200, `status ${r.res?.status}`);
check("shell cached on a 200 html navigation", log.includes("PUT shell-v1 /index.html"), log.join(" | "));

/* 2. the hashed asset is cached, and a SECOND request must NOT hit the network */
/* ⚠️ USE AN ASSET INSTALL DID NOT PRECACHE. Against a precached one this measured
   0 fetches for BOTH requests — correct behaviour, but it proves nothing about
   cache-first, since the network was never the source either time. */
fetchCalls = 0;
await drive("/assets/lazy-xyz.js", { mode: "no-cors" });
const afterFirst = fetchCalls;
await drive("/assets/lazy-xyz.js", { mode: "no-cors" });
check("asset cache-first (1st fetches, 2nd is served from cache)",
  afterFirst === 1 && fetchCalls === 1, `fetches 0->${afterFirst}->${fetchCalls}`);
check("a precached asset needs no network at all",
  await (async () => { fetchCalls = 0; await drive("/assets/index-abc.js", { mode: "no-cors" }); return fetchCalls === 0; })(),
  `fetches ${fetchCalls}`);

/* 3. THE CASE THIS EXISTS FOR: origin down, refresh still gets the shell */
netMode = "down";
r = await drive("/dashboards/marketing");
const body = r.res ? await r.res.text() : "";
check("origin DOWN: navigation falls back to the cached shell",
  r.res?.status === 200 && body.includes("/assets/index-abc.js"), r.threw || `status ${r.res?.status} body ${body.slice(0,60)}`);

/* 4. /api must never be touched, up or down */
netMode = "up";
r = await drive("/api/status", { mode: "cors" });
check("/api passes through, never cached", r.passedThrough === true, JSON.stringify(r));
const apiCached = log.some((l) => l.includes("/api"));
check("nothing under /api was ever cached", !apiCached, log.filter(l=>l.includes("/api")).join());

/* 5. AUTH REDIRECT must not become the shell — the sharpest trap */
cacheStore.clear(); log.length = 0;
netMode = "redirect";
r = await drive("/");
check("a 302 auth redirect is NOT cached as the shell",
  !log.some((l) => l.includes("PUT shell")), log.join(" | ") || "(nothing cached)");

/* 6. cross-origin is never intercepted */
r = await drive("/x.png", { mode: "no-cors", origin: "https://api.mapbox.com" });
check("cross-origin passes through", r.passedThrough === true, JSON.stringify(r));

/* 7. /healthz and /sw.js bypass */
r = await drive("/healthz", { mode: "cors" });
check("/healthz passes through", r.passedThrough === true, JSON.stringify(r));
r = await drive("/sw.js", { mode: "no-cors" });
check("/sw.js passes through", r.passedThrough === true, JSON.stringify(r));

let bad = 0;
for (const t of results) { if (!t.pass) bad++; console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name}${t.pass ? "" : "\n      -> " + t.detail}`); }
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
