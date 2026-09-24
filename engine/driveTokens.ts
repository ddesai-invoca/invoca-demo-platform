import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";

/* =============================================================================
   driveTokens.ts — one Google refresh token PER SE, on disk
   -----------------------------------------------------------------------------
   Google Drive is PER-USER OAuth (docs/INTEGRATIONS.md): strategy docs live in
   individual Drives, so the app has to read as the SE who is generating the
   demo, not as one shared service account the way Gong is. That means there is
   no single credential to paste into Render's environment the way
   GMAIL_REFRESH_TOKEN is — each SE's consent has to be stored, and read back by
   THAT SE's email on their next generation.

   ⚠️ A CREDENTIAL, TREATED LIKE ONE. Same DATA_DIR as the demo library and the
   feedback board (`engine/demoStore.ts`), which is the Render persistent disk in
   production and a git-ignored `.data/` locally — never written to git, never
   logged. One file per SE, keyed by a slugified email so the filename itself
   carries no path-traversal risk (mirrors `feedbackStore.ts`'s `safeName` +
   resolve-then-prefix-check belt-and-braces, applied to an email instead of an
   uploaded filename).
   ============================================================================= */

const TOKENS_DIR = path.join(DATA_DIR, "drive-tokens");

interface DriveTokenRecord {
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
export function saveDriveToken(email: string, refreshToken: string): void {
  ensureDir();
  const rec: DriveTokenRecord = { email, refreshToken, connectedAt: new Date().toISOString() };
  writeAtomic(fileFor(email), JSON.stringify(rec, null, 2));
}

/** The stored refresh token for this SE, or null if they have never connected
 *  (or have since disconnected). Never throws on a missing file. */
export function getDriveToken(email: string): string | null {
  try {
    const rec = JSON.parse(fs.readFileSync(fileFor(email), "utf8")) as DriveTokenRecord;
    return rec.refreshToken || null;
  } catch {
    return null;
  }
}

/** Cheap presence check for the panel — same read, discards the value. */
export function hasDriveToken(email: string): boolean {
  return !!getDriveToken(email);
}

/** Disconnect: removes the stored token. Does not revoke it with Google — see
 *  the disconnect route, which best-effort-revokes THEN calls this regardless,
 *  so a revoke failure never leaves a dead token stranded on disk. */
export function removeDriveToken(email: string): void {
  try { fs.unlinkSync(fileFor(email)); } catch { /* already gone */ }
}
