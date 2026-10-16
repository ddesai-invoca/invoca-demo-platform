/* =============================================================================
   canonicalHost — send visitors on the onrender.com address to the real domain
   -----------------------------------------------------------------------------
   Asked for 10/15/2026, once env-invoca.net was live: *"if anyone goes to the
   render site, I want them to get redirected to the new site."* Render cannot
   do this itself; its redirect settings only cover custom domains.

   ⚠️⚠️ IT SWITCHES ITSELF ON FROM `BASE_URL`, and only when that names a domain
   that is NOT onrender.com. So the staging service (no BASE_URL) and a laptop
   (localhost) never redirect, and the one ordering rule is the same as for sign-in:
   set BASE_URL only once the new domain answers. `CANONICAL_REDIRECT=off` disables it.

   ⚠️ PAGE LOADS ONLY. These are never redirected, each for a reason:
     • `/api/*`: the two claude.ai routines read /api/canary on the onrender address
       with a plain fetch, and a tab still open there POSTs to /api/chat; a redirect
       turns a POST into a GET and every one of those silently breaks.
     • `/auth/*`: a sign-in started on the old address has to finish there.
     • `/healthz`: Render's health check.
     • anything but GET/HEAD, for the POST reason above.
   ⚠️ 302, NOT 301. Browsers cache a 301 forever, so a mistaken BASE_URL would keep
   sending people to the wrong place after it was fixed. A 302 behaves the same for
   the visitor and is undone the moment the setting is.
   ============================================================================= */

const EXEMPT = /^\/(api|auth)(\/|$)|^\/healthz$/;

/**
 * Where to send this request, or null to serve it here.
 * Pure: the server passes in the host, method, URL and BASE_URL.
 */
export function canonicalRedirect(
  host: string | undefined,
  method: string,
  url: string,
  baseUrl: string | undefined,
  off = false,
): string | null {
  if (off || !baseUrl || !host) return null;
  if (method !== "GET" && method !== "HEAD") return null;
  let target: URL;
  try { target = new URL(baseUrl); } catch { return null; }
  if (!/^https?:$/.test(target.protocol) || /\.onrender\.com$/i.test(target.hostname)) return null;
  const h = host.split(":")[0].toLowerCase();
  if (!h.endsWith(".onrender.com") || h === target.hostname.toLowerCase()) return null;
  const path = url.startsWith("/") ? url : "/" + url;
  if (EXEMPT.test(path.split("?")[0])) return null;
  return `${target.protocol}//${target.host}${path}`;
}
