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

self.addEventListener("install", (event) => {
  if (KILL) return;
  /* Nothing is precached: the bundle's name is content-hashed and this file has no
     way to know it. The first successful load populates both caches. */
  event.waitUntil(self.skipWaiting());
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
