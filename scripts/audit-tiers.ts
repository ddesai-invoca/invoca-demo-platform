/* =============================================================================
   audit-tiers.ts — the Signal AI Silver / Gold pair, on EVERY prospect
   -----------------------------------------------------------------------------
   `npm run audit:tiers` (also run by `npm run audit`).

   The pair used to be Health Spring only and hand-authored. Now every prospect's is DERIVED
   from its own Conversation Intelligence report, which means the honesty of the comparison is
   no longer something a human checked once — it has to hold for 13 profiles on disk and for
   whatever is generated next month. These checks BUILD the real views and read them.

   ⚠️ **THE CENTRAL CHECK IS THE VERBATIM QUOTE.** Every Silver miss prints the caller's own
   words on the Comments tab, beside a transcript a prospect can read. If a quote is not in
   that prospect's transcript, character for character, the demo is inventing evidence.

   ⚠️ **AND THE MISS MUST BE A REAL MISS**: the quoted turn must contain none of the phrases
   the comment claims the library holds. Both directions matter — a miss that the library
   would actually have caught is a lie, and a "caught" row that nothing matched is one too.
   ============================================================================= */
import { readFileSync, readdirSync } from "node:fs";
import { tierView, hasTierReports } from "../src/data/signalTiers";
import type { CustomerProfile } from "../src/data/schema";

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const check = (c: boolean, m: string, detail = "") => (c ? ok(m) : bad(`${m}${detail ? ` — ${detail}` : ""}`));

const files = readdirSync("src/data/generated").filter((f) => f.endsWith(".json"));
check(files.length >= 5, "generated profiles were found to audit", `${files.length} files`);

let withPair = 0, totalMisses = 0, honestCatches = 0;
/* ⚠⚠ **THE FLOOR, asked for 10/9/2026: "for unmet signals have 4 high valuable signal that
   were unmet ... instead of just the 1 right now."** Silver's whole argument is the UNMET
   group, and one row does not make it — so the number of prospects reaching four is tracked
   and asserted below rather than left to vary silently. */
let reachedFour = 0;
for (const f of files) {
  const p = JSON.parse(readFileSync(`src/data/generated/${f}`, "utf8")) as CustomerProfile;
  const name = p.customerName;
  const silver = tierView(p, "silver");
  const gold = tierView(p, "gold");

  /* Gated together: a prospect either has both reports or neither. Half a pair would put a
     Gold row on My Reports whose Silver counterpart refuses. */
  if (!hasTierReports(p)) {
    check(!silver && !gold, `${name}: no tier reports, and neither view builds`);
    continue;
  }
  withPair++;
  if (!silver || !gold) { bad(`${name}: hasTierReports is true but a view is null`); continue; }

  const transcript = (p.reports.conversationIntelligence?.transcript ?? []) as { speaker?: string; time: string; text: string }[];
  const all = transcript.map((t) => t.text).join(" ");
  const unmet = silver.signals.filter((s) => !s.met);

  /* 1. There is something to compare. */
  if (!unmet.length) bad(`${name}: Silver has no UNMET row, so there is no comparison to show`);
  totalMisses += unmet.length;

  /* 2. Silver is the SHORT library — that length is part of what is being sold against. */
  check(silver.signals.length < gold.signals.length,
    `${name}: Silver is shorter than Gold`, `${silver.signals.length} vs ${gold.signals.length}`);

  /* 3. Gold carries AI, and does NOT replace the deterministic detections. */
  const goldBadges = new Set(gold.signals.flatMap((s) => s.badges));
  check(goldBadges.has("AI"), `${name}: Gold's rail carries AI badges`);
  check(gold.signals.some((s) => s.badges.some((b) => /^Rule/.test(b))),
    `${name}: Gold keeps its rules-based rows`);
  check(!silver.signals.some((s) => s.badges.includes("AI")),
    `${name}: Silver carries NO AI badge`);

  /* 4. Every UNMET row on Silver comes back MET on Gold — that IS the upsell. */
  const goldMet = new Set(gold.signals.filter((s) => s.met).map((s) => s.name));
  const stranded = unmet.filter((s) => !goldMet.has(s.name));
  check(!stranded.length, `${name}: every Silver miss fires on Gold`,
    stranded.map((s) => s.name).join(", "));

  /* 5. ⚠️ THE QUOTE IS VERBATIM. Health Spring's pair is hand-authored and its comments
     EXCERPT the caller (adding a full stop), so the verbatim rule is asserted on the derived
     prospects — which is where a machine could invent one. */
  const handAuthored = /health spring/i.test(name);
  const quotes = silver.comments.filter((c) => c.miss)
    .map((c) => (/^Caller: "([\s\S]+?)"/.exec(c.text) ?? [])[1])
    .filter((q): q is string => !!q);
  if (!handAuthored) {
    const fake = quotes.filter((q) => !all.includes(q.replace(/\.\.\.$/, "")));
    check(!fake.length, `${name}: every quoted caller line is verbatim from its own transcript`,
      fake.join(" | "));
    check(quotes.length === unmet.length,
      `${name}: every miss is quoted on the Comments tab`, `${quotes.length} of ${unmet.length}`);
  }

  /* 6. ⚠️ THE MISS IS REAL: the quoted turn contains none of the phrases the comment names. */
  for (const c of silver.comments.filter((x) => x.miss)) {
    const q = (/^Caller: "([\s\S]+?)"/.exec(c.text) ?? [])[1];
    const listed = [...c.text.matchAll(/list holds ([^.]+)\./g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    if (!q || !listed.length) continue;
    const caught = listed.filter((ph) => q.toLowerCase().includes(ph.toLowerCase()));
    if (caught.length) bad(`${name}: "${c.signal}" is claimed as a miss but the caller said ${caught.map((x) => `"${x}"`).join(", ")}`);
  }

  /* 7. A MET concept row is an honest hit, not decoration. */
  honestCatches += silver.signals.filter((s) => s.met && s.count > 0).length;
  if (unmet.length >= 4) reachedFour++;

  /* 9. ⚠⚠ **THE UNMET ROWS ARE ORDERED BY SALES VALUE.** `CONCEPTS` is written in value order
     (price, competitor, booking intent, upsell, then urgency, contract, decider) and
     `findConcepts` preserves it, so the top of the UNMET group is always the most expensive
     thing the keyword library missed. If that order is ever lost the rail still looks right
     and the pitch degrades — an SE reads the first two rows aloud and they would be whichever
     concept happened to match first. */
  {
    const RANK = ["Price Sensitivity", "Competitor Comparison", "Intent", "Upsell Opportunity",
      "Urgency Expressed", "Contract Objection", "Decision Maker Absent"];
    const rankOf = (n: string) => {
      const i = RANK.findIndex((r) => r === "Intent" ? /\bIntent$/.test(n) : n === r);
      return i < 0 ? 99 : i;
    };
    /* ⚠️ **DERIVED PROSPECTS ONLY — and this fired on Health Spring, correctly.** Its pair is
       hand-authored and its unmet rows lead with Enrollment Intent, which is the lead of THAT
       call ("I'd like to move forward", booked ninety seconds later) and the whole reason the
       narrative was written that way. A human's chosen order is not drift; the machine's is
       what needs pinning. Same scoping the verbatim-quote check above already uses. */
    if (!handAuthored) {
      const ranks = unmet.map((s) => rankOf(s.name)).filter((r) => r < 99);
      const sorted = [...ranks].sort((x, y) => x - y);
      check(ranks.every((r, i) => r === sorted[i]),
        `${name}: the unmet rows run in sales-value order`, ranks.join(" "));
    }
  }

  /* 10. ⚠⚠ **GOLD CARRIES "Keyword Spotting" ONLY WHERE SILVER ACTUALLY HAS THE ROW.** Asked
     for directly: "remove the keyword spotting tag for the bottom half because that signal was
     caught by AI and not a keyword spotting or a rule." A row Gold adds on top of Silver was
     claiming a phrase-list detection on a screen whose Silver rail does not list it at all —
     the two tiers contradicting each other about the same signal.
     ⚠️ DETERMINISTIC ROWS ARE EXEMPT: a QA phrase check and a routing rule are not AI on any
     tier, and `(QA) Proper Close` is absent from Silver because this library is small. */
  {
    const DET = /^(\(QA\)|Answered by Agent|Business Hours|Contact Info|Caller Type)/;
    const silverNames = new Set(silver.signals.map((s) => s.name));
    const wrong = gold.signals.filter((g) =>
      !DET.test(g.name)
      && !silverNames.has(g.name)
      && g.badges.some((b) => /keyword|rule|keypress/i.test(b)));
    check(!wrong.length,
      `${name}: a Gold row Silver does not have carries AI only`,
      wrong.map((w) => `${w.name} [${w.badges.join(",")}]`).join(" | "));
    /* And the converse, which is the "Gold adds, it does not replace" half: a row Silver DOES
       catch must keep its keyword badge on Gold rather than being rewritten as AI. */
    const replaced = gold.signals.filter((g) => {
      const sv = silver.signals.find((x) => x.name === g.name && x.met);
      return sv && sv.badges.some((b) => /keyword|rule/i.test(b))
        && !g.badges.some((b) => /keyword|rule/i.test(b));
    });
    check(!replaced.length,
      `${name}: a row Silver catches keeps its keyword badge on Gold`,
      replaced.map((r) => r.name).join(" | "));
  }

  /* 8. ⚠️ NO OTHER PROSPECT'S VOCABULARY. Health Spring's hand-authored lists name Medicare,
     prescriptions and subsidies; those leaking onto a blinds company or a plumber is the
     re-skin failure this whole feature is about. */
  if (!handAuthored) {
    const leak = /Enrollment Intent|Medicare|Prescription|Subsidy|Coverage Gap/i
      .exec(JSON.stringify([silver, gold]));
    check(!leak, `${name}: no Health Spring vocabulary leaked in`, leak?.[0] ?? "");
  }
}

check(withPair === files.length,
  "EVERY prospect on disk has the Silver / Gold pair", `${withPair} of ${files.length}`);
check(totalMisses >= withPair, "every prospect with the pair has at least one genuine miss");
check(honestCatches > 0, "Silver fires on real detections too, so it is not a strawman");

/* ⚠⚠ **THE FLOOR IS A PROPORTION, NOT A PER-PROSPECT RULE, AND THAT IS STATED HONESTLY.**
   A miss has to be REAL — located in that prospect's own transcript — so a prospect whose call
   genuinely contains only three high-value moments cannot be given a fourth without inventing
   evidence, which is the one thing this whole feature refuses to do. What IS assertable is
   that the detector keeps finding them: measured 10/9/2026, widening the concept patterns took
   the share of prospects reaching four unmet rows from **26% to 71%** on the 99 profiles on
   disk. The bar is set below that so a regression in the patterns reddens, and deliberately
   not at 100%, which would be a permanently-failing check.
   ⚠️ If this ever needs to be 100%, the remedy is `scripts/enrich-ci-sales.ts` — add the
   missing moments to the TRANSCRIPT — not a looser pattern here. */
{
  const share = withPair ? reachedFour / withPair : 0;
  /* ⚠️ **EVERY TRACKED PROFILE, not a proportion — measured 15 of 15 after the widening, so
     the bar is where the code actually is.** The looser 60% this started as was a guess made
     before measuring, and a check set below what the code achieves is a check that lets the
     next regression through. The LIBRARY demos (git-ignored `.data/demos`) sit lower — 71% of
     all 99 profiles on this machine — and are deliberately not audited here, because a check
     that depends on a local, untracked store fails differently on every machine. */
  check(share === 1,
    `every prospect reaches four unmet high-value rows`,
    `${reachedFour} of ${withPair} (${Math.round(share * 100)}%)`);
}

/* ⚠⚠ **SILVER HAS NO AI SUMMARY TAB.** Asked for directly: an AI summary is written BY the
   AI, so an account without Signal AI Gold does not have one. Asserted on the screen's own
   `tabsFor`, because the tab list is what renders. */
{
  const screen = readFileSync("src/screens/ConversationIntelligence.tsx", "utf8");
  check(/tier === "silver" \? TABS\.filter\(\(t\) => t\.label !== "AI Summary"\)/.test(screen),
    "Silver's tab list drops AI Summary");
  check(/\{tabs\.map\(/.test(screen) && !/\{TABS\.map\(/.test(screen),
    "…and the rail renders that filtered list, not the full one");
}

/* A profile with no Conversation Intelligence report must produce nothing rather than an
   invented Silver list. There is none on disk, so it is asserted against a stripped copy. */
{
  const p = JSON.parse(readFileSync(`src/data/generated/${files[0]}`, "utf8")) as CustomerProfile;
  const stripped = { ...p, reports: { ...p.reports, conversationIntelligence: undefined } } as CustomerProfile;
  check(!hasTierReports(stripped) && !tierView(stripped, "silver") && !tierView(stripped, "gold"),
    "a prospect with no CI report gets no tier reports (fails closed)");
}

console.log(failures ? `\n${failures} tier-report failure(s)` : `\nok    Signal AI tiers  (${files.length} profiles)`);
process.exit(failures ? 1 : 0);
