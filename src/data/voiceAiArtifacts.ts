import type { CustomerProfile, VoiceConversation, VoiceRoutingDemo, VoiceScreenpop, CISignal } from "./schema";

/* =============================================================================
   voiceAiArtifacts.ts — the two leave-behinds built from a REAL captured call
   -----------------------------------------------------------------------------
   The demo story, in the user's own words: "the Caller calls in, then voice agent picks up and
   has the conversation, the Voice Routing Demo shows how we took that conversation, pulled out
   all the signals and routed them to the correct department, then the Voice Screenpop shows
   what the agent in the call center gets when that call got routed to him."

   The two seeded artifacts already tell that story with an INVENTED script. These two rebuild
   the same templates from the call the SE just had, so the transcript on the routing demo is
   the one they just spoke, the department is the one the agent actually named, and the
   screenpop carries what the agent actually established.

   ⚠️ **GATED ON A REAL TRANSFER, AND IT FAILS CLOSED.** `latestTransferredCall` returns a call
   only when `/api/analyze` came back with `transferred: true` AND a department name. A call
   that was refused as out of area, hung up, or whose analysis failed produces NOTHING — no
   rows, no artifacts. An artifact naming a department nobody was sent to is worse than an
   absent one, and this is the one thing on these screens a prospect would check.

   ⚠️ **NEWEST CALL ONLY** (agreed 8/27/2026). One pair of rows that always reflects the most
   recent transferred call, rather than a pair per practice run cluttering My Reports.

   ⚠️⚠️ **THE PRE-CALL STORY IS RE-SKINNED TO THE CALL'S LOCATION, and the first build got this
   badly wrong.** The rule was "keep whatever the call could not establish", which is right for
   an email or a cart id and WRONG for anything naming a place. A caller who said "New York"
   got a screen reading "luxury hotels Las Vegas weekend", "Calling Page: St. Regis Las Vegas",
   "Pages Viewed: W Hotels Las Vegas", "Location: Las Vegas, NV" and a campaign called "Las
   Vegas Acquisition" — every one of them contradicting the transcript printed beside it.
   Reported as: "I want a consistent story so no one says wait a sec, this metric and these
   attributions don't match."

   The digital journey is FICTION WE CONTROL. It costs nothing to make it agree with the call,
   and a prospect reading the search term against the transcript is exactly the person this demo
   is for. So the seeded city is substituted throughout: attribution, visitor history, campaign,
   searches, calling page, products, journey and the address block.

   ⚠️ Only genuinely unknowable, place-free fields stay seeded: the cart id, the estimated value,
   the street number. Those cannot contradict anything that was said.
   ============================================================================= */

type Conv = VoiceConversation;

/** The most recent call that actually ended in a transfer, or null. */
export function latestTransferredCall(convs: Conv[] | undefined): Conv | null {
  for (const c of convs ?? []) {
    const o = c.outcome;
    /* Both halves matter: `transferred` is the gate, `routedTo` is what the artifacts NAME.
       A transfer with no department would render a routing demo pointing nowhere. */
    if (o?.transferred && o.routedTo.trim() && c.transcript?.length) return c;
  }
  return null;
}

/** Words worth matching a signal against a turn — short ones match everything. */
function keyWords(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 5)
    .map((w) => w.toLowerCase());
}

/**
 * The colour band a signal is drawn in.
 *
 * ⚠️ Read off the signal's own NAME rather than assigned by position, so a call that fires a
 * different mix still colours consistently with the seeded artifact.
 */
function signalColor(name: string): string {
  const n = name.toLowerCase();
  if (/\(qa\)|greeting|close|quality/.test(n)) return "blue";
  if (/booked|scheduled|conversion|qualified/.test(n)) return "green";
  if (/intent|interest|product|competitor/.test(n)) return "purple";
  return "orange";
}

/**
 * Attach each signal to the turn that triggered it.
 *
 * ⚠️ **THE SAME TECHNIQUE `InsightsCallDetail` USES for "Found Phrases"** — signal name to its
 * significant words to the first turn containing one — rather than a second model call. It is
 * deterministic, so an SE rehearsing the same call twice sees the same artifact.
 *
 * ⚠️ A signal that matches no turn lands on the LAST turn rather than being dropped: the
 * routing demo prints a signal COUNT, and silently losing detections would make the count
 * disagree with the Analysis tab of the CI report built from the very same call.
 */
function signalsByTurn(signals: CISignal[], turns: { text: string }[]): { c: string; t: string }[][] {
  const out: { c: string; t: string }[][] = turns.map(() => []);
  if (!turns.length) return out;
  for (const s of signals) {
    const words = keyWords(s.name);
    let idx = turns.findIndex((t) => {
      const low = t.text.toLowerCase();
      return words.some((w) => low.includes(w));
    });
    if (idx < 0) idx = turns.length - 1;
    out[idx].push({ c: signalColor(s.name), t: s.name });
  }
  return out;
}

/**
 * Per-turn confidence for each queue, aligned to `queues[]`.
 *
 * ⚠️ **THIS IS THE ONE MODELLED THING HERE, and it is bounded by two real facts:** it starts
 * near even and it ENDS on the department the agent actually named. The artifact animates these
 * bars climbing as the call proceeds; no transcript carries a per-turn probability, and asking
 * a model to invent one would make the same call score differently on each replay. A monotonic
 * ramp toward the true winner is honest about what it is — a visualisation of the decision, not
 * a measurement of it.
 */
function confidenceRamp(turnCount: number, queueCount: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < turnCount; i++) {
    const p = turnCount > 1 ? i / (turnCount - 1) : 1;         // 0 at the open, 1 at the transfer
    const win = Math.round(40 + p * 52);                        // 40 -> 92
    const rest = queueCount > 1 ? Math.round((100 - win) / (queueCount - 1)) : 0;
    rows.push(Array.from({ length: queueCount }, (_, q) => (q === 0 ? win : rest)));
  }
  return rows;
}

/** The three queues with the department the agent named FIRST, since `queues[0]` is the winner. */
function queuesWithWinner(base: VoiceRoutingDemo["queues"], routedTo: string): VoiceRoutingDemo["queues"] {
  const norm = (x: string) => x.trim().toLowerCase();
  const hit = base.find((q) => norm(q.name) === norm(routedTo));
  /* ⚠️ MATCHED BY NAME, NOT ASSUMED TO BE PRESENT. The agent's department comes from the
     workflow's use-case branches, which an SE can rename with Ask AI — so it may not be one of
     the prospect's seeded queues at all. When it is, reorder; when it is not, it leads and the
     seeded ones fill the remaining slots. Either way `queues[0]` is what the agent said. */
  const winner = hit ?? { id: "routed_ai", name: routedTo.trim() };
  return [winner, ...base.filter((q) => q.id !== winner.id)].slice(0, Math.max(3, 1));
}


/**
 * A city the demo call might name, with a real state and a real ZIP inside it.
 *
 * ⚠️ **STATE AND ZIP MOVE WITH THE CITY OR THEY CONTRADICT IT.** Substituting only the city left
 * "City: New York / State: NV / Zip: 89121" on the screenpop, which is the same class of
 * mismatch this whole change exists to remove — just one row further down.
 *
 * ⚠️ Unknown city: the address block is left ALONE rather than half-rewritten. A caller's home
 * address is not something the call established, so leaving the seeded one intact is honest;
 * writing a city with someone else's state is not.
 */
const CITY_PLACE: Record<string, { state: string; zip: string; area: string }> = {
  "new york": { state: "NY", zip: "10019", area: "212" },
  "los angeles": { state: "CA", zip: "90015", area: "213" },
  "san francisco": { state: "CA", zip: "94103", area: "415" },
  "san diego": { state: "CA", zip: "92101", area: "619" },
  "las vegas": { state: "NV", zip: "89109", area: "702" },
  "chicago": { state: "IL", zip: "60601", area: "312" },
  "miami": { state: "FL", zip: "33131", area: "305" },
  "orlando": { state: "FL", zip: "32819", area: "407" },
  "boston": { state: "MA", zip: "02116", area: "617" },
  "seattle": { state: "WA", zip: "98101", area: "206" },
  "denver": { state: "CO", zip: "80202", area: "303" },
  "austin": { state: "TX", zip: "78701", area: "512" },
  "dallas": { state: "TX", zip: "75201", area: "214" },
  "houston": { state: "TX", zip: "77002", area: "713" },
  "atlanta": { state: "GA", zip: "30303", area: "404" },
  "phoenix": { state: "AZ", zip: "85004", area: "602" },
  "nashville": { state: "TN", zip: "37203", area: "615" },
  "new orleans": { state: "LA", zip: "70130", area: "504" },
  "washington": { state: "DC", zip: "20001", area: "202" },
  "philadelphia": { state: "PA", zip: "19107", area: "215" },
  "charlotte": { state: "NC", zip: "28202", area: "704" },
  "portland": { state: "OR", zip: "97205", area: "503" },
  "tampa": { state: "FL", zip: "33602", area: "813" },
  "honolulu": { state: "HI", zip: "96815", area: "808" },
};

/**
 * ZIP codes a demo call is likely to give, with the city USPS actually assigns them.
 *
 * ⚠️ **A CALLER MAY GIVE A ZIP RATHER THAN A CITY, and for a serviceable-address prospect that
 * ZIP *IS* the caller's address** — asked for directly: "if its for a serviceable address and on
 * the call they give a zipcode for example 30097, then i do want you to go change the pre call
 * intelligence to match the address with zipcode." A hotel caller's own address is irrelevant
 * (the destination is what matters); a plumber's is the whole job.
 *
 * ⚠️ **REAL ZIP-TO-CITY PAIRS ONLY.** Guessing a city from a ZIP3 prefix would put "Atlanta, GA
 * 30097" on screen when 30097 is Duluth — a prospect who knows their own service area reads that
 * instantly, which is the exact failure this work exists to remove. An unresolved ZIP leaves the
 * address block ALONE rather than half-rewriting it.
 */
const ZIP_PLACE: Record<string, { city: string; state: string; area: string }> = {
  /* Comfort Keepers' own configured service area. */
  "30097": { city: "Duluth", state: "GA", area: "770" },
  "30096": { city: "Duluth", state: "GA", area: "770" },
  "30095": { city: "Duluth", state: "GA", area: "770" },
  /* Metros the seeded profiles and the demo scripts actually use. */
  "89109": { city: "Las Vegas", state: "NV", area: "702" },
  "89121": { city: "Las Vegas", state: "NV", area: "702" },
  "10019": { city: "New York", state: "NY", area: "212" },
  "90210": { city: "Beverly Hills", state: "CA", area: "310" },
  "93109": { city: "Santa Barbara", state: "CA", area: "805" },
  "32701": { city: "Altamonte Springs", state: "FL", area: "407" },
  "32819": { city: "Orlando", state: "FL", area: "407" },
  "75201": { city: "Dallas", state: "TX", area: "214" },
  "78701": { city: "Austin", state: "TX", area: "512" },
  "60601": { city: "Chicago", state: "IL", area: "312" },
  "98101": { city: "Seattle", state: "WA", area: "206" },
  "02116": { city: "Boston", state: "MA", area: "617" },
};

/**
 * A place-NEUTRAL street, so the address block can never contradict its own city.
 *
 * ⚠️ The seeded street was "4521 Desert Palm Drive", which reads as Las Vegas wherever it is
 * printed — and once the city moves to New York or Duluth it is the last field still telling the
 * old story. Inventing a real Manhattan address is inventing; keeping the house NUMBER and
 * choosing a name that evokes nowhere is not. Deterministic on the ZIP, so a rehearsal renders
 * the same address twice.
 */
const NEUTRAL_STREETS = ["Oakwood Drive", "Maple Avenue", "Cedar Lane", "Ridgeview Court", "Brookside Road", "Highland Terrace"];
function neutralStreet(seeded: string, zip: string): string {
  const num = (seeded.match(/^\d+/) ?? ["1240"])[0];
  const pick = [...zip].reduce((n, ch) => n + ch.charCodeAt(0), 0) % NEUTRAL_STREETS.length;
  return `${num} ${NEUTRAL_STREETS[pick]}`;
}

/** Whatever the caller said — a city or a ZIP — resolved to one place, or null. */
function resolvePlace(loc: string): { city: string; state: string; zip: string; area: string } | null {
  const raw = loc.trim();
  const zip = raw.match(/\b(\d{5})\b/)?.[1];
  if (zip) {
    const z = ZIP_PLACE[zip];
    return z ? { city: z.city, state: z.state, zip, area: z.area } : null;
  }
  const c = CITY_PLACE[cityKey(raw)];
  return c ? { city: cityLabel(raw), state: c.state, zip: c.zip, area: c.area } : null;
}

/** "Las Vegas, NV" -> "las vegas"; "New York" -> "new york". */
function cityKey(loc: string): string {
  return loc.split(",")[0].trim().toLowerCase();
}

/** Title Case the city as the caller said it, so "new york" prints "New York". */
function cityLabel(loc: string): string {
  return loc.split(",")[0].trim().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * Swap every mention of the seeded city for the one the caller named.
 *
 * ⚠️ WORD-BOUNDED and case-insensitive, so "St. Regis Las Vegas" becomes "St. Regis New York"
 * rather than being left half-substituted, and a city name that happens to appear inside
 * another word is not mangled.
 */
function swapCity(text: string, from: string, to: string): string {
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${esc}\\b`, "gi"), to);
}

/**
 * Re-point a phone number's AREA CODE at the caller's city, keeping everything else.
 *
 * ⚠️ **702 IS LAS VEGAS, AND IT SAT DIRECTLY ABOVE THE WORD "New York" ON THE CALLER CARD.** Not
 * in the reported list, but the same class of mismatch and the one a prospect who knows area
 * codes spots instantly.
 *
 * ⚠️ **THE 555 EXCHANGE IS PRESERVED** — it is reserved precisely so a demo number cannot ring a
 * real business, the same care the Google Search ad's call extension takes.
 */
function swapAreaCode(phone: string, area: string | undefined): string {
  /* ⚠️ CAPTURE THE PARENTHESES, DO NOT RE-ADD THEM. A first version matched the prefix with
     `\D*`, which greedily swallowed the opening "(" and then wrote another one — producing
     "+1 ((212) 555-0847". Anchoring on the 555 exchange keeps this to the area code alone. */
  return area ? phone.replace(/(\(?)(\d{3})(\)?\D*555)/, `$1${area}$3`) : phone;
}

/** "Challer Bing" -> "challer.bing@gmail.com". A name-free call keeps the seeded address. */
function emailFor(name: string, seeded: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return seeded;
  return `${parts[0]}.${parts[parts.length - 1]}@gmail.com`.replace(/[^a-z0-9.@-]/g, "");
}

/** The Voice Routing Demo, rebuilt from a captured call. */
export function voiceAiRouting(profile: CustomerProfile, conv: Conv): VoiceRoutingDemo | null {
  const base = profile.reports.voiceRoutingDemo;
  const o = conv.outcome;
  if (!base || !o?.transferred || !o.routedTo.trim()) return null;

  const queues = queuesWithWinner(base.queues, o.routedTo);
  const turns = conv.transcript;
  const sigs = signalsByTurn(conv.signals ?? [], turns);
  const ramp = confidenceRamp(turns.length, queues.length);

  /* The seeded city, and the place the caller actually named — a city OR a ZIP. */
  const fromCity = cityLabel(base.callerLocation);
  const place = o.location.trim() ? resolvePlace(o.location) : null;
  const toCity = place?.city ?? (o.location.trim() && !/\d{5}/.test(o.location) ? cityLabel(o.location) : fromCity);
  const swap = (t: string) => swapCity(t, fromCity, toCity);

  return {
    ...base,                                   // brand, icon, phone, badge
    /* ⚠️ THE WHOLE PRE-CALL STORY FOLLOWS THE CALL. Leaving these seeded put "luxury hotels Las
       Vegas weekend" and "Pages Viewed: W Hotels Las Vegas" beside a transcript in which the
       caller says New York — the attribution panel contradicting the transcript panel, on one
       screen, in front of the person most likely to read both. */
    callerLocation: place ? `${place.city}, ${place.state}` : swap(base.callerLocation),
    callerPhone: swapAreaCode(base.callerPhone, place?.area),
    attribution: base.attribution.map((a) => ({ ...a, value: swap(a.value) })),
    visitorHistory: base.visitorHistory.map((a) => ({
      ...a,
      value: a.label.toLowerCase() === "location" && place ? `${place.city}, ${place.state}` : swap(a.value),
    })),
    queues,
    convo: turns.map((t, i) => ({
      role: t.speaker === "agent" ? ("agent" as const) : ("caller" as const),
      text: t.text,
      sigs: sigs[i] ?? [],
      q: ramp[i] ?? [],
    })),
    routedSubtitle: `AI Agent qualified caller intent and routed to ${o.routedTo.trim()}`,
  };
}

/** "Cancel an existing reservation" -> "cancel an existing reservation", leaving acronyms be. */
function lowerFirst(t: string): string {
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/** The Voice Screenpop the receiving rep sees, rebuilt from the same call. */
export function voiceAiScreenpop(profile: CustomerProfile, conv: Conv): VoiceScreenpop | null {
  const base = profile.reports.voiceScreenpop;
  const o = conv.outcome;
  if (!base || !o?.transferred || !o.routedTo.trim()) return null;

  const name = o.callerName.trim() || base.callerName;
  const first = name.split(/\s+/)[0] || name;
  const where = o.location.trim();
  const intent = o.intent.trim() || base.intent;
  /* What the agent ACTUALLY collected, read off the signals and the outcome rather than
     asserted — the rep is told only what the caller really gave. */
  const collected = [
    o.callerName.trim() ? "name" : "",
    where ? "location" : "",
  ].filter(Boolean);

  const fromCity = cityLabel(base.city ?? "");
  const place = where ? resolvePlace(where) : null;
  const toCity = place?.city ?? (where && !/\d{5}/.test(where) ? cityLabel(where) : fromCity);
  const swap = (t: string) => swapCity(t, fromCity, toCity);

  return {
    /* ⚠️ Only the genuinely unknowable, PLACE-FREE fields stay seeded — the cart id, the
       estimated value, the street number. Nothing left here can contradict the transcript. */
    ...base,
    callerName: name,
    /* ⚠️ THE EMAIL FOLLOWED A DIFFERENT PERSON ENTIRELY. The seeded one was
       "j.martinez.702@email.com" while the caller had just given their name as Challer Bing, so
       the rep's screen named two people. Derived from whoever actually called; a call that got
       no name keeps the seeded address rather than inventing one. */
    email: emailFor(name, base.email),
    callerPhone: swapAreaCode(base.callerPhone, place?.area),
    campaign: swap(base.campaign),
    googleSearch: swap(base.googleSearch),
    websiteSearch: swap(base.websiteSearch),
    callingWebpage: swap(base.callingWebpage),
    products: swap(base.products),
    digitalJourney: swap(base.digitalJourney),
    /* ⚠️ **THE WHOLE ADDRESS MOVES TOGETHER, STREET INCLUDED.** For a serviceable-address
       prospect the ZIP the caller gave IS their address, so city, state, zip AND street have to
       sit at it — "4521 Desert Palm Drive, Duluth, GA 30097" would be the last field still
       telling the Las Vegas story. The street becomes place-neutral rather than a fabricated
       local one: the house number is kept, and the name evokes nowhere, so it cannot contradict
       whatever city ends up beside it. */
    ...(place
      ? { city: place.city, state: place.state, zip: place.zip,
          street: neutralStreet(base.street, place.zip) }
      : {}),
    intent,
    /* ⚠️⚠️ **THE "AI VOICE AGENT" PANEL COMES ENTIRELY FROM THE CALL, WHERE THE CRM FIELDS DO
       NOT — and the distinction is not pedantry.** Keeping the seeded `coverage` left a support
       caller who never gave a location reading "ZIP 89121 confirmed, Las Vegas serviceable" on
       a panel headed by the AI agent's name: the screen would be crediting the agent with a
       check it never ran, which is exactly the kind of thing a prospect who knows the product
       asks about. An address and an email are facts about a person that a CRM legitimately
       already holds; a verification is an event, and this call either did it or did not. */
    coverage: where ? `${where} confirmed by the AI agent` : `Service area not checked on this call`,
    switchIntent: `Qualified by the AI voice agent and routed to ${o.routedTo.trim()}`,
    tagBlue: `Routed to ${o.routedTo.trim()}`,
    greeting:
      /* Lower-cased and de-punctuated because the intent is a SENTENCE and this splices it
         mid-clause — "about Cancel an existing reservation." reads as two half-sentences. */
      `Hi ${first}, thanks for holding. I can see you just spoke with our AI assistant about ${lowerFirst(intent.replace(/\.\s*$/, ""))}` +
      `${collected.length ? `, and I already have your ${collected.join(" and ")}` : ""}. ` +
      `Let me pick up right where you left off.`,
  };
}
