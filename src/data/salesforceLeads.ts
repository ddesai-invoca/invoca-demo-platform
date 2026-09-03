import { leadSlug, liveBookedLead } from "./salesforceLiveLead";
import type { CustomerProfile, VoiceConversation } from "./schema";

/* =============================================================================
   The Leads list — the CRM end of the Invoca integration
   -----------------------------------------------------------------------------
   The Lead Intelligence View is where the demo's story lands: an AI agent talked
   to someone, and the lead shows up in Salesforce carrying SMS Opt In, Product of
   Interest, and an **Invoca Attribution ID**. That last column is the whole point
   of putting this screen in the demo, so it is never blank.

   ⚠️ EVERY LEAD IS SOMEBODY THE PROSPECT'S OWN PROFILE ALREADY NAMES. The capture's
   rows are that org's real people (Bethany Jorgensen, Bill Hyatt) mixed with its
   test rows (John Doe, QA Test, Dana Probe twice) — 13 in all. Copying those 13
   into every prospect's demo would put "QA Test" and a duplicated "Dana Probe" on
   a projector in front of a customer, and inventing 13 fresh names per prospect
   would put people in a CRM list who appear nowhere else in the demo. So the rows
   come from the four places a profile actually names a caller:

     voice screen-pop      the caller the Voice AI agent handled
     SMS screen-pop        the caller the SMS AI agent handled
     voice CI              the evaluated call's own caller record
     SMS CI                the evaluated conversation's own caller record

   That yields two to four leads, and a list that short reads as a broken query on a
   screen built for a scrolling table — so it is **padded to TEN** (asked for
   directly: "have a total of 10 leads instead of 2"). The distinction that keeps
   this honest is WHICH HALF IS WHICH:

     rows 1..k   the prospect's own named callers, newest first, so the SE can point
                 at a row and open that same person's screen-pop or CI transcript
     the rest    demo scaffolding — a name, a 555 number in the prospect's own area
                 code, and one of the prospect's own products

   ⚠️ **THE FILLER CARRIES NO FIGURE, and that is the line.** Every number this repo
   refuses to invent is a MEASUREMENT — a call count, a revenue, a conversion rate,
   something a prospect can check against another screen. A lead row is a contact
   record; the capture's own list is padded with John Doe and QA Test. What must
   still never be typed is the COUNT: "N items" and the Total Leads / No Activity
   tiles are computed from the rows, so the page cannot claim ten over a table of
   four. Same rule as leadForms.ts.

   ⚠️ THE ATTRIBUTION ID IS DERIVED, NOT RANDOM. `Math.random()` would hand the SE
   a different id every reload, which is exactly the kind of thing that gets
   noticed when someone re-opens the tab mid-demo. Each id is a pure function of
   the lead's own identity, in the capture's own `<network>/<promo>/i-<uuid>` shape.
   ============================================================================= */

export interface SfLead {
  /** URL identity, shared by the list row and the record page. */
  slug: string;
  first: string;
  last: string;
  /** "(406) 781-2153", the capture's own formatting. */
  phone: string;
  status: string;
  smsOptIn: string;
  /** Lower-case in the capture ("blinds", "shutters"), and it stays that way. */
  product: string;
  /** ⚠️ THE SAME PRODUCT IN ITS PROPER CASE ("Plantation Shutters"). The Lead record
   *  page shows Product of Interest and Product Name side by side, and deriving the
   *  second one independently gave one lead "apartments by marriott bonvoy" against
   *  "The Ritz-Carlton Las Vegas" — two products for one person, from one function. */
  productName: string;
  /** Blank when the source has no email — two of the capture's rows are blank too. */
  email: string;
  attributionId: string;
  /** "8/27/2026, 1:30 PM". */
  created: string;
  /** Sort key behind `created`. */
  sortKey: number;
}

export interface SfLeadView {
  leads: SfLead[];
  /** "13 items • Sorted by Created Date • Filtered by Created Date, Me, Total Leads" */
  statusLine: string;
  kpis: { label: string; value: number; info: boolean }[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A stable stream of hex digits from one seed, so an id never changes between reloads. */
function hex(seed: string, n: number): string {
  let out = "";
  let i = 0;
  while (out.length < n) { out += hash(`${seed}:${i++}`).toString(16).padStart(8, "0"); }
  return out.slice(0, n);
}

/** The capture's id shape: `2751/2511698647/i-b96a5b9e-877d-42cd-abaa-1f9e6204fcb7`. */
function attributionId(profileId: string, seed: string): string {
  const network = (hash(`net:${profileId}`) % 9000 + 1000).toString();
  const promo = (hash(`promo:${profileId}`) % 9_000_000_000 + 1_000_000_000).toString();
  const u = hex(seed, 32);
  const uuid = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20, 32)}`;
  return `${network}/${promo}/i-${uuid}`;
}

/** "(406) 781-2153" from any of the forms the profile stores ("406-781-2153"). */
function phone(raw: string | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length !== 10 && d.length !== 11) return String(raw ?? "");
  const t = d.length === 11 ? d.slice(1) : d;
  return `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}`;
}

/** "1/15/26 4:12 pm" and "8/16/25 10:55 pm" -> "1/15/2026, 4:12 PM". */
function created(raw: string | undefined, fallbackSeed: string): { text: string; key: number } {
  const m = String(raw ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([ap])m/i);
  if (m) {
    const [, mo, da, yr, hh, mm, ap] = m;
    const year = yr.length === 2 ? 2000 + Number(yr) : Number(yr);
    const h24 = (Number(hh) % 12) + (ap.toLowerCase() === "p" ? 12 : 0);
    return { text: `${Number(mo)}/${Number(da)}/${year}, ${hh}:${mm} ${ap.toUpperCase()}M`,
             key: new Date(year, Number(mo) - 1, Number(da), h24, Number(mm)).getTime() };
  }
  /* No parseable timestamp on this source: order it last rather than invent a date. */
  return { text: "", key: -(hash(fallbackSeed) % 1000) };
}

/** "Motorized Shades, Plantation Shutters" -> ["Motorized Shades", "Plantation Shutters"]. */
function productList(raw: string | undefined): string[] {
  return String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
/** The same list lower-cased, which is the form the capture's own column shows. */
function products(raw: string | undefined): string[] {
  return productList(raw).map((s) => s.toLowerCase());
}

/** Asked for directly. The capture's own list is 13. */
const TARGET_LEADS = 10;

/* Names for the padded rows. Deliberately ordinary and deliberately not anybody's:
   a lead list is the one place on this screen where a recognisable real name would
   be worse than a plain invented one. */
const FIRST_NAMES = ["Alan", "Priya", "Devon", "Renee", "Marcus", "Simone", "Curtis", "Nadia",
  "Grant", "Yvette", "Theo", "Lorna", "Miles", "Bianca", "Roland", "Cara"];
const LAST_NAMES = ["Whitfield", "Okonkwo", "Barrett", "Alvarez", "Lindqvist", "Moreau", "Sandoval",
  "Ferris", "Nakamura", "Delgado", "Rowan", "Castellano", "Bright", "Osei", "Vance", "Holloway"];
const MAIL_DOMAINS = ["gmail.com", "outlook.com", "yahoo.com", "icloud.com"];

/** The capture's "8/27/2026, 1:30 PM". */
function stamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? "AM" : "PM";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}


function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function salesforceLeads(
  profile: CustomerProfile,
  /* ⚠️ OPT-IN AND LAST, so every existing caller and both audits behave exactly as before.
     Pass the prospect's voice captures and a call that BOOKED an appointment becomes the top
     row — which is the whole point: the SE makes the call, opens the Leads tab, and their
     caller is the newest lead. */
  voiceCalls?: VoiceConversation[],
): SfLeadView {
  const r = profile.reports;
  const id = profile.id;

  type Src = { first: string; last: string; phone: string; email: string; product: string;
               productName: string; optIn: string; when: string | undefined; seed: string };
  const sources: Src[] = [];

  const vs = r.voiceScreenpop;
  if (vs?.callerName) {
    const n = splitName(vs.callerName);
    sources.push({ ...n, phone: phone(vs.callerPhone), email: vs.email ?? "", product: products(vs.products)[0] ?? "",
      productName: productList(vs.products)[0] ?? "", optIn: "Yes", when: r.voiceConversationIntelligence?.conversations?.find((c) => c.voiceInfo)?.voiceInfo?.callStartTime,
      seed: `voice:${id}:${vs.callerName}` });
  }

  const ss = r.smsScreenpop;
  if (ss?.callerName) {
    const n = splitName(ss.callerName);
    const info = r.smsConversationIntelligence?.conversations?.find((c) => c.smsInfo)?.smsInfo;
    sources.push({ ...n, phone: phone(ss.callerPhone), email: ss.email ?? "", product: products(ss.products)[0] ?? "",
      productName: productList(ss.products)[0] ?? "", optIn: info?.smsOptIn || "Yes", when: info?.smsStartTime, seed: `sms:${id}:${ss.callerName}` });
  }

  const vi = r.voiceConversationIntelligence?.conversations?.find((c) => c.voiceInfo)?.voiceInfo;
  if (vi?.firstName) {
    sources.push({ first: vi.firstName, last: vi.lastName ?? "", phone: phone(vi.callerId), email: "",
      product: products(vs?.products)[1] ?? products(vs?.products)[0] ?? "",
      productName: productList(vs?.products)[1] ?? productList(vs?.products)[0] ?? "", optIn: "Yes",
      when: vi.callStartTime, seed: `voiceinfo:${id}:${vi.firstName}${vi.lastName ?? ""}` });
  }

  const si = r.smsConversationIntelligence?.conversations?.find((c) => c.smsInfo)?.smsInfo;
  if (si?.firstName) {
    sources.push({ first: si.firstName, last: si.lastName ?? "", phone: phone(si.callerId), email: "",
      product: products(ss?.products)[1] ?? products(ss?.products)[0] ?? "",
      productName: productList(ss?.products)[1] ?? productList(ss?.products)[0] ?? "", optIn: si.smsOptIn || "Yes",
      when: si.smsStartTime, seed: `smsinfo:${id}:${si.firstName}${si.lastName ?? ""}` });
  }

  /* ⚠️ DEDUP ON THE NAME ALONE, NOT NAME + PHONE. The screen-pop caller and the CI
     caller are usually the same person — the screen-pop IS that call's pop — and the
     profile often stores their number in two forms ("(480) 555-0187" on the pop,
     "555-884-3367" on the call record). Keyed on name+phone, half the profiles
     rendered "Sarah Mitchell" twice on adjacent rows, which is precisely the
     duplicated-Dana-Probe look this module exists to avoid. First writer wins, and
     the screen-pops are pushed first because they alone carry an email and a product. */
  const seen = new Set<string>();
  const leads: SfLead[] = [];
  for (const s of sources) {
    const key = `${s.first} ${s.last}`.trim().toLowerCase().replace(/\s+/g, " ");
    if (!s.first || seen.has(key)) continue;
    seen.add(key);
    const c = created(s.when, s.seed);
    leads.push({ slug: leadSlug(s.first, s.last), first: s.first, last: s.last, phone: s.phone, status: "New", smsOptIn: s.optIn,
      product: s.product, productName: s.productName, email: s.email, attributionId: attributionId(id, s.seed),
      created: c.text, sortKey: c.key });
  }
  leads.sort((a, b) => b.sortKey - a.sortKey);

  /* ⚠️ THE PAD RUNS OFF THE END OF THE REAL ROWS, NOT THE OTHER WAY ROUND — the
     prospect's own people keep the top of the list, which is where an SE points. */
  const areaCode = (vs?.callerPhone ?? ss?.callerPhone ?? "").replace(/\D/g, "").slice(-10, -7) || "805";
  /* ⚠️ A FILLER NAME MUST NOT COLLIDE WITH A NAME THE DEMO ALREADY USES. Measured: the
     pool produced "Curtis Nakamura" for AutoNation, which is one of that profile's own
     agents — so the same person would have appeared as an agent on one screen and a lead
     on another. Checked against the whole profile rather than a list of the fields that
     hold names today, since the next slice to carry one would not be in such a list. */
  const known = JSON.stringify(profile).toLowerCase();
  const catalogue = [...productList(vs?.products), ...productList(ss?.products)].filter(Boolean);
  let clock = leads.length ? leads[leads.length - 1].sortKey : Date.parse("2026-01-14T14:12:00");
  /* ⚠️ `attempt` ADVANCES ON A SKIP AND `leads.length` IS THE LOOP'S TEST, so a rejected
     name costs a different seed rather than a row — keyed on the index alone, a collision
     silently returned a nine-row list. */
  for (let attempt = leads.length; leads.length < TARGET_LEADS && attempt < TARGET_LEADS + 40; attempt++) {
    const i = attempt;
    const seed = `pad:${id}:${i}`;
    const first = FIRST_NAMES[hash(`f:${seed}`) % FIRST_NAMES.length];
    const last = LAST_NAMES[hash(`l:${seed}`) % LAST_NAMES.length];
    const key = `${first} ${last}`.toLowerCase();
    if (seen.has(key) || known.includes(key)) { clock -= 1; continue; }
    seen.add(key);
    /* Down the list in time, like the capture's own dates, by a varying 6 to 30 hours. */
    clock -= (6 + (hash(`t:${seed}`) % 25)) * 3_600_000;
    leads.push({
      slug: leadSlug(first, last), first, last,
      /* ⚠️ THE 555 EXCHANGE IS RESERVED so a demo number cannot ring a real business —
         the same care the Google Search ad's call extension takes.
         ⚠️ FOUR DIGITS AFTER IT. Without the pad this rendered "(805) 555-466", a
         nine-digit phone number, on screen — and the audit's own regex asked for
         `\d{3}`, so the check agreed with the bug. */
      phone: `(${areaCode}) 555-${String(100 + (hash(`p:${seed}`) % 900)).padStart(4, "0")}`,
      status: "New", smsOptIn: "Yes",
      product: catalogue.length ? catalogue[i % catalogue.length].toLowerCase() : "",
      productName: catalogue.length ? catalogue[i % catalogue.length] : "",
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${MAIL_DOMAINS[hash(`m:${seed}`) % MAIL_DOMAINS.length]}`,
      attributionId: attributionId(id, seed),
      created: stamp(clock), sortKey: clock,
    });
  }

  /* ⚠️⚠️ **THE LIVE LEAD IS PREPENDED AND ONE FILLER DROPS, so the list stays the length the
     capture has.** Growing to eleven would be self-consistent (the count line is derived from
     the rows), but the row that leaves is invented scaffolding while the row that arrives is a
     real caller — trading one for the other keeps the screen the shape an SE has rehearsed
     against. `sortKey` already puts it first; this only trims the tail.
     ⚠️ And it is spliced HERE rather than pushed into `sources` above, because a source goes
     through the dedup and the pad loop, and a live caller who happens to share a name with a
     screen-pop caller would then be silently dropped — the very row this exists to show. */
  const live = liveBookedLead(profile, voiceCalls);
  if (live) {
    /* ⚠️⚠️ **THE CALLER IS OFTEN ALREADY ON THIS LIST, AND THAT MUST UPDATE THEM RATHER THAN
       DUPLICATE THEM.** Measured: Avi & Co's booking caller is Marcus Wellington, who is also
       its screen-pop caller and therefore already a derived lead — so a blind `unshift` put
       the same person on two rows, which is precisely the duplicated-Dana-Probe look
       `audit:leads` exists to catch. Replaced in place, then MOVED TO THE TOP, because the
       list is sorted by Created Date and this is the row the SE just created.
       ⚠️ A first version replaced without moving, and the freshly-booked caller sat
       mid-list while a filler held the top — found by reading the list, not by a type. */
    const at = leads.findIndex((l) => l.slug === live.lead.slug);
    if (at !== -1) leads.splice(at, 1);
    leads.unshift(live.lead);
    if (leads.length > TARGET_LEADS) leads.length = TARGET_LEADS;
  }

  const n = leads.length;
  return {
    leads,
    statusLine: `${n} item${n === 1 ? "" : "s"} • Sorted by Created Date • Filtered by Created Date, Me, Total Leads`,
    /* The capture's seven tiles in its own order. Every lead is New and unworked,
       so No Activity equals the total and the activity tiles are zero — which is
       what the capture shows too (13 / 13 / 0 / 0 / 0 / 0 / 0). */
    kpis: [
      { label: "Total Leads", value: n, info: false },
      { label: "No Activity", value: n, info: true },
      { label: "Idle", value: 0, info: true },
      { label: "No Upcoming", value: 0, info: true },
      { label: "Overdue", value: 0, info: false },
      { label: "Due Today", value: 0, info: false },
      { label: "Upcoming", value: 0, info: true },
    ],
  };
}
