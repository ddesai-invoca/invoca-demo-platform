import type { CustomerProfile } from "./schema";
import { salesforceCallLog } from "./salesforceCallLog";
import { salesforceLeads, type SfLead } from "./salesforceLeads";
import { salesforceLeadDetail } from "./salesforceLeadDetail";

/* =============================================================================
   The Invoca Call Log RECORD page — what the INVOCA-… link opens
   -----------------------------------------------------------------------------
   Built off `reference/salesforce/call-log-detail-v1.html`. This is the Invoca
   package's own custom object opened as a record: the one screen in the demo that
   shows, field by field, exactly what the integration WRITES INTO Salesforce.

   ⚠️⚠️ THREE SECTIONS ARE DELIBERATELY NOT THE CAPTURE'S, asked for directly:
   "reduce the number of fields in the Enriched Caller Data … for signals the left
   column is the name and the right column is a check or not if it existed in the
   call … Custom Data: reduce the number of fields and also left column is the name
   of the data and the right column is the value of the name."

   The capture stores those two sections as PAIRED GENERIC FIELDS — a field called
   `Customer Boolean Name 0` whose value is "Buying Intent (Industry)", beside a
   field called `Customer Boolean Value 0` whose value is True — because they are
   generic columns on a custom object, and Salesforce has no way to label them with
   the thing they hold. So the real page spends 20 rows to show 10 signals, and 50
   rows to show 25 custom values, with the actual names buried in the VALUE column.
   Collapsing each pair into one row is what those rows MEAN, and it is the whole
   difference between a screen an SE can point at and a wall of "Customer Boolean
   Name 7".

   ⚠️ EVERYTHING IS DERIVED FROM THE PROFILE, and where a lead's page links to this
   record the two screens read the SAME attribution — `salesforceLeadDetail` is the
   one source for it, so the utm values on this page and the Marketing Source on
   that one cannot disagree.
   ============================================================================= */

/** One name/value row. `value` may be "" — the record page renders empty fields. */
export interface SfField { name: string; value: string }

/** One signal row: the name on the left, a check on the right when it fired. */
export interface SfSignalRow { name: string; fired: boolean }

export interface SfCallLogDetail {
  name: string;
  /** The lead whose record page links here, when there is one. */
  lead: { name: string; slug: string } | null;
  /** Account / Lead / Contact / Opportunity / Case — the unlabelled top section. */
  relations: SfField[];
  callData: SfField[];
  callerData: SfField[];
  enriched: SfField[];
  campaign: SfField[];
  signals: SfSignalRow[];
  customData: SfField[];
  owner: string;
  createdAt: string;
  modifiedAt: string;
}

/* ⚠️⚠️ THE utm VALUES COME OUT OF THE LANDING PAGE URL, NOT OFF THE CHANNEL LABELS, and
   the first version contradicted itself ON SCREEN: it printed `utm_source = Paid Search`
   two rows above a `calling_page` reading `…?utm_source=google&utm_medium=cpc…`. Marketing
   Source is a CHANNEL ("Paid Search"); utm_source is the PARAMETER that was on the link
   ("google"). A prospect reading one row against the next catches that immediately, which
   is the same reason the Details Report takes a whole attribution row rather than cycling
   its fields. Falls back to the channel labels for a row whose URL carries no utm params
   (an organic or direct visit), since then there is no parameter to disagree with. */
function utmFrom(url: string, key: string): string {
  const m = new RegExp(`[?&]${key}=([^&#\\s]+)`, "i").exec(url ?? "");
  return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** `len` hex digits, upper case, derived from a seed. */
function hex(seed: string, len: number): string {
  let out = "";
  for (let i = 0; out.length < len; i++) out += hash(`${seed}:${i}`).toString(16).toUpperCase();
  return out.slice(0, len);
}

function digits(seed: string, len: number): string {
  return String(hash(seed) % 10 ** len).padStart(len, "0");
}

/* ⚠️ THE 555 EXCHANGE, like every other number in this demo, so a promo number on a
   projector cannot ring a real business. The same care the Google Search ad's call
   extension and the filler leads take. */
function promoNumber(seed: string): string {
  const tollFree = ["877", "888", "866", "855"][hash(`tf:${seed}`) % 4];
  return `${tollFree}-555-${digits(`pn:${seed}`, 4)}`;
}

/** "8/22/2026, 2:17 PM" — the capture's own format. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? "AM" : "PM";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

/* ⚠️ CARRIER NAMES ARE GENERIC ON PURPOSE. The capture's own reads "Hd Carrier Llc",
   and naming a real telco as this caller's carrier would be inventing a fact about a
   real company for no demo value. Same reasoning as the invented competitors on the
   Google Search screen carrying no real business's name. */
const CARRIERS = ["Hd Carrier Llc", "Pacific Line Services Llc", "Northbridge Telecom Llc",
  "Cascade Voice Networks Llc", "Meridian Wireless Llc"];

/**
 * The record's own call. Where a lead's page links here, that lead IS the call, so
 * the two pages agree; otherwise the details are derived from the record's number.
 */
function linkedLead(profile: CustomerProfile, name: string): SfLead | null {
  for (const l of salesforceLeads(profile).leads) {
    if (salesforceLeadDetail(profile, l.slug)?.callLogName === name) return l;
  }
  return null;
}

export function salesforceCallLogRecord(profile: CustomerProfile, name: string): SfCallLogDetail | null {
  /* ⚠️ FAILS CLOSED on a record this prospect's org does not have, the same rule the
     lead page and the created-workflow route follow. A plausible record page for an
     id that is not in the Call Log tab's list is worse than a refusal. */
  const list = salesforceCallLog(profile).records;
  if (!list.some((r) => r.name === name)) return null;

  const r = profile.reports as Record<string, any>;
  const seed = `clr:${profile.id}:${name}`;
  const lead = linkedLead(profile, name);
  const detail = lead ? salesforceLeadDetail(profile, lead.slug) : null;
  const a = detail?.attribution;
  const vs = r.voiceScreenpop ?? {};
  const cd = r.callDetail ?? {};

  /* The call's own clock: the lead's created date where there is one, so the record
     and the lead agree, else derived from the record number. */
  const when = (() => {
    const t = Date.parse(lead?.created ?? "");
    return Number.isNaN(t) ? Date.now() - (hash(`when:${seed}`) % 1_209_600_000) : t;
  })();

  /* Duration in seconds, as the record page shows it (the capture reads 329 / 327).
     Connect duration is always slightly under: the ring time is not connected time. */
  const duration = 90 + (hash(`dur:${seed}`) % 420);
  const connect = duration - (1 + (hash(`con:${seed}`) % 4));

  const city = String(vs.city ?? "");
  const state = String(vs.state ?? "");
  const zip = String(vs.zip ?? "");
  const callerPhone = lead?.phone ?? String(vs.callerPhone ?? "");
  const e164 = `+1${callerPhone.replace(/\D/g, "")}`;
  const areaCode = callerPhone.match(/\((\d{3})\)/)?.[1] ?? callerPhone.slice(0, 3);
  const transactionId = `${hex(`tx:${seed}`, 8)}-${hex(`tx2:${seed}`, 8)}`;
  /* The landing page this call came from — the same URL the lead's page shows. */
  const page = a?.websiteCallingPage ?? "";

  /* ⚠️ THE 4-AND-12 SHAPE IS THE PLATFORM'S OWN, and it is confirmed three times over:
     this capture's Complete Call ID (C51A-0527ACDF0CF0), `callDetail.callId`
     (0597-627F62F2570D) and the Details Report's row ids. */
  const completeCallId = `${hex(`cc:${seed}`, 4)}-${hex(`cc2:${seed}`, 12)}`;

  /* ⚠️ SMS RECORDS EXIST AND THE CAPTURE IS ONE — its Media Type reads "Mobile: SMS".
     Rendering every record as a voice call would hide the half of the integration that
     writes the SMS agent's conversations into Salesforce. */
  const isSms = hash(`sms:${seed}`) % 4 === 0;

  return {
    name,
    lead: lead ? { name: `${lead.first} ${lead.last}`.trim(), slug: lead.slug } : null,

    /* Only the Lead is populated, exactly as captured: this org converts nothing into
       Accounts or Opportunities, and inventing an Opportunity here would promise a
       pipeline the rest of the demo does not show. */
    relations: [
      { name: "Account", value: "" },
      { name: "Lead", value: lead ? `${lead.first} ${lead.last}`.trim() : "" },
      { name: "Contact", value: "" },
      { name: "Opportunity", value: "" },
      { name: "Case", value: "" },
      { name: "", value: "" },
    ],

    callData: [
      { name: "Transaction ID", value: transactionId },
      { name: "Promo Number", value: promoNumber(seed) },
      { name: "Start Time/Date", value: stamp(when) },
      { name: "Media Type", value: isSms ? "Mobile: SMS" : "Mobile: Voice" },
      /* Call Recording is rendered by the screen as the real PLAY button, not text. */
      { name: "Call Recording", value: "__PLAY__" },
      { name: "Promo Number Description", value: a?.marketingCampaign ?? "" },
      { name: "Key Presses", value: "" },
      { name: "Duration", value: String(duration) },
      { name: "Destination Phone Number", value: `${areaCode}-555-${digits(`dest:${seed}`, 4)}` },
      { name: "Connect Duration", value: String(connect) },
      { name: "Complete Call ID", value: completeCallId },
      { name: "End of Call Reason", value: hash(`eoc:${seed}`) % 2 ? "Destination: Hang-up" : "Caller: Hang-up" },
      { name: "Revenue", value: "" },
      { name: "", value: "" },
    ],

    callerData: [
      { name: "Caller ID", value: callerPhone },
      /* Repeat Caller is a real Invoca field and the Details Report already derives it
         walking forward in time; here it is this record's own flag. */
      { name: "Repeat Caller", value: hash(`rep:${seed}`) % 3 === 0 ? "Yes" : "No" },
      { name: "Caller ID E164", value: e164 },
      { name: "Phone Type", value: isSms ? "Mobile" : ["Landline", "Mobile", "VoIP"][hash(`pt:${seed}`) % 3] },
      { name: "City", value: city },
      { name: "", value: "" },
      { name: "Region", value: state },
      { name: "", value: "" },
    ],

    /* ⚠️ REDUCED FROM THE CAPTURE'S 23 FIELDS TO 8, and WHICH eight is the decision.
       Twenty of the capture's are empty, and the ones dropped are the demographic
       block — Age Range, Gender, Marital Status, Has Children, Education, Household
       Income, Home Market Value, High Net Worth, Occupation. Those are real Invoca
       enrichment fields, and filling them would mean inventing a named caller's
       income and marital status to decorate a demo. What stays is the line
       intelligence an SE actually talks about: who the number belongs to, what kind
       of line it is, and where it is. */
    enriched: [
      /* The capture's own Enriched Display Name reads "San Francisco,ca", i.e. that
         record's enrichment resolved to a place rather than a person. The caller's
         name is what the field is for and what makes the pre-call story land. */
      { name: "Enriched Display Name", value: lead ? `${lead.first} ${lead.last}`.trim() : String(vs.callerName ?? "") },
      { name: "Enriched Carrier", value: CARRIERS[hash(`car:${seed}`) % CARRIERS.length] },
      { name: "Enriched Line Type", value: isSms ? "Mobile" : ["Landline", "Mobile", "VoIP"][hash(`pt:${seed}`) % 3] },
      { name: "Enriched Is Prepaid", value: hash(`pre:${seed}`) % 5 === 0 ? "Yes" : "No" },
      { name: "Enriched City", value: city },
      { name: "Enriched State", value: state },
      { name: "Enriched Zipcode", value: zip },
      { name: "Enriched Country", value: city ? "United States" : "" },
    ],

    campaign: [
      { name: "Advertiser Name", value: profile.customerName },
      { name: "AdWords Campaign", value: /cpc|paid/i.test(a?.marketingMedium ?? "") ? (a?.marketingCampaign ?? "") : "" },
      { name: "Advertiser id from network", value: digits(`adv:${seed}`, 6) },
      { name: "AdWords Ad Group", value: /cpc|paid/i.test(a?.marketingMedium ?? "") ? (a?.productCategory ?? "") : "" },
      { name: "Campaign Name", value: a?.marketingCampaign ?? "" },
      { name: "AdWords Ad", value: "" },
      { name: "Advertiser campaign id from network", value: digits(`cmp:${seed}`, 7) },
      { name: "Keywords", value: /cpc|paid/i.test(a?.marketingMedium ?? "") ? (a?.marketingSearchTerms ?? "") : "" },
      /* Blank as captured: a paid-search call has no publisher. */
      { name: "Publisher Name", value: "" },
      { name: "", value: "" },
      { name: "Publisher ID", value: "" },
      { name: "", value: "" },
    ],

    /* ⚠️ ONE ROW PER SIGNAL, name on the left and a check on the right — asked for.
       The names are the PROSPECT'S OWN, off the call the demo already shows, so the
       rail here and the Call Detail screen's Signals rail cannot disagree. Met ones
       carry the check; the unmet ones are the dashed box the capture draws. */
    signals: (() => {
      const met = (cd.metSignals ?? []).slice(0, 4).map((n: string) => ({ name: n, fired: true }));
      const unmet = (cd.unmetSignals ?? []).slice(0, 6).map((n: string) => ({ name: n, fired: false }));
      return [...met, ...unmet];
    })(),

    /* ⚠️ REDUCED FROM 25 PAIRS TO 11, name on the left and its value on the right —
       asked for. Every one is a key the real integration passes, and every VALUE comes
       from the same attribution row the lead's page shows, so the utm values here and
       the Marketing Source there are the same call. */
    customData: [
      { name: "invoca_caller_language", value: "English" },
      { name: "utm_source", value: utmFrom(page, "utm_source") || (a?.marketingSource ?? "") },
      { name: "utm_medium", value: utmFrom(page, "utm_medium") || (a?.marketingMedium ?? "") },
      { name: "utm_campaign", value: utmFrom(page, "utm_campaign") || (a?.marketingCampaign ?? "") },
      { name: "utm_term", value: a?.marketingSearchTerms ?? "" },
      { name: "calling_page", value: a?.websiteCallingPage ?? "" },
      { name: "productName", value: a?.productName ?? "" },
      { name: "productCategory", value: a?.productCategory ?? "" },
      { name: "invoca_id", value: transactionId },
      { name: "location", value: city },
      { name: "locationRegion", value: state },
    ],

    /* The record is owned by the SE's own Salesforce user, as in both captures — that
       org's records belong to the person demoing, not to anyone at the prospect. */
    owner: "Bill Hyatt",
    createdAt: stamp(when),
    modifiedAt: stamp(when + 3_600_000 * (1 + (hash(`mod:${seed}`) % 12))),
  };
}
