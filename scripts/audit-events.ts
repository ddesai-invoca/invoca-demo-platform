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

const { DALLAS_EVENT, DALLAS_ID_PREFIX, dallasDemoId, EVENTS, eventGroupOf } =
  await import("../src/data/eventDemos.ts");
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

/* ⚠️⚠️ RE-AIMED 10/8/2026 WHEN A SECOND EVENT ARRIVED, NOT LOOSENED. These three used
   to pin the Dallas TERNARY and its literal row in `GROUP_ORDER` character for character,
   which is exactly what a second event had to replace — the ternary and the table each
   grew a branch per event. The invariants that survive are stronger, because they hold
   for every event rather than for one: the screen reads the shared registry, every event
   gets a section, and every section is always-shown. */
/* ⚠️ THE IMPORT IS NOT THE USE. The first version of this matched `eventGroupOf`
   anywhere in the file, so replacing the CALL with `null` left the import behind and
   the check stayed green while every roster demo fell into My/Team demos. It asserts
   the call site now — the same dead-code trap recorded three times in CLAUDE.md. */
/eventGroupOf\(d\.event\)/.test(launch) && /from\s+"\.\.\/data\/eventDemos"/.test(launch)
  ? ok("Launch groups a demo by calling eventGroupOf on its own event key")
  : bad("Launch does not call eventGroupOf(d.event) — roster demos fall back to My/Team demos");
!EVENTS.some((e) => new RegExp(`["']${e.key}["']`).test(launch))
  ? ok("Launch hardcodes no event key")
  : bad("Launch hardcodes an event key — two copies is how one side reads a key nobody writes");
/* ⚠️ CALLED, NOT GREPPED: a grep passes against `if (false && ...)`, which this file
   has already been bitten by once. */
EVENTS.every((e) => eventGroupOf(e.key) === e.group) && eventGroupOf("nope-2026") === null
  ? ok(`every event key groups to its own section (${EVENTS.length} events), and an unknown one does not`)
  : bad("eventGroupOf does not map every event — roster demos would fall back to My/Team demos");
/\.\.\.EVENTS\.map\(/.test(launch) && /\[group,\s*label,\s*true\]/.test(launch)
  ? ok("every event gets its own section, shown even when empty")
  : bad("the event sections are not derived from EVENTS, or are hidden when empty");
new Set(EVENTS.map((e) => e.group)).size === EVENTS.length &&
new Set(EVENTS.map((e) => e.key)).size === EVENTS.length &&
new Set(EVENTS.map((e) => e.idPrefix)).size === EVENTS.length
  ? ok("event keys, groups and id prefixes are all distinct")
  : bad("two events share a key, a section id or an id prefix — one would swallow the other");
EVENTS.every((e) => EVENTS.every((o) => o === e || !o.idPrefix.startsWith(e.idPrefix)))
  ? ok("no event's id prefix is a prefix of another's")
  : bad("one event's id prefix starts with another's — eventForId would answer the wrong event");
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

/* ⚠️⚠️ RE-AIMED 10/8/2026, NOT LOOSENED. It used to assert that `createDemo`'s body
   never mentions `event` at all — true while nothing could set one, and backwards the
   moment bulk generation needed to file a demo under an event. The invariant that
   survives is the one that always mattered, and it is now CHECKED BY CALLING the real
   function rather than by grepping a slice of it: a copy inherits no event, and an event
   is set only when one is passed. A duplicate belongs in "My demos" — it is the SE's own
   working copy, not part of the conference roster. */
const api = code("engine/demoApi.ts");
{
  const { createDemo } = await import("../engine/demoApi.ts");
  const who = { name: "Audit", email: "audit@invoca.com" };
  const prof = { customerName: "Audit Co", industry: "Testing", networkName: "n" };
  const plain = createDemo(prof, who);
  const filed = createDemo(prof, who, undefined, "", EVENTS[0].key);
  const copied = createDemo(filed.profile, who, undefined, " (copy)");
  plain.event === undefined && filed.event === EVENTS[0].key && copied.event === undefined
    ? ok("an event is set only when passed, and a duplicate inherits none")
    : bad(`createDemo mishandles the event (plain=${plain.event}, filed=${filed.event}, copy=${copied.event})`);
}
/* And the duplicate ROUTE passes none — the call site, not just the function. */
/createDemo\(rec\.profile, user, structuredClone\(rec\.customizations\), " \(copy\)"\)/.test(api)
  ? ok("the duplicate route passes no event")
  : bad("the duplicate route now passes an event — a copy would land in the conference roster");
/\.\.\.rec,/.test(api)
  ? ok("PATCH spreads the record, so an edited roster demo keeps its event")
  : bad("PATCH no longer spreads the record — editing a roster demo could drop its event");


/* =============================================================================
   THE EVENT'S CONNECTED GOOGLE SHEET (10/8/2026)
   ============================================================================= */
console.log("\nEvent sheet\n");
{
  const { isSheetWebhookUrl, setEventSheet, eventSettings } =
    await import("../engine/eventSettings.ts");

  /* ⚠️⚠️ THE URL IS AN ALLOW-LIST, AND THAT IS A SECURITY RULE. This value is pasted by
     a human and the server then POSTs the prospect's name, the SE's note and who was in
     the room to it — so anything looser is a way to make this server send real customer
     data to any host somebody can type. */
  const good = [
    "https://script.google.com/macros/s/AKfycbx_123-abc/exec",
    "https://script.google.com/a/macros/invoca.com/s/AKfycbx_123/exec",
  ];
  const evil = [
    "https://evil.example.com/collect",
    "http://script.google.com/macros/s/AKfycbx/exec",           // not https
    "https://script.google.com/macros/s/AKfycbx/dev",            // a test deployment
    "https://script.google.com.evil.com/macros/s/A/exec",        // lookalike host
    "https://script.google.com/macros/s/AKfycbx/exec?next=http://evil",
    "javascript:alert(1)",
    "",
  ];
  good.every(isSheetWebhookUrl) ? ok("a deployed Apps Script /exec URL is accepted")
    : bad("a real Apps Script URL is refused — nobody could wire a sheet");
  evil.every((u) => !isSheetWebhookUrl(u))
    ? ok(`every one of ${evil.length} hostile or wrong-shaped URLs is refused`)
    : bad("a URL outside script.google.com is accepted — marks would be POSTed off-site");

  /* The store, against a throwaway DATA_DIR (set before demoStore resolves it). */
  setEventSheet("nope-2026", good[0], "x") === null
    ? ok("an unknown event key stores nothing")
    : bad("setEventSheet writes a file for an event that does not exist");
  setEventSheet(EVENTS[0].key, "https://evil.example.com/x", "x") === null
    ? ok("a refused URL is not stored")
    : bad("an unusable URL is stored — every later mark would report 'could not be reached'");
  const saved = setEventSheet(EVENTS[0].key, good[0], "tester@invoca.com");
  saved?.sheetWebhookUrl === good[0] && eventSettings(EVENTS[0].key).sheetWebhookUrl === good[0]
    ? ok("a good URL is stored and read back")
    : bad("the sheet URL does not survive a write/read round trip");
  setEventSheet(EVENTS[0].key, "", "tester@invoca.com");
  !eventSettings(EVENTS[0].key).sheetWebhookUrl
    ? ok("an empty string unwires the sheet")
    : bad("a sheet cannot be disconnected");

  /* ── postMarkRow, against a MOCKED fetch ──────────────────────────────────
     ⚠️ NEVER THE REAL NETWORK. An audit that depends on somebody else's service is
     flaky by construction and cannot run on a machine with no sheet — the rule
     audit:advanced already follows for Gong. */
  const { postMarkRow, attendeeCell } = await import("../engine/sheetHook.ts");
  const realFetch = globalThis.fetch;
  let lastBody: any = null;
  const row = {
    demoId: "chicago-acme", prospect: "Acme", website: "https://acme.com",
    status: "Lead", note: "wants pricing", attendees: "Sarah Chen (VP Ops)",
    markedBy: "Local Dev", markedByEmail: "local@dev",
    at: "2026-10-08T00:00:00.000Z", demoUrl: "http://x/launch?demo=chicago-acme",
    action: "upsert" as const,
  };

  (await postMarkRow(undefined, row)).posted === false
    ? ok("a demo in no event posts nothing") : bad("a demo with no event still posts a row");
  (await postMarkRow(EVENTS[0].key, row)).posted === false
    ? ok("an event with no sheet posts nothing") : bad("an unwired event still posts");

  setEventSheet(EVENTS[0].key, good[0], "tester@invoca.com");
  globalThis.fetch = (async (_u: any, init: any) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, status: 200 } as any;
  }) as any;
  const sent = await postMarkRow(EVENTS[0].key, row);
  sent.posted ? ok("a wired event posts the row") : bad(`a wired event did not post (${sent.reason})`);
  /* ⚠️ THE KEY IS THE WHOLE FEATURE — "creates a row for that prospect or updates a row
     if changes are made to an existing prospect" is only possible if demoId travels. */
  lastBody?.demoId === "chicago-acme" && lastBody?.event === EVENTS[0].key && !!lastBody?.env
    ? ok("the body carries the upsert key, the event and which deployment wrote it")
    : bad("the posted body is missing demoId, event or env");
  lastBody?.note === "wants pricing" && lastBody?.attendees === "Sarah Chen (VP Ops)"
    ? ok("the note and who was in the room reach the sheet")
    : bad("the note or the attendee list does not reach the sheet");

  globalThis.fetch = (async () => ({ ok: false, status: 500 } as any)) as any;
  (await postMarkRow(EVENTS[0].key, row)).reason?.includes("500")
    ? ok("a failing sheet is reported with its status, not silently swallowed")
    : bad("a failing sheet does not report why");
  globalThis.fetch = (async () => { throw new Error("boom"); }) as any;
  const thrown = await postMarkRow(EVENTS[0].key, row);
  thrown.posted === false && !!thrown.reason
    ? ok("a thrown fetch resolves with a reason rather than throwing")
    : bad("postMarkRow can throw — it would take a mark down with it");
  globalThis.fetch = realFetch;

  attendeeCell({ attendees: [{ name: "A", title: "VP" }, { name: "B" }] }) === "A (VP), B"
    ? ok("the attendee cell reads as one list") : bad("the attendee cell is malformed");
  setEventSheet(EVENTS[0].key, "", "tester@invoca.com");

  /* ── the wiring ────────────────────────────────────────────────────────── */
  const api = code("engine/demoApi.ts");
  /* ⚠️⚠️ ORDER IS THE INVARIANT: the mark is on disk BEFORE the sheet is attempted, so a
     sheet that moved can never lose an SE's note. Same rule feedbackApi records for mail. */
  api.indexOf("markDemo(id, user, status") < api.indexOf("postMarkRow(rec.event")
    ? ok("the mark is stored before the row is attempted")
    : bad("the sheet post runs before the mark is saved — a sheet failure could lose the note");
  /* ⚠️ EVERY CALL SITE, NOT ANY. The first version tested `/await postMarkRow\(/` — which
     passes while ONE of the two (mark, unmark) is still awaited, so dropping the await on
     the other went undetected. A floating promise is killed by the SIGTERM drain mid-deploy,
     exactly when the last request through is most likely to be somebody's. */
  (() => {
    const sites = api.match(/\bpostMarkRow\(/g)?.length ?? 0;
    const awaited = api.match(/\bawait postMarkRow\(/g)?.length ?? 0;
    return sites >= 2 && sites === awaited;
  })()
    ? ok("every postMarkRow call is awaited, so the SIGTERM drain cannot kill one mid-deploy")
    : bad("a sheet post is fire-and-forget — a deploy would drop the last rows");
  /* ⚠️ SLICED, NOT WINDOWED — the third character-window probe fault in this session.
     It matched `isAdmin(user)` within 400 chars of `sheetWebhookUrl`, and went red the
     moment the handler grew three more fields between them. A window is a guess about
     formatting; the handler's own body is the thing the invariant is about. */
  (() => {
    const start = api.indexOf('if (p === "/api/events")');
    const body = api.slice(start, api.indexOf("const linkRoute", start));
    if (start < 0 || !body) return false;
    /* Every address field must sit inside the `admin ? { … } : {}` branch. */
    /* ⚠️ The invariant is "no address field OUTSIDE the admin branch", which is what to
       assert. Counting occurrences instead was a probe fault: `sheetWebhookUrl:
       e.settings.sheetWebhookUrl` carries the token twice on ONE line, so an `=== 1`
       count failed on correct code. */
    const open = body.indexOf("...(admin ? {");
    const close = body.indexOf("} : {})");
    if (open < 0 || close < open) return false;
    const guarded = body.slice(open, close);
    const outside = body.slice(0, open) + body.slice(close);
    const fields = ["sheetWebhookUrl", "sheetUrl", "sheetOwner"];
    return fields.every((f) => guarded.includes(f)) && fields.every((f) => !outside.includes(f));
  })()
    ? ok("every sheet address is returned only to an admin")
    : bad("the sheet URL reaches every signed-in user — anyone could append to the sheet");
  /Connecting a sheet is limited to project admins/.test(api)
    ? ok("a non-admin cannot wire a sheet")
    : bad("any signed-in user can repoint an event's sheet");
  /action: "removed"/.test(api)
    ? ok("clearing a mark tells the sheet, so the row does not keep a status nobody stands behind")
    : bad("unmarking leaves a stale status in the sheet");

  /\/api\/events/.test(code("vite.config.ts"))
    ? ok("the dev twin serves /api/events")
    : bad("/api/events 404s in dev while production serves it — the documented twin trap");
}

/* =============================================================================
   PASTE A SHEET LINK (10/8/2026)
   -----------------------------------------------------------------------------
   Reported: "connecting a sheet is too complicated for not technical people…
   ideally all i want users to do is paste the google sheet URL." So the Sheets API
   path is now the one the dialog leads with and the Apps Script webhook is the
   collapsed fallback.
   ============================================================================= */
console.log("\nPaste a sheet link\n");
{
  const { spreadsheetIdFrom, sheetUrlFor, colLetter, COLUMNS, upsertRow, SheetsReconnectError } =
    await import("../engine/sheetsApi.ts");
  const { setEventSpreadsheet, eventSettings } = await import("../engine/eventSettings.ts");
  const { saveSheetsToken, hasSheetsToken, removeSheetsToken } =
    await import("../engine/sheetsTokens.ts");

  /* ⚠️ ONLY THE ID IS KEPT, so a pasted link carrying #gid=, /edit, ?usp=sharing or a
     query string cannot reach an API path. */
  const ID = "1aBcD3fGhIjKlMnOpQrStUvWxYz0123456789abcd";
  const good: [string, string][] = [
    [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, ID],
    [`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`, ID],
    [`https://docs.google.com/spreadsheets/d/${ID}`, ID],
    [ID, ID],
  ];
  good.every(([raw, want]) => spreadsheetIdFrom(raw) === want)
    ? ok("a pasted sheet link yields its id however it was copied")
    : bad("a normal Google Sheets link is not parsed — the whole point is pasting one");
  ["https://example.com/x", "https://docs.google.com/document/d/" + ID + "/edit", "", "   ", "short"]
    .every((u) => spreadsheetIdFrom(u) === null)
    ? ok("a non-sheet link, a Google DOC and an empty paste are all refused")
    : bad("something that is not a spreadsheet is accepted as one");
  sheetUrlFor(ID).includes(ID)
    ? ok("the stored id round-trips back to a link the UI can show")
    : bad("sheetUrlFor does not rebuild the link");

  colLetter(0) === "A" && colLetter(25) === "Z" && colLetter(26) === "AA" && colLetter(51) === "AZ"
    ? ok("column letters carry past Z, so a sheet with 27+ columns still addresses correctly")
    : bad(`colLetter is wrong past Z (26 -> ${colLetter(26)})`);
  COLUMNS[0] === "Demo ID"
    ? ok("Demo ID is the first column — the upsert key findRow reads")
    : bad("the key column moved; the upsert would read the wrong column");

  /* The settings store's second shape, against the same throwaway DATA_DIR. */
  setEventSpreadsheet(EVENTS[0].key, ID, "admin@invoca.com", "Chicago follow-ups", "admin@invoca.com");
  const st = eventSettings(EVENTS[0].key);
  /* ⚠⚠ THE OWNER IS STORED BESIDE THE ID. Reading the two apart — the id here, the
     signed-in user at write time — is how an event silently starts writing with whoever
     happens to be marking, which is the per-SE model this design rejects. */
  st.spreadsheetId === ID && st.sheetOwner === "admin@invoca.com"
    ? ok("the sheet id is stored WITH whose grant writes it")
    : bad("the connecting admin is not recorded — rows would be written as whoever marks");

  /* ⚠️ The API path must WIN when both are configured: an event moved onto the simple
     path must not keep posting to a webhook somebody left behind. */
  const { postMarkRow } = await import("../engine/sheetHook.ts");
  const realFetch2 = globalThis.fetch;
  let hitWebhook = false;
  globalThis.fetch = (async (u: any) => {
    if (String(u).includes("script.google.com")) hitWebhook = true;
    return { ok: false, status: 500, json: async () => ({}) } as any;
  }) as any;
  saveSheetsToken("admin@invoca.com", "probe-refresh");
  await postMarkRow(EVENTS[0].key, {
    demoId: "d1", prospect: "Acme", status: "Lead", markedBy: "A", markedByEmail: "a@invoca.com",
    at: "2026-10-08T00:00:00.000Z", action: "upsert",
  });
  !hitWebhook
    ? ok("with both configured the API path is used, not the leftover webhook")
    : bad("a wired sheet still posts to the Apps Script webhook");
  globalThis.fetch = realFetch2;

  /* ⚠️ A REVOKED GRANT IS ITS OWN ANSWER — `reconnect`, not "try again", which would
     send somebody round a loop that cannot help. */
  removeSheetsToken("admin@invoca.com");
  !hasSheetsToken("admin@invoca.com") ? ok("a grant can be removed") : bad("removeSheetsToken does nothing");
  const gone = await postMarkRow(EVENTS[0].key, {
    demoId: "d1", prospect: "Acme", status: "Lead", markedBy: "A", markedByEmail: "a@invoca.com",
    at: "2026-10-08T00:00:00.000Z", action: "upsert",
  });
  gone.posted === false && gone.reconnect === true
    ? ok("a missing grant reports reconnect rather than a generic failure")
    : bad(`a missing grant did not report reconnect (${JSON.stringify(gone)})`);

  /* ⚠️ UPSERT, against a mocked Sheets API: the same claim the Apps Script harness
     proves for the other path. Same prospect updates; a new one appends. */
  saveSheetsToken("admin@invoca.com", "probe-refresh");
  const calls: { url: string; method: string; body?: any }[] = [];
  const mock = (rowsIds: string[][]) => (async (u: any, init: any) => {
    const url = String(u);
    /* ⚠️ The token exchange posts form-encoded, not JSON — parsing blind throws and
       takes the whole audit down with a stack trace instead of a failed check. */
    let parsed: any;
    try { parsed = init?.body ? JSON.parse(init.body) : undefined; } catch { parsed = undefined; }
    calls.push({ url, method: init?.method ?? "GET", body: parsed });
    if (url.includes("oauth2.googleapis.com")) return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) } as any;
    if (url.includes("fields=sheets.properties.title")) return { ok: true, status: 200, json: async () => ({ sheets: [{ properties: { title: EVENTS[0].key } }] }) } as any;
    if (url.includes("!1:1")) return { ok: true, status: 200, json: async () => ({ values: [[...COLUMNS]] }) } as any;
    if (url.includes("!A2:A") || /![A-Z]2:[A-Z]$/.test(decodeURIComponent(url).split("/values/")[1] ?? ""))
      return { ok: true, status: 200, json: async () => ({ values: rowsIds }) } as any;
    return { ok: true, status: 200, json: async () => ({ values: [[]] }) } as any;
  }) as any;

  globalThis.fetch = mock([["d1"], ["d2"]]);
  const hit = await upsertRow({ email: "admin@invoca.com", spreadsheetId: ID, tab: "t" }, { "Demo ID": "d2", Prospect: "N" });
  hit.updated === true && hit.row === 3
    ? ok("a prospect already in the sheet UPDATES its own row")
    : bad(`an existing prospect did not update in place (${JSON.stringify(hit)})`);
  calls.some((c) => c.method === "PUT") && !calls.some((c) => c.url.includes(":append"))
    ? ok("updating writes in place and does not append")
    : bad("an update appended a second row");

  calls.length = 0;
  globalThis.fetch = mock([["d1"]]);
  const miss = await upsertRow({ email: "admin@invoca.com", spreadsheetId: ID, tab: "t" }, { "Demo ID": "zzz", Prospect: "New" });
  miss.updated === false && calls.some((c) => c.url.includes(":append"))
    ? ok("a prospect not in the sheet is appended")
    : bad("a new prospect did not append");
  globalThis.fetch = realFetch2;
  removeSheetsToken("admin@invoca.com");
  setEventSpreadsheet(EVENTS[0].key, "", "", "", "x");

  /* ── the wiring ────────────────────────────────────────────────────────── */
  const auth = code("googleAuth.ts");
  /\/auth\/sheets/.test(auth) && /auth\/spreadsheets/.test(auth)
    ? ok("the Sheets consent route exists and asks for the spreadsheets scope")
    : bad("there is no /auth/sheets leg — nobody could connect");
  /* ⚠️ The gate's own scope must NOT grow it: "see, edit, create and delete all your
     spreadsheets" shown to everyone who opens the platform is the opposite of seamless. */
  !/scope: "openid email profile https:\/\/www\.googleapis\.com\/auth\/spreadsheets"[\s\S]{0,600}?hd: ALLOWED_DOMAIN[\s\S]{0,200}?app\.get\("\/auth\/callback"/.test(auth)
    ? ok("the sign-in gate did not grow the spreadsheets scope")
    : bad("every user now consents to full Sheets access just to sign in");
  /state\.startsWith\("sheets:"\)/.test(auth) && /saveSheetsToken\(/.test(auth)
    ? ok("the callback stores the grant rather than displaying it")
    : bad("the Sheets callback does not store the token");

  const api3 = code("engine/demoApi.ts");
  /describeSheet\([\s\S]{0,200}?setEventSpreadsheet\(/.test(api3)
    ? ok("a sheet is proved reachable BEFORE it is stored")
    : bad("an unreachable sheet can be stored — it would fail at the first mark instead");
  /Connecting a sheet is limited to project admins[\s\S]*?sheet-link|sheet-link[\s\S]{0,600}?Connecting a sheet is limited to project admins/.test(api3)
    ? ok("the paste-a-link route is admin-only too")
    : bad("any signed-in user can repoint an event's sheet by link");

  const btn = code("src/components/EventSheetButton.tsx");
  /\/auth\/sheets/.test(btn) && /Connect Google Sheets/.test(btn)
    ? ok("the dialog offers Connect when the admin has not granted yet")
    : bad("there is no Connect control — the paste field would just fail");
  /<details className="evs-alt">/.test(btn)
    ? ok("the Apps Script path is demoted to a collapsed fallback")
    : bad("the script steps are still front and centre — that is what was reported");
  btn.indexOf("Google Sheet link") < btn.indexOf("Use a script instead")
    ? ok("pasting a link comes before the script fallback")
    : bad("the script path is above the paste field again");
}

/* =============================================================================
   THE APPS SCRIPT'S OWN UPSERT — run against a stubbed Spreadsheet
   -----------------------------------------------------------------------------
   ⚠️⚠️ THE HALF THAT IS NOT IN THIS REPO AT RUNTIME IS STILL TESTED HERE. "Creates a row
   for that prospect or updates a row if changes are made" is decided entirely by that
   script, so shipping it unexercised would mean the feature's core claim is the one
   thing nothing checks.
   ============================================================================= */
console.log("\nApps Script upsert\n");
{
  const src = readFileSync("public/event-sheet.gs", "utf8");
  const rows: string[][] = [];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0]?.length ?? 0),
    getRange: (r: number, c: number, nr: number, nc: number) => ({
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
      setValues: (vals: string[][]) => vals.forEach((line, i) => {
        rows[r - 1 + i] = rows[r - 1 + i] ?? [];
        line.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; });
      }),
      setFontWeight: () => {},
    }),
    appendRow: (line: string[]) => { rows.push([...line]); },
    setFrozenRows: () => {},
  };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" },
      createTextOutput: (t: string) => ({ setMimeType: () => JSON.parse(t) }) },
  };
  const run = new Function(...Object.keys(sandbox), `${src}; return doPost;`)(
    ...Object.values(sandbox)) as (e: any) => any;
  const post = (o: Record<string, unknown>) => run({ postData: { contents: JSON.stringify(o) } });

  const a1 = post({ event: "chicago-2026", demoId: "d1", prospect: "Acme", status: "Lead", note: "first" });
  a1?.ok ? ok("the script accepts a post") : bad(`the script threw: ${a1?.error}`);
  rows.length === 2 ? ok("a header row and one data row after the first mark")
    : bad(`expected header + 1 row, got ${rows.length}`);

  /* ⚠️ THE CORE CLAIM. */
  post({ event: "chicago-2026", demoId: "d1", prospect: "Acme", status: "Urgent lead", note: "changed" });
  rows.length === 2 && rows[1].includes("Urgent lead") && rows[1].includes("changed")
    ? ok("re-marking the SAME prospect UPDATES its row rather than adding one")
    : bad(`a second mark on one prospect produced ${rows.length - 1} rows`);

  post({ event: "chicago-2026", demoId: "d2", prospect: "Northwind", status: "Lead" });
  rows.length === 3 ? ok("a different prospect appends a new row")
    : bad("a second prospect did not get its own row");

  post({ event: "chicago-2026", demoId: "d1", action: "removed" });
  const head = rows[0];
  const statusAt = head.indexOf("Status");
  rows.length === 3 && rows[1][statusAt] === "" && rows[1][head.indexOf("Prospect")] === ""
    ? bad("unmarking cleared the prospect name too — the row stops being findable")
    : rows.length === 3 && rows[1][statusAt] === ""
      ? ok("clearing a mark empties the status but keeps the row")
      : bad("clearing a mark did not empty the status, or removed the row");

  /* ⚠️ A COLUMN SOMEBODY ADDED BY HAND MUST SURVIVE EVERY LATER WRITE — otherwise the
     first mark after an SE adds an "Owner" column wipes it. */
  rows[0].push("Owner"); rows[1].push("Dana");
  post({ event: "chicago-2026", demoId: "d2", prospect: "Northwind", status: "Lead", note: "x" });
  rows[1][rows[0].indexOf("Owner")] === "Dana"
    ? ok("a hand-added column survives a later write")
    : bad("writing a row wipes columns the script does not know about");
}

/* =============================================================================
   BULK GENERATE (10/8/2026)
   ============================================================================= */
console.log("\nBulk generate\n");
{
  const { parseRoster, normalizeUrl, ROSTER_MAX, ROSTER_TEMPLATE } =
    await import("../src/data/rosterImport.ts");

  const p = parseRoster(
    'name,website\n"Smith, Jones & Co",smithjones.com\nNorthwind,https://northwind.org\n' +
    '"Smith, Jones & Co",dupe.com\nNoSite,\n,https://noname.com\nBad,not a url\n');
  p.rows.length === 2 && p.rows[0].name === "Smith, Jones & Co"
    ? ok("a quoted comma stays inside one company name")
    : bad(`a quoted name was split — got ${JSON.stringify(p.rows.map((r) => r.name))}`);
  p.rows[0].url === "https://smithjones.com"
    ? ok("a bare domain becomes an https URL") : bad("a bare domain is not normalised");
  p.skipped.length === 4 && p.skipped.every((s) => !!s.reason && s.line > 0)
    ? ok("every dropped row is reported with its line and a reason")
    : bad(`skips are not fully reported — ${JSON.stringify(p.skipped)}`);

  /* ⚠️ THE HEADER IS FOUND, NOT ASSUMED — somebody will reorder the two columns. */
  const flipped = parseRoster("website,name\nacme.com,Acme\n");
  flipped.rows[0]?.name === "Acme" && flipped.rows[0]?.url === "https://acme.com"
    ? ok("the columns are read by header, in either order")
    : bad("a reordered template is parsed backwards — every prospect would get the wrong URL");
  const headerless = parseRoster("Acme,acme.com\n");
  headerless.rows[0]?.name === "Acme"
    ? ok("a file with no header still parses") : bad("a headerless file yields nothing");
  const tsv = parseRoster("name\twebsite\nAcme\tacme.com\n");
  tsv.rows[0]?.url === "https://acme.com"
    ? ok("a tab-separated paste parses too") : bad("a TSV paste is not handled");

  parseRoster(Array.from({ length: ROSTER_MAX + 5 },
    (_, i) => `P${i},p${i}.com`).join("\n")).rows.length === ROSTER_MAX
    ? ok(`the roster is capped at ${ROSTER_MAX} and the overflow is reported`)
    : bad("the roster cap does not hold — one click could queue weeks of generation");
  normalizeUrl("localhost") === null && normalizeUrl("javascript:alert(1)") === null
    ? ok("a hostname with no dot and a javascript: URL are both refused")
    : bad("normalizeUrl accepts something that is not a web address");
  parseRoster(ROSTER_TEMPLATE).rows.length === 2 && parseRoster(ROSTER_TEMPLATE).skipped.length === 0
    ? ok("the downloadable template parses cleanly through the same parser")
    : bad("the template this hands out does not survive its own parser");

  /* ── the wiring ────────────────────────────────────────────────────────── */
  const launch = code("src/screens/Launch.tsx");
  /<BulkGenerate \/>/.test(launch) && /<details className="launch-bulk">/.test(launch)
  && /<summary>Bulk Generation<\/summary>/.test(launch)
    ? ok("the panel is mounted behind a Bulk Generation disclosure, closed by default")
    : bad("bulk generate is not mounted, or its disclosure is missing/renamed");
  /* ⚠️ ABOVE the submit button, asked for directly. Checked by POSITION rather than by
     the markup around it, so reformatting the form cannot quietly flip it back. */
  launch.indexOf('<details className="launch-bulk">') < launch.indexOf('className="launch-btn" type="submit"')
    ? ok("it sits above the Launch demo button")
    : bad("bulk generation dropped below the Launch demo button again");
  !/<AdvancedSettings/.test(launch)
    ? ok("the old AdvancedSettings panel is still unmounted")
    : bad("the removed advanced panel came back — it was taken off this form on request");
  /* ⚠️ ONE SSE READER. Two copies drift the first time the engine adds an event type:
     one surface keeps working and the other silently stops advancing. */
  !/getReader\(\)/.test(launch) && /generateProfile\(\{/.test(launch)
    ? ok("the launch form reads the stream through the shared module")
    : bad("the launch form has its own copy of the SSE reader again");
  const bulk = code("src/components/BulkGenerate.tsx");
  /generateProfile\(\{/.test(bulk) && !/getReader\(\)/.test(bulk)
    ? ok("the bulk panel uses that same reader")
    : bad("the bulk panel parses the stream itself");
  /existing\.has\(/.test(bulk)
    ? ok("a prospect already in the library is skipped, so a run is resumable")
    : bad("bulk generation rebuilds prospects that already exist");
  /catch[\s\S]{0,200}?state: "failed"/.test(bulk)
    ? ok("one failed prospect does not stop the roster")
    : bad("a single failure aborts the run — one blocked site would take the roster with it");

  /* ⚠️⚠️ **THE LAUNCH SCREEN IS GREEN, NOT THE PLATFORM BLUE — reported directly: "i
     dont like the blue, stay on theme".** `#2666f9` is the accent on every REPLICA
     screen, and reaching for it here was reflex: this screen is OUR tool, and
     `.launch-btn`, `.launch-spinner`, `.launch-page` and `.prospect-card:hover` have
     always been `--color-green-bar`. Checked over the CSS with COMMENTS STRIPPED — the
     note recording this very correction names the blue it replaced, and a check that
     reddens on its own documentation gets deleted as a nuisance (the fix `audit:place`
     and the vendor scan already carry). */
  {
    /* ⚠️ SLICED AT REAL CSS, NOT AT THE SECTION'S COMMENT HEADER. Starting the slice
       inside a `/* … *\/` block leaves the first `*\/` unpaired, which shifts every
       later comment boundary by one and leaves prose in the "code" — this check failed
       on correct CSS exactly that way, matching the note that documents the fix. */
    const css = readFileSync("src/styles/app.css", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    const mine = css.slice(css.indexOf(".evs-trigger {"));
    !/#2666f9|rgba\(38,\s*102,\s*249/i.test(mine)
      ? ok("the launch-screen controls carry no platform blue")
      : bad("a launch-screen control uses the replica accent #2666f9 — it is green here");
    /--color-green-bar/.test(mine) && /--color-green-active/.test(mine)
      ? ok("they use the green TOKENS rather than a hex, so a later control cannot drift a third way")
      : bad("the green is hardcoded — use --color-green-bar / --color-green-active");
  }

  const api2 = code("engine/demoApi.ts");
  /if \(event && !isEventKey\(event\)\) return err\(400/.test(api2)
    ? ok("an unknown event on create is refused rather than silently dropped")
    : bad("createDemo accepts any event string — a demo could be filed into a section that does not exist");
}


console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll event-roster checks passed\n");
process.exit(fail ? 1 : 0);
