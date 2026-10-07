/* =============================================================================
   generatedProfiles — the on-disk generated profiles, served instead of bundled
   -----------------------------------------------------------------------------
   See the header of `src/data/profiles.ts` for WHY these stopped being bundled:
   15 real companies were shipping inside the public JS, which only the Google gate
   was hiding, and a prospect-facing share link removes that gate.

   ⚠️ They are committed files under `src/data/generated/`, so they deploy with the
   app and this reads them straight off disk — no database, no new storage, and the
   same files `npm run generate` already writes.

   ⚠️ **READ FRESH, NOT CACHED AT BOOT.** `/api/generate` writes a new file at
   runtime, and a module-level cache would hide it until the next restart — which is
   exactly how the dev server used to behave and is a trap this repo already records
   for Node-cached engine modules.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "generated");

export function readGeneratedProfiles(): unknown[] {
  if (!fs.existsSync(DIR)) return [];
  const out: unknown[] = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"))); }
    catch { /* one unreadable file must not empty the list — the client validates anyway */ }
  }
  return out;
}
