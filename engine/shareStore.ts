/* =============================================================================
   shareStore — a prospect-facing link to ONE demo, time-boxed and password-gated
   -----------------------------------------------------------------------------
   Asked for 10/6/2026: an SE shares an "agentic demo" with a prospect — Agent
   Studio plus the two AI Conversation Intelligence reports — as a link the
   prospect opens without an Invoca account, for a set number of days, behind a
   password that defaults to the prospect's name.

   ⚠️⚠️ **THE TOKEN IS THE REAL ACCESS CONTROL; THE PASSWORD IS A SPEED BUMP, AND
   SAYING SO SHAPES THE DESIGN.** The default password is the prospect's own name,
   which anyone holding the link can guess in a handful of tries, so it cannot be
   what keeps strangers out. 32 bytes of `randomBytes` can't be guessed, which is
   why the link is the secret and why REVOCATION matters more than password
   strength: if a link reaches somebody it should not have, the answer is to kill
   it, not to hope the password held.

   ⚠️ **THE PASSWORD IS STILL HASHED AT REST (scrypt, per-record salt) AND NEVER
   LOGGED.** It defaults to a name, so a plaintext column would be a file full of
   prospect names next to live links — and people reuse passwords even when told
   not to. Verified with `timingSafeEqual`.

   ⚠️ **ONE FILE PER SHARE under `DATA_DIR/shares/`**, the same disk and the same
   shape as the demo library and the feedback board, so it survives a redeploy on
   Render and needs no new infrastructure.
   ============================================================================= */
import fs from "node:fs";
import { DEFAULT_SHARE_DAYS } from "../src/data/shareDefaults.ts";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./demoStore.ts";

const DIR = path.join(DATA_DIR, "shares");

export interface ShareRecord {
  /** The URL secret. 43 url-safe chars of 32 random bytes. */
  token: string;
  demoId: string;
  /** Shown on the unlock screen so a prospect knows they are in the right place. */
  prospect: string;
  createdAt: string;
  createdBy: string;
  /** Whole days of access, counted from `createdAt` — see `expiresAt`. */
  days: number;
  passwordHash: string;
  passwordSalt: string;
  /* ⚠️⚠️ **CAN THE PASSWORD BE EMAILED?** Only a DERIVED one can: the store keeps a hash,
     so a password somebody typed cannot be recovered to send. Without this flag the
     request route would cheerfully email `sharePassword(prospect)` to a link protected by
     something else — a password that does not work, with nothing to explain why. Absent on
     every share created before 10/8/2026, which is why the route treats missing as FALSE
     rather than assuming. */
  derivedPassword?: boolean;
  revokedAt?: string;
  /** Bumped on every successful unlock, so the owner can see the link was opened. */
  opens?: number;
  /* ⚠️⚠️ **WHO ASKED FOR THE PASSWORD (10/8/2026), AND IT IS THE POINT OF THE CHANGE.**
     Asked for as *"instead of us giving them the password… they have to enter their email,
     and then a password is send to them"*. The password itself is the prospect's own name,
     so this list — not the password — is what the flow actually buys: a record of who
     opened the demo, and the only thing that makes an abusive request visible. */
  requests?: { email: string; at: string }[];
  lastOpenedAt?: string;
}

/** What the OWNER may see. Never the hash or the salt. */
export type ShareSummary = Omit<ShareRecord, "passwordHash" | "passwordSalt"> & {
  expiresAt: string;
  expired: boolean;
  active: boolean;
};

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }

/**
 * ⚠️ A TOKEN IS THE FILENAME, SO IT MUST NOT BE ABLE TO ESCAPE THE DIRECTORY.
 * Base64url is `[A-Za-z0-9_-]` only, which cannot contain a slash or a dot
 * segment — but the check is on the READ path rather than trusted from the write
 * path, because a token arrives from a URL. Same resolve-then-verify shape the
 * feedback attachments already use.
 */
function fileFor(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const file = path.join(DIR, `${token}.json`);
  if (path.dirname(path.resolve(file)) !== path.resolve(DIR)) return null;
  return file;
}

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password.normalize("NFKC"), salt, 32).toString("hex");
}

/**
 * ⚠️⚠️ **CONSTANT-TIME, AND THE LENGTH GUARD IS PART OF IT.** `timingSafeEqual`
 * THROWS on a length mismatch rather than returning false, so comparing a wrong-
 * length candidate would crash the unlock route instead of refusing the password.
 */
/** ⚠️ CAPPED IN THE RECORD AS WELL AS AT THE ROUTE. The route's daily budget stops a
 *  burst; this stops a slow drip growing a JSON file nobody reads until it fails to parse.
 *  Newest last, oldest dropped. */
const REQUESTS_MAX = 200;

/** Record that this address asked for the password. Returns false for an unknown token. */
export function noteRequest(token: string, email: string): boolean {
  const rec = getShare(token);
  if (!rec) return false;
  const kept = (rec.requests ?? []).filter((r) => r.email.toLowerCase() !== email.toLowerCase());
  rec.requests = [...kept, { email, at: new Date().toISOString() }].slice(-REQUESTS_MAX);
  write(rec);
  return true;
}

export function passwordMatches(rec: ShareRecord, candidate: string): boolean {
  const got = Buffer.from(hash(candidate ?? "", rec.passwordSalt), "hex");
  const want = Buffer.from(rec.passwordHash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function expiresAt(rec: ShareRecord): Date {
  return new Date(new Date(rec.createdAt).getTime() + rec.days * 86_400_000);
}

/**
 * Is this link usable right now?
 *
 * ⚠️ **REVOKED BEATS EVERYTHING, AND IT IS CHECKED FIRST.** An SE who kills a link
 * because it reached the wrong inbox must not find it still working because the
 * expiry maths said otherwise.
 */
export function shareActive(rec: ShareRecord, now = new Date()): boolean {
  if (rec.revokedAt) return false;
  return now < expiresAt(rec);
}

export function summarize(rec: ShareRecord): ShareSummary {
  const { passwordHash: _h, passwordSalt: _s, ...rest } = rec;
  return { ...rest, expiresAt: expiresAt(rec).toISOString(), expired: new Date() >= expiresAt(rec), active: shareActive(rec) };
}

/**
 * Remove every existing link for a demo.
 *
 * ⚠️⚠️ **DELETED, NOT REVOKED, AND THE DIFFERENCE IS VISIBLE.** A revoked record would
 * linger in the SE's list as a dead row beside the live one, which is the clutter that
 * prompted "why is there 2 shareable links". Deleting also makes the replacement
 * unambiguous: the old URL stops working the moment a new one is made.
 */
export function deleteSharesFor(demoId: string): number {
  let n = 0;
  for (const rec of listShares(demoId)) {
    const file = fileFor(rec.token);
    if (file && fs.existsSync(file)) { fs.rmSync(file); n++; }
  }
  return n;
}

export function createShare(opts: { demoId: string; prospect: string; createdBy: string; days: number; password: string; derivedPassword?: boolean }): ShareRecord {
  ensureDir();
  /* ⚠️⚠️ **ONE LIVE LINK PER DEMO: creating REPLACES.** Asked for directly — a second
     link is two secrets to track and two things to remember to turn off, and an SE
     reading the list cannot tell which one the prospect actually has. Done HERE rather
     than in the API handler so every caller inherits it, including the launch form's
     checkbox. **Consequence, stated: the previous URL stops working immediately.** */
  deleteSharesFor(opts.demoId);
  const salt = crypto.randomBytes(16).toString("hex");
  const rec: ShareRecord = {
    token: crypto.randomBytes(32).toString("base64url"),
    demoId: opts.demoId,
    prospect: opts.prospect,
    createdAt: new Date().toISOString(),
    createdBy: opts.createdBy,
    /* ⚠️ Clamped rather than trusted: the value arrives from a form, and a link
       that never expires is the one nobody remembers to revoke. */
    days: Math.min(365, Math.max(1, Math.round(opts.days || DEFAULT_SHARE_DAYS))),
    passwordHash: hash(opts.password, salt),
    ...(opts.derivedPassword ? { derivedPassword: true } : {}),
    passwordSalt: salt,
  };
  write(rec);
  return rec;
}

function write(rec: ShareRecord) {
  ensureDir();
  const file = fileFor(rec.token);
  if (!file) throw new Error("refusing to write a share with an unusable token");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);
}

export function getShare(token: string): ShareRecord | null {
  const file = fileFor(token);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as ShareRecord; } catch { return null; }
}

export function listShares(demoId?: string): ShareRecord[] {
  ensureDir();
  const out: ShareRecord[] = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as ShareRecord;
      if (!demoId || rec.demoId === demoId) out.push(rec);
    } catch { /* a half-written file is not worth taking the list down for */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revokeShare(token: string): ShareRecord | null {
  const rec = getShare(token);
  if (!rec) return null;
  rec.revokedAt = new Date().toISOString();
  write(rec);
  return rec;
}

/** Give a live link more days, or bring a lapsed one back. */
export function extendShare(token: string, days: number): ShareRecord | null {
  const rec = getShare(token);
  if (!rec) return null;
  rec.days = Math.min(365, Math.max(1, Math.round(rec.days + (days || 0))));
  /* ⚠️ Extending UN-REVOKES deliberately: an SE who revoked by mistake has no other
     way back, and the alternative is a dead record they cannot tell apart from a
     live one. Revoking again is one click. */
  delete rec.revokedAt;
  write(rec);
  return rec;
}

export function noteOpen(token: string) {
  const rec = getShare(token);
  if (!rec) return;
  rec.opens = (rec.opens ?? 0) + 1;
  rec.lastOpenedAt = new Date().toISOString();
  write(rec);
}
