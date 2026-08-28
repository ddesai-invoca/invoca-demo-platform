/* Checks the Lead RECORD page derivation across every profile on disk: that every link on
   the Leads list opens a page, that the Invoca Captured Attribution section is actually
   filled, that a lead's two product fields describe ONE product, and the cross-screen
   invariant that the Invoca Call Log record it names exists in that tab's own list.
   Run: npx tsx scripts/audit-leaddetail.ts */
import { readFileSync, readdirSync } from "node:fs";
import { salesforceLeads } from "../src/data/salesforceLeads.ts";
import { salesforceLeadDetail, offerFromCall, strongLexical, categoryRows } from "../src/data/salesforceLeadDetail.ts";
import { salesforceCallLog } from "../src/data/salesforceCallLog.ts";
import type { CustomerProfile } from "../src/data/schema.ts";

const dir = "src/data/generated";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const BLANK = new Set(["", "—", "-", "–", "n/a", "N/A"]);
let bad = 0;

/** Every attribution field except the promotion, which is legitimately blank for a
    prospect that runs none — see the note in salesforceLeadDetail.ts. */
const REQUIRED = ["lineOfBusiness", "productOfInterest", "productCategory", "productName",
  "marketingSource", "marketingMedium", "marketingCampaign", "marketingSearchTerms",
  "websiteJourney", "websiteCallingPage"] as const;

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3));

/** ⚠️ ONE PERSON, ONE PRODUCT. Picking the product name off the screen-pops by index gave
    David Chen "apartments by marriott bonvoy" as his Product of Interest and "The
    Ritz-Carlton Las Vegas" as his Product Name, on adjacent rows of the same section. */
function oneProduct(interest: string, name: string): boolean {
  const a = words(interest), b = words(name);
  if (!a.size || !b.size) return true;
  return [...a].some((w) => b.has(w));
}

let blankPromos = 0, callPromos = 0;

for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as CustomerProfile;
  const view = salesforceLeads(p);
  const logNames = new Set(salesforceCallLog(p).records.map((r) => r.name));
  const catRows = categoryRows(p);
  const playbookOffer = String(((p.reports as Record<string, any>).agentConfig?.smsPlaybook?.offer) ?? "").trim();
  const errs: string[] = [];
  const slugs = new Set<string>();

  for (const lead of view.leads) {
    /* ⚠️ EVERY NAME ON THE LIST IS A LINK, so a slug that does not resolve is a dead end
       mid-demo. The screen fails closed, which is right, and this is what stops it. */
    const d = salesforceLeadDetail(p, lead.slug);
    if (!d) { errs.push(`slug does not resolve: ${lead.slug}`); continue; }
    if (slugs.has(lead.slug)) errs.push(`duplicate slug: ${lead.slug} — two rows open one page`);
    slugs.add(lead.slug);

    const a = d.attribution;
    for (const k of REQUIRED) {
      if (BLANK.has(String(a[k] ?? "").trim())) errs.push(`${lead.slug}: ${k} is blank`);
    }
    if (!oneProduct(a.productOfInterest, a.productName)) {
      errs.push(`${lead.slug}: two products for one person — "${a.productOfInterest}" vs "${a.productName}"`);
    }
    /* The record named here must exist in the Invoca Call Log tab's own list — the same
       cross-screen invariant `newestCallLogName` exists for on Seller Home. */
    /* ⚠️ AN UNAMBIGUOUS CATEGORY MUST WIN OVER THE SCREEN-POP'S CAMPAIGN. A screen-pop
       lists two products against one campaign, so with the precedence reversed its second
       product inherits the first one's category — measured, "memory care neighborhood"
       rendered as "Assisted Living" with a Memory Care row in the same list. */
    const lex = strongLexical(catRows, a.productOfInterest || a.productName);
    if (lex && a.productCategory !== lex) {
      errs.push(`${lead.slug}: category "${a.productCategory}" ignores the exact row "${lex}"`);
    }
    if (!logNames.has(d.callLogName)) errs.push(`${lead.slug}: call log record ${d.callLogName} is not in the list`);

    const promo = String(a.productPromotion ?? "").trim();
    if (!promo) {
      blankPromos++;
      /* A prospect whose playbook HAS an offer must never render a blank promotion. */
      if (playbookOffer) errs.push(`${lead.slug}: promotion blank though the playbook has one`);
    } else if (promo !== playbookOffer) {
      callPromos++;
      /* ⚠️ A CALL-DERIVED PROMOTION MUST NAME A VALUE, not describe the agent's behaviour
         and not quote the caller. Both regressions this guards were real: "Agent offered
         specific clinic locations" and "Needs an individual plan near $500/month". */
      if (promo.includes("?")) errs.push(`${lead.slug}: promotion is a question — "${promo}"`);
      if (!/\b(free|complimentary|no[- ]cost|waived|discount|off)\b/i.test(promo)) {
        errs.push(`${lead.slug}: call-derived promotion names no value — "${promo}"`);
      }
    }
  }

  /* Stable across calls, or an SE cannot rehearse against the screen. */
  const first = view.leads[0]?.slug;
  if (first && JSON.stringify(salesforceLeadDetail(p, first)) !== JSON.stringify(salesforceLeadDetail(p, first))) {
    errs.push("NOT STABLE across calls");
  }
  /* Fails closed rather than rendering a plausible page for a lead that does not exist. */
  if (salesforceLeadDetail(p, "no-such-person-xyz") !== null) errs.push("does NOT fail closed on an unknown slug");

  if (errs.length) bad++;
  console.log(`${errs.length ? "FAIL" : "ok  "} ${f.padEnd(44)} ${view.leads.length} leads`);
  errs.slice(0, 6).forEach((e) => console.log(`       - ${e}`));
  if (errs.length > 6) console.log(`       … and ${errs.length - 6} more`);
}

console.log(`\npromotions: ${callPromos} recovered from the call, ${blankPromos} blank (prospects that run none)`);

/* ⚠️ PROVE THE CHECKS BITE. Each of these broke a real build of this screen, so a check
   that cannot fail is worse than none — three tautological checks are already recorded in
   CLAUDE.md. Every probe below must FAIL, and the good input must PASS. */
const P = (o: unknown) => JSON.parse(JSON.stringify(o)) as CustomerProfile;
const base = JSON.parse(readFileSync(`${dir}/${files[0]}`, "utf8"));
let selfFail = 0;
const expect = (label: string, ok: boolean) => { if (!ok) { console.log(`SELF-TEST FAIL: ${label}`); selfFail++; } };

expect("a real product pair passes", oneProduct("motorized shades", "Motorized Shades"));
const CATS = ["Independent Living", "Assisted Living", "Memory Care", "Skilled Nursing"];
expect("an exact category row is found", strongLexical(CATS, "memory care neighborhood") === "Memory Care");
expect("one shared word is NOT enough", strongLexical(CATS, "respite nursing") === "");
expect("two products FAIL", !oneProduct("apartments by marriott bonvoy", "The Ritz-Carlton Las Vegas"));

/* offerFromCall is the real function, not a copy — so rewording its rules moves this test. */
const withSignals = (metSignals: string[], keyPoints: string[] = []) => {
  const q = P(base) as unknown as Record<string, any>;
  q.reports.callDetail = { ...(q.reports.callDetail ?? {}), metSignals };
  q.reports.conversationIntelligence = { ...(q.reports.conversationIntelligence ?? {}), aiSummary: { keyPoints }, signals: [] };
  return q as CustomerProfile;
};
expect("a genuine free offer is recovered",
  offerFromCall(withSignals(["Agent offered free in-home assessment"])) === "Free in-home assessment");
expect("agent BEHAVIOUR is rejected",
  offerFromCall(withSignals(["Agent offered specific clinic locations"])) === "");
expect("the CALLER'S budget is rejected",
  offerFromCall(withSignals([], ["Needs an individual plan near $500/month with specialist flexibility"])) === "");
expect("a caller question is rejected",
  offerFromCall(withSignals([], ["Do you offer free virtual visits?"])) === "");

if (!selfFail) console.log("self-test: the product and promotion checks reject the four shapes that broke real builds");
bad += selfFail;

console.log(bad ? `\n${bad} failure(s)` : `\nall ${files.length} profiles ok`);
process.exit(bad ? 1 : 0);
