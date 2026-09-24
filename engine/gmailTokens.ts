import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";

/* =============================================================================
   gmailTokens.ts — one Gmail send-token PER SE, on disk
   -----------------------------------------------------------------------------
   Asked for directly, about the "tell the account exec" notification: *"can you
   use the person that signed in using the Gmail OAuth as the email that's
   actually sending, because that is the actual person sending the email"*. Yes
   — and it is the honest answer rather than a cosmetic one: the SE really is
   the sender, so the message should leave from their mailbox and land in their
   Sent folder.

   ⚠️⚠️ **THIS IS `/auth/gmail` AND `/auth/drive` COMBINED, AND NEITHER ALONE
   WOULD DO.** `/auth/gmail` already proves the `gmail.send` scope works on this
   OAuth client — but it is admin-only and mints ONE token for ONE sending
   account, displayed once to be pasted into Render. `/auth/drive` already proves
   the per-user store — but it is a read scope. What this needs is gmail.send,
   per user, STORED. So the shape below is `driveTokens.ts` verbatim in structure,
   holding a different scope's token.

   ⚠️ **A SEPARATE, DIFFERENT DIRECTORY FROM `drive-tokens/`, ON PURPOSE.** The two
   tokens carry different scopes and are revoked independently — disconnecting
   Drive must not silently stop an SE's notifications, and vice versa. Sharing a
   file to save a few lines is how one consent ends up governing two capabilities.

   ⚠️ A CREDENTIAL, TREATED LIKE ONE — and this one can SEND, which is strictly
   more than Drive's read. Same `DATA_DIR` as the demo library (the Render
   persistent disk in production, git-ignored `.data/` locally), never written to
   git, never logged. One file per SE keyed by a slugified email, with the same
   resolve-then-prefix-check guard `feedbackStore.ts` and `driveTokens.ts` apply.
   ============================================================================= */

const TOKENS_DIR = path.join(DATA_DIR, "gmail-tokens");

interface GmailTokenRecord {
  email: string;
  refreshToken: string;
  connectedAt: string;
}

function ensureDir() {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
}

function keyFor(email: string): string {
  const stem = String(email).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!stem) throw new Error("Invalid account.");
  return stem;
}

function fileFor(email: string): string {
  const file = path.join(TOKENS_DIR, `${keyFor(email)}.json`);
  if (!file.startsWith(TOKENS_DIR + path.sep)) throw new Error("Invalid account.");
  return file;
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Stores (or replaces) this SE's Gmail send token. */
export function saveGmailToken(email: string, refreshToken: string): void {
  ensureDir();
  const rec: GmailTokenRecord = { email, refreshToken, connectedAt: new Date().toISOString() };
  writeAtomic(fileFor(email), JSON.stringify(rec, null, 2));
}

/** This SE's token, or null if they never connected (or disconnected). Never
 *  throws on a missing file — "not connected" is the common case, not an error. */
export function getGmailToken(email: string): string | null {
  try {
    const rec = JSON.parse(fs.readFileSync(fileFor(email), "utf8")) as GmailTokenRecord;
    return rec.refreshToken || null;
  } catch {
    return null;
  }
}

export function hasGmailToken(email: string): boolean {
  return !!getGmailToken(email);
}

/** Disconnect. Does not revoke with Google — the route best-effort-revokes and
 *  then calls this regardless, so a failed revoke never strands a dead token. */
export function removeGmailToken(email: string): void {
  try { fs.unlinkSync(fileFor(email)); } catch { /* already gone */ }
}
