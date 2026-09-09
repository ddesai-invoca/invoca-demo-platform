/* =============================================================================
   audit-events.ts — an event roster reaches its own dropdown and nowhere else
   -----------------------------------------------------------------------------
   The 2026 Dallas Invoca Summit roster is 59 generated prospects that have to
   (a) land in the shared library on the live site, (b) appear ONLY under their
   own Launch dropdown, and (c) not collide with anything already there. Every
   way that goes wrong is SILENT:

     • an id that collides with an existing demo is SKIPPED by the seeder, so
       that prospect is quietly missing from the roster;
     • a demo whose `event` key the Launch screen does not recognise is filed
       under no section at all and simply does not render;
     • a roster committed into src/data/generated would work perfectly and add
       ~9MB to the browser bundle.

   Most of this is checked FUNCTIONALLY — the seeder is run against a throwaway
   DATA_DIR and the records it writes are read back — because a grep passes
   against code that is never called, which this repo has paid for repeatedly.
   ============================================================================= */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");

/* Comments are stripped before any source match. An earlier audit in this repo
   fired on its own documentation, and a check that reddens on correct code gets
   deleted as a nuisance. */
const code = (p: string) =>
  read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/* ── the roster ──────────────────────────────────────────────────────────── */
console.log("\nEvent roster\n");

const { DALLAS_EVENT, DALLAS_ID_PREFIX, dallasDemoId } = await import("../src/data/eventDemos.ts");
const roster = JSON.parse(read("scripts/dallas-roster.json")) as {
  prospects: { slug: string; name: string; listedAs?: string; url: string }[];
};
const ps = roster.prospects;

ps.length >= 59 ? ok(`${ps.length} prospects in the roster`) : bad(`only ${ps.length} prospects in the roster`);

const slugs = ps.map((p) => p.slug);
new Set(slugs).size === slugs.length
  ? ok("every roster slug is unique")
  : bad("duplicate slug(s) in the roster — one prospect would overwrite another's seed file");

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
const badIds = ps.filter((p) => !VALID_ID.test(dallasDemoId(p.slug)) || dallasDemoId(p.slug).length > 120);
badIds.length === 0
  ? ok("every roster slug makes a valid demo id")
  : bad(`invalid demo id(s): ${badIds.map((p) => p.slug).join(", ")}`);

const unprefixed = ps.filter((p) => !dallasDemoId(p.slug).startsWith(DALLAS_ID_PREFIX));
unprefixed.length === 0
  ? ok(`every roster id carries the "${DALLAS_ID_PREFIX}" prefix`)
  : bad(`${unprefixed.length} roster id(s) unprefixed — a collision would silently skip them`);

const missing = ps.filter((p) => !p.name?.trim() || !/^https?:\/\//.test(p.url ?? ""));
missing.length === 0
  ? ok("every prospect has a display name and an http(s) URL")
  : bad(`incomplete row(s): ${missing.map((p) => p.slug).join(", ")}`);

/* ⚠️ THE COLLISION THIS PREFIX EXISTS FOR, ASSERTED RATHER THAN TRUSTED. Two of
   the Dallas prospects (AutoNation, Goosehead Insurance) share a slug with a
   BUNDLED profile, so the unprefixed form really would clash. If this ever stops
   finding an overlap the prefix looks like dead ceremony and someone drops it. */
const bundled = existsSync("src/data/generated")
  ? new Set(readdirSync("src/data/generated").filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")))
  : new Set<string>();
const wouldClash = slugs.filter((s) => bundled.has(s));
wouldClash.length > 0
  ? ok(`prefix is load-bearing: ${wouldClash.join(", ")} would clash with a bundled profile unprefixed`)
  : bad("no roster slug clashes with a bundled profile — re-check whether the prefix is still needed");
ps.every((p) => !bundled.has(dallasDemoId(p.slug)))
  ? ok("no PREFIXED roster id clashes with a bundled profile")
  : bad("a prefixed roster id collides with a bundled profile");

/* Displayed names must be demo-safe: they are spoken by the voice agent and
   printed as headings, which is why the roster cleans the source list. */
/* ⚠️ MULTI-WORD all-caps only. A SINGLE all-caps word is a brand stylisation the
   roster deliberately preserves — DIRECTV, TRG, HCL — and the first version of
   this check failed DIRECTV, i.e. reddened on correct data. What it is actually
   for is a row like "H. LEE MOFFITT CANCER CENTER AND RESEARCH INSTITUTE, INC.",
   which the voice agent would read out loud. */
const shouty = ps.filter((p) => /\s/.test(p.name.trim()) && p.name === p.name.toUpperCase() && /[A-Z]/.test(p.name));
shouty.length === 0
  ? ok("no display name is multi-word ALL-CAPS prose (single-word brand caps kept)")
  : bad(`ALL-CAPS display name(s): ${shouty.map((p) => p.name).join(", ")}`);
const suffixed = ps.filter((p) => /,?\s+(LLC|Inc\.?|Corporation|Incorporated)\.?$/i.test(p.name));
suffixed.length === 0
  ? ok("no display name carries an LLC/Inc./Corporation suffix")
  : bad(`corporate suffix left on: ${suffixed.map((p) => p.name).join(", ")}`);

/* ── the seeder, run for real ────────────────────────────────────────────── */
console.log("\nSeeding into the library\n");

const tmp = mkdtempSync(join(tmpdir(), "audit-events-"));
process.env.DATA_DIR = tmp; // demoStore resolves DATA_DIR at module load
try {
  const store = await import("../engine/demoStore.ts");
  store.DATA_DIR === tmp
    ? ok("seeder test is isolated in a throwaway DATA_DIR")
    : bad(`DATA_DIR is ${store.DATA_DIR}, not the temp dir — this test would write to the real library`);

  const { importEventSeeds } = await import("../engine/eventSeeds.ts");
  const seedFiles = existsSync("engine/event-seeds")
    ? readdirSync("engine/event-seeds").filter((f) => f.endsWith(".json"))
    : [];

  if (!seedFiles.length) {
    console.log("  note  no seed files committed yet — skipping the import checks");
  } else {
    const first = importEventSeeds();
    first.failed.length === 0
      ? ok(`imported ${first.added.length} seed(s) with no failures`)
      : bad(`seed import reported failures: ${first.failed.join("; ")}`);
    first.added.length === seedFiles.length
      ? ok("every committed seed became a library demo")
      : bad(`${seedFiles.length} seed file(s) but ${first.added.length} imported`);

    const recs = first.added.map((id) => store.getDemo(id)!);
    recs.every((r) => r?.event === DALLAS_EVENT)
      ? ok(`every seeded demo carries event "${DALLAS_EVENT}"`)
      : bad("a seeded demo is missing its event key — it would render in no section at all");
    recs.every((r) => (r.profile as any)?.id === r.id)
      ? ok("profile.id equals the demo id on every seed")
      : bad("profile.id disagrees with the demo id — the switcher and the library would disagree");
    recs.every((r) => r.prospect && r.industry && r.websiteUrl)
      ? ok("every seeded demo has prospect, industry and website")
      : bad("a seeded demo is missing library metadata");
    recs.every((r) => r.creator?.email)
      ? ok("every seeded demo has an owner")
      : bad("a seeded demo has no creator — nobody could edit or delete it");

    /* listedAs comes off the roster, so it must agree with it — and must be
       ABSENT where the name was not cleaned, not set to the same string twice. */
    const bySlug = new Map(ps.map((p) => [dallasDemoId(p.slug), p]));
    const wrong = recs.filter((r) => {
      const p = bySlug.get(r.id);
      if (!p) return false;
      const expect = p.listedAs && p.listedAs !== p.name ? p.listedAs : undefined;
      return r.listedAs !== expect;
    });
    wrong.length === 0
      ? ok("listedAs matches the roster on every seed (and is absent where the name was unchanged)")
      : bad(`listedAs wrong on: ${wrong.map((r) => r.id).join(", ")}`);

    /* ⚠️ THE GUARD THAT MATTERS MOST AT A CONFERENCE: a redeploy must not undo an
       edit an SE made to a roster demo. Proved by mutating one and reimporting. */
    const victim = recs[0];
    store.saveDemo({ ...victim, prospect: "EDITED BY AN SE" });
    const second = importEventSeeds();
    second.added.length === 0 && second.skipped === seedFiles.length
      ? ok("a second import adds nothing — existing demos are the guard, not a marker file")
      : bad(`re-import added ${second.added.length} and skipped ${second.skipped} — it would clobber SE edits`);
    store.getDemo(victim.id)?.prospect === "EDITED BY AN SE"
      ? ok("an edited roster demo survives a reimport")
      : bad("reimport overwrote an edited roster demo");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ── the wiring the browser depends on ───────────────────────────────────── */
console.log("\nLaunch screen wiring\n");

const launch = code("src/screens/Launch.tsx");

/\bDALLAS_EVENT\b/.test(launch) && /from\s+"\.\.\/data\/eventDemos"/.test(launch)
  ? ok("Launch reads the event key from the one shared definition")
  : bad("Launch does not import DALLAS_EVENT from src/data/eventDemos");
!/["']dallas-2026["']/.test(launch)
  ? ok("Launch does not hardcode a second copy of the event key")
  : bad("Launch hardcodes the event key — two copies is how one side reads a key nobody writes");
/d\.event\s*===\s*DALLAS_EVENT\s*\?\s*"dallas"/.test(launch)
  ? ok('a demo carrying the event key is grouped as "dallas"')
  : bad("the dallas grouping is gone — roster demos would fall back to My/Team demos");
/\["dallas",\s*"2026 Dallas Invoca Summit",\s*true\]/.test(launch)
  ? ok("the Dallas section is present and shown even when empty")
  : bad("the Dallas section is missing or no longer always shown");
/\(e\.listedAs\s*\?\?\s*""\)\.toLowerCase\(\)\.includes\(q\)/.test(launch)
  ? ok("the search matches the source-list name too")
  : bad("listedAs is not searchable — pasting the spreadsheet name would find nothing");
/listedAs:\s*d\.listedAs/.test(launch)
  ? ok("listedAs is carried onto the Entry the search reads")
  : bad("listedAs never reaches the Entry, so searching it can only ever fail");

/* ⚠️ THE 9MB MISTAKE. src/data/generated is loaded by an EAGER import.meta.glob
   straight into the single browser bundle; a 59-profile roster there would work
   and quintuple it. The seeds must live outside it. */
const seedsInSrc = existsSync("src/data/generated") &&
  readdirSync("src/data/generated").some((f) => f.startsWith(DALLAS_ID_PREFIX));
!seedsInSrc
  ? ok("no roster seed sits in src/data/generated (the eager-glob bundle)")
  : bad("a roster seed is in src/data/generated — it is being bundled into the browser");

const seeder = code("engine/eventSeeds.ts");
/event-seeds/.test(seeder) && !/src[/\\]data[/\\]generated/.test(seeder)
  ? ok("the seeder reads engine/event-seeds, not the bundled directory")
  : bad("the seeder points at the wrong directory");

const server = code("server.ts");
/importEventSeeds\(\)/.test(server)
  ? ok("server.ts runs the seed import at boot")
  : bad("server.ts never calls importEventSeeds — the roster would never reach the live library");

/* A DUPLICATE must not inherit the event: a copy is the SE's own working demo
   and belongs in "My demos", not in the conference roster. createDemo builds
   every copy, so its record literal must not mention `event`. */
const api = code("engine/demoApi.ts");
const createBody = api.slice(api.indexOf("export function createDemo"), api.indexOf("export async function handleDemoApi"));
!/\bevent\b/.test(createBody)
  ? ok("a duplicated demo does not inherit the event roster")
  : bad("createDemo carries `event` — duplicating a roster demo would clone it into the roster");
/\.\.\.rec,/.test(api)
  ? ok("PATCH spreads the record, so an edited roster demo keeps its event")
  : bad("PATCH no longer spreads the record — editing a roster demo could drop its event");

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll event-roster checks passed\n");
process.exit(fail ? 1 : 0);
