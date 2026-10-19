/* =============================================================================
   customCrm.ts — the "Custom CRM" scheduling calendar the SMS agent books into
   -----------------------------------------------------------------------------
   Asked for 10/15/2026, from a coworker's Chicago Summit build (The Carpet Guys):
   while the SMS agent schedules an appointment, a CRM calendar beside it fills in
   live — the service area confirmed, the openings it offers, the slot the customer
   picks, the booking landing, and a lead panel with what was collected.

   ⚠️⚠️ **THE AGENT AND THE CALENDAR READ ONE TABLE.** `crmCalendar` is the
   prospect's openings for the next seven days. The SMS agent is handed the same
   table (`crmPromptCalendar`, behind the connect switch) and told those are the
   ONLY times it can offer, so a time it says out loud is always a block the
   calendar can draw. Without that, the agent invents "Thursday at 2" and the CRM
   has nothing to show — the two halves of the beat disagreeing in front of a
   prospect.

   ⚠️⚠️ **THE CONVERSATION IS CLASSIFIED AGAINST THAT TABLE, NOT FREE-PARSED.** This
   repo has been bitten reading model prose with regexes (the Salesforce slot, the
   apostrophe that false-failed a simulator 5 runs in 6). The parse here only ever
   asks "which of the times we offered does this message name", so a phrasing it
   cannot read degrades to "no offer yet", never to a block at an invented time.

   DOM-free and import-light so the audit can call it under Node; localStorage is
   only touched inside try/catch.
   ============================================================================= */

import type { CustomerProfile, SmsConversation } from "./schema";
import { resolvePlace, neutralStreet } from "./voiceAiArtifacts";

/** One day of the calendar, in the viewer's local time. */
export interface CrmDay {
  /** YYYY-MM-DD, local. */
  date: string;
  /** "Thursday" */
  weekday: string;
  /** "Thursday, October 15" — how the agent is told to say it. */
  label: string;
  /** Start times the agent may offer, "12:00 PM". */
  open: string[];
  /** Start times already taken, drawn as "Booked". */
  busy: string[];
  /** No business that day (Sunday). */
  closed: boolean;
}

export const CRM_START_HOUR = 8;
export const CRM_END_HOUR = 18;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* `>>>`, not `>>`: a hash above 2^31 goes negative under a signed shift and `%` keeps the sign. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hourLabel = (h: number): string => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;
const hourOf = (label: string): number => {
  const m = /^(\d{1,2}):00 (AM|PM)$/.exec(label);
  if (!m) return -1;
  return (Number(m[1]) % 12) + (m[2] === "PM" ? 12 : 0);
};

/**
 * The next seven days of openings, stable for a prospect on a given date.
 *
 * Today has nothing left (a same-day visit is not what the demo is about), Sunday is closed,
 * and ONE weekday is fully booked so the agent has a real "that day is full, how about…"
 * moment — the beat in the reference video. Every other day carries two openings, one before
 * noon and one after, so the customer is offered a genuine choice.
 */
export function crmCalendar(profileId: string, now: Date = new Date()): CrmDay[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: CrmDay[] = [];
  const candidates: number[] = [];
  for (let i = 1; i < 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() !== 0) candidates.push(i);
  }
  const fullIdx = candidates.length ? candidates[hash(`${profileId}:full:${ymd(base)}`) % candidates.length] : -1;

  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const date = ymd(d);
    const weekday = WEEKDAYS[d.getDay()];
    const label = `${weekday}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const h = hash(`${profileId}:${date}`);
    if (d.getDay() === 0) { days.push({ date, weekday, label, open: [], busy: [], closed: true }); continue; }

    const morning = [9, 10, 11];
    const afternoon = [12, 13, 14, 15, 16];
    const pick = (pool: number[], seed: number) => pool[seed % pool.length];
    let open: number[] = [];
    let busy: number[] = [];
    if (i === 0) {
      busy = [pick(morning, h >>> 3), pick(afternoon, h >>> 9)];
    } else if (i === fullIdx) {
      busy = [pick(morning, h >>> 3), pick(afternoon, h >>> 9), pick(afternoon, (h >>> 15) + 2)];
    } else {
      const am = pick(morning, h >>> 3);
      const pm = pick(afternoon, h >>> 9);
      open = [am, pm];
      const rest = [...morning, ...afternoon].filter((x) => !open.includes(x));
      busy = [pick(rest, h >>> 15)];
    }
    busy = [...new Set(busy)].filter((x) => !open.includes(x)).sort((a, b) => a - b);
    days.push({ date, weekday, label, open: open.sort((a, b) => a - b).map(hourLabel), busy: busy.map(hourLabel), closed: false });
  }
  return days;
}

/* ------------------------------------------------------------------------------------------
   Connecting the SMS agent
   ⚠️ OPT-IN PER PROSPECT, AND THE CRM PAGE CONNECTS ITSELF ON FIRST VISIT. Handing the agent
   a calendar changes what it says, so it must not happen to every prospect's agent silently;
   the switch lives on the CRM screen, where the change is visible. Per browser, which is also
   where the Preview Agent tab reads it.
   ------------------------------------------------------------------------------------------ */
const connKey = (profileId: string) => `invoca-demo:custom-crm::${profileId}`;

export function crmConnection(profileId: string): "on" | "off" | null {
  try {
    const v = localStorage.getItem(connKey(profileId));
    return v === "1" ? "on" : v === "0" ? "off" : null;
  } catch { return null; }
}
export const crmConnected = (profileId: string): boolean => crmConnection(profileId) === "on";
export function setCrmConnected(profileId: string, on: boolean): void {
  try { localStorage.setItem(connKey(profileId), on ? "1" : "0"); } catch { /* private window */ }
}

/** What the SMS agent is handed: today's date and the same openings the calendar draws. */
export interface CrmPromptCalendar { today: string; booking: string; days: { label: string; open: string[]; closed: boolean }[] }
export function crmPromptCalendar(p: Pick<CustomerProfile, "id" | "bookingTerm">, now: Date = new Date()): CrmPromptCalendar {
  const days = crmCalendar(p.id, now);
  return {
    today: days[0]?.label ?? "",
    booking: (p.bookingTerm || "appointment").toLowerCase(),
    days: days.map((d) => ({ label: d.label, open: d.open, closed: d.closed })),
  };
}

/* ------------------------------------------------------------------------------------------
   Reading the conversation
   ------------------------------------------------------------------------------------------ */

export interface CrmSlot { date: string; time: string }
export interface CrmState {
  lead: Record<string, string>;
  conversation: { who: "agent" | "customer"; text: string }[];
  zip: string | null;
  /** Days the agent looked at, and how many openings each had. */
  checked: { date: string; found: number }[];
  offers: CrmSlot[];
  selected: CrmSlot | null;
  booking: (CrmSlot & { id: string }) | null;
}

const WD_RE = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?\b/gi;
const WD_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_RE = new RegExp(`\\b(${MONTHS.map((m) => m.slice(0, 3)).join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi");

/** Days a message names, in the order it names them. */
function daysIn(text: string, days: CrmDay[]): { day: CrmDay; at: number }[] {
  const out: { day: CrmDay; at: number }[] = [];
  for (const m of text.matchAll(MONTH_RE)) {
    const mi = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase());
    const day = days.find((d) => { const dt = new Date(d.date + "T12:00"); return dt.getMonth() === mi && dt.getDate() === Number(m[2]); });
    if (day) out.push({ day, at: m.index ?? 0 });
  }
  for (const m of text.matchAll(WD_RE)) {
    const idx = WD_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (idx === undefined) continue;
    const day = days.find((d) => new Date(d.date + "T12:00").getDay() === idx);
    if (day && !out.some((o) => o.day === day)) out.push({ day, at: m.index ?? 0 });
  }
  if (/\btomorrow\b/i.test(text) && days[1] && !out.some((o) => o.day === days[1])) out.push({ day: days[1], at: text.search(/\btomorrow\b/i) });
  return out.sort((a, b) => a.at - b.at);
}

/** Clock times a message names, as 24h hours (ambiguous ones carry both readings). */
function timesIn(text: string): { hours: number[]; at: number }[] {
  const out: { hours: number[]; at: number }[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?=\W|$)/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (!n || n > 12 || (m[2] && m[2] !== "00")) continue;
    /* A bare number is a time only when it reads like one ("3", "the 12") — a five-digit ZIP
       or a phone fragment is excluded by the 1-12 range and the word boundary. */
    const ap = (m[3] || "").toLowerCase().replace(/[^ap]/g, "");
    if (!ap && !m[2] && !/\b(at|the|for|around|@)\s*$/i.test(text.slice(0, m.index ?? 0)) && text.trim() !== m[0]) continue;
    const h12 = n % 12;
    out.push({ hours: ap === "p" ? [h12 + 12] : ap === "a" ? [h12] : [h12, h12 + 12], at: m.index ?? 0 });
  }
  if (/\bnoon\b/i.test(text)) out.push({ hours: [12], at: text.search(/\bnoon\b/i) });
  return out;
}

type Ask = "name" | "phone" | "address" | "email" | "zip" | null;
function askOf(text: string): Ask {
  if (!/\?/.test(text)) return null;
  const t = text.toLowerCase();
  if (/\be-?mail\b/.test(t)) return "email";
  if (/\bphone\b|\bnumber to reach\b|\bbest number\b/.test(t)) return "phone";
  if (/\baddress\b/.test(t)) return "address";
  if (/\bzip\b|postal code/.test(t)) return "zip";
  if (/\bname\b/.test(t)) return "name";
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
  .replace(/\b([A-Z][a-z])\b/g, (w) => (/^(Il|Ny|Ca|Tx|Fl|Ga|Az|Co|Wa|Oh|Pa|Nj|Ma|Mi|Nc|Va|Tn|Mo|In|Md|Wi|Mn|Or|Sc|Al|La|Ky|Ok|Ct|Ut|Ia|Nv|Ar|Ms|Ks|Nm|Ne|Id|Wv|Hi|Nh|Me|Mt|Ri|De|Sd|Nd|Ak|Vt|Wy|Dc)$/.test(w) ? w.toUpperCase() : w));

/**
 * The CRM's view of a conversation, read turn by turn.
 *
 * ⚠️ A CUSTOMER ANSWER IS FILED UNDER THE QUESTION THE AGENT JUST ASKED. "kyle smith" is only a
 * name because the previous message asked for one; reading names out of free text would file
 * "basement" as a surname. Email and phone are recognisable on their own and are taken wherever
 * they appear.
 */
export function crmStateFrom(conv: Pick<SmsConversation, "id" | "transcript"> | null | undefined, days: CrmDay[]): CrmState {
  const st: CrmState = { lead: {}, conversation: [], zip: null, checked: [], offers: [], selected: null, booking: null };
  if (!conv) return st;
  let ask: Ask = null;
  const checked = new Map<string, number>();

  for (const turn of conv.transcript ?? []) {
    const text = String(turn.text ?? "").trim();
    if (!text) continue;
    if (turn.speaker === "agent") {
      st.conversation.push({ who: "agent", text });
      ask = askOf(text);

      const named = daysIn(text, days);
      for (const n of named) checked.set(n.day.date, n.day.open.length);
      const times = timesIn(text);

      /* ⚠️⚠️ A CONFIRMATION BOOKS ONLY WHEN IT IS NOT STILL ASKING FOR SOMETHING. Measured on a
         real run: "I have you down for Saturday at 1:00 PM. What is your full name?" read as a
         booking and the block landed before a single contact detail was collected. A message
         that holds the slot while it asks for details is a PICK; the booking is the final
         "you're all set". */
      const holds = /\b(all set|you'?re booked|is booked|booked you|have you down|have you booked|you'?re confirmed|is confirmed|you'?re scheduled|is scheduled|see you (on|then))\b/i.test(text);
      if (holds) {
        const day = named.at(-1)?.day ?? days.find((d) => d.date === st.selected?.date);
        const hrs = times.flatMap((t) => t.hours);
        const time = day && (day.open.find((o) => hrs.includes(hourOf(o))) ?? (st.selected && st.selected.date === day.date ? st.selected.time : undefined));
        if (day && time) {
          st.selected = { date: day.date, time };
          if (!ask) st.booking = { id: bookingId(conv.id), date: day.date, time };
        }
        continue;
      }

      /* Each time is credited to the nearest day named before it that actually has that opening. */
      const offers: CrmSlot[] = [];
      for (const t of times) {
        const before = named.filter((n) => n.at <= t.at).reverse();
        const pool = [...before, ...named.filter((n) => !before.includes(n))];
        for (const n of pool) {
          const hit = n.day.open.find((o) => t.hours.includes(hourOf(o)));
          if (hit) { if (!offers.some((o) => o.date === n.day.date && o.time === hit)) offers.push({ date: n.day.date, time: hit }); break; }
        }
      }
      if (offers.length) { st.offers = offers; st.selected = null; }
      continue;
    }

    st.conversation.push({ who: "customer", text });
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) st.lead.email = email[0].toLowerCase();
    const digits = text.replace(/\D/g, "");
    if ((ask === "phone" || /^[\d\s().+-]+$/.test(text)) && (digits.length === 10 || (digits.length === 11 && digits[0] === "1"))) {
      const d = digits.slice(-10);
      st.lead.phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    const zip = text.match(/\b\d{5}\b/);
    if (zip && digits.length < 10 && (ask === "zip" || ask === "address" || /^\s*\d{5}\s*$/.test(text) || !st.zip)) st.zip = zip[0];
    if (ask === "name" && !email && digits.length < 4) {
      const name = text.replace(/^(hi|hey|sure|yes|ok(ay)?)[,!. ]+/i, "").replace(/^(it'?s|my name is|this is|i'?m|name'?s)\s+/i, "")
        .replace(/[^A-Za-z' -]/g, "").trim().split(/\s+/).slice(0, 4).join(" ");
      if (name.length >= 2) st.lead.name = titleCase(name);
    }
    if (ask === "address" && /\d/.test(text) && !email) st.lead.address = titleCase(text.replace(/[.\s]+$/, ""));
    /* VOLUNTEERED DETAILS (10/19/2026). The rules above only read an answer to the question just
       asked, so "Hi, this is Sarah Mitchell" or a phone number mid-sentence never reached the
       lead, and the Pre-Call Intelligence rows could not confirm against it. A name is taken only
       from an explicit introduction in Capitalised words, so "I'm looking for…" is not a name. */
    if (!st.lead.phone) {
      const ph = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
      if (ph) { const d = ph[0].replace(/\D/g, "").slice(-10); st.lead.phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; }
    }
    if (!st.lead.name) {
      const intro = text.match(/\b(?:my name is|this is|i'?m|it'?s)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})/i);
      const lead = text.match(/^([A-Z][a-z'-]+\s+[A-Z][a-z'-]+)\s*,/);
      const nm = (intro && /^[A-Z]/.test(intro[1]) ? intro[1] : null) ?? (lead && st.lead.phone ? lead[1] : null);
      if (nm && !/^(Aptive|The|A|An)\b/.test(nm)) st.lead.name = titleCase(nm);
    }
    if (st.zip) st.lead.zip = st.zip;

    /* Picking one of the openings just offered. */
    if (st.offers.length && !st.booking) {
      const hrs = timesIn(text).flatMap((t) => t.hours);
      const namedDay = daysIn(text, days)[0]?.day;
      let pick = st.offers.find((o) => hrs.includes(hourOf(o.time)) && (!namedDay || namedDay.date === o.date));
      if (!pick && /\b(first|earlier|morning)\b/i.test(text)) pick = st.offers[0];
      if (!pick && /\b(second|later|afternoon|last)\b/i.test(text)) pick = st.offers[st.offers.length - 1];
      if (pick) st.selected = pick;
    }
    ask = null;
  }
  st.checked = [...checked.entries()].map(([date, found]) => ({ date, found })).sort((a, b) => a.date.localeCompare(b.date));
  return st;
}

/** A stable six-digit booking number for a conversation. */
export const bookingId = (convId: string): string => String(100000 + (hash(`booking:${convId}`) % 900000));

/* ------------------------------------------------------------------------------------------
   Project details — the key facts the customer gave, as tags (10/15/2026)
   Asked for: "key signals, like mosquitoes, or the 2,500 sq. ft. size of the home, whether
   it's indoor and outdoor". Two sources, merged:
   - what the customer STATED, read straight off their messages (size, indoor/outdoor, home
     type, pets). Instant, and not dependent on a model call;
   - the conversation's AI-extracted signals (`/api/analyze`, which already runs a beat after
     every turn), which carry the vertical's own facts ("Pest Type Identified: Mosquitoes").
   Anything the panel already shows elsewhere (ZIP, contact details, the appointment) is left
   out, so a tag is always something new.
   ------------------------------------------------------------------------------------------ */
const ALREADY_SHOWN = /\b(zip|service area|area confirmed|appointment|booked|booking|scheduled|schedul|contact|name|phone|email|address|opt.?in|engaged|greeting|close)\b/i;
const GENERIC_VALUE = /^(yes|no|none|n\/a|declined|confirmed|requested|interested|true|false|captured|provided|discussed|met)$/i;
const NEGATED = /\b(no|not|don'?t|without|never|nope)\b[^.?!,]{0,24}$/i;

const stem = (w: string) => w.replace(/ies$/, "y").replace(/(?<=o)es$/, "").replace(/s$/, "");
const stems = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 4).map(stem);

/** Tags for the Project section, most concrete first, no duplicates, at most `max`. */
export function crmDetails(customerText: string, signalNames: string[], categories: string[], max = 8): string[] {
  const out: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/(\d),(?=\d{3})/g, "$1").replace(/\s+and\s+/g, " + ").replace(/\s+/g, " ").trim();
  const add = (t: string | null | undefined, opts: { overlap?: boolean } = {}) => {
    const s = (t ?? "").replace(/\s+/g, " ").trim();
    if (!s || s.length > 40) return;
    const k = norm(s);
    if (out.some((o) => { const n = norm(o); return n === k || n.includes(k) || k.includes(n); })) return;
    /* A signal that repeats a tag already shown ("Mosquito interest" beside "Mosquito
       Treatments") adds nothing. */
    if (opts.overlap && out.some((o) => stems(o).some((w) => stems(s).includes(w)))) return;
    out.push(s[0].toUpperCase() + s.slice(1));
  };
  const text = customerText;
  const lower = text.toLowerCase();

  /* Size of the property, in whatever unit they used. */
  const sq = text.match(/(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:sq\.?\s*f(?:ee)?t\.?|square\s*f(?:ee|oo)t|sqft|sf)\b/i);
  if (sq) add(`${Number(sq[1].replace(/,/g, "")).toLocaleString("en-US")} sq ft`);
  const ac = text.match(/(\d+(?:\.\d+)?|half an?|a quarter)\s*acres?\b/i);
  if (ac) add(`${ac[1]} acre${/^1$|half|quarter/i.test(ac[1]) ? "" : "s"}`);
  const bed = text.match(/\b(\d)\s*(?:bed(?:room)?s?|br)\b/i);
  if (bed) add(`${bed[1]} bedroom`);

  /* Where the work is. */
  const ins = /\b(indoor|inside|interior)\b/i.test(text), outs = /\b(outdoor|outside|exterior|yard)\b/i.test(text);
  if ((ins && outs) || (/\bboth\b/i.test(text) && (ins || outs))) add("Indoor + outdoor");
  else if (/\b(indoor|inside|interior)\s+only\b/i.test(text)) add("Indoor only");
  else if (/\b(outdoor|outside|exterior)\s+only\b/i.test(text)) add("Outdoor only");

  /* The prospect's own product lines the customer named. */
  const said = new Set(stems(text));
  for (const c of categories) if (stems(c).some((w) => said.has(w))) add(c);

  /* The AI-extracted signals: the value when it says something, the whole signal when the
     value is only "yes" or "declined". */
  for (const name of signalNames) {
    const clean = name.replace(/\s*\((industry|conversion|qa|ai)\)\s*/gi, " ").trim();
    if (ALREADY_SHOWN.test(clean)) continue;
    const [label, ...rest] = clean.split(":");
    const value = rest.join(":").trim();
    if (!value) continue;
    add(GENERIC_VALUE.test(value) ? `${label.trim()}: ${value.toLowerCase()}` : value, { overlap: true });
  }

  /* The home itself, and who lives there. */
  const home = lower.match(/\b(single[- ]family|townhouse|townhome|condo|apartment|duplex|mobile home|two[- ]story|ranch|basement|garage|attic|crawl ?space|commercial|office|restaurant)\b/g);
  for (const h of [...new Set(home ?? [])]) {
    const at = lower.indexOf(h);
    if (!NEGATED.test(lower.slice(Math.max(0, at - 30), at))) add(h.replace(/-/g, " "));
  }
  const pets = text.match(/\b(\d+|one|two|three|four|a|an)\s+(dogs?|cats?|pets?)\b/i);
  if (pets) add(`${/^an?$/i.test(pets[1]) ? "1" : pets[1]} ${pets[2].toLowerCase()}`);
  if (/\b(kids|children|toddlers?|baby)\b/i.test(text)) add("Kids at home");
  return out.slice(0, max);
}

/* =============================================================================
   PRE-CALL INTELLIGENCE — what Invoca already knows before the first text (10/19/2026)
   -----------------------------------------------------------------------------
   Asked for: *"add fictitious presence or pre-call intelligence information on that column …
   Before they even get here, we already have presence information about this customer, and then
   we're going to enhance it even further as they're having this SMS conversation."*

   ⚠️ IT IS THE SAME CUSTOMER THE REST OF THE DEMO ALREADY KNOWS, not a third invented one. The
   Preview Agent greets by `voiceScreenpop.callerName` (resolveGreeting), the Voice/SMS Screen Pop
   artifacts print that person's search, pages and products, and the Salesforce lead carries their
   attribution; this reads all of it from those same slices, so the CRM, the screen pop and the
   lead agree. Only the visit count and the carrier are hashed (deterministic per prospect).
   ============================================================================= */
export interface CrmPreCall {
  name: string; phone: string; email: string; street: string; zip: string; location: string;
  search: string; landingPage: string; journey: string; interest: string;
  source: string; campaign: string; value: string; intent: string; visits: string; line: string;
}

export function crmPreCall(profile: CustomerProfile, attribution?: { marketingSource?: string; marketingMedium?: string; marketingCampaign?: string }, serviceCity?: string): CrmPreCall | null {
  const seeded = profile.reports.voiceScreenpop ?? profile.reports.smsScreenpop;
  if (!seeded?.callerName) return null;
  /* ⚠️ THE CUSTOMER LIVES WHERE THE CRM SERVES. The CRM's header names its service area (the
     prospect's own location), and a pre-call address in another city would read as out of area
     beside "Service area: Dallas". Re-skinned with the same table and street rule the Screen Pop
     artifacts use; an unknown city leaves the seeded address alone rather than half-moving it. */
  const place = serviceCity && seeded.city?.trim().toLowerCase() !== serviceCity.trim().toLowerCase() ? resolvePlace(serviceCity) : null;
  const vs = place ? {
    ...seeded, city: place.city, state: place.state, zip: place.zip,
    street: neutralStreet(seeded.street ?? "", place.zip),
    callerPhone: (seeded.callerPhone ?? "").replace(/\(\d{3}\)/, `(${place.area})`),
  } : seeded;
  /* The seeded search, campaign and pages can name the old city ("…near Denver Colorado"), so
     they move with it, state name and all. */
  const moveCity = (t: string) => {
    if (!place || !seeded.city || !t) return t;
    const oldState = STATE_NAMES[(seeded.state ?? "").toUpperCase()] ?? "";
    const newState = STATE_NAMES[place.state.toUpperCase()] ?? place.state;
    let out = t.replace(new RegExp(`\\b${seeded.city}(,?\\s+${oldState || "$^"})?\\b`, "gi"),
      (_m, st) => (st ? `${place.city}${st.startsWith(",") ? "," : ""} ${newState}` : place.city));
    if (oldState) out = out.replace(new RegExp(`\\b${oldState}\\b`, "g"), newState);
    return out;
  };
  const h = hash(`crm-precall:${profile.id}`);
  const visits = 2 + (h % 4);
  const carrier = ["Verizon", "AT&T", "T-Mobile"][h % 3];
  const src = [attribution?.marketingSource, attribution?.marketingMedium].filter(Boolean).join(" · ");
  return {
    name: vs.callerName.trim(),
    phone: vs.callerPhone ?? "",
    email: vs.email ?? "",
    street: [vs.street, vs.city].filter(Boolean).join(", "),
    zip: vs.zip ?? "",
    location: [vs.city, [vs.state, vs.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    search: moveCity(vs.googleSearch ?? ""),
    landingPage: vs.callingWebpage ?? "",
    journey: moveCity((vs.digitalJourney ?? "").replace(/\s*›\s*/g, " › ")),
    interest: vs.products ?? "",
    source: src,
    campaign: moveCity(attribution?.marketingCampaign || vs.campaign || ""),
    value: vs.estimatedValue ?? "",
    intent: vs.tagBlue ?? "",
    visits: `${visits} site visits in the last 7 days`,
    line: `Mobile · ${carrier}`,
  };
}

/** How a detail the customer gave in the chat relates to what was known before it. */
export function precallMatch(field: "name" | "phone" | "email" | "address" | "zip", pre: string, chat: string): "confirmed" | "updated" {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]/g, "");
  if (field === "phone") return pre.replace(/\D/g, "").slice(-10) === chat.replace(/\D/g, "").slice(-10) ? "confirmed" : "updated";
  if (field === "name") {
    const first = (s: string) => norm(s.split(/\s+/)[0] ?? "");
    return first(pre) && first(pre) === first(chat) ? "confirmed" : "updated";
  }
  if (field === "address") return norm(pre).startsWith(norm(chat).slice(0, 8)) || norm(chat).startsWith(norm(pre).slice(0, 8)) ? "confirmed" : "updated";
  if (field === "zip") return (pre.match(/\d{5}/)?.[0] ?? "") === (chat.match(/\d{5}/)?.[0] ?? "-") ? "confirmed" : "updated";
  return norm(pre) === norm(chat) ? "confirmed" : "updated";
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
