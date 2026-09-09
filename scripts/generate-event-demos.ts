/* =============================================================================
   generate-event-demos.ts — generate an event roster into engine/event-seeds/
   -----------------------------------------------------------------------------
   Run (needs ANTHROPIC_API_KEY, which --env-file supplies from .env):

     npm run gen:events -- --limit 3          # pilot the first three
     npm run gen:events -- --parallel 3       # the rest, three at a time
     npm run gen:events -- --only truist,humana
     npm run gen:events -- --list             # what's done, what's left

   ⚠️ RESUMABLE BY CONSTRUCTION. A prospect whose seed file already exists is
   skipped, so a run that dies at prospect 40 is restarted by re-running the same
   command — which matters when the whole roster is a couple of hours of Opus and
   a rate limit or a dropped connection is a normal event, not an exceptional one.
   Delete a seed file to regenerate that one.

   ⚠️ THE OUTPUT IS NOT src/data/generated/. That directory is loaded by an eager
   import.meta.glob straight into the browser bundle; see engine/eventSeeds.ts for
   why a 59-prospect roster cannot live there.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateProfile } from "../engine/core.ts";
import { dallasDemoId } from "../src/data/eventDemos.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "engine", "event-seeds");
const ROSTER = path.join(ROOT, "scripts", "dallas-roster.json");

interface Prospect { slug: string; name: string; listedAs?: string; url: string }

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const num = (name: string, fallback: number) => {
  const v = flag(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const seedFile = (p: Prospect) => path.join(OUT_DIR, `${dallasDemoId(p.slug)}.json`);
const done = (p: Prospect) => fs.existsSync(seedFile(p));

async function main() {
  const { prospects } = JSON.parse(fs.readFileSync(ROSTER, "utf8")) as { prospects: Prospect[] };

  const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  let queue = only ? prospects.filter((p) => only.includes(p.slug)) : prospects.filter((p) => !done(p));
  if (only) {
    const missing = only.filter((s) => !prospects.some((p) => p.slug === s));
    if (missing.length) { console.error(`Unknown slug(s): ${missing.join(", ")}`); process.exit(1); }
  }

  if (has("list")) {
    for (const p of prospects) console.log(`${done(p) ? "✓" : " "} ${p.slug.padEnd(32)} ${p.name}`);
    console.log(`\n${prospects.filter(done).length} of ${prospects.length} generated.`);
    return;
  }

  const limit = num("limit", 0);
  if (limit) queue = queue.slice(0, limit);
  const parallel = num("parallel", 2);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (put it in .env).");
    process.exit(1);
  }
  if (!queue.length) { console.log("Nothing to generate — every prospect already has a seed file."); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Generating ${queue.length} prospect(s), ${parallel} at a time.\n`);

  const failed: { slug: string; error: string }[] = [];
  let completed = 0;
  const startedAll = Date.now();

  /* A shared cursor rather than fixed-size batches: a batch only finishes when
     its SLOWEST member does, so with 59 prospects of uneven site size a batched
     run spends a large fraction of its wall clock with idle slots. */
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const p = queue[i];
      const t0 = Date.now();
      try {
        const profile = await generateProfile(p.name, p.url);
        /* The demo id is stamped by the seeder, not here — one definition of the
           id-to-record mapping. What matters in the file is the profile itself. */
        fs.writeFileSync(seedFile(p), JSON.stringify(profile, null, 2));
        completed++;
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`✓ ${p.name} — ${profile.industry} (${secs}s)  [${completed + failed.length}/${queue.length}]`);
      } catch (e) {
        failed.push({ slug: p.slug, error: (e as Error).message });
        console.error(`✗ ${p.name}: ${(e as Error).message}  [${completed + failed.length}/${queue.length}]`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));

  const mins = ((Date.now() - startedAll) / 60000).toFixed(1);
  console.log(`\n${completed} generated, ${failed.length} failed, ${mins} min.`);
  if (failed.length) {
    console.log("\nFailed (re-run the same command to retry — finished ones are skipped):");
    for (const f of failed) console.log(`  ${f.slug}: ${f.error}`);
  }
  const remaining = JSON.parse(fs.readFileSync(ROSTER, "utf8")).prospects.filter((p: Prospect) => !done(p)).length;
  console.log(`${remaining} of ${prospects.length} still to generate.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
