/* =============================================================================
   replicaStore — captures made by the Replicate button, on the SAME persistent
   disk as the demo library, so a restart or a redeploy does not lose them.
   -----------------------------------------------------------------------------
   Before this, a capture only existed as a `public/replicas/*.html` file with a
   hand-pasted entry in `src/data/replicaPages.ts` — something a person ran from
   a terminal, never something the button itself could create. Asked for
   directly: the button downloads a standalone HTML file, keeps it, and re-opens
   it next time — "yes it needs to survive a restart too."

   Reuses `DATA_DIR` from `demoStore.ts` rather than re-deriving it, so replicas
   land on the exact same disk as the demo JSON (Render disk in production,
   `.data/` locally) — one persistence story, not two.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";
import type { ReplicaFieldMap } from "../src/data/leadFields.ts";

export const REPLICAS_DIR = path.join(DATA_DIR, "replicas");
const INDEX_FILE = path.join(REPLICAS_DIR, "index.json");

export interface StoredReplica {
  slug: string;
  file: string;              // filename under REPLICAS_DIR
  domain: string;
  sourceUrl: string;
  capturedAt: string;        // YYYY-MM-DD
  label: string;
  fields: ReplicaFieldMap;
  bytes: number;
}

function ensureDir() {
  fs.mkdirSync(REPLICAS_DIR, { recursive: true });
}

function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readIndex(): Record<string, StoredReplica> {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return {};
  }
}

function hostOf(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

/** Every captured replica, most recent first. */
export function listReplicas(): StoredReplica[] {
  return Object.values(readIndex()).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function getReplicaBySlug(slug: string): StoredReplica | null {
  return readIndex()[slug] ?? null;
}

/** The capture for this prospect's domain, or null if nobody has captured one. */
export function getReplicaForDomain(domain: string): StoredReplica | null {
  const host = hostOf(domain);
  return Object.values(readIndex()).find((r) => hostOf(r.domain) === host) ?? null;
}

/** Save (or overwrite, on a re-capture) one replica: the HTML file and its index entry. */
export function saveReplica(entry: Omit<StoredReplica, "bytes">, html: string): StoredReplica {
  ensureDir();
  writeAtomic(path.join(REPLICAS_DIR, entry.file), html);
  const idx = readIndex();
  const rec: StoredReplica = { ...entry, bytes: Buffer.byteLength(html) };
  idx[entry.slug] = rec;
  writeAtomic(INDEX_FILE, JSON.stringify(idx, null, 2));
  return rec;
}

export function deleteReplica(slug: string): boolean {
  ensureDir();
  const idx = readIndex();
  const rec = idx[slug];
  if (!rec) return false;
  try { fs.unlinkSync(path.join(REPLICAS_DIR, rec.file)); } catch { /* already gone */ }
  delete idx[slug];
  writeAtomic(INDEX_FILE, JSON.stringify(idx, null, 2));
  return true;
}

/** Read one replica's HTML off disk, or null if the file is missing (index says it exists but
 *  the file does not — a crash mid-write, or someone deleted it by hand). */
export function readReplicaHtml(rec: StoredReplica): string | null {
  try {
    return fs.readFileSync(path.join(REPLICAS_DIR, rec.file), "utf8");
  } catch {
    return null;
  }
}
