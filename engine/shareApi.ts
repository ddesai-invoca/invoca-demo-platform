/* =============================================================================
   shareApi — the PUBLIC half of a shared agentic demo
   -----------------------------------------------------------------------------
   Transport-agnostic, mounted by BOTH `server.ts` and the `vite.config.ts` dev
   plugin, the same rule every other API in this repo follows — two copies of a
   route is how dev and production come to disagree.

   ⚠️⚠️ **EVERY ROUTE HERE IS REACHABLE WITHOUT AN INVOCA SESSION, WHICH IS THE
   ENTIRE POINT AND ALSO THE ENTIRE RISK.** A prospect has no Google account, so
   these sit BEFORE `installAuth` exactly as `/api/status`, `/healthz` and
   `/api/client-error` already do. Three things follow, and none is optional:

     1. A visitor may only ever reach the ONE demo their token names. There is no
        route here that lists demos, and the demo id is read from the SHARE
        RECORD, never from the request — otherwise a token for demo A plus a body
        naming demo B would hand over demo B.
     2. The agent runs LIVE on this path (asked for explicitly), so it spends our
        Anthropic key and LiveKit minutes for whoever holds the link. Hence the
        per-link caps below. They are not a nicety: without them a single leaked
        link is an open bill.
     3. Nothing here writes to the demo. A prospect's own drawer edits live in
        their browser; the server offers them nowhere to land.
   ============================================================================= */
import crypto from "node:crypto";
import { DEFAULT_SHARE_DAYS } from "../src/data/shareDefaults.ts";
import { getShare, passwordMatches, shareActive, noteOpen, expiresAt, type ShareRecord } from "./shareStore.ts";
import { getDemo } from "./demoStore.ts";

const SECRET = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || "insecure-dev-secret";
const COOKIE_PREFIX = "invoca_share_";

/* ── the unlock cookie ────────────────────────────────────────────────────── */
/** Proof that THIS server accepted the password for THIS token. */
const stamp = (token: string) => crypto.createHmac("sha256", SECRET).update(`share:${token}`).digest("base64url");

export function cookieNameFor(token: string): string {
  /* ⚠️ The token is base64url and can be 43 chars; a cookie NAME may not contain
     every byte a token can, so it is hashed into the name rather than embedded. */
  return COOKIE_PREFIX + crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function unlocked(cookies: Record<string, string>, token: string): boolean {
  const got = cookies[cookieNameFor(token)] ?? "";
  const want = stamp(token);
  /* ⚠️ Length-guarded for the same reason the password compare is — timingSafeEqual
     throws on a mismatch rather than returning false. */
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── per-link spend caps ──────────────────────────────────────────────────── */
/**
 * ⚠️⚠️ **IN MEMORY ON PURPOSE, AND THE CONSEQUENCE IS STATED.** A counter on disk
 * would be one write per prospect message on the request path; this resets when the
 * service restarts, so a determined abuser could reset their budget by waiting for a
 * deploy. That is an acceptable trade for a link an SE can revoke instantly, and the
 * cap's real job is stopping a runaway script, not a patient adversary.
 */
const spend = new Map<string, { day: string; chat: number; voice: number }>();
export const CAPS = { chat: 120, voice: 10 };

function budget(token: string) {
  const day = new Date().toISOString().slice(0, 10);
  const cur = spend.get(token);
  if (!cur || cur.day !== day) { const fresh = { day, chat: 0, voice: 0 }; spend.set(token, fresh); return fresh; }
  return cur;
}

/** Returns false when this link has spent its allowance for the day. */
export function takeBudget(token: string, kind: "chat" | "voice"): boolean {
  const b = budget(token);
  if (b[kind] >= CAPS[kind]) return false;
  b[kind] += 1;
  return true;
}

/** Test seam — the caps are per-process state and a suite must start clean. */
export function __resetBudgets() { spend.clear(); }

/* ── what a visitor is allowed to see ─────────────────────────────────────── */
export interface ShareResult {
  status: number;
  body?: unknown;
  /** Set when the password was just accepted. */
  setCookie?: { name: string; value: string; maxAgeSeconds: number };
}

const gone = (rec: ShareRecord | null) => ({
  status: 410,
  body: {
    error: rec?.revokedAt ? "This demo link has been turned off." : "This demo link has expired.",
    prospect: rec?.prospect ?? "",
    expired: true,
  },
});

/**
 * Handle one public share request.
 *
 * ⚠️ `urlPath` arrives WITHOUT a query string and already url-decoded by the caller,
 * matching `handleDemoApi`'s contract.
 */
export async function handleShareApi(
  method: string,
  urlPath: string,
  body: Record<string, unknown> | undefined,
  cookies: Record<string, string>,
): Promise<ShareResult | null> {
  const m = /^\/api\/share\/([A-Za-z0-9_-]{20,64})(\/[a-z-]+)?$/.exec(urlPath);
  if (!m) return null;
  const token = m[1];
  const leaf = m[2] ?? "";
  const rec = getShare(token);

  /* ⚠️⚠️ **AN UNKNOWN TOKEN AND A REVOKED ONE ANSWER THE SAME WAY.** Distinguishing
     them would turn this route into an oracle for which links exist. */
  if (!rec) return { status: 410, body: { error: "This demo link is not valid.", expired: true } };

  /* The unlock SCREEN needs to know who it is for and whether it is worth asking. */
  if (method === "GET" && leaf === "") {
    if (!shareActive(rec)) return gone(rec);
    return { status: 200, body: { prospect: rec.prospect, expiresAt: expiresAt(rec).toISOString(), needsPassword: !unlocked(cookies, token) } };
  }

  if (method === "POST" && leaf === "/unlock") {
    if (!shareActive(rec)) return gone(rec);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!passwordMatches(rec, password)) {
      /* ⚠️ No hint about length or near-misses, and the password is never echoed. */
      return { status: 401, body: { error: "That password is not right." } };
    }
    noteOpen(token);
    return {
      status: 200,
      body: { ok: true, prospect: rec.prospect },
      setCookie: {
        name: cookieNameFor(token),
        value: stamp(token),
        /* ⚠️ The cookie never outlives the link itself. */
        maxAgeSeconds: Math.max(60, Math.floor((expiresAt(rec).getTime() - Date.now()) / 1000)),
      },
    };
  }

  /* Everything past here needs the password to have been accepted. */
  if (!unlocked(cookies, token)) return { status: 401, body: { error: "This demo is locked." } };
  if (!shareActive(rec)) return gone(rec);

  if (method === "GET" && leaf === "/demo") {
    /* ⚠️⚠️ **THE DEMO ID COMES FROM THE RECORD, NEVER THE REQUEST.** This is the one
       line that keeps a share from becoming a key to the whole library. */
    const demo = getDemo(rec.demoId);
    if (!demo) return { status: 404, body: { error: "This demo is no longer available." } };
    /* ⚠️ The OWNER's identity is not a prospect's business, so the record is served
       without its creator, and `canEdit` is false by construction — there is no
       route here that accepts a write. */
    const { creator: _c, updatedBy: _u, ...rest } = demo as unknown as Record<string, unknown>;
    return { status: 200, body: { demo: rest, canEdit: false, shared: true, prospect: rec.prospect } };
  }

  return { status: 404, body: { error: "Not found." } };
}

/** Does this request carry a valid unlock for a live share? Used by the live-agent routes. */
export function shareSession(cookies: Record<string, string>, token: string): ShareRecord | null {
  const rec = getShare(token);
  if (!rec || !shareActive(rec) || !unlocked(cookies, token)) return null;
  return rec;
}

/* ── the OWNER's half, behind the Google gate ─────────────────────────────── */
/**
 * Create, list, revoke and extend the links for a demo.
 *
 * ⚠️ **SEPARATE FROM `handleShareApi` BECAUSE THE AUDIENCE IS DIFFERENT.** Mounting
 * these on the public path would put link management one forgotten `if` away from a
 * prospect. They live behind `installAuth` with every other `/api/demos` route.
 */
export async function handleShareAdminApi(
  method: string,
  urlPath: string,
  body: Record<string, unknown> | undefined,
  user: { email: string; name?: string },
  canManage: (demoId: string) => boolean,
  /**
   * ⚠️⚠️ **ADMIN-ONLY, AND IT IS ENFORCED HERE RATHER THAN BY HIDING THE BUTTON.**
   * Asked for 10/7/2026: pilot the share feature with admins. Hiding the control is
   * cosmetic — anyone signed in could POST to this route directly — and this is the one
   * feature that sends a link OUTSIDE Invoca and spends our Anthropic and LiveKit budget
   * for whoever holds it, so the gate has to be where the decision is made.
   * ⚠️ **PASSED IN, NOT IMPORTED**, the same shape `handleFeedbackApi` already uses: both
   * twins decide who the user is, and this module stays transport-agnostic.
   * ⚠️ **THE PUBLIC SIDE IS UNAFFECTED.** `handleShareApi` — the prospect opening a link —
   * has no admin test and must not grow one, or a live link would die the moment the
   * feature was piloted. Only CREATING and managing is restricted.
   */
  isAdmin: boolean,
): Promise<ShareResult | null> {
  const list0 = /^\/api\/demos\/([^/]+)\/shares$/.test(urlPath);
  const one0 = /^\/api\/shares\/([A-Za-z0-9_-]{20,64})$/.test(urlPath);
  if ((list0 || one0) && !isAdmin) {
    return { status: 403, body: { error: "Sharing a demo is limited to project admins." } };
  }
  const list = /^\/api\/demos\/([^/]+)\/shares$/.exec(urlPath);
  const one = /^\/api\/shares\/([A-Za-z0-9_-]{20,64})$/.exec(urlPath);
  const { createShare, listShares, revokeShare, extendShare, summarize, getShare } = await import("./shareStore.ts");

  if (list) {
    const demoId = decodeURIComponent(list[1]);
    /* ⚠️ The same ownership test the demo library already enforces — a share is a
       door into that demo, so whoever may not edit it may not open one either. */
    if (!canManage(demoId)) return { status: 403, body: { error: "This demo belongs to someone else." } };
    if (method === "GET") return { status: 200, body: { shares: listShares(demoId).map(summarize) } };
    if (method === "POST") {
      const days = Number(body?.days ?? DEFAULT_SHARE_DAYS);
      const password = typeof body?.password === "string" && body.password.trim() ? body.password : String(body?.prospect ?? "");
      if (!password.trim()) return { status: 400, body: { error: "A password is required." } };
      const rec = createShare({
        demoId,
        prospect: String(body?.prospect ?? demoId),
        createdBy: user.email,
        days,
        password,
      });
      return { status: 201, body: { share: summarize(rec) } };
    }
  }

  if (one) {
    const token = one[1];
    const rec = getShare(token);
    if (!rec) return { status: 404, body: { error: "No such link." } };
    if (!canManage(rec.demoId)) return { status: 403, body: { error: "This demo belongs to someone else." } };
    if (method === "DELETE") return { status: 200, body: { share: summarize(revokeShare(token)!) } };
    if (method === "PATCH") return { status: 200, body: { share: summarize(extendShare(token, Number(body?.addDays ?? DEFAULT_SHARE_DAYS))!) } };
  }
  return null;
}
