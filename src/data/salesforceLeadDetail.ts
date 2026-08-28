import type { CustomerProfile } from "./schema";
import { salesforceLeads, type SfLead } from "./salesforceLeads";
import { salesforceCallLog } from "./salesforceCallLog";

/* =============================================================================
   The Lead record page — and the Invoca Captured Attribution section is the point
   -----------------------------------------------------------------------------
   Asked for directly: "fill in the following sections as well: 1. Invoca Captured
   Attribution. Don't worry about the Address information and Additional
   Information." So this is a DELIBERATE DEPARTURE from the capture, which has all
   eleven attribution fields blank except Product of Interest — that org simply is
   not passing them. Blank is the honest replica and a terrible demo: the whole
   claim of this screen is that Invoca writes the attribution onto the lead, and an
   empty section says the opposite. The two sections the user waved off stay blank,
   exactly as captured.

   ⚠️ **EVERY FIELD COMES FROM DATA ANOTHER SCREEN ALREADY SHOWS**, so a prospect
   who cross-checks finds the same values rather than a second set:

     Line of Business       `networkName` less "Invoca for " — the vertical itself
     Product of Interest    the lead's own product (from the list)
     Product Category       a "Conversions by Product Category" row
     Product Name           the screen-pop's own product, in its proper case
     Product Promotion      `agentConfig.smsPlaybook.offer`
     Marketing Source       ┐
     Marketing Medium       │ ONE `digitalInsights` row, taken WHOLE
     Marketing Campaign     │
     Marketing Search Terms ┘
     Website Journey        that row's `websiteJourney`
     Website Calling Page   that row's landing page URL

   ⚠️ **THE ROW IS TAKEN WHOLE, NOT FIELD BY FIELD.** Cycling source, medium and
   campaign independently is what produced "Medium: Bing, Source: Paid Search" in
   the Details Report — one coherent row and one contradictory row out of the same
   code, and a marketer reads that instantly. `InteractionRow` already holds a
   coherent tuple per interaction, so the whole row goes to one lead.
   ============================================================================= */

export interface SfLeadAttribution {
  lineOfBusiness: string;
  productOfInterest: string;
  productCategory: string;
  productName: string;
  productPromotion: string;
  marketingSource: string;
  marketingMedium: string;
  marketingCampaign: string;
  marketingSearchTerms: string;
  websiteJourney: string;
  websiteCallingPage: string;
}

export interface SfLeadDetail {
  lead: SfLead;
  /** 1-based position in the list, which is what picks this lead's attribution row. */
  index: number;
  attribution: SfLeadAttribution;
  /** The Invoca Call Log record related to this lead. */
  callLogName: string;
  owner: string;
  createdAt: string;
  modifiedAt: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const WORD = /[a-z0-9]+/g;
const GENERIC = new Set(["the", "and", "of", "for", "with", "service", "services", "hotel", "hotels"]);
function significant(s: string): string[] {
  return (s.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 3 && !GENERIC.has(w));
}

/* ⚠️⚠️ THE CATEGORY COMES FROM THE SCREEN-POP THAT SUPPLIED THE PRODUCT, and word overlap
   alone put a CARDIAC CATHETERIZATION under "Cancer Institute" on Orlando Health — a
   contradiction two rows apart in the same section, and exactly the kind a prospect reads
   straight off the screen. Overlap could not see it: the right row is "Heart & Vascular
   Institute", and "cardiac" is not "heart".

   The profile already records the answer, twice, on the very object the lead's product came
   from — `voiceScreenpop.campaign` is "Heart & Vascular Institute, Winter Park Acquisition"
   and its `callingWebpage` is "/services/heart-vascular-institute", beside
   `products: "Cardiac Catheterization, Diagnostic Imaging"`. So the campaign's FIRST SEGMENT
   is that caller's product category, and it is a real `Conversions by Product Category` row.
   Same principle as taking a `digitalInsights` row WHOLE: read the coherent tuple the
   generator already produced rather than re-deriving one field of it by keyword. */
function categoryFromScreenpop(profile: CustomerProfile, product: string, rows: string[]): string {
  const r = profile.reports as Record<string, any>;
  const want = product.trim().toLowerCase();
  if (!want) return "";
  for (const sp of [r.voiceScreenpop, r.smsScreenpop]) {
    const listed = String(sp?.products ?? "").split(",").map((x: string) => x.trim().toLowerCase());
    if (!listed.includes(want)) continue;
    /* The first segment is the category; the rest is the campaign's own targeting
       ("Winter Park Acquisition"), which is NOT a product category. */
    const seg = String(sp?.campaign ?? "").split(",")[0]?.trim() ?? "";
    if (!seg) continue;
    const exact = rows.find((x) => x.trim().toLowerCase() === seg.toLowerCase());
    if (exact) return exact;
    /* TWO shared words minimum, the threshold the Google Ads ad-group note settled after
       one word matched "continuing CARE" to "Memory Care" over a better row. */
    const segWords = new Set(significant(seg));
    const near = rows.find((x) => significant(x).filter((w) => segWords.has(w)).length >= 2);
    if (near) return near;
  }
  return "";
}

/* ⚠️ A STRONG LEXICAL MATCH BEATS THE CAMPAIGN, because a screen-pop lists TWO products
   against ONE campaign, so its second product inherits the first one's category. Measured:
   "memory care neighborhood" came out as "Assisted Living" while a **Memory Care** row sat
   right there in the same list. TWO shared words is the threshold — the same one the Google
   Ads ad-group note settled on, and one word alone is what matched "continuing CARE" to
   "Memory Care" over a better row. */
export function strongLexical(rows: string[], product: string): string {
  const want = new Set(significant(product));
  if (want.size < 2) return "";
  return rows.find((r) => significant(r).filter((w) => want.has(w)).length >= 2) ?? "";
}

/** The category row that shares the most significant words with the product. */
function categoryFor(rows: string[], product: string, index: number): string {
  if (!rows.length) return "";
  const want = new Set(significant(product));
  let best = "", score = 0;
  for (const r of rows) {
    const n = significant(r).filter((w) => want.has(w)).length;
    if (n > score) { score = n; best = r; }
  }
  /* No shared word is the common case — a product line and a reporting category are
     named differently — so fall back to a stable pick rather than forcing a match
     the way the Google Ads ad-group note warns about. */
  return score ? best : rows[index % rows.length];
}

/** How many of a row's attribution fields carry a real value rather than a "—". */
function filled(row: { marketingSource?: string; marketingMedium?: string; marketingCampaign?: string;
                       marketingSearchTerm?: string; landingPageUrl?: string; websiteJourney?: string }): number {
  const real = (v: unknown) => { const s = String(v ?? "").trim(); return s !== "" && s !== "—" && s !== "-" ? 1 : 0; };
  return real(row.marketingSource) + real(row.marketingMedium) + real(row.marketingCampaign)
    + real(row.marketingSearchTerm) + real(row.landingPageUrl) + real(row.websiteJourney);
}

/* ⚠️ THE PROMOTION FALLS BACK TO THE OFFER THE AGENT ACTUALLY MADE ON THE CALL, and the
   reason is measured: `agentConfig.smsPlaybook.offer` is EMPTY on 5 of the 14 profiles on
   disk — every healthcare prospect plus Comfort Keepers — so a section the user asked to
   see "filled in" opened with a blank Product Promotion on 50 of 140 lead pages.

   Minting one would be fabricating a healthcare promotion, which is the same refusal
   `serviceZips` and the rejected ZIP3 guess already make. But two of those five DO name a
   real offer in their own call data — Comfort Keepers' "Agent offered free in-home
   assessment" and Orlando Health's "MyChart portal enrollment offered at no cost" — and a
   promotion the agent made on the recorded call is exactly what an attribution field should
   carry. So it is RECOVERED, not invented, and stays blank for the three prospects that
   genuinely run no promotion.

   ⚠️ **`qaPairs` IS DELIBERATELY NOT A SOURCE.** Those are questions the CALLER asks, and
   they are full of the word "offer" — "Do you offer virtual visits?", "Do you offer
   physical therapy?" — so including them would print a caller's question as the prospect's
   promotion. Same trap as `/how does .* work/` matching the upsell concept, and as "in-home
   senior care" containing "car". Anything ending in "?" is rejected outright as a second
   guard. */
/* ⚠️ THE VERB "offered" IS NOT ENOUGH, AND A BARE `\boffered\b` BRANCH RENDERED A REAL
   DEFECT: Denver Health's met signal "Agent offered specific clinic locations" came out as
   the Product Promotion "Specific clinic locations", which is the agent naming clinics, not
   a promotion. A promotion needs a VALUE word — something given up — so that is what is
   matched, and "offered" survives only as a phrase to strip during normalisation. Third
   time in this repo a keyword has been too loose in exactly this way.
   ⚠️ AND A BARE DOLLAR AMOUNT IS NOT A DISCOUNT EITHER — `\$\d` matched Health Spring's
   key point "Needs an individual plan near $500/month", i.e. the CALLER'S OWN BUDGET,
   rendered as the prospect's promotion. A price someone states is not a value given up.
   Every real "$300 Instant Gift" case arrives through the playbook offer instead. */
const OFFER_SHAPE = /\b(free|complimentary|no[- ]cost|waived|discount|% off|percent off)\b/i;

/** Exported so the audit tests THIS function rather than a copy of its rules, the same
    reason `CONCEPT_HARD_PHRASES` is exported from `signalTiers.ts`. */
export function offerFromCall(profile: CustomerProfile): string {
  const r = profile.reports as Record<string, any>;
  /* A FIXED source order, so a rehearsal renders the same promotion twice. */
  const candidates: string[] = [
    ...(r.callDetail?.metSignals ?? []),
    ...(r.conversationIntelligence?.aiSummary?.keyPoints ?? []),
    ...((r.conversationIntelligence?.signals ?? []).map((s: { name?: string }) => s?.name ?? "")),
  ];
  for (const raw of candidates) {
    const t = String(raw ?? "").trim();
    if (!t || t.includes("?") || !OFFER_SHAPE.test(t)) continue;
    /* "Agent offered free in-home assessment" -> "Free in-home assessment", and
       "MyChart portal enrollment offered at no cost" -> "MyChart portal enrollment at no
       cost" — the field names a promotion, not the agent's behaviour on the call. */
    let out = t.replace(/^(?:the\s+)?agent\s+offered\s+/i, "")
               .replace(/\s+offered\b(?=\s+at\b|$)/i, "")
               .trim();
    if (!out) continue;
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  return "";
}

/** "Invoca for Home Services" -> "Home Services". */
function lineOfBusiness(profile: CustomerProfile): string {
  const n = String(profile.networkName ?? "").replace(/^invoca\s+for\s+/i, "").trim();
  return n || String(profile.industry ?? "");
}

/** The prospect's own "Conversions by Product Category" rows. Exported so the audit reads
    the SAME list the screen does rather than re-deriving it and drifting. */
export function categoryRows(profile: CustomerProfile): string[] {
  return (profile.reports.marketingDashboard?.breakdowns ?? [])
    .find((b) => /product category/i.test(b.title ?? ""))?.rows?.map((x) => x.name) ?? [];
}

export function salesforceLeadDetail(profile: CustomerProfile, slug: string): SfLeadDetail | null {
  const view = salesforceLeads(profile);
  const i = view.leads.findIndex((l) => l.slug === slug);
  if (i === -1) return null;
  const lead = view.leads[i];
  const r = profile.reports;

  /* ⚠️ FULLER ROWS FIRST, and the row is still taken WHOLE. Assigning strictly by
     index gave the FIRST lead — the one an SE clicks in the demo — a social-media
     interaction whose Marketing Search Term is the em-dash placeholder, so a section
     asked to be "filled in" opened with a blank. Ordering by how many of the six
     fields carry a value keeps every row internally coherent (a social row genuinely
     has no search term) while putting the complete ones where they will be seen. */
  const rows = [...(r.digitalInsights?.rows ?? [])].sort((a, b) => filled(b) - filled(a));
  const row = rows.length ? rows[i % rows.length] : undefined;

  const catRows = categoryRows(profile);

  /* ⚠️ THE LEAD CARRIES ITS OWN PROPER-CASE PRODUCT. Picking one off the screen-pops
     by index instead gave David Chen "apartments by marriott bonvoy" as his Product
     of Interest and "The Ritz-Carlton Las Vegas" as his Product Name — two products
     for one person, on adjacent rows of the same section. */
  const productName = lead.productName;

  return {
    lead,
    index: i + 1,
    attribution: {
      lineOfBusiness: lineOfBusiness(profile),
      productOfInterest: lead.product,
      /* ⚠️ ORDER MATTERS AND EACH STEP EARNED ITS PLACE: an unambiguous lexical match
         first, then the screen-pop's own campaign (which is the real attribution evidence
         where the words differ, e.g. cardiac -> Heart & Vascular), then the looser
         single-word overlap and finally a stable index pick. */
      productCategory: strongLexical(catRows, lead.product || productName)
        || categoryFromScreenpop(profile, lead.product || productName, catRows)
        || categoryFor(catRows, lead.product || productName, i),
      productName,
      productPromotion: (r.agentConfig?.smsPlaybook?.offer || "").trim() || offerFromCall(profile),
      marketingSource: row?.marketingSource ?? "",
      marketingMedium: row?.marketingMedium ?? "",
      marketingCampaign: row?.marketingCampaign ?? "",
      marketingSearchTerms: row?.marketingSearchTerm ?? "",
      websiteJourney: row?.websiteJourney ?? "",
      websiteCallingPage: row?.landingPageUrl ?? "",
    },
    /* One call log record per lead, off the object that owns that numbering — so the
       record named here exists in the Invoca Call Log tab's own list. */
    callLogName: (() => {
      const recs = salesforceCallLog(profile).records;
      return recs[hash(`calllog:${lead.slug}`) % recs.length].name;
    })(),
    /* The lead's owner is the SE's own Salesforce user, as in the capture — that org's
       records are owned by the person demoing, not by anyone at the prospect. */
    owner: "Bill Hyatt",
    createdAt: lead.created,
    modifiedAt: lead.created,
  };
}
