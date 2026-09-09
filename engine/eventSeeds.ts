/* =============================================================================
   eventSeeds.ts — put an EVENT's prospect roster into the shared demo library
   -----------------------------------------------------------------------------
   A conference roster is dozens of generated prospects that have to reach the
   live site and be visible to the whole team. Neither existing store fits:

     • src/data/generated/*.json is loaded by an EAGER import.meta.glob, so every
       file lands in the single JS bundle and is Zod-parsed at boot. At ~155KB a
       profile, 59 of them would add ~9MB to a 1.85MB bundle and put all 59 in
       the customer switcher. Wrong store.
     • DATA_DIR/demos is the right store — fetched one at a time, shared by the
       team — but it is a git-ignored disk, so nothing generated locally ever
       reaches production.

   So the profiles are committed under engine/event-seeds/ (outside src/, so the
   glob cannot see them) and imported into the library HERE, at boot, the same
   way the dash sweep and the demo patches run server-side. They travel with a
   push and cost the browser nothing until somebody opens one.

   ⚠️ EXISTING RECORDS ARE NEVER OVERWRITTEN. "Already in the store" is the
   guard, not a marker file — so a redeploy cannot clobber an edit an SE made to
   a roster demo mid-conference, which is exactly when it would hurt most. To
   force a reimport, delete that demo first.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DALLAS_EVENT, dallasDemoId } from "../src/data/eventDemos.ts";
import { getDemo, isValidId, saveDemo, type DemoRecord } from "./demoStore.ts";

const SEEDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "event-seeds");

/* The source-list name per seed, when the displayed name was cleaned up (see
   `listedAs` on DemoRecord). Read from the roster the profiles were generated
   from, so the two cannot disagree about which row a demo came from. */
const ROSTER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "dallas-roster.json");

function listedAsById(): Record<string, string> {
  try {
    const { prospects } = JSON.parse(fs.readFileSync(ROSTER, "utf8")) as {
      prospects: { slug: string; name: string; listedAs?: string }[];
    };
    return Object.fromEntries(
      prospects
        .filter((p) => p.listedAs && p.listedAs !== p.name)
        .map((p) => [dallasDemoId(p.slug), p.listedAs as string]),
    );
  } catch {
    return {};
  }
}

/* Who owns a seeded roster demo. The project admin, so the roster has a real
   owner who can edit it in place; everyone else views it (which is all a demo
   needs) or duplicates it into their own. */
const SEED_CREATOR = { email: "ddesai@invoca.com", name: "Dhruv Desai" };

/** Import every committed event seed that is not already in the library.
 *  Returns what it did, so the boot log can say so. */
export function importEventSeeds(): { added: string[]; skipped: number; failed: string[] } {
  const added: string[] = [];
  const failed: string[] = [];
  let skipped = 0;

  let files: string[];
  try {
    files = fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { added, skipped, failed }; // no seeds committed — nothing to do
  }
  const listedAs = listedAsById();

  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    if (!isValidId(id)) { failed.push(`${file} (not a valid demo id)`); continue; }
    if (getDemo(id)) { skipped++; continue; }
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, file), "utf8"));
      if (!profile?.customerName) { failed.push(`${file} (no customerName)`); continue; }
      const now = new Date().toISOString();
      const rec: DemoRecord = {
        id,
        prospect: String(profile.customerName),
        websiteUrl: String(profile.websiteUrl ?? ""),
        industry: String(profile.industry ?? ""),
        creator: SEED_CREATOR,
        createdAt: now,
        updatedAt: now,
        event: DALLAS_EVENT,
        ...(listedAs[id] ? { listedAs: listedAs[id] } : {}),
        /* The frontend keys everything off profile.id, and openDemo registers
           this profile under it — so it MUST equal the demo id or the customer
           switcher and the library disagree about which prospect is open. */
        profile: { ...profile, id },
        customizations: { overrides: {}, tiles: {} },
      };
      saveDemo(rec);
      added.push(id);
    } catch (e) {
      // One bad seed must never stop the server booting, exactly as one corrupt
      // demo must never take down listDemos().
      failed.push(`${file} (${(e as Error).message})`);
    }
  }
  return { added, skipped, failed };
}
