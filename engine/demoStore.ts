/* =============================================================================
   demoStore.ts — the shared demo library (JSON files on a persistent disk)
   -----------------------------------------------------------------------------
   Demos used to live only in each person's browser (localStorage), which made
   them private by construction. The team library needs one shared copy on the
   server, so each demo is a JSON file under DATA_DIR/demos/<id>.json.

   A demo = a generated prospect profile + the AI customizations layered on it
   (dashboard data edits + generated tiles) + who created it. Ownership is by
   creator email; the API layer (demoApi.ts) enforces who may edit what.

   Storage location, in order: $DATA_DIR → /data (the Render disk, when mounted)
   → <repo>/.data (local dev, git-ignored). Writes are atomic (temp file +
   rename) so a crash mid-write can't leave a half-written demo behind.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, "..");

/* Where the library lives: $DATA_DIR wins, else the first mounted disk we find
   (Render's convention is /var/data; /data is accepted too so either mount path
   works), else a git-ignored local folder for dev. */
const DISK_CANDIDATES = ["/var/data", "/data"];

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  for (const dir of DISK_CANDIDATES) {
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch { /* not mounted */ }
  }
  return path.join(REPO, ".data");
}

/** True when demos are on a persistent disk rather than ephemeral local space. */
export const isPersistent = (dir: string) => DISK_CANDIDATES.some((d) => dir.startsWith(d));

export const DATA_DIR = resolveDataDir();
const DEMOS_DIR = path.join(DATA_DIR, "demos");

export interface DemoCreator { email: string; name: string }

/** One saved demo. `profile` is a CustomerProfile; `customizations` holds the
 *  Ask AI layer, keyed by dashboard pathname (e.g. "/dashboards/marketing"). */
export interface DemoRecord {
  id: string;
  prospect: string;                 // customerName — what people search by
  websiteUrl: string;
  industry: string;
  creator: DemoCreator;
  createdAt: string;
  updatedAt: string;
  profile: unknown;
  customizations: {
    overrides: Record<string, unknown>;
    tiles: Record<string, unknown[]>;
  };
}

/** List view — everything the library needs except the heavy payload. */
export type DemoSummary = Omit<DemoRecord, "profile" | "customizations">;

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;

export function isValidId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 120 && VALID_ID.test(id);
}

function fileFor(id: string): string {
  const file = path.join(DEMOS_DIR, `${id}.json`);
  // Defense in depth: isValidId already excludes separators and dots.
  if (!file.startsWith(DEMOS_DIR + path.sep)) throw new Error("Invalid demo id.");
  return file;
}

function ensureDir() {
  fs.mkdirSync(DEMOS_DIR, { recursive: true });
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export const summarize = (d: DemoRecord): DemoSummary => {
  const { profile: _p, customizations: _c, ...rest } = d;
  return rest;
};

export function listDemos(): DemoSummary[] {
  ensureDir();
  const out: DemoSummary[] = [];
  for (const name of fs.readdirSync(DEMOS_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DEMOS_DIR, name), "utf8")) as DemoRecord;
      if (rec?.id) out.push(summarize(rec));
    } catch (e) {
      // One corrupt file must never take down the whole library.
      console.error(`[demoStore] skipping unreadable demo ${name}:`, (e as Error).message);
    }
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function getDemo(id: string): DemoRecord | null {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), "utf8")) as DemoRecord;
  } catch {
    return null;
  }
}

export function saveDemo(rec: DemoRecord): DemoRecord {
  ensureDir();
  writeAtomic(fileFor(rec.id), JSON.stringify(rec, null, 2));
  return rec;
}

export function deleteDemo(id: string): boolean {
  if (!isValidId(id)) return false;
  const file = fileFor(id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export function slugify(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "demo";
}

/** A slug that isn't taken yet — "acme", then "acme-2", "acme-3", … */
export function uniqueId(base: string): string {
  ensureDir();
  const slug = slugify(base);
  if (!fs.existsSync(fileFor(slug))) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!fs.existsSync(fileFor(candidate))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
