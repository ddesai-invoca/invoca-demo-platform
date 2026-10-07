/* =============================================================================
   audit-app.ts — OUR OWN chrome: the launch menu and the release notes
   -----------------------------------------------------------------------------
   Everything else in this repo replicates Invoca's product. These two screens are
   the tool's own, and they have their own quiet failure modes:

     • `RELEASES[0]` is assumed to be the NEWEST entry — `LATEST_RELEASE` and the
       "New" chip are both derived from it. Add an entry in the wrong place and the
       chip either never fires again or fires forever, with nothing to notice.
     • the menu is now the ONLY way to reach Support, the admin inbox, the docs and
       the notes. A row that stops rendering does not error, it just goes missing.
     • the three floating pills it replaced were deleted; a stray `.readme-fab` or
       `.corner-stack` left in the markup would render an invisible orphan.
   ============================================================================= */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");
/* Comments stripped before any source match — an audit in this repo has fired on
   its own documentation before, and a check that reddens on correct code gets
   deleted as a nuisance. */
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/* ── release notes ───────────────────────────────────────────────────────── */
console.log("\nRelease notes\n");

const { RELEASES, LATEST_RELEASE, unseenRelease } = await import("../src/data/releaseNotes.ts");

RELEASES.length >= 20
  ? ok(`${RELEASES.length} dated releases`)
  : bad(`only ${RELEASES.length} releases — the backfill looks truncated`);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const badDates = RELEASES.filter((r) => !ISO.test(r.date) || Number.isNaN(+new Date(`${r.date}T12:00:00`)));
badDates.length === 0
  ? ok("every date is a valid ISO date")
  : bad(`invalid date(s): ${badDates.map((r) => r.date).join(", ")}`);

const dates = RELEASES.map((r) => r.date);
new Set(dates).size === dates.length
  ? ok("no duplicate dates")
  : bad("two releases share a date — merge them into one entry");

/* ⚠️ THE ORDERING CHECK IS THE POINT OF THIS FILE. Strictly descending, because
   `RELEASES[0]` IS the newest release everywhere else in the app. */
const sorted = dates.every((d, k) => k === 0 || dates[k - 1] > d);
sorted
  ? ok("releases are strictly newest-first")
  : bad("releases are not newest-first — LATEST_RELEASE and the \"New\" chip both read RELEASES[0]");

LATEST_RELEASE === [...dates].sort().reverse()[0]
  ? ok(`LATEST_RELEASE (${LATEST_RELEASE}) is the newest date`)
  : bad(`LATEST_RELEASE is ${LATEST_RELEASE}, but the newest date is ${[...dates].sort().reverse()[0]}`);

const thin = RELEASES.filter((r) => !r.title?.trim() || !r.changes?.length);
thin.length === 0
  ? ok("every release has a title and at least one change")
  : bad(`empty release(s): ${thin.map((r) => r.date).join(", ")}`);

const KINDS = new Set(["new", "improved", "fixed"]);
const badChanges = RELEASES.flatMap((r) =>
  r.changes.filter((c) => !KINDS.has(c.kind) || !c.text?.trim()).map((c) => `${r.date}: ${c.kind}`));
badChanges.length === 0
  ? ok(`all ${RELEASES.reduce((n, r) => n + r.changes.length, 0)} changes have a valid kind and text`)
  : bad(`malformed change(s): ${badChanges.join(", ")}`);

/* ⚠️ "FROM THE VERY BEGINNING" WAS THE ASK, so the oldest entry is pinned to the
   repo's first commit. Without this, trimming the list to "the recent stuff"
   silently rewrites what the page claims to be. Skipped where git is unavailable
   (a build container), rather than failing for the wrong reason. */
let firstCommit = "";
try { firstCommit = execSync("git log --reverse --format=%ad --date=short", { encoding: "utf8" }).split("\n")[0].trim(); }
catch { /* no git here */ }
if (!firstCommit) console.log("  note  git unavailable — skipping the first-commit check");
else {
  const oldest = [...dates].sort()[0];
  oldest === firstCommit
    ? ok(`the oldest entry (${oldest}) is the repo's first commit`)
    : bad(`oldest entry is ${oldest} but the first commit is ${firstCommit} — the history no longer starts at the beginning`);
}

/* ⚠️⚠️ NO ENTRY MAY NAME A PROSPECT. Release notes are product-wide by request
   (9/10/2026): an entry has to be true for anyone using the tool, whichever demo
   they open, so the capability belongs here and the instance built on one demo
   does not. The name list is DERIVED from the profiles and demos actually on
   disk rather than hardcoded, so it covers prospects added later — a note
   written next month naming a demo generated next month still fails.

   ⚠️ THIS CHECKS THE NAME, NOT THE SCOPE, and the difference is the real trap.
   Three entries were pulled from the backfill that named nobody and were still
   about one demo (a dashboard gated to a single prospect; a report that shipped
   for one account before it was derived for all). No static check can see that;
   the rule is in the data file's header for whoever writes the next entry. */
const prospectNames = new Set<string>();
for (const dir of ["src/data/generated", "engine/event-seeds"]) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const name = JSON.parse(read(`${dir}/${file}`))?.customerName;
      if (typeof name === "string" && name.trim()) prospectNames.add(name.trim());
    } catch { /* a malformed profile is another audit's problem */ }
  }
}
/* Local demos too when they are there — git-ignored, so absent on a fresh clone
   and in a build container. Their absence must not weaken the check silently,
   which is why the count is printed. */
if (existsSync(".data/demos")) {
  for (const file of readdirSync(".data/demos").filter((f) => f.endsWith(".json"))) {
    try {
      const rec = JSON.parse(read(`.data/demos/${file}`));
      const name = rec?.prospect ?? rec?.profile?.customerName;
      if (typeof name === "string" && name.trim()) prospectNames.add(name.trim());
    } catch { /* skip */ }
  }
}
prospectNames.add("Shady Blinds");   // the code-defined seed, not a JSON file

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const named: string[] = [];
for (const r of RELEASES) {
  for (const [where, text] of [["title", r.title] as const, ...r.changes.map((c, k) => [`change ${k + 1}`, c.text] as const)]) {
    for (const name of prospectNames) {
      if (new RegExp(`\\b${esc(name)}\\b`, "i").test(text)) named.push(`${r.date} ${where} names "${name}"`);
    }
  }
}
named.length === 0
  ? ok(`no entry names any of the ${prospectNames.size} known prospects`)
  : bad(`prospect-specific entr${named.length === 1 ? "y" : "ies"}:\n        ${named.join("\n        ")}`);

/* The chip must be derivable at all — `unseenRelease` reads localStorage, which
   does not exist under node, so it has to survive that rather than throw on a
   screen the launch page renders. */
try {
  typeof unseenRelease() === "boolean"
    ? ok("unseenRelease() survives having no localStorage (returns a boolean)")
    : bad("unseenRelease() did not return a boolean");
} catch (e) {
  bad(`unseenRelease() threw without localStorage: ${(e as Error).message}`);
}

/* ── the launch menu ─────────────────────────────────────────────────────── */
console.log("\nLaunch menu\n");

const app = code("src/App.tsx");
const menu = code("src/components/LaunchMenu.tsx");
const modal = code("src/components/SupportModal.tsx");

/\bLaunchMenu\b/.test(app)
  ? ok("App renders the launch menu")
  : bad("App no longer renders LaunchMenu");

for (const [route, label] of [["/release-notes", "release notes"], ["/feedback", "the feedback board"]] as const) {
  new RegExp(`path="${route}"`).test(app)
    ? ok(`${label} route is registered`)
    : bad(`${label} route (${route}) is missing`);
  new RegExp(`MENU_ON[^;]*"${route}"`).test(app)
    ? ok(`the menu renders on ${route}`)
    : bad(`${route} is not in MENU_ON, so the menu vanishes there`);
}

/* ⚠️ THE ROUTE GATING IS AN ALLOW-LIST, and it must stay one: a deny-list means a
   new replica screen carries our chrome by default. */
/const MENU_ON = \[/.test(app) && /MENU_ON\.includes\(pathname\)/.test(app)
  ? ok("the menu is gated by an allow-list, not a deny-list")
  : bad("MENU_ON is no longer an allow-list checked with .includes");

const rows = ["support", "inbox", "releases", "readme"];
const missing = rows.filter((k) => !new RegExp(`key: "${k}"`).test(menu));
missing.length === 0
  ? ok(`all four rows present (${rows.join(", ")})`)
  : bad(`menu row(s) missing: ${missing.join(", ")}`);

/* ⚠️⚠️ THE MODAL MUST BE A SIBLING OF THE PANEL, NOT INSIDE IT. Selecting a row
   closes the menu, which unmounts the panel — a modal rendered in there is
   destroyed by the click that opened it. Asserted structurally: the SupportModal
   element must appear AFTER the panel's closing markup. */
const panelEnd = menu.lastIndexOf("</div>");
const modalAt = menu.indexOf("<SupportModal");
modalAt > 0 && modalAt > menu.indexOf('className="lm-panel"')
  && !menu.slice(menu.indexOf('className="lm-panel"'), panelEnd).includes("<SupportModal")
  ? ok("SupportModal is rendered outside the menu panel")
  : bad("SupportModal is inside the panel — closing the menu would unmount it mid-open");

/\{\s*open,\s*onClose\s*\}/.test(modal) && !/useState\(false\)[^\n]*\/\/?\s*open/.test(modal)
  ? ok("SupportModal is controlled by its parent")
  : bad("SupportModal is no longer controlled — the menu could not open it");
!/className="fb-fab"/.test(modal)
  ? ok("SupportModal carries no trigger button of its own")
  : bad("SupportModal still renders the old .fb-fab pill");

/* ⚠️ CAPTURE PHASE. On bubble the hamburger closes the panel and its own onClick
   reopens it, so the trigger can never dismiss the menu — documented twice
   already in this repo (the Signal flyout, the Create Workflow combobox). */
/addEventListener\("pointerdown",\s*onDown,\s*true\)/.test(menu)
  ? ok("outside-click uses pointerdown in the capture phase")
  : bad("the outside-click listener is not capture-phase pointerdown");
/e\.key === "Escape"/.test(menu) && /ArrowDown/.test(menu)
  ? ok("Escape closes and arrow keys move through the rows")
  : bad("keyboard handling (Escape / arrows) is missing");

/* The three deleted pills must not reappear anywhere in the app's own source. */
const deadClasses = ["corner-stack", "readme-fab", "inbox-fab", "fb-fab"];
const cssText = read("src/styles/app.css");
const cssDead = deadClasses.filter((c) => new RegExp(`^\\.${c}[\\s:,{]`, "m").test(cssText));
cssDead.length === 0
  ? ok("no CSS rules left for the three replaced pills")
  : bad(`dead CSS still defined: ${cssDead.join(", ")}`);

/* z-order: the menu must sit UNDER the Support overlay and the env badge, or it
   competes with a modal it opened. Read from the stylesheet, not assumed. */
const zOf = (sel: string) => {
  const m = new RegExp(`\\.${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`, "m").exec(cssText);
  return m ? Number(m[1]) : NaN;
};
const [zMenu, zOverlay, zBadge] = [zOf("lm-root"), zOf("fb-overlay"), zOf("envbadge")];
zMenu < zOverlay && zMenu < zBadge
  ? ok(`z-order holds: menu ${zMenu} < support overlay ${zOverlay} < env badge ${zBadge}`)
  : bad(`z-order wrong: menu ${zMenu}, support overlay ${zOverlay}, env badge ${zBadge}`);

existsSync("src/components/ReadmeButton.tsx") || existsSync("src/components/InboxButton.tsx")
  ? bad("a replaced pill component is back on disk — it should be a menu row, not a button")
  : ok("the replaced pill components are gone, not merely unmounted");

/* ── the feedback notification ───────────────────────────────────────────── */
console.log("\nFeedback notification\n");

/* ⚠️⚠️ WHY THIS SECTION EXISTS. Until 9/10/2026 the only mail this app sent was
   the COMPLETION notice, to the SUBMITTER. Nothing told the maintainer anything,
   so the sole signal that feedback had arrived was the Inbox badge on the LIVE
   launch screen — per-instance, so working on localhost showed the local store's
   count instead. Three colleagues' reports sat In review for over two weeks.
   A notification that silently stops is indistinguishable from nobody writing
   in, which is exactly the failure that has to stay checked. */
const { newItemEmail: newMail } = await import("../engine/mailer.ts");
const { adminEmails } = await import("../engine/demoApi.ts");

adminEmails().length > 0
  ? ok(`${adminEmails().length} admin address(es) to notify`)
  : bad("no admin addresses — a new submission would notify nobody");

const sample = newMail({
  to: "admin@invoca.com", kind: "feedback", title: "A title", body: "Line one.\nLine two.",
  submitterName: "Jane Doe", submitterEmail: "jane@invoca.com",
  page: "/launch", boardUrl: "https://example.com/feedback",
});
sample.subject === "Feedback: A title"
  ? ok("the subject carries the kind and the title")
  : bad(`unexpected subject: ${sample.subject}`);
newMail({ ...{ to: "a", kind: "feature", title: "T", body: "b", submitterName: "n", submitterEmail: "e", boardUrl: "u" } }).subject === "Feature request: T"
  ? ok("a feature request says so in the subject")
  : bad("the feature-request subject is wrong");
/* ⚠️ REPLY GOES TO THE SUBMITTER. This app sends FROM the maintainer's own
   address, so without an explicit Reply-To, hitting Reply mails yourself. */
sample.replyTo === "jane@invoca.com"
  ? ok("Reply-To is the submitter, not the sending account")
  : bad(`Reply-To is ${sample.replyTo} — replying would not reach the submitter`);
sample.text.includes("Line one.") && sample.text.includes("Line two.")
  ? ok("the full body is in the email, so it is readable without opening the board")
  : bad("the submission body is missing from the email");
sample.text.includes("https://example.com/feedback")
  ? ok("the email links the board")
  : bad("the email does not link the board");
/* Submission text is user input rendered into HTML mail. */
!/<script/i.test(newMail({
  to: "a", kind: "feedback", title: "<script>alert(1)</script>", body: "<script>alert(2)</script>",
  submitterName: "<script>3</script>", submitterEmail: "e", boardUrl: "u",
}).html ?? "")
  ? ok("title, body and name are HTML-escaped in the email")
  : bad("submission text reaches the email's HTML unescaped");

/* Both transports must honour it, or the header is set and dropped. */
const mailerSrc = code("engine/mailer.ts");
/Reply-To: \$\{mail\.replyTo \|\|/.test(mailerSrc) && /replyTo: mail\.replyTo \|\|/.test(mailerSrc)
  ? ok("both the Gmail and SMTP paths honour mail.replyTo")
  : bad("one transport ignores mail.replyTo, so Reply-To depends on which route sends");

const fbSrc = code("engine/feedbackApi.ts");
/newItemEmail\(/.test(fbSrc)
  ? ok("the POST path sends the new-item notice")
  : bad("a new submission notifies nobody — the defect this section exists for");
/await sendMail\(newItemEmail\(/.test(fbSrc)
  ? ok("the send is awaited, so the SIGTERM drain cannot kill it mid-deploy")
  : bad("the notification is fire-and-forget and can be dropped by a deploy");
/* ⚠️ NEVER MAIL THE SUBMITTER THEIR OWN ITEM — the maintainer files most of the
   feature requests, and an inbox of your own notes trains you to ignore it. */
/adminEmails\(\)\.filter\(/.test(fbSrc) && /!==\s*\(user\.email/.test(fbSrc)
  ? ok("the submitter is excluded from their own notification")
  : bad("the submitter would be emailed about their own submission");
/* The item is saved before the mail, so a mail failure cannot lose a submission. */
fbSrc.indexOf("saveFeedback(rec)") < fbSrc.indexOf("newItemEmail(")
  ? ok("the item is saved before the notice is attempted")
  : bad("the notice is attempted before the item is saved — a mail failure could lose it");

/* ---- the completion comment goes out WITH the email -------------------------
   Asked for directly (9/16/2026): "allow me to add a comment when i change status of
   any Feedback & feature requests to complete before the email gets send out, and the
   email includes the comment."

   ⚠️⚠️ **THE ORDERING IS THE WHOLE CORRECTNESS ARGUMENT, and it is one line apart in
   the handler.** `rec.note` is assigned from the request body BEFORE the terminal-status
   block builds the mail, so the comment and the email are one atomic PATCH. Move the
   note assignment below that block and the feature still "works" — the comment saves,
   the board shows it, the status changes — and the email goes out WITHOUT it, every
   time, silently. That is the only way this can break, so it is what these checks pin. */
console.log("\nThe completion comment reaches the email");
{
  const api = code("engine/feedbackApi.ts");
  const iNote = api.indexOf("rec.note = body.note");
  const iMail = api.indexOf("completionEmail(");
  iNote > 0 && iMail > 0 && iNote < iMail
    ? ok("the note is stored BEFORE the completion email is built")
    : bad("the note is assigned after the mail is built — the email would go out without the comment");

  /* One field, not two. The plumbing already existed end to end; a second
     `completionComment` would have duplicated a working path. */
  /note: rec\.note/.test(api)
    ? ok("and that same note is what the email is handed")
    : bad("completionEmail is no longer given rec.note");

  const mail = read("engine/mailer.ts");
  /\.\.\.\(opts\.note \? \[``, opts\.note\] : \[\]\)/.test(mail)
    ? ok("the text body includes it, and omits the line entirely when it is blank")
    : bad("the plain-text email no longer carries the note");
  /opts\.note \? `<br><span[^`]*\$\{esc\(opts\.note\)\}/.test(mail)
    ? ok("the HTML body includes it, escaped")
    : bad("the HTML email no longer carries the note, or stopped escaping it");

  const board = code("src/screens/FeedbackBoard.tsx");
  /if \(next === "Complete" && !i\.notifiedAt\)/.test(board)
    ? ok("picking Complete opens the composer instead of saving straight through")
    : bad("the board no longer asks for a comment when completing");
  /* ⚠️ Already-notified items must NOT offer a comment: no second email is sent, so the
     panel would be promising something that cannot happen. */
  /!i\.notifiedAt/.test(board)
    ? ok("but not for an item whose submitter has already been emailed")
    : bad("it would offer a comment on an item that will send no email");
  /JSON\.stringify\(note === undefined \? \{ status \} : \{ status, note \}\)/.test(board)
    ? ok("every other status change omits `note`, so an existing one is never wiped")
    : bad("the board may send note: \"\" on an unrelated status change and erase a comment");
  /* The panel must not promise an email on a server that has no mailer — all three
     lines (label, button, hint) branch on `emailEnabled`. The hint did not, at first. */
  (board.match(/emailEnabled/g) || []).length >= 4
    ? ok("its copy honours whether email is actually configured")
    : bad("some of the composer's copy promises an email regardless of configuration");
}

/* ── the profile cache, and the Preview Agent tab it broke ──────────────────
   Reported 9/28/2026: on production, with Hiscox active, Preview Agent opened
   showing SHADY BLINDS. Measured on the reporter's own browser — localStorage
   at 5,095KB against a ~5MB quota, `invoca-demo:profiles` alone 4,624KB across
   52 profiles, and Hiscox absent from it. So `addProfile`'s write had been
   throwing QuotaExceededError into a `catch {}` for some time, the profile
   lived only in the tab that opened it, and the NEW tab Preview Agent opens
   rebuilt the store from a cache that did not contain it. */
{
  /* ⚠️ `code()`, NOT `read()` — comments are stripped. The `alive` check below
     otherwise matches THIS FILE'S OWN note explaining why the flag is gone,
     and fails on correct code. Same fix audit:place and the vendor scan carry. */
  const ctx = code("src/data/ProfileContext.tsx");

  /uncaught|MAX_CACHE_BYTES/.test(ctx) && /MAX_CACHE_BYTES/.test(ctx)
    ? ok("the profile cache has a byte budget")
    : bad("the profile cache is unbounded again — it will refill and re-break");

  /* ⚠️ THE WRITE MUST EVICT, NOT SWALLOW. A `setItem` in a bare catch is the exact
     shape that failed silently for weeks. */
  /function persistCached/.test(ctx) && /out\.splice\(victim, 1\)/.test(ctx)
    ? ok("the cache write evicts oldest-first instead of failing")
    : bad("persistCached no longer evicts");
  !/localStorage\.setItem\(LS_PROFILES/.test(ctx.replace(/function persistCached[\s\S]*?\n}/, ""))
    ? ok("nothing writes the cache except persistCached")
    : bad("a raw setItem on the profile cache is back — it can fail silently");

  /* ⚠️ THE ACTIVE ID MUST NOT BE CLOBBERED. Resetting it wrote the seed's id to
     localStorage, so a Preview Agent tab did not merely render the wrong prospect,
     it changed what the ORIGINAL tab thought was selected. */
  !/if \(!byId\[profileId\]\) setProfileId\(DEFAULT_PROFILE_ID\)/.test(ctx)
    ? ok("an unknown active id is kept, not reset to the seed")
    : bad("the active id is being clobbered again — this corrupts the other tab too");

  /* ⚠️ AND A MISSING PROFILE IS FETCHED. The cache is a convenience; the server is
     the source of truth for a library demo. */
  /fetch\(`\/api\/demos\/\$\{encodeURIComponent\(profileId\)\}`\)/.test(ctx)
    ? ok("a missing active profile is hydrated from the server")
    : bad("nothing recovers a library demo the cache does not hold");
  /tried\.current\.add\(profileId\)/.test(ctx)
    ? ok("hydration is attempted once per id, so an unknown id cannot loop")
    : bad("the hydration guard is gone — an unknown id would refetch forever");

  /* ⚠️⚠️ AND IT MUST NOT CARRY A CANCELLATION FLAG. With one, StrictMode's
     double-mount cancels the first run while the `tried` guard skips the second,
     so the fetch resolves into a discarded result and the fix does nothing in dev.
     Measured exactly that: one request, 200 OK, empty cache. */
  (() => {
    const i = ctx.indexOf("tried.current.add(profileId)");
    const body = ctx.slice(i, ctx.indexOf("}, [byId, profileId]);", i));
    return !/\balive\b/.test(body);
  })()
    ? ok("no cancellation flag on the hydrate — StrictMode would make it a no-op")
    : bad("an `alive` flag is back on the hydration effect; it does nothing in dev");

  /render fallback|byId\[profileId\] \?\? byId\[DEFAULT_PROFILE_ID\]/.test(ctx)
    ? ok("rendering still degrades safely while the fetch is in flight")
    : bad("the render fallback is gone — a missing profile would crash");
}

console.log("\nDemo marks — one status set, and Submit is the only writer (10/7/2026)\n");
{
  const ms = await import("../src/data/markStatus.ts");
  const { cleanAttendees } = await import("../engine/demoMarks.ts");

  JSON.stringify(ms.MARK_STATUSES) === JSON.stringify(["urgent-lead", "lead", "no-interest"])
    ? ok("the three offered statuses are Urgent lead / Lead / No interest")
    : bad(`the offered statuses are ${JSON.stringify(ms.MARK_STATUSES)}`);

  /* ⚠️⚠️ **READ WIDER THAN YOU WRITE.** Real marks on disk still say `demoed` and
     `follow-up`; the user chose to keep them readable rather than remap or delete.
     So a legacy value must still LABEL and still pass the READ gate, while the
     WRITE gate refuses it — nobody can newly set a retired status. */
  ms.isStoredMarkStatus("demoed") && ms.isStoredMarkStatus("follow-up")
    && !ms.isMarkStatus("demoed") && !ms.isMarkStatus("follow-up")
    ? ok("retired statuses stay readable but can never be set again")
    : bad("a retired status is either unreadable or still settable");

  ms.MARK_LABEL["demoed"] === "Demoed" && ms.MARK_LABEL["follow-up"] === "Follow-up"
    && ms.MARK_LABEL["urgent-lead"] === "Urgent lead" && ms.MARK_LABEL["no-interest"] === "No interest"
    ? ok("every status a mark can carry has a label, retired ones included")
    : bad("a stored status would render as a raw slug");

  ms.isMarkStatus("lead") && !ms.isMarkStatus("nonsense")
    ? ok("the write gate accepts a current status and refuses an unknown one")
    : bad("the write gate is wrong");

  /* ⚠️ What OWES something is what the follow-up count and the menu badge mean.
     "No interest" is a decision and "Demoed" is a record — neither is a task. */
  ms.owesFollowUp("urgent-lead") && ms.owesFollowUp("lead") && ms.owesFollowUp("follow-up")
    && !ms.owesFollowUp("no-interest") && !ms.owesFollowUp("demoed")
    ? ok("only the statuses that owe a follow-up are counted as owing")
    : bad("the owing set is wrong — the follow-up count would mislead");

  /* ⚠️⚠️ **ONE DEFINITION.** The client used to re-declare this union, and when the
     statuses changed the server was edited while the client silently kept offering
     the old ones — `tsc -b --force` had no opinion, because the two types were
     independent. Both sides must come from `markStatus.ts`. */
  const ctx = code("src/data/DemoLibraryContext.tsx");
  !/export type MarkStatus =\s*"/.test(ctx) && /from "\.\/markStatus"/.test(ctx)
    ? ok("the client re-exports the shared status type instead of declaring its own")
    : bad("the client declares its own MarkStatus again — it will drift");

  /engine\/demoMarks\.ts/.test("engine/demoMarks.ts") &&
  /from "\.\.\/src\/data\/markStatus\.ts"/.test(code("engine/demoMarks.ts"))
    ? ok("the engine reads the same module, with the .ts extension nodenext needs")
    : bad("the engine declares statuses separately from the client");

  const dmk = code("src/components/DemoMarkButton.tsx");

  /* ⚠️ Nothing may write except `submit`. A status button that still committed
     would make the Submit button decorative, which is worse than not having one. */
  (() => {
    const choose = dmk.slice(dmk.indexOf("function choose"), dmk.indexOf("async function clear"));
    return !/setMark\(/.test(choose) && /setDraft\(/.test(choose);
  })()
    ? ok("picking a status only selects it — it does not save")
    : bad("a status button still writes, so Submit is decorative");

  /\bfunction submit\(\)/.test(dmk) && /className="dmk-submit"/.test(dmk)
    ? ok("there is a Submit button, and a submit() that writes")
    : bad("no Submit button");

  /disabled=\{!draft \|\| saving\}/.test(dmk)
    ? ok("Submit is disabled until a status is chosen")
    : bad("Submit would save a mark with no status");

  /<textarea/.test(dmk) && /className="dmk-note"/.test(dmk)
    ? ok("the note is a textarea, not a one-line input")
    : bad("the note box is still a single-line input");

  /* ⚠️⚠️ **NO CHARACTER LIMIT ON THE NOTE (10/7/2026), asked for directly.** What
     remains server-side is a SANITY bound, not a word limit — free text from a
     browser lands in a JSON file and an HTML email, so something must stop a
     malformed payload growing the store until a read fails. 20,000 is ~4,000 words,
     far past any real note. **Do not lower it back toward a human-sized number.** */
  (() => {
    const dm = code("engine/demoMarks.ts");
    const m = /const NOTE_MAX = ([\d_]+)/.exec(dm);
    const n = m ? Number(m[1].replace(/_/g, "")) : 0;
    return n >= 10_000 && !/maxLength=\{\d+\}/.test(dmk) && !/dmk-count/.test(dmk);
  })()
    ? ok("the note has no UI cap and only a far-off sanity bound on the server")
    : bad("the note is capped again, or the counter is back");

  /* ⚠️ Who was in the room. A NAME is enough — plenty of demos end without catching
     a job title, and requiring one would lose the name too. */
  /* Calls the REAL validator rather than grepping for it: a nameless row is
     dropped (the form always starts with one), a title with nobody attached is not
     a person, fields are trimmed, and the list is bounded — a list from a browser
     is one that can arrive with ten thousand entries. */
  (() => {
    const out = cleanAttendees([
      { name: "  Sarah Chen  ", title: "  VP Ops " },
      { name: "", title: "Head of Nothing" },
      { name: "Marcus Webb" },
      "not an object",
      null,
    ]);
    const bounded = cleanAttendees(Array.from({ length: 500 }, (_, i) => ({ name: `P${i}` })));
    return out.length === 2
      && out[0].name === "Sarah Chen" && out[0].title === "VP Ops"
      && out[1].name === "Marcus Webb" && out[1].title === undefined
      && bounded.length > 0 && bounded.length <= 24
      && cleanAttendees("nonsense").length === 0;
  })()
    ? ok("attendee rows are trimmed, nameless ones dropped, and the list bounded")
    : bad("the attendee validator does not hold");

  /className="dmk-pin"/.test(dmk) && /\+ Add person/.test(dmk) && /className="dmk-prm"/.test(dmk)
    ? ok("the panel collects a name and title per person, with add and remove")
    : bad("there is no way to record who the demo was given to");

  /* ⚠️ A field only ever WRITTEN is a field nobody fills in twice. It has to be
     readable where the work happens — the follow-up list and the rep's email. */
  /fup-people/.test(code("src/screens/FollowUps.tsx"))
    ? ok("the follow-up list shows who was in the room")
    : bad("attendees are write-only on the follow-up list");

  /attendees\?: \{ name: string; title\?: string \}\[\]/.test(code("engine/mailer.ts"))
    && /They demoed to/.test(code("engine/mailer.ts"))
    ? ok("the rep's notification names who the demo was given to")
    : bad("the notification does not say who saw the demo");

  /Notify the Rep/.test(dmk) && !/Tell the account exec/.test(dmk)
    ? ok("the notify row reads \"Notify the Rep\"")
    : bad("the notify row still carries the old wording");
}

console.log("\nTooltips on the demo-row controls (10/7/2026)\n");
{
  const tip = code("src/components/Tooltip.tsx");
  const dmk = code("src/components/DemoMarkButton.tsx");
  const shr = code("src/components/ShareDemoButton.tsx");
  const lau = code("src/screens/Launch.tsx");
  const css = read("src/styles/app.css");

  /* ⚠️⚠️ **PORTALLED, BECAUSE THE ROW IS IN A SCROLL BOX.** The demo list is
     `overflow-y: auto`; a tooltip positioned inside it is clipped at the box's edge,
     and the first and last visible rows — as likely to be hovered as any — are
     exactly where that bites. Same trap as the panels, the flyout and the combobox. */
  /createPortal\(/.test(tip) && /document\.body/.test(tip) && /position: fixed/.test(css.slice(css.indexOf(".ttp {"), css.indexOf("}", css.indexOf(".ttp {"))))
    ? ok("the tooltip is portalled and fixed, so a scroll box cannot clip it")
    : bad("the tooltip renders in flow and will be clipped by the demo list");

  /* ⚠️⚠️ **THE NATIVE `title` MUST GO WHERE A TOOLTIP ARRIVES**, or a viewer gets
     this label and then the OS's own a second later, on top of it. */
  (() => {
    /* ⚠️ Slices the control's OWN opening tag rather than a character window after a
       quoted className — the flag button writes `className={"dmk-btn" + …}`, so the
       quoted form matched nothing and the check was VACUOUS. Found by sabotaging it:
       a native title put back went undetected. Walk back to the `<button` that owns
       the marker, forward to the end of that tag, and look only inside. */
    const titledTag = (src: string, marker: string): boolean => {
      for (let i = src.indexOf(marker); i >= 0; i = src.indexOf(marker, i + 1)) {
        const open = src.lastIndexOf("<button", i);
        if (open < 0) continue;
        const close = src.indexOf(">", i);
        if (close < 0) continue;
        if (/\stitle=/.test(src.slice(open, close))) return true;
      }
      return false;
    };
    const markers: [string, string][] = [
      [dmk, "dmk-btn"], [shr, "shr-trigger"],
      [lau, "prospect-delete"], [lau, "prospect-dup"],
    ];
    return markers.every(([src, m]) => !titledTag(src, m));
  })()
    ? ok("no row control keeps a native title beside its tooltip")
    : bad("a control has both a tooltip and a native title — both will show");

  /* ⚠️ `aria-label` is the control's NAME and must survive; the tooltip is a
     DESCRIPTION, wired with aria-describedby only while it is on screen. */
  /aria-describedby=\{box \? id : undefined\}/.test(tip)
    && /aria-label/.test(dmk) && /aria-label/.test(shr) && /aria-label/.test(lau)
    ? ok("the tooltip describes the control without replacing its accessible name")
    : bad("the tooltip replaced the aria-label, or describes a node that is not shown");

  /* All five row controls are covered — a row with three tooltips and two without
     reads as broken, and they sit side by side. */
  (/<Tooltip/.test(dmk) ? 1 : 0) + (/<Tooltip/.test(shr) ? 1 : 0) +
  ((lau.match(/<Tooltip/g) ?? []).length) >= 5
    ? ok("flag, share, delete, duplicate and publish all carry a tooltip")
    : bad("some row controls still have no tooltip");

  /* ⚠️ It flips below when there is no room above — a fixed tooltip off the top of
     the viewport simply cannot be read. Verified live at a short viewport. */
  /ttp--below/.test(tip) && /ttp--below/.test(css)
    ? ok("it flips below the control when there is no room above")
    : bad("a tooltip near the top of the screen would be unreadable");

  /* ⚠️ Not on touch: there is no hover, so it would fire on every tap. */
  /pointerType !== "touch"/.test(tip)
    ? ok("a touch pointer opens no tooltip")
    : bad("tapping a control on a touch screen would open a tooltip");

  /* ⚠️ A delay, or scrolling a 76-row roster flashes tooltips past you. */
  /DELAY_MS = \d+/.test(tip) && /setTimeout/.test(tip)
    ? ok("it waits before appearing rather than firing on every pass")
    : bad("the tooltip appears instantly and will flicker while scrolling");

  /* ⚠️ The dark panel is `.ind-tip`'s, which DonutChart renders on three Dashboards
     screens — so this has its own prefix rather than reusing that class. */
  !/\.ind-tip/.test(tip) && /\.ttp \{/.test(css)
    ? ok("it has its own prefix and does not restyle the charts' shared tooltip")
    : bad("the row tooltip reuses .ind-tip and would reach the dashboards");
}

console.log("\nCenterModal — the mark and share panels are centred dialogs (10/7/2026)\n");
{
  const cm = code("src/components/CenterModal.tsx");
  const dmk = code("src/components/DemoMarkButton.tsx");
  const shr = code("src/components/ShareDemoButton.tsx");
  const css = read("src/styles/app.css");

  /\bfunction CenterModal\b/.test(cm) && /createPortal/.test(cm)
    ? ok("there is one shared modal shell, portalled to <body>")
    : bad("CenterModal is missing or no longer portals");

  /from "\.\/CenterModal"/.test(dmk) && /from "\.\/CenterModal"/.test(shr)
    ? ok("both panels render through the shared shell")
    : bad("a panel still renders its own dialog chrome");

  /* ⚠️⚠️ **THE LOAD-BEARING ONE.** The backdrop covers the whole screen, and the
     Launch library dropdown closes on any capture-phase mousedown outside itself.
     Without this the backdrop's own click closes the dropdown, UNMOUNTS the row,
     and takes the modal with it — the share panel's "Create link does nothing"
     bug, which cost a debugging session the first time. */
  /className="cmd-backdrop"[\s\S]{0,200}?data-picker-safe/.test(cm)
    ? ok("the backdrop is picker-safe, so the row underneath cannot unmount")
    : bad("the backdrop would close the library dropdown and destroy the modal");

  /* ⚠️ Closing on `target === currentTarget` rather than "outside the box": a drag
     that starts in the note and ends on the backdrop would otherwise dismiss the
     dialog and throw the note away. */
  /e\.target === e\.currentTarget/.test(cm)
    ? ok("only a press on the backdrop itself closes — not a drag out of the box")
    : bad("a selection drag ending on the backdrop would discard the dialog");

  /key === "Escape"/.test(cm)
    ? ok("Escape closes the dialog")
    : bad("Escape no longer closes");

  /className="cmd-x"/.test(cm) && /aria-label="Close"/.test(cm)
    ? ok("there is a labelled close button, top right")
    : bad("the close button is missing or unlabelled");

  /* ⚠️⚠️ **THE ANCHORING MUST STAY GONE.** Both panels used to measure their
     trigger, flip above it, re-place on a rAF and again from a ResizeObserver.
     Every line of that existed because a `position: fixed` popover can hang past
     the viewport where it cannot be scrolled to. A centred dialog has no anchor,
     so re-introducing any of it would be re-introducing the bug's habitat. */
  ![dmk, shr].some((f) => /ResizeObserver/.test(f) || /getBoundingClientRect/.test(f) || /setRect\(/.test(f))
    ? ok("neither panel anchors itself any more")
    : bad("trigger-anchoring is back — a dialog can fall off the viewport again");

  /* The four rules those panels used are dead; leaving them invites a future
     reader to style a class nothing renders. */
  !/\.dmk-panel\s*\{/.test(css) && !/\.shr-panel\s*\{/.test(css)
    && !/\.dmk-head\s*\{/.test(css) && !/\.shr-head\s*\{/.test(css)
    ? ok("the retired panel rules are gone from the stylesheet")
    : bad("a dead panel rule is still in app.css");

  /* ⚠️ The dialogs roughly doubled, so they MUST clamp — otherwise a 680px box on
     a small laptop runs off the edge, and the body must scroll rather than the
     page. Measured at 600x420: clamps to 552x372 with the body scrolling. */
  /* ⚠️⚠️ **THE DOT IS WHAT MAKES AN UNSELECTED OPTION MEAN ANYTHING.** The three
     were identical white rectangles, so the colour only appeared after a choice —
     too late to help the person deciding. Each dot takes its status's own hue, the
     one its chip and flag pill already use. */
  (() => {
    const hues = ["\.dmk-urgent-lead \.dmk-dot", "\.dmk-lead \.dmk-dot", "\.dmk-no-interest \.dmk-dot"];
    return /className="dmk-dot"/.test(dmk) && hues.every((h) => new RegExp(h).test(css));
  })()
    ? ok("each status option carries its own colour before anything is selected")
    : bad("the status options are indistinguishable until one is picked");

  /* ⚠️ The primary action must sit OUTSIDE the scrolling body, or it drifts down the
     dialog as the rep-lookup result grows it. */
  /footer=\{/.test(dmk) && /className="cmd-foot"/.test(cm) && !/\.dmk-actions\s*\{/.test(css)
    ? ok("Submit is in the modal footer, and the old actions row is gone")
    : bad("the actions row is still inside the scrolling body, or its dead rule remains");

  /* ⚠️⚠️ **THE SHARE DIALOG MUST NOT GROW A FOOTER.** Its primary button is a form
     SUBMIT and has to stay inside the <form>; hoisting it into the footer would
     need a `form=` attribute and would silently stop "Create link" working — the
     exact bug that panel already cost a session. */
  /* ⚠️ Slices the real <form>…</form> rather than guessing a character window —
     a window is an assumption about formatting, and a 400-char one failed on
     perfectly correct code here. */
  (() => {
    const i = shr.indexOf("<form");
    const j = shr.indexOf("</form>", i);
    return !/footer=\{/.test(shr) && i > 0 && j > i && /className="shr-btn"/.test(shr.slice(i, j));
  })()
    ? ok("the share dialog keeps its submit inside its form, with no footer")
    : bad("the share dialog's submit moved out of its form — Create link will break");

  (() => {
    const i = css.indexOf(".cmd-box {");
    const rule = i < 0 ? "" : css.slice(i, css.indexOf("}", i));
    return /max-width:\s*100%/.test(rule) && /max-height:\s*100%/.test(rule);
  })() && /\.cmd-body\s*\{[^}]*overflow-y:\s*auto/.test(css)
    ? ok("the dialog clamps to the viewport and scrolls its body, not the page")
    : bad("a doubled dialog could run off a small screen");
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll app-chrome checks passed\n");
process.exit(fail ? 1 : 0);
