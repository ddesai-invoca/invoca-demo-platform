import type { CustomerProfile } from "./schema";

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

   That is typically four leads, sometimes fewer. **The counts follow the rows** —
   "N items" and the Total Leads / No Activity tiles are computed here, never
   typed — so the page can never claim 13 leads over a table of four. Same rule as
   leadForms.ts: a fabricated count sitting beside real ones is worse than a
   smaller true one.

   ⚠️ THE ATTRIBUTION ID IS DERIVED, NOT RANDOM. `Math.random()` would hand the SE
   a different id every reload, which is exactly the kind of thing that gets
   noticed when someone re-opens the tab mid-demo. Each id is a pure function of
   the lead's own identity, in the capture's own `<network>/<promo>/i-<uuid>` shape.
   ============================================================================= */

export interface SfLead {
  first: string;
  last: string;
  /** "(406) 781-2153", the capture's own formatting. */
  phone: string;
  status: string;
  smsOptIn: string;
  /** Lower-case in the capture ("blinds", "shutters"), and it stays that way. */
  product: string;
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

/** "Motorized Shades, Plantation Shutters" -> ["motorized shades", "plantation shutters"]. */
function products(raw: string | undefined): string[] {
  return String(raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function salesforceLeads(profile: CustomerProfile): SfLeadView {
  const r = profile.reports;
  const id = profile.id;

  type Src = { first: string; last: string; phone: string; email: string; product: string;
               optIn: string; when: string | undefined; seed: string };
  const sources: Src[] = [];

  const vs = r.voiceScreenpop;
  if (vs?.callerName) {
    const n = splitName(vs.callerName);
    sources.push({ ...n, phone: phone(vs.callerPhone), email: vs.email ?? "", product: products(vs.products)[0] ?? "",
      optIn: "Yes", when: r.voiceConversationIntelligence?.conversations?.find((c) => c.voiceInfo)?.voiceInfo?.callStartTime,
      seed: `voice:${id}:${vs.callerName}` });
  }

  const ss = r.smsScreenpop;
  if (ss?.callerName) {
    const n = splitName(ss.callerName);
    const info = r.smsConversationIntelligence?.conversations?.find((c) => c.smsInfo)?.smsInfo;
    sources.push({ ...n, phone: phone(ss.callerPhone), email: ss.email ?? "", product: products(ss.products)[0] ?? "",
      optIn: info?.smsOptIn || "Yes", when: info?.smsStartTime, seed: `sms:${id}:${ss.callerName}` });
  }

  const vi = r.voiceConversationIntelligence?.conversations?.find((c) => c.voiceInfo)?.voiceInfo;
  if (vi?.firstName) {
    sources.push({ first: vi.firstName, last: vi.lastName ?? "", phone: phone(vi.callerId), email: "",
      product: products(vs?.products)[1] ?? products(vs?.products)[0] ?? "", optIn: "Yes",
      when: vi.callStartTime, seed: `voiceinfo:${id}:${vi.firstName}${vi.lastName ?? ""}` });
  }

  const si = r.smsConversationIntelligence?.conversations?.find((c) => c.smsInfo)?.smsInfo;
  if (si?.firstName) {
    sources.push({ first: si.firstName, last: si.lastName ?? "", phone: phone(si.callerId), email: "",
      product: products(ss?.products)[1] ?? products(ss?.products)[0] ?? "", optIn: si.smsOptIn || "Yes",
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
    leads.push({ first: s.first, last: s.last, phone: s.phone, status: "New", smsOptIn: s.optIn,
      product: s.product, email: s.email, attributionId: attributionId(id, s.seed),
      created: c.text, sortKey: c.key });
  }
  leads.sort((a, b) => b.sortKey - a.sortKey);

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
