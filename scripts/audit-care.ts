/* =============================================================================
   audit-care — healthcare prospects speak healthcare, everyone else is untouched
   -----------------------------------------------------------------------------
   Asked for 10/6/2026, scoped on the follow-up to "only future prospects that are
   healthcare". Two things therefore have to hold at once, and the second is the
   one that is easy to lose: a care prospect's agent and dashboards stop saying
   "sales", AND nothing else moves — not another vertical's wording, and not the
   stored data of any demo already saved.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { servesPatients, qmLabels } from "../engine/careVocab.ts";
import { smsSystemPromptForAudit, __buildVoiceSystemForTest } from "../engine/chat.ts";
import { buildSmsBrain } from "../src/data/smsBrain.ts";
import { voiceSpecFor } from "../src/data/voiceAgentSpec.ts";
import type { CustomerProfile } from "../src/data/schema.ts";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const code = (p: string) => fs.readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const SALES = /\b(sales|sell\w*|sold|purchase\w*|buyer)\b/i;

const profiles: CustomerProfile[] = [];
for (const d of ["src/data/generated", "engine/event-seeds"]) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      const p = (raw.profile ?? raw) as CustomerProfile;
      if (p?.reports?.agentConfig) profiles.push(p);
    } catch { /* a malformed file is audit-seeds' business, not ours */ }
  }
}

console.log("\nWho counts as healthcare\n");
profiles.length >= 40
  ? ok(`${profiles.length} profiles swept`)
  : bad(`only ${profiles.length} profiles parsed — the sweep is probably broken, not the data`);

/* ⚠️⚠️ **THE SUBSTRING TRAP, PINNED.** A first pass matched "Hospitality" with `hospital`
   and swept two hotel-management prospects into healthcare — the same failure this repo
   records for "car" inside "care". */
(() => {
  /* ⚠️⚠️ **THE NOUN MUST NOT MASK THE REGEX, and the first version of this check was
     masked.** It used the real prospects' own nouns ("Owner", "Guest"), which already fail
     the noun test — so it passed whether or not the industry regex matched "Hospitality".
     A hotel loyalty programme plausibly calls its customers Members, so this fixture passes
     the noun test and isolates the INDUSTRY regex, which is the thing being asserted.
     ⚠️ **STATED PLAINLY: NO SINGLE-GUARD SABOTAGE CAN MAKE THIS FIRE.** The word boundary
     and the `(?!ity)` lookahead each block "Hospitality" on their own (measured), so this
     pins the OUTCOME rather than either mechanism. It would catch a rewrite that dropped
     both, which is the shape the original mistake actually had. */
  const maskedByNoun = servesPatients("Third-Party Hospitality Management", "Member");
  return !maskedByNoun;
})()
  ? ok("'Hospitality' is not read as 'hospital', even for a noun that would otherwise qualify")
  : bad("the care test matches Hospitality — hotel prospects would get patient language");

/* ⚠️⚠️ **SELLING INTO HEALTHCARE IS STILL SELLING.** Nine measured prospects run dental
   support organisations, a marketing platform and a revenue-cycle business; sales language
   is CORRECT for them, and only `customerNoun` tells them apart from a care provider. */
servesPatients("Hospital & Health Systems", "Patient")
  && servesPatients("Senior Living / Continuing Care", "Resident")
  && !servesPatients("Dental Support Organization (DSO)", "Doctor")
  && !servesPatients("Healthcare Marketing Performance & Privacy", "Customer")
  ? ok("care providers match; vendors selling INTO healthcare do not")
  : bad("the care test cannot tell a provider from a healthcare vendor");

const care = profiles.filter((p) => servesPatients(p.industry ?? "", p.customerNoun ?? ""));
care.length >= 15 && care.length < profiles.length
  ? ok(`${care.length} of ${profiles.length} profiles are care-serving`)
  : bad(`care classification looks wrong: ${care.length} of ${profiles.length}`);

console.log("\nThe wording itself\n");

/* ⚠️⚠️ **A NON-CARE PROSPECT GETS TODAY'S LITERALS BACK, CHARACTER FOR CHARACTER.** This is
   what keeps the change scoped: every other vertical's NEXT generation is byte-identical to
   its last. Asserted against the exact strings the scaffolding used before this existed. */
(() => {
  const L = qmLabels("Sales Call", "Window treatments & home services", "Customer");
  const want = {
    opportunities: "Sales Opportunities",
    conversions: "Sales Conversions",
    lostOpportunities: "Calls Needing Review - Lost Sales Opportunities",
    baselineScore: "Baseline Sales Quality Score",
    scorecard: "New Customer Sales Combination Scorecard",
    scorecardAvg: "New Customer Sales Combination Scorecard (Average)",
    fail: "New Customer Sales Fail (Range & Count)",
    nonQualified: "Non-Sales Inquiries",
  };
  const wrong = Object.entries(want).filter(([k, v]) => (L as Record<string, string>)[k] !== v);
  return wrong.length === 0
    ? ok("a non-care prospect's QM labels are byte-identical to the old literals")
    : bad(`a non-care prospect's QM wording changed: ${wrong.map(([k]) => k).join(", ")}`);
})();

/* ⚠️ AND THE CARE FORM IS BUILT FROM THE PROSPECT'S OWN CANONICAL TERM, not a word invented
   in careVocab.ts — "New Patient Call" is already generated per prospect. */
(() => {
  const L = qmLabels("New Patient Call", "Hospital & Health Systems", "Patient");
  return L.opportunities === "New Patient Opportunities"
    && L.scorecard === "New Patient Combination Scorecard"
    && !Object.values(L).some((v) => SALES.test(v))
    ? ok("a care prospect's QM labels come from its own qualifiedCallTerm, with no sales words")
    : bad(`care QM labels are wrong: ${JSON.stringify(L)}`);
})();

/* ⚠️ A term that is not a "… Call" is used whole rather than mangled. */
qmLabels("Residency Inquiry", "Senior living communities", "Resident").opportunities === "Residency Inquiry Opportunities"
  ? ok("a non-Call canonical term is used whole")
  : bad("the qualifier mangles a term that does not end in 'Call'");

console.log("\nThe agents\n");

/* ⚠️⚠️ **THE HEADLINE CASE: a hospital's agent introducing itself as a sales assistant.**
   Read out of the REAL built prompt rather than grepped, for every profile on disk. */
(() => {
  let careLeaks = 0, changedOthers = 0; const names: string[] = [];
  for (const p of profiles) {
    const isCare = servesPatients(p.industry ?? "", p.customerNoun ?? "");
    const sms = smsSystemPromptForAudit(buildSmsBrain(p, p.reports.agentConfig!));
    const id = sms.split("\n").find((l) => /^You are the SMS/.test(l)) ?? "";
    if (isCare) { if (SALES.test(id)) { careLeaks++; if (names.length < 3) names.push(p.customerName); } }
    else if (!/SMS sales assistant/.test(id)) { changedOthers++; if (names.length < 3) names.push(p.customerName); }
  }
  careLeaks === 0
    ? ok("no care prospect's agent calls itself a sales assistant")
    : bad(`${careLeaks} care prospect(s) still say "sales assistant": ${names.join(", ")}`);
  changedOthers === 0
    ? ok("every other prospect's identity line is unchanged")
    : bad(`${changedOthers} non-care prospect(s) changed: ${names.join(", ")}`);
})();

/* ⚠️ THE VOICE PROMPT'S OWN "you do NOT sell", which read oddly for a hospital whose agent
   was never selling. The JOB is identical in both branches — only the wording moves. */
(() => {
  const p = care[0];
  if (!p) return bad("no care profile to check the voice prompt against");
  const spec = voiceSpecFor(p);
  if (!spec) return bad(`no voice spec derived for ${p.customerName}`);
  const v = __buildVoiceSystemForTest({
    customerName: p.customerName, industry: p.industry, customerNoun: p.customerNoun,
    voiceRules: spec.rules, voiceSteps: spec.informSteps,
  } as never);
  !/you do NOT sell/.test(v) && /ROUTE them to the right team/.test(v)
    ? ok("a care prospect's voice agent does not talk about selling, and still routes")
    : bad("the voice prompt still tells a healthcare agent it does not sell");
})();

console.log("\nScope: FUTURE prospects only\n");

/* ⚠️⚠️ **THE EXPLICIT SCOPE DECISION, PINNED. "only future prospects that are healthcare".**
   The QM wording is baked into each profile's JSON at GENERATION time, so changing the
   scaffolding changes what the next prospect is born with and leaves every saved demo
   exactly as it is. A read-time transform over stored profiles would quietly widen that to
   every demo on the platform, so this check fails if one appears. */
(() => {
  const readTime = ["src/data/ProfileContext.tsx", "src/data/agentDefaults.ts", "src/data/marketingSources.ts"]
    .filter((f) => fs.existsSync(f) && /careVocab|qmLabels/.test(code(f)));
  return readTime.length === 0
    ? ok("no read-time transform rewrites a saved demo's wording")
    : bad(`careVocab reached a read-time path, which would change saved demos: ${readTime.join(", ")}`);
})();

/* ⚠️ AND THE SCAFFOLDING REALLY USES THE LABELS — a literal left behind would mean a future
   healthcare prospect is still born saying "Sales". */
(() => {
  const core = code("engine/core.ts");
  const leftovers = ['"Sales Opportunities"', '"Sales Conversions"', '"Baseline Sales Quality Score"',
    '"New Customer Sales Combination Scorecard"', '"Non-Sales Inquiries"']
    .filter((lit) => core.includes(lit));
  return leftovers.length === 0 && /composeQm\(g, sc, L\)/.test(core)
    ? ok("the QM scaffolding builds every title from the vertical's labels")
    : bad(`a hardcoded sales title is still in the generator: ${leftovers.join(", ") || "composeQm not wired"}`);
})();

/* ⚠️ THE STORED DEMOS ARE UNTOUCHED, asserted rather than assumed: they still carry the old
   wording, which is exactly what "future prospects only" means. */
(() => {
  const withOld = profiles.filter((p) => /Sales Opportunities/.test(JSON.stringify(p.reports?.qualityManagement ?? {})));
  return withOld.length > 0
    ? ok(`${withOld.length} saved demos keep their original wording — nothing was migrated`)
    : bad("saved demos were rewritten — the ask was future prospects only");
})();

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll healthcare-language checks passed\n");
process.exit(fail ? 1 : 0);
