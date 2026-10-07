/* =============================================================================
   shareMode — is this browser a PROSPECT on a shared link, or an SE?
   -----------------------------------------------------------------------------
   Asked for 10/6/2026: an SE shares one demo with a prospect. The prospect sees
   their OWN demo and nothing else — no other prospects, no network switcher, no
   launch screen. The first page they land on is Agent Studio.

   ⚠️⚠️ **READ FROM THE PATH AT MODULE LOAD, AND THAT IS DELIBERATE.** The token is
   fixed for the life of the page, and everything downstream — which provider tree
   renders, which routes exist, where `/api/chat` points — has to agree about it
   from the first paint. A React context would make it a value that arrives late,
   and the window where it is still `undefined` is exactly where an SE-only control
   would render for one frame on a prospect's screen.

   ⚠️ **`location.pathname`, NEVER a query parameter or storage.** A `?share=` could
   be added to any URL in the signed-in app and would flip a real SE session into
   prospect mode; a path prefix cannot be, because the server only serves the SPA
   shell under `/share/:token`.
   ============================================================================= */

/* ⚠️ The default lives in `shareDefaults.ts`, which carries no DOM reference so the
   server can import it too — this module reads `location` and the engine project
   compiles without a DOM lib. Re-exported so client code has one place to look. */
export { DEFAULT_SHARE_DAYS } from "./shareDefaults";

/** `/share/<token>/agent-studio` → the token. Null anywhere else in the app. */
function readToken(): string | null {
  if (typeof location === "undefined") return null;
  const m = /^\/share\/([A-Za-z0-9_-]{20,64})(?:\/|$)/.exec(location.pathname);
  return m ? m[1] : null;
}

export const SHARE_TOKEN: string | null = readToken();
export const isShareMode = (): boolean => SHARE_TOKEN !== null;

/** Everything under `/share/<token>` so React Router can own the rest of the path. */
export const SHARE_BASENAME = SHARE_TOKEN ? `/share/${SHARE_TOKEN}` : "";

/**
 * Where the prospect lands. Asked for explicitly: not a home page, not a list —
 * Agent Studio.
 */
export const SHARE_LANDING = "/agent-studio";

/**
 * The ONLY routes a shared demo answers.
 *
 * ⚠️⚠️ **ENFORCED ON THE ROUTE, NOT JUST THE NAV — this repo has already paid for
 * the other way round.** The AI-Conversion dashboard note records that gating only
 * the list row left a bookmarked or pasted URL rendering a full dashboard for
 * whichever prospect was active. A prospect typing `/dashboards/marketing` under
 * their share prefix must get a refusal, not a dashboard.
 */
export const SHARE_ROUTES = [
  "/agent-studio",
  "/reports",
  "/reports/sms-conversation-intelligence",
  "/reports/voice-conversation-intelligence",
];

/** Is this path part of the shared demo? Prefix-matched so sub-pages come along. */
export function shareAllows(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" ) return true; /* the index redirect to the landing page */
  /* Agent Studio owns a whole subtree (config, knowledge, workflows, preview). */
  if (p === "/agent-studio" || p.startsWith("/agent-studio/")) return true;
  /* ⚠️ Reports is NOT a subtree: only the two AI CI reports were asked for, so the
     Digital Journey report, the human call-log CI report and the artifacts stay out
     even though they live under the same prefix. */
  return SHARE_ROUTES.includes(p);
}

/**
 * Point an API call at the share-scoped twin.
 *
 * ⚠️⚠️ **THE PROSPECT'S AGENT MUST GO THROUGH `/api/share/<token>/…`, or it hits the
 * GATED route and the call simply fails behind a Google redirect.** It is also what
 * applies the per-link daily caps — the signed-in `/api/chat` has none, because an
 * SE is not an anonymous visitor holding a link.
 */
export function apiPath(path: string): string {
  if (!SHARE_TOKEN) return path;
  const m = /^\/api\/(chat|analyze|livekit-token)$/.exec(path);
  return m ? `/api/share/${SHARE_TOKEN}/${m[1]}` : path;
}
