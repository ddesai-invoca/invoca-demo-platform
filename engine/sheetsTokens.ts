import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";

/* =============================================================================
   sheetsTokens.ts — the Google grant that writes an event's follow-up sheet
   -----------------------------------------------------------------------------
   Asked for 10/8/2026, after the Apps Script flow was reported as too much:
   *"connecting a sheet is too complicated for not technical people… ideally all i
   want users to do is paste the google sheet URL."* Pasting a bare sheet URL only
   works if the SERVER can reach that sheet, so somebody has to grant it once.

   ⚠️⚠️ **ONE GRANT WRITES EVERY SE'S ROWS, AND THAT IS THE WHOLE POINT.** This is
   NOT the per-SE model `driveTokens.ts` uses, even though the file is its twin.
   Drive reads a document belonging to the person generating, so it must read AS
   them. A conference sheet is the opposite: twenty-five SEs mark demos and every
   row goes to ONE sheet, so requiring each of them to grant a scope and hold edit
   access would mean rows silently missing for whoever had not. The admin who
   connects the event grants once; `eventSettings` records WHOSE grant it is and
   every later mark is written with it.

   ⚠️ **CONSEQUENCE, STATED: THE GRANT BELONGS TO A PERSON.** If they revoke it or
   leave, rows stop — reported as "reconnect", never silently. A service account
   would not have that property and would cost a key in Render's env plus a
   share step on every sheet; that trade was put to the user and this is the side
   they chose.

   ⚠️ A CREDENTIAL, TREATED LIKE ONE. Same DATA_DIR as the demo library and the
   feedback board, which is the Render persistent disk in production and a
   git-ignored `.data/` locally — never in git, never logged. One file per
   account, keyed by a slugified email so the filename itself carries no
   path-traversal risk.
   ============================================================================= */

const TOKENS_DIR = path.join(DATA_DIR, "sheets-tokens");

interface SheetsTokenRecord {
  email: string;
  refreshToken: string;
  connectedAt: string;
}

function ensureDir() {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
}

/** Slugify an email into a safe filename stem — lowercased, non [a-z0-9] runs
 *  collapsed to "-", same shape as `demoStore.ts`'s `slugify`, plus the
 *  resolve()-then-prefix-check guard `feedbackStore.ts` applies on top of its
 *  own sanitizer before ever touching the filesystem. */
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

/** Stores (or replaces) the refresh token for one SE's Google account. */
export function saveSheetsToken(email: string, refreshToken: string): void {
  ensureDir();
  const rec: SheetsTokenRecord = { email, refreshToken, connectedAt: new Date().toISOString() };
  writeAtomic(fileFor(email), JSON.stringify(rec, null, 2));
}

/** The stored refresh token for this SE, or null if they have never connected
 *  (or have since disconnected). Never throws on a missing file. */
export function getSheetsToken(email: string): string | null {
  try {
    const rec = JSON.parse(fs.readFileSync(fileFor(email), "utf8")) as SheetsTokenRecord;
    return rec.refreshToken || null;
  } catch {
    return null;
  }
}

/** Cheap presence check for the panel — same read, discards the value. */
export function hasSheetsToken(email: string): boolean {
  return !!getSheetsToken(email);
}

/** Disconnect: removes the stored token. Does not revoke it with Google — see
 *  the disconnect route, which best-effort-revokes THEN calls this regardless,
 *  so a revoke failure never leaves a dead token stranded on disk. */
export function removeSheetsToken(email: string): void {
  try { fs.unlinkSync(fileFor(email)); } catch { /* already gone */ }
}
