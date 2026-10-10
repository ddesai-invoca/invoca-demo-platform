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
import { getShare, passwordMatches, shareActive, noteOpen, noteRequest, expiresAt, type ShareRecord } from "./shareStore.ts";
import { sendMail, sharePasswordEmail } from "./mailer.ts";
import { recordActivity } from "./activityStore.ts";
import { queueActivitySync } from "./sheetActivity.ts";
import { codeForEmail, emailForCode, isMasterPassword, MASTER_WHO } from "./shareCodes.ts";
import { sharePassword } from "../src/data/sharePassword.ts";
import { workEmailVerdict, workEmailMessage } from "../src/data/workEmail.ts";
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

/* ⚠️⚠️ **THE COOKIE CARRIES THE PROOF *AND* WHO TYPED IT: `<hmac>.<base64url email>`.**
   Activity has to be attributable after a reload, and the alternative — a second cookie —
   meant widening `ShareResult.setCookie` to a list and touching both twins for a value
   that belongs to the same session as the proof. The email half is NOT signed and does not
   need to be: it is self-declared at the gate anyway (somebody can type any address), so
   forging the cookie grants nothing typing a different address would not. The PROOF half is
   compared on its own, so appending to the value can never loosen the unlock. */
const splitCookie = (raw: string) => {
  const dot = raw.indexOf(".");
  return dot < 0 ? { proof: raw, who: "" } : { proof: raw.slice(0, dot), who: raw.slice(dot + 1) };
};

export function unlocked(cookies: Record<string, string>, token: string): boolean {
  const { proof } = splitCookie(cookies[cookieNameFor(token)] ?? "");
  const want = stamp(token);
  /* ⚠️ Length-guarded for the same reason the password compare is — timingSafeEqual
     throws on a mismatch rather than returning false. */
  const a = Buffer.from(proof), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Who said they were opening this link, or "" when they never gave an address. */
export function unlockedAs(cookies: Record<string, string>, token: string): string {
  if (!unlocked(cookies, token)) return "";
  const { who } = splitCookie(cookies[cookieNameFor(token)] ?? "");
  try {
    const email = Buffer.from(who, "base64url").toString("utf8");
    /* Shape-checked on the way out as well as in — the cookie is user-editable. The one
       non-address allowed is the master-password label, so that session's activity is
       attributed to "Invoca employee" rather than to nobody. */
    if (email === MASTER_WHO) return email;
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : "";
  } catch { return ""; }
}

/* ── per-link spend caps ──────────────────────────────────────────────────── */
/**
 * ⚠️⚠️ **IN MEMORY ON PURPOSE, AND THE CONSEQUENCE IS STATED.** A counter on disk
 * would be one write per prospect message on the request path; this resets when the
 * service restarts, so a determined abuser could reset their budget by waiting for a
 * deploy. That is an acceptable trade for a link an SE can revoke instantly, and the
 * cap's real job is stopping a runaway script, not a patient adversary.
 */
const spend = new Map<string, { day: string; chat: number; voice: number; email: number; unlockFail: number }>();

/* ⚠️⚠️ **`SHARE_FROM` IS A REQUEST, NOT A GUARANTEE.** Gmail only honours a From the
   sending account may send as — itself, or an address verified under "Send mail as".
   Anything else is silently REWRITTEN to the real account, so the mail arrives from the
   wrong address and nothing errors. Unset, it falls through to the sending account, which
   is the honest default. See `docs/SHARE-EMAIL.md`. */
const shareFrom = (): string | undefined => process.env.SHARE_FROM?.trim() || undefined;
/* ⚠️⚠️ `email` IS AN ABUSE BOUND, NOT A FAIRNESS ONE. The request route sends mail to an
   address the CALLER chooses, so anybody holding a share link could otherwise use it to
   push unsolicited mail from an invoca.com address. The body is fixed — a password and the
   demo's own link, nothing the caller can influence — so the worst case is a handful of
   confusing emails rather than a spam relay, and 12 a day per link bounds even that. Every
   request is also recorded on the share, so a burst is visible rather than merely blocked. */
/* ⚠️ `unlockFail` (10/9/2026): passwords are now 6-digit codes, so wrong guesses are
   capped per link per day. Only FAILED attempts count, so somebody who types the right
   code is never locked out by the people who did not. */
export const CAPS = { chat: 120, voice: 10, email: 12, unlockFail: 40 };

function budget(token: string) {
  const day = new Date().toISOString().slice(0, 10);
  const cur = spend.get(token);
  if (!cur || cur.day !== day) { const fresh = { day, chat: 0, voice: 0, email: 0, unlockFail: 0 }; spend.set(token, fresh); return fresh; }
  return cur;
}

/** Returns false when this link has spent its allowance for the day. */
export function takeBudget(token: string, kind: keyof typeof CAPS): boolean {
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
  /* ⚠️ PASSED IN BY EACH TWIN, never read from process.env here — the same rule
     `status.ts` states at the top of its own file, and what lets the emailed link be
     correct on staging and on a laptop as well as in production. */
  baseUrl = "",
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

  /* ⚠️⚠️ **PUBLIC, AND IT SENDS MAIL TO AN ADDRESS THE CALLER CHOOSES** — so every guard
     here is load-bearing. The body is fixed (the password and this demo's own link), the
     recipient is validated, the link must be live, and the per-link daily cap bounds the
     worst case. Each request is recorded on the share so a burst is visible afterwards
     rather than only blocked at the time. */
  if (method === "POST" && leaf === "/request-password") {
    /* ⚠️ A dead link mints and mails nothing. Missing before 10/9/2026; it matters more now
       that asking creates a code that lives on past the link. */
    if (!shareActive(rec)) return gone(rec);
    const email = String(body?.email ?? "").trim();
    /* ⚠️ A SHAPE CHECK, NOT A DELIVERABILITY ONE. Rejecting anything that is not plausibly
       an address keeps obvious junk out of the record and out of the mailer; whether it
       EXISTS is not knowable here, and the reply must not reveal it either way. */
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return { status: 400, body: { error: "That does not look like an email address." } };
    }
    /* ⚠⚠ **A COMPANY ADDRESS, NOT A PERSONAL ONE — asked for 10/9/2026, and enforced HERE
       because this route is PUBLIC and sends mail.** The gate runs the same test so the
       message arrives without a round trip, but a browser check on a route anyone can POST to
       is a suggestion. One definition, two readers; see `workEmail.ts` for why it is a
       blocklist and which two entries are deliberately narrow.
       ⚠️ **REFUSED BEFORE `takeBudget`**, so a prospect who types a Gmail address by habit and
       then corrects it has not silently spent one of the twelve sends this link gets in a day.
       ⚠️ **AND BEFORE `noteRequest`**, which is the one judgement call here: nothing was sent
       and nobody was told anything, so there is no event to record — and writing one would put
       addresses on the share record that never received a password. */
    const verdict = workEmailVerdict(email);
    if (verdict !== "ok") {
      return { status: 400, body: { error: workEmailMessage(verdict) } };
    }
    if (!takeBudget(token, "email")) {
      return { status: 429, body: { error: "Too many requests for this link today. Please contact your Invoca contact." } };
    }
    /* ⚠️⚠️ **EACH ADDRESS HAS ITS OWN 6-DIGIT CODE, AND ASKING AGAIN SENDS THE SAME ONE**
       (10/9/2026). Asked for directly: a random number tied to the email, the same number
       every time that email asks. It works on any link a person is sent, whatever password
       the SE set on the link itself — see `shareCodes.ts`. Recorded first, because who
       asked is the point even if the send fails. */
    noteRequest(token, email);
    const password = codeForEmail(email);
    const url = `${baseUrl}/share/${token}`;
    const sent = await sendMail(sharePasswordEmail(email, rec.prospect, password, url, shareFrom()));
    /* ⚠️ **THE OUTCOME IS REPORTED HONESTLY.** `sendMail` legitimately declines off
       production and with no mailer configured, and telling somebody to check an inbox
       nothing was sent to is the silent no-op this repo keeps paying for. */
    return sent.sent
      ? { status: 200, body: { sent: true } }
      : { status: 200, body: { sent: false, reason: sent.reason || "The email could not be sent." } };
  }

  if (method === "POST" && leaf === "/unlock") {
    if (!shareActive(rec)) return gone(rec);
    const password = typeof body?.password === "string" ? body.password : "";
    const typedEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (budget(token).unlockFail >= CAPS.unlockFail) {
      return { status: 429, body: { error: "Too many wrong passwords on this link today. Please contact your Invoca contact." } };
    }
    /* ⚠️⚠️ THREE WAYS IN, AND EACH ONE DECIDES WHO OPENED IT (10/9/2026):
       1. the master password, for Invoca employees, recorded as "Invoca employee";
       2. a person's own 6-digit code, recorded as THE ADDRESS THAT CODE BELONGS TO, so a
          later visit through "I already have the password" is still attributed correctly;
       3. the link's own stored password, kept so links already sent with the old
          name-based password keep working. */
    const codeOwner = emailForCode(password);
    const who = isMasterPassword(password) ? MASTER_WHO
      : codeOwner ? codeOwner
      : passwordMatches(rec, password) ? typedEmail
      : null;
    if (who === null) {
      budget(token).unlockFail += 1;
      /* ⚠️ No hint about length or near-misses, and the password is never echoed. */
      return { status: 401, body: { error: "That password is not right." } };
    }
    noteOpen(token);
    recordActivity(rec.demoId, rec.prospect, who, "opened");
    queueActivitySync(rec.demoId);
    return {
      status: 200,
      body: { ok: true, prospect: rec.prospect },
      setCookie: {
        name: cookieNameFor(token),
        value: who ? `${stamp(token)}.${Buffer.from(who, "utf8").toString("base64url")}` : stamp(token),
        /* ⚠️ The cookie never outlives the link itself. */
        maxAgeSeconds: Math.max(60, Math.floor((expiresAt(rec).getTime() - Date.now()) / 1000)),
      },
    };
  }

  /* ⚠️⚠️ **AN EXPLICIT EVENT, BECAUSE `/analyze` IS NOT ONE.** The obvious hook looked
     like the analyze call that already happens when a conversation is captured — but the
     SMS capture fires it after EVERY turn (it is progressive by design, so nothing is lost
     when the tab closes), so it says "a message happened", not "a demo finished". This
     takes the conversation's own id instead and the store counts it once. */
  if (method === "POST" && leaf === "/activity") {
    if (!unlocked(cookies, token)) return { status: 401, body: { error: "This demo is locked." } };
    if (!shareActive(rec)) return gone(rec);
    const kind = String(body?.kind ?? "") === "voice" ? "voice" : String(body?.kind ?? "") === "sms" ? "sms" : null;
    if (!kind) return { status: 400, body: { error: "kind must be sms or voice." } };
    const id = typeof body?.id === "string" ? body.id.slice(0, 120) : undefined;
    recordActivity(rec.demoId, rec.prospect, unlockedAs(cookies, token), kind, id);
    queueActivitySync(rec.demoId);
    /* ⚠️ 204-shaped: the page is mid-demo and has nothing to do with the answer. */
    return { status: 200, body: { ok: true } };
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
      /* ⚠️ The default is the prospect's name with the spaces taken out (10/8/2026),
         where it used to be the name verbatim. ONE definition, in `sharePassword` —
         the email reads the same function, so the stored hash and the sent string
         cannot disagree. An explicit password still wins for anyone who wants one. */
      const custom = typeof body?.password === "string" && body.password.trim();
      const password = custom ? String(body.password) : sharePassword(String(body?.prospect ?? ""));
      if (!password.trim()) return { status: 400, body: { error: "A password is required." } };
      const rec = createShare({
        demoId,
        prospect: String(body?.prospect ?? demoId),
        createdBy: user.email,
        days,
        password,
        /* ⚠️ Only a DERIVED password can be emailed — the store keeps a hash, so a typed
           one cannot be recovered to send. See `ShareRecord.derivedPassword`. */
        derivedPassword: !custom,
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


