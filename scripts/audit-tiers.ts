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
