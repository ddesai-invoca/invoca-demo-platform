/* Service worker — keeps the app loadable while the server is being redeployed.
   ============================================================================
   WHY THIS EXISTS. A Render disk attaches to one instance at a time, so a deploy
   must stop the old instance before the new one boots. Measured on 2026-08-20:
   ~40 seconds where the origin answered nothing at all. An already-loaded browser
   survives that (the whole app is one bundle already in memory), but anyone who
   hits REFRESH inside the window gets the browser's error page — mid-demo, in front
   of a customer. That is the failure this removes, and it is the only one it
   removes: it does NOT shorten the window. See CLAUDE.md TODO 0.

   WHAT IS CACHED, AND WHAT DELIBERATELY IS NOT
   - Navigations: network first, cache as the shell on success, fall back to the
     cached shell when the network fails. Network-first is what makes a deploy
     visible immediately afterwards instead of pinning users to an old build.
   - `/assets/*`: cache first. Safe ONLY because the filenames are content-hashed,
     so a name never means two different things.
   - `/api/*`, `/auth/*`, `/healthz`: NEVER cached, not even opportunistically.
     Demo content must never come from here. The "Bill is still seeing the old
     conversation" class of bug is exactly what a data cache would reintroduce, and
     that one took real debugging to kill the first time.

   ⚠️ THE SINGLE BUNDLE IS LOAD-BEARING, AND THIS MAKES IT MORE SO. The build is one
   hashed JS file with NO code splitting. A cached shell paired with a cached bundle
   is therefore always a CONSISTENT pair. Introduce code splitting and a cached
   shell could ask for a lazy chunk that was never cached and no longer exists on the
   server — a white screen mid-demo, which is worse than the problem this solves.

   ⚠️ KILL SWITCH. Set KILL = true and deploy: every client unregisters itself and
   drops its caches on the next load. Do that rather than deleting this file —
   deleting it leaves already-registered workers running forever. */

const KILL = false;

/* Bump on any change to this file's logic. Old caches are dropped on activate. */
const VERSION = "v1";
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const SHELL_KEY = "/index.html";

/* Never let these reach a cache. */
const BYPASS = [/^\/api\//, /^\/auth\//, /^\/healthz$/, /^\/sw\.js$/];

/* ⚠️ PRECACHE ON INSTALL, AND DO NOT GO BACK TO CACHING LAZILY. The first version of
   this cached nothing here, reasoning that the bundle's hashed name is unknowable from
   inside this file and the first load would populate the caches. It does not: the
   navigation that REGISTERS a worker, and the bundle fetch it triggers, both complete
   before the worker exists, so there is nothing to intercept. `clients.claim()` takes
   control of the page but cannot retroactively cache what already loaded. Observed in
   Chrome: worker active, Cache Storage EMPTY, and it stayed that way until a second
   load. That is exactly backwards for the case this exists for — open the app, a deploy
   lands, refresh, and nothing had been cached.
   The hashed name IS knowable: read it out of the shell HTML. */
self.addEventListener("install", (event) => {
  if (KILL) return;
  event.waitUntil((async () => {
    try {
      const res = await fetch(SHELL_KEY, { cache: "no-store" });
      const type = res.headers.get("content-type") || "";
      /* Same guard as the runtime path: only a same-origin 200 HTML response is the
         shell. `res.type !== "basic"` is what rejects a sign-in redirect that fetch has
         quietly followed off to accounts.google.com. */
      if (res.ok && res.type === "basic" && type.includes("text/html")) {
        const html = await res.clone().text();
        await (await caches.open(SHELL_CACHE)).put(SHELL_KEY, res);
        const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        if (refs.length) {
          const assets = await caches.open(ASSET_CACHE);
          await Promise.all(refs.map(async (p) => {
            try {
              const r = await fetch(p, { cache: "no-store" });
              if (r.ok && r.type === "basic") await assets.put(p, r);
            } catch { /* one asset failing must not fail the install */ }
          }));
        }
      }
    } catch {
      /* Offline at install time: nothing to precache. The runtime handlers still fill
         the caches on the next successful load, so this is a degraded start, not a
         broken one. */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (KILL) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.registration.unregister();
      return;
    }
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== SHELL_CACHE && n !== ASSET_CACHE).map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (KILL) return;
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never touch Google/Mapbox/etc.
  if (BYPASS.some((re) => re.test(url.pathname))) return;

  /* A navigation is the case that matters: it is what a refresh does. */
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        /* ⚠️ ONLY a same-origin 200 HTML response is the shell. The app sits behind a
           Google sign-in gate, so an unauthenticated navigation is a 302 to
           accounts.google.com — caching that as the shell would pin every user to a
           redirect. Opaque and non-200 responses are passed through untouched. */
        const type = res.headers.get("content-type") || "";
        if (res.ok && res.type === "basic" && type.includes("text/html")) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_KEY, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE });
        if (cached) return cached;
        throw new Error("offline and no cached shell");
      }
    })());
    return;
  }

  /* Hashed build assets: cache first, because the name pins the content. */
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    })());
  }
  /* Everything else (fonts, icons, the standalone artifact pages) is left alone —
     the browser's own HTTP cache already handles them, and every extra thing cached
     here is another thing that can go stale. */
});
