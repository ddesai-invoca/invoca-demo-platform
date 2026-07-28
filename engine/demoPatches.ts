/* One-off content patches applied to demos on the server at boot.

   Why this exists: `PATCH /api/demos/:id` is creator-only, so a user cannot fix
   or update a demo belonging to a colleague from the browser. Code running on
   the server is not acting as any user, so it can apply an agreed change without
   weakening that rule for the API. Same mechanism as the dash sweep in
   engine/dashSweep.ts.

   Each patch is a JSON file in engine/migrations/ so the CONTENT is reviewable in
   a diff rather than buried in TypeScript, and so adding another is a file rather
   than a code change. Shape:

     { demoId, marker, reports: { <slice>: { <field>: <value>, … } } }

   Only the named fields are replaced. Everything else in the demo, including
   `creator`, is left exactly as it was — a patch changes content, never who owns
   a demo. Each patch carries its own marker file so it applies once and is a
   no-op on every boot after that, and the marker is versioned so a corrected
   patch can ship as v2. */
import fs from "node:fs";
import path from "node:path";

interface Patch {
  demoId: string;
  marker: string;
  reports: Record<string, Record<string, unknown>>;
  _note?: string;
}

const DIR = path.join(import.meta.dirname, "migrations");

export function applyDemoPatches(dataDir: string): void {
  if (!fs.existsSync(DIR)) return;

  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith(".json")) continue;
    let patch: Patch;
    try {
      patch = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    } catch (e) {
      console.warn(`   ! ${file}: unreadable (${(e as Error).message})`);
      continue;
    }
    if (!patch.demoId || !patch.marker) {
      console.warn(`   ! ${file}: missing demoId or marker, skipped`);
      continue;
    }

    const marker = path.join(dataDir, patch.marker);
    if (fs.existsSync(marker)) continue;                 // already applied

    const target = path.join(dataDir, "demos", `${patch.demoId}.json`);
    if (!fs.existsSync(target)) {
      // The demo may not exist in this environment (e.g. local dev). Do NOT
      // write the marker, so the patch still applies wherever it does exist.
      console.log(`   · ${file}: ${patch.demoId} not present, skipped`);
      continue;
    }

    try {
      const rec = JSON.parse(fs.readFileSync(target, "utf8"));
      let fields = 0;
      for (const [slice, values] of Object.entries(patch.reports)) {
        if (!rec.profile?.reports?.[slice]) {
          console.warn(`   ! ${file}: ${patch.demoId} has no reports.${slice}, skipped`);
          continue;
        }
        for (const [k, v] of Object.entries(values)) {
          rec.profile.reports[slice][k] = v;
          fields++;
        }
      }
      if (!fields) continue;
      fs.writeFileSync(target, JSON.stringify(rec, null, 2) + "\n");
      fs.writeFileSync(marker, new Date().toISOString());
      console.log(`   ✎ ${file}: ${patch.demoId}, ${fields} field(s) replaced`);
    } catch (e) {
      console.warn(`   ! ${file}: ${(e as Error).message}`);
    }
  }
}
