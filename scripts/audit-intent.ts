/* =============================================================================
   audit-intent — the voice and SMS workflows fit the prospect's industry
   -----------------------------------------------------------------------------
   Asked for 10/14/2026: a healthcare prospect's workflows are health-related, not sales, and
   every top category (health, auto, home services, hotels, insurance…) is tailored to what its
   callers actually want, in the workflow, both drawers and both agents.
   Runs over every profile on disk and BUILDS the trees, drawers and prompts rather than
   grepping, so a check fails on behaviour, not on wording.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { CustomerProfile } from "../src/data/schema";
import { intentKindOf, intentCopyFor, INTENT_KINDS } from "../src/data/prospectIntent";
import { builtInWorkflowBase } from "../src/data/workflowBase";
import { deriveUseCases, repairSupportUseCases } from "../src/data/voiceUseCases";
import { smsConfigFor, effectiveSmsConfig } from "../src/data/smsTemplate";
import { voiceSpecFor } from "../src/data/voiceAgentSpec";
import { buildSmsBrain } from "../src/data/smsBrain";
import { smsSystemPromptForAudit, __buildVoiceSystemForTest } from "../engine/chat";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };

const dirs = ["src/data/generated", "engine/event-seeds", ".data/demos"];
const profiles: CustomerProfile[] = [];
const seen = new Set<string>();
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      const p = CustomerProfile.parse(raw.profile ?? raw);
      if (seen.has(p.customerName)) continue;
      seen.add(p.customerName);
      profiles.push(p);
    } catch { /* not a profile */ }
  }
}

console.log("\nClassification\n");
profiles.length >= 15 ? ok(`${profiles.length} profiles to check`) : bad(`only ${profiles.length} profiles found`);
const by = (name: string) => profiles.find((p) => p.customerName === name);
const expect: [string, string][] = [
  ["Baptist Health South Florida", "care"], ["Orlando Health", "care"], ["Key-Whitman Eye Center", "care"],
  ["AutoNation", "autoSales"], ["Roto-Rooter Plumbing & Water Cleanup", "homeService"], ["Aptive", "homeService"],
  ["Marriott", "hospitality"], ["Goosehead Insurance", "insurance"], ["Comfort Keepers", "seniorCare"],
  ["Continuing Life", "seniorCare"], ["National Van Lines", "moving"], ["Mattress Firm", "retail"],
  ["Vector Security", "security"],
];
const wrong = expect.filter(([n, k]) => by(n) && intentKindOf(by(n)!) !== k);
wrong.length === 0
  ? ok(`${expect.filter(([n]) => by(n)).length} known prospects classify to their industry`)
  : bad(`misclassified: ${wrong.map(([n, k]) => `${n} (want ${k}, got ${intentKindOf(by(n)!)})`).join(", ")}`);
/* The traps that bit while building it: "hospital" is a prefix of "hospitality", a reverse
   mortgage lender says "retirement", a dental support org sells to DOCTORS. */
const traps: [object, string][] = [
  [{ industry: "Experiential Hospitality, Hotels & Restaurants", customerNoun: "Guest" }, "hospitality"],
  [{ industry: "Reverse mortgage lending (retirement home-equity finance)", customerNoun: "Borrower" }, "financial"],
  [{ industry: "Dental Support Organization (DSO)", customerNoun: "Doctor" }, "b2b"],
  [{ industry: "In-home senior care", customerNoun: "Client" }, "seniorCare"],
  [{ industry: "Value-based senior primary care", customerNoun: "Patient" }, "care"],
  [{ industry: "Automotive aftermarket tire and wheel retail", customerNoun: "Customer" }, "autoService"],
  [{ industry: "Hospital & Health Systems", customerNoun: "Patient", intentKind: "b2b" }, "b2b"],
];
const trapWrong = traps.filter(([f, k]) => intentKindOf(f) !== k);
trapWrong.length === 0 ? ok("the classifier traps hold, and a generated intentKind wins")
  : bad(`trap misclassified: ${trapWrong.map(([f, k]) => `${JSON.stringify(f)} want ${k} got ${intentKindOf(f)}`).join("; ")}`);
INTENT_KINDS.every((k) => intentCopyFor({ customerName: "X", intentKind: k }).kind === k)
  ? ok(`every one of the ${INTENT_KINDS.length} kinds has copy`) : bad("a kind has no copy");

console.log("\nA care prospect's workflows are not sales\n");
const SALES_WORDS = /\b(sales assistant|quote|upgrade|add or upgrade|starting .+ service|comparing options|ready to book now|purchase|buying|discount)\b/i;
const care = profiles.filter((p) => intentKindOf(p) === "care");
care.length >= 3 ? ok(`${care.length} care prospects`) : bad("fewer than 3 care prospects to check");
const leaks: string[] = [];
for (const p of care) {
  for (const sms of [true, false]) {
    const t = builtInWorkflowBase(p, sms) as { branches: { subtitle?: string; leaves?: { paths?: { title?: string }[] }[] }[]; sms?: ReturnType<typeof smsConfigFor> };
    const txt = [
      ...t.branches.map((b) => b.subtitle ?? ""),
      ...t.branches.flatMap((b) => (b.leaves ?? []).flatMap((l) => (l.paths ?? []).map((x) => x.title ?? ""))),
    ].join(" | ");
    if (SALES_WORDS.test(txt)) leaks.push(`${p.customerName} ${sms ? "SMS" : "voice"}: ${txt.match(SALES_WORDS)![0]}`);
  }
  const cfg = smsConfigFor(p);
  const drawer = [cfg.intents.sales.looksLike, cfg.intents.support.looksLike, cfg.qualify.support.question].join(" ");
  if (SALES_WORDS.test(drawer)) leaks.push(`${p.customerName} SMS drawer: ${drawer.match(SALES_WORDS)![0]}`);
}
leaks.length === 0 ? ok("no sales words in any care workflow's boxes or drawers") : bad(`sales words on care workflows: ${leaks.slice(0, 4).join("; ")}`);

const careVoice = care.map((p) => voiceSpecFor(p)).filter(Boolean);
careVoice.every((s) => s!.rules.some((r) => /911/.test(r)) && s!.rules.some((r) => /medical advice/i.test(r)))
  ? ok("every care voice agent sends emergencies to 911 and gives no medical advice")
  : bad("a care voice agent is missing the emergency or no-medical-advice rule");
const careSms = care.map((p) => smsSystemPromptForAudit(buildSmsBrain(p, p.reports.agentConfig!)));
careSms.every((s) => /911/.test(s) && !/SMS sales assistant/.test(s) && /never selling/i.test(s))
  ? ok("every care SMS agent is told it never sells and to send emergencies to 911")
  : bad("a care SMS agent prompt still sells or lacks the emergency rule");

console.log("\nEvery industry gets its own branches and desks\n");
const tailored = profiles.filter((p) => intentKindOf(p) !== "general");
const funnel = tailored.filter((p) => {
  const t = deriveUseCases(p).sales.map((u) => u.title);
  return t.includes("Ready to book now") || t.includes("Comparing options");
});
funnel.length === 0 ? ok(`no tailored prospect (${tailored.length}) keeps the generic shopping funnel`)
  : bad(`still the generic funnel: ${funnel.slice(0, 4).map((p) => p.customerName).join(", ")}`);
const kinds = new Set(tailored.map((p) => deriveUseCases(p).sales.map((u) => u.title).join("|")));
kinds.size >= 8 ? ok(`${kinds.size} distinct sets of new-caller branches across industries`) : bad(`only ${kinds.size} distinct branch sets`);
const billingMisroute = profiles.filter((p) => {
  const s = deriveUseCases(p).support;
  return s.filter((u) => !/billing/i.test(u.title)).some((u) => /billing|insurance verification/i.test(u.route ?? ""));
});
billingMisroute.length === 0 ? ok("no non-billing support case is routed to a billing desk")
  : bad(`support case routed to billing: ${billingMisroute.slice(0, 4).map((p) => p.customerName).join(", ")}`);
const newDeskMisroute = profiles.filter((p) => {
  const s = deriveUseCases(p).support;
  return s.some((u) => /new project|new booking|new patient|new mattress|new bundle/i.test(u.route ?? ""));
});
newDeskMisroute.length === 0 ? ok("no support case is routed to a new-business desk")
  : bad(`support case routed to a new-business desk: ${newDeskMisroute.slice(0, 4).map((p) => p.customerName).join(", ")}`);
const invented = profiles.filter((p) => {
  const q = new Set((p.reports.voiceRoutingDemo?.queues ?? []).map((x) => x.name.trim()));
  if (!q.size) return false;
  return deriveUseCases(p).sales.some((u) => u.route && !q.has(u.route) && !/Group Sales|Fleet Sales|Trade Sales|Care Coordination|Group Health|Key Accounts/.test(u.route));
});
invented.length === 0 ? ok("every new-caller route is one of the prospect's own queues") : bad(`invented route: ${invented.slice(0, 3).map((p) => p.customerName).join(", ")}`);

console.log("\nThe agents behave like the industry\n");
const roleWrong = profiles.filter((p) => {
  const s = smsSystemPromptForAudit(buildSmsBrain(p, p.reports.agentConfig!));
  const role = intentCopyFor(p).role;
  return !/scheduling assistant/.test(s) && !s.includes(`SMS ${role} for`);
});
roleWrong.length === 0 ? ok("every SMS agent introduces itself in its industry's role") : bad(`wrong SMS role: ${roleWrong.slice(0, 3).map((p) => p.customerName).join(", ")}`);
const hotel = by("Marriott");
if (hotel) {
  const s = smsSystemPromptForAudit(buildSmsBrain(hotel, hotel.reports.agentConfig!));
  /reservations assistant/.test(s) && !/sales assistant/.test(s) ? ok("a hotel's SMS agent is a reservations assistant") : bad("the hotel agent is still a sales assistant");
}
const funeral = profiles.find((p) => intentKindOf(p) === "funeral");
if (funeral) {
  const spec = voiceSpecFor(funeral)!;
  const v = __buildVoiceSystemForTest({ customerName: funeral.customerName, industry: funeral.industry, customerNoun: funeral.customerNoun, voiceRules: spec.rules } as never);
  /never selling/i.test(v) && /grieving/i.test(v) ? ok("a funeral home's voice agent never sells and is told the caller may be grieving")
    : bad("the funeral voice agent still reads as sales");
}
/* An industry rule is rendered once, not twice, when the workflow's own rules carry it. */
if (care[0]) {
  const spec = voiceSpecFor(care[0])!;
  const v = __buildVoiceSystemForTest({ customerName: care[0].customerName, industry: care[0].industry, customerNoun: care[0].customerNoun, voiceRules: spec.rules } as never);
  (v.match(/call 911/g) ?? []).length === 1 ? ok("an industry rule the workflow already carries is not repeated") : bad(`the 911 rule appears ${(v.match(/call 911/g) ?? []).length} times`);
}

console.log("\nEmpathy is situational, not a tone setting\n");
{
  const has = (k: string) => intentCopyFor({ customerName: "X", intentKind: k, customerNoun: "Patient" }).agentRules.find((r) => /empathetic/i.test(r));
  ["care", "seniorCare", "legal", "insurance", "homeService"].every((k) => {
    const r = has(k); return r && /only when/i.test(r) && /routine/i.test(r);
  }) ? ok("care, senior care, legal, insurance and home services get a SITUATIONAL empathy rule")
    : bad("an empathy rule is missing, or is not limited to the situations that call for it");
  ["b2b", "general", "telecom", "retail"].every((k) => !has(k))
    ? ok("businesses with no such moments get no empathy rule") : bad("an empathy rule leaked onto a kind that has none");
  const c = care[0];
  if (c) {
    const sms = smsSystemPromptForAudit(buildSmsBrain(c, c.reports.agentConfig!));
    const spec = voiceSpecFor(c)!;
    const v = __buildVoiceSystemForTest({ customerName: c.customerName, industry: c.industry, customerNoun: c.customerNoun, voiceRules: spec.rules } as never);
    /empathetic only when/i.test(sms) && (v.match(/empathetic only when/gi) ?? []).length === 1
      ? ok("the empathy rule reaches both the SMS and the voice prompt, once each")
      : bad("the empathy rule is missing from a prompt or rendered twice");
  }
}

console.log("\nDemos saved before this keep up\n");
const aptive = by("Aptive");
if (aptive) {
  const stale = [
    { title: "Sales Inquiry", subtitle: "Caller wants to book a service appointment and is not an existing customer",
      leaves: [{ title: "All Sales Inquiry Users", paths: [{ title: "Ready to book now" }, { title: "Comparing options" }, { title: "Large or multi-site enquiry" }] }] },
    { title: "Need Support", subtitle: "The consumer is an existing Aptive homeowner reaching out about their current account or service. They may need to reschedule, ask about billing or payments, report a concern, change or cancel their plan, or check on status. They may be messaging from a recognised or unrecognised number.", leaves: [] },
  ];
  const fixed = repairSupportUseCases(stale as never, aptive, { builtIn: true, withRoute: true }) as unknown as typeof stale;
  const titles = fixed[0].leaves[0].paths.map((x) => x.title);
  !titles.includes("Comparing options") && titles.length === 3 ? ok("a stored voice funnel is swapped for the industry's branches") : bad(`stored funnel not repaired: ${titles.join(", ")}`);
  fixed[0].subtitle !== stale[0].subtitle && fixed[1].subtitle !== stale[1].subtitle ? ok("stored retired intent subtitles are swapped") : bad("a stored retired subtitle survived");
  const mine = [{ title: "Sales Inquiry", subtitle: "My own words", leaves: [{ title: "All Sales Inquiry Users", paths: [{ title: "Ready to book now" }, { title: "Something I added" }] }] }];
  repairSupportUseCases(mine as never, aptive, { builtIn: true, withRoute: true }) === (mine as never) ? ok("an SE's own text and branches are left alone (same object)") : bad("the repair rewrote an SE's own edit");
  const cfg = effectiveSmsConfig(aptive, { intents: { sales: { looksLike: "The consumer is a prospective homeowner interested in starting Aptive service, or an existing homeowner who wants to add or upgrade what they already have.\n\nThey are NOT: x", rules: [] }, support: { looksLike: "Mine", rules: [] } } });
  !/add or upgrade/.test(cfg.intents.sales.looksLike) && cfg.intents.support.looksLike === "Mine" ? ok("a stored retired SMS drawer description gives way; an SE's own stays") : bad("stored SMS intent text not repaired correctly");
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll industry-intent checks passed\n");
process.exit(fail ? 1 : 0);
