import type { CustomerProfile } from "./schema";

/* WHERE THE PROSPECT IS, WHO ITS RIVALS ARE, AND HOW A PAID CLICK IS TRACKED.

   Shared by the two "before Invoca sees the call" screens: the ChatGPT sponsored
   placement (`screens/ChatGptAd.tsx`) and the Google search results page
   (`screens/GoogleSearch.tsx`). It lives here rather than in either screen
   because the two MUST agree: the same prospect has to land in the same city,
   against the same competitor names, in both. Two copies of this logic would
   drift the first time one was fixed.

   Nothing here is generated. It is all derived from the profile the engine
   already produces, so every prospect on disk gets both screens with no schema
   change and no extra generation phase. */

/* `serviceArea` is written for the AI agent's system prompt, so it's a full
   paragraph ("the greater Santa Barbara, California area — ZIP codes starting
   with 931…"). An ad needs a place name, so trim it to one and give up
   (returning undefined) rather than print something that doesn't read as a
   place — the copy is written to work with or without it. */
function shortArea(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw
    .split(/[—(,;]/)[0]                                  // drop ZIP-code asides
    .replace(/^\s*(the\s+)?(greater\s+)?/i, "")
    .replace(/\s+(metro(politan)?\s+)?area\s*$/i, "")
    .trim();
  return s && s.length <= 34 ? s : undefined;
}

/* Turn an industry string into something that reads as a business name.
   Naively taking the first "&" segment gave Vector Security "Home" (from
   "Home & Business Security / Alarm Monitoring"), so prefer whichever side of
   the "&" actually has two words: "Business Security", "Vision Care",
   "Health Systems", "Window Treatments". */
const STOP = new Set(["group", "center", "centre", "clinic", "the", "and", "inc",
  "llc", "corp", "company"]);

function industrySeg(industry: string): string {
  const head = industry.split(/[/,]/)[0].trim();
  const parts = head.split("&").map((x) => x.trim()).filter(Boolean);
  const pick = parts.find((x) => x.split(/\s+/).length >= 2) ?? parts[0] ?? industry;
  /* Cap at two words. "Ambulatory Healthcare Services" produced "Santa Barbara
     Ambulatory Healthcare Services", which reads like a directory entry rather
     than a business. The TAIL is the useful half ("Healthcare Services",
     "Care Services"); the leading qualifier is what makes it clumsy. */
  const words = pick.split(/\s+/);
  const capped = words.length > 2 ? words.slice(-2).join(" ") : pick;
  return capped.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* The prospect's site with Invoca's opportunity-reference token appended, which
   is what makes the click traceable back to this placement. Built with URL()
   rather than string concatenation so it lands as a proper query parameter
   whether or not the domain already carries one. */
const OPP_REF = "gAAAAABqZosEcRIQ_xkq";

export function trackedSiteUrl(domain: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const u = new URL(`https://${host}`);
  u.searchParams.set("oppref", OPP_REF);
  return u.toString();
}

/* =============================================================================
   THE CITY TABLE — coordinates AND state in ONE entry
   -----------------------------------------------------------------------------
   ⚠️⚠️ **ONE ENTRY CARRIES BOTH BECAUSE THE TWO HALVES MUST NEVER BE COMBINED FROM
   DIFFERENT SOURCES.** This file already warned that "label and coordinates must always
   resolve TOGETHER" after a fallback city was recombined with a live screenpop state and
   printed "Santa Barbara, TX" for Reyes Law. `GoogleSearch` was STILL doing the same thing
   as of 9/8/2026 — completing a city from this table with `voiceScreenpop.state`, i.e. the
   CALLER's state — so the state now travels with the city and no caller has to be consulted.

   ⚠️⚠️ **THE COORDINATES ARE THE HAND-CHECKED ONES; DO NOT BULK-REPLACE THEM FROM A
   GEOCODER.** Verified 9/8/2026 by geocoding every key through the Google Places API: 39 of
   41 agreed to within 0.05 degrees, and the two that disagreed showed the API was WRONG for
   this app, not the table — a bare city name is ambiguous, so "washington" came back as
   Washington STATE and "duluth" as Duluth MINNESOTA, where this app means Washington DC and
   Duluth GEORGIA (metro Atlanta, the same place `ZIP_PLACE` maps 30097 to). Their states are
   therefore set by hand and marked below.

   ⚠️ **AMBIGUITY IS THE STANDING LIMITATION OF SUBSTRING MATCHING HERE.** Keys are matched by
   longest-substring against a location NAME, so a key cannot be qualified by state:
   "greensboro" resolves to Greensboro GA because that is where the one prospect naming it
   actually is, and a future prospect with a Greensboro NC office would get Georgia. Prefer
   adding a key only when a real prospect needs it, and leave the rest to the ZIP override on
   the search screen, which resolves any US ZIP for real.
   ============================================================================= */
const CITIES: Record<string, { ll: [number, number]; st: string }> = {
  "atlanta": { ll: [33.7490, -84.3880], st: "GA" },
  "austin": { ll: [30.2672, -97.7431], st: "TX" },
  "baltimore": { ll: [39.2904, -76.6122], st: "MD" },
  "boston": { ll: [42.3601, -71.0589], st: "MA" },
  "charlotte": { ll: [35.2271, -80.8431], st: "NC" },
  "chicago": { ll: [41.8781, -87.6298], st: "IL" },
  "cleveland": { ll: [41.4993, -81.6944], st: "OH" },
  "columbus": { ll: [39.9612, -82.9988], st: "OH" },
  "dallas": { ll: [32.7767, -96.7970], st: "TX" },
  "denver": { ll: [39.7392, -104.9903], st: "CO" },
  "detroit": { ll: [42.3314, -83.0458], st: "MI" },
  /* ⚠️ Duluth GA (metro Atlanta), not Minnesota — see above. */
  "duluth": { ll: [34.0029, -84.1446], st: "GA" },
  "fort worth": { ll: [32.7555, -97.3308], st: "TX" },
  "greensboro": { ll: [33.5757, -83.1824], st: "GA" },
  "houston": { ll: [29.7604, -95.3698], st: "TX" },
  "jacksonville": { ll: [30.3322, -81.6557], st: "FL" },
  "kansas city": { ll: [39.0997, -94.5786], st: "MO" },
  "las vegas": { ll: [36.1699, -115.1398], st: "NV" },
  "los angeles": { ll: [34.0522, -118.2437], st: "CA" },
  "miami": { ll: [25.7617, -80.1918], st: "FL" },
  "minneapolis": { ll: [44.9778, -93.2650], st: "MN" },
  "nashville": { ll: [36.1627, -86.7816], st: "TN" },
  "new york": { ll: [40.7128, -74.0060], st: "NY" },
  "orlando": { ll: [28.5383, -81.3792], st: "FL" },
  "philadelphia": { ll: [39.9526, -75.1652], st: "PA" },
  "phoenix": { ll: [33.4484, -112.0740], st: "AZ" },
  "pittsburgh": { ll: [40.4406, -79.9959], st: "PA" },
  "portland": { ll: [45.5152, -122.6784], st: "OR" },
  "raleigh": { ll: [35.7796, -78.6382], st: "NC" },
  "richmond": { ll: [37.5407, -77.4360], st: "VA" },
  "sacramento": { ll: [38.5816, -121.4944], st: "CA" },
  "salt lake city": { ll: [40.7608, -111.8910], st: "UT" },
  "san antonio": { ll: [29.4241, -98.4936], st: "TX" },
  "san diego": { ll: [32.7157, -117.1611], st: "CA" },
  "san francisco": { ll: [37.7749, -122.4194], st: "CA" },
  "san jose": { ll: [37.3382, -121.8863], st: "CA" },
  "santa barbara": { ll: [34.4208, -119.6982], st: "CA" },
  "seattle": { ll: [47.6062, -122.3321], st: "WA" },
  "tampa": { ll: [27.9506, -82.4572], st: "FL" },
  "thousand oaks": { ll: [34.1706, -118.8376], st: "CA" },
  /* ⚠️ DC, not the state — see above. */
  "washington": { ll: [38.9072, -77.0369], st: "DC" },
  "winter park": { ll: [28.6000, -81.3392], st: "FL" },
};

/* =============================================================================
   WHERE THE BUSINESS ACTUALLY IS
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THE LOCATION MUST BE ONE OF THE PROSPECT'S OWN LOCATIONS (9/8/2026).** Asked for
   directly, looking at the search screen: *"In the past i asked you to default to Santa
   Barbara, CA for the location, i no longer want you to do that, the location has to be one
   of the locations where the business actually is."*

   ⚠️⚠️ **TWO SEPARATE DEFECTS WERE FOUND BY MEASURING ALL 27 PROFILES, and the second was
   the worse one:**
     1. **12 of 27 fell back to Santa Barbara** — and every one of them had real locations
        sitting unused two fields away. Reyes Law has Dallas, Houston and Fort Worth offices;
        Vector Security has Pittsburgh and Philadelphia; Roto-Rooter has Chicago.
     2. **14 prospects showed the SCREENPOP CALLER'S CITY as though it were the company's.**
        That source was second in the old preference order, and a caller is a CUSTOMER, not a
        location — Mattress Firm rendered "Portland, OR" while its stores are Houston, Dallas
        and Atlanta. It is dropped entirely as a location source.

   `opsDashboard.locationHandling` is the right source and was already there: it is a
   COMPLETE PARTITION of the prospect's call volume by site, every profile carries four rows,
   and the Location Comparison dashboard renders the same names. Measured after the change:
   20 of 23 prospects resolve to one of their own locations.
   ============================================================================= */

/** The full table entry for the longest city key contained in `text`. */
function matchCity(text: string): { key: string; ll: [number, number]; st: string } | null {
  const s = text.toLowerCase();
  let best = "";
  for (const k of Object.keys(CITIES)) if (s.includes(k) && k.length > best.length) best = k;
  return best ? { key: best, ...CITIES[best] } : null;
}

/** "pittsburgh" -> "Pittsburgh, PA" — one canonical format, state included. */
function cityLabel(key: string, st: string): string {
  return `${key.replace(/\b\w/g, (c) => c.toUpperCase())}, ${st}`;
}

/**
 * The prospect's own site names, in the order the dashboard lists them.
 *
 * ⚠️ THE COLUMN IS FOUND BY HEADER, never by index — the standing rule for these tables,
 * because the engine reordering `locationHandling.columns` would otherwise silently hand back
 * a call count where a place name is expected. Rows are `{ cells: [...] }`; there is no
 * `name` field, which is what made a first probe of this report a false negative.
 */
export function companyLocations(p: CustomerProfile): string[] {
  const lh = p.reports.opsDashboard?.locationHandling;
  if (!lh?.rows?.length) return [];
  const i = lh.columns.findIndex((c) => /location|office|branch|store|site|facility|clinic|center|centre/i.test(c));
  const col = i === -1 ? 0 : i;
  return lh.rows.map((r) => r.cells?.[col]).filter((x): x is string => !!x && x.trim().length > 0);
}

export interface ResolvedPlace {
  /** "Pittsburgh, PA" */
  label: string;
  ll: [number, number];
  st: string;
  /** Which of the prospect's own fields answered, for the audit and for `address`. */
  source: "location" | "serviceArea" | "zip" | "fallback";
  /** The site name that matched, when a location row did. */
  matched?: string;
}

/**
 * Resolve where the business is, from the prospect's own data only.
 *
 * ⚠️ **A CALLER'S CITY IS NOT A COMPANY LOCATION** and is deliberately absent from this
 * order. See the note above for what that produced.
 * ⚠️ **THE FALLBACK IS KEPT ON PURPOSE, and is now reachable by almost nothing.** Asked for
 * when the three profiles that name no place anywhere were put to the user: Marriott, whose
 * "locations" are reservation centres rather than hotels, and the two fictional healthcare
 * demos, whose clinic names are invented. Every other prospect resolves from its own data,
 * and an SE can override any of them by ZIP on the search screen.
 */
export function companyPlace(p: CustomerProfile): ResolvedPlace {
  for (const name of companyLocations(p)) {
    const hit = matchCity(name);
    if (hit) return { label: cityLabel(hit.key, hit.st), ll: hit.ll, st: hit.st, source: "location", matched: name };
  }
  /* The prospect's own stated service area, scanned rather than trimmed to a short label:
     Reynolds Lake Oconee's reads "the Reynolds Lake Oconee community in Greensboro, Georgia,
     ZIP code 30642, about 85 miles east of Atlanta", which `shortArea`'s 34-character cap
     threw away whole even though the city it names is right there. */
  const area = p.reports.agentConfig?.serviceArea;
  if (area) {
    const hit = matchCity(area);
    if (hit) return { label: cityLabel(hit.key, hit.st), ll: hit.ll, st: hit.st, source: "serviceArea" };
  }
  return { label: DEFAULT_PLACE.label, ll: DEFAULT_PLACE.ll, st: "CA", source: "fallback" };
}

/* Kept as the shape every existing caller expects. */
const CITY_LL: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(CITIES).map(([k, v]) => [k, v.ll]),
);

/* An exact key lookup silently mismatched: "Dallas–Fort Worth Metroplex" isn't
   a key, so it fell back to San Francisco while the label still read Dallas —
   a wrong map is worse than an obviously generic one. So scan for the longest
   table key CONTAINED in the string ("dallas" inside the Metroplex, "greater
   Orlando and Central Florida" → orlando). San Francisco stays the fallback
   only when nothing matches at all. */
/* Where the map lands when we can't resolve the prospect's location at all.
   The Santa Barbara office address (2930 De La Vina St, 93105), geocoded once
   via Nominatim rather than eyeballed off a map. */
const DEFAULT_PLACE = {
  label: "Santa Barbara, CA",
  ll: [34.4382504, -119.7275035] as [number, number],
};

/* Returns null when nothing matches, so the caller falls back label-and-all.
   Scans for the longest table key CONTAINED in the string ("dallas" inside
   "Dallas-Fort Worth Metroplex", "orlando" inside "greater Orlando and
   Central Florida") — an exact-key lookup silently mismatched those. */
export function lookupLL(place: string): [number, number] | null {
  const s = place.toLowerCase();
  let best = "";
  for (const k of Object.keys(CITY_LL)) {
    if (s.includes(k) && k.length > best.length) best = k;
  }
  return best ? CITY_LL[best] : null;
}

export const Z = 12, TS = 256;

export function tileXY(lat: number, lon: number) {
  const n = 2 ** Z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

/* A Mapbox PUBLIC token (pk.…) is designed to ship in browser code, which is
   why this one carries the VITE_ prefix while every other key in .env stays
   server-side. It should be URL-restricted in the Mapbox dashboard. The full
   reasoning, and why Mapbox rather than CARTO, is with MapCard in
   screens/ChatGptAd.tsx. */
/* ⚠️ OPTIONAL-CHAINED SO NODE CAN IMPORT THIS MODULE AT ALL. `import.meta.env` is a
   Vite-only builtin and is `undefined` under plain Node, so a bare `.VITE_MAPBOX_TOKEN`
   threw at import time — which meant nothing in this file could be measured or audited
   outside a browser, and `derive()` is the shared source of truth for two screens. Same
   wall that sent the workflow chrome constants to `workflowChrome.ts`. */
export const MAPBOX_TOKEN = (import.meta.env as Record<string, string | undefined> | undefined)
  ?.VITE_MAPBOX_TOKEN;

/* =============================================================================
   THE PAID AD'S CREATIVE — the prospect's own campaign, not a template
   -----------------------------------------------------------------------------
   Asked for 9/8/2026, looking at Aptive's sponsored result: *"just like a sponsored ad on
   google, lets change the top title to a creative campaign personalized to the prospect. and
   same for the search term, like now it says 'best quarterly near me' which make no sense for
   this aptive prospect."*

   ⚠️⚠️ **THE QUERY BUG WAS ALREADY FOUND AND FIXED ONCE, ON A DIFFERENT SCREEN.** The old
   query was `best <searchSuggestions[0]> near me`, and `searchSuggestions` is a list of CALL
   REVIEW TRANSCRIPT WORDS — so Aptive's read "best quarterly near me" (quarterly is how often
   its plans run), American Home Shield's "best gold near me" (a plan TIER), and Avi & Co's
   "best daytona near me". This file's own comment even warned the list "is just as likely to
   hold a process word", and guarded only against a hardcoded list of process words that
   "quarterly" is not on. `google-ads-demo.js` had the same defect and the fix is recorded in
   CLAUDE.md verbatim: use the top **Calls by Search Term** row, "a real phrase somebody
   types". It was never carried across to this module. Measured across all 23 prospects, the
   search-term row is better every single time.

   ⚠️ **THE CREATIVE IS THE PROSPECT'S OWN CAMPAIGN NAME.** `Calls by Campaign` rows are
   human-written advertiser copy specific to the business — "Freedom From Glasses",
   "Elevating the Human Spirit", "Smart Home. Smarter Decision.", "Turn 62", "$1B+ Recovered".
   Nothing we could invent would be more personalised than that, and the ad already carries
   the same campaign in its `utm_campaign`, so the creative and the click now tell one story.
   ============================================================================= */

/** The creative half of a campaign row: "Pest Control Near Me, Exact" -> "Pest Control Near Me". */
function campaignThemes(p: CustomerProfile): { theme: string; full: string }[] {
  const rows = p.reports.marketingDashboard.breakdowns
    .find((b) => /campaign/i.test(b.title))?.rows ?? [];
  return rows.map((r) => ({ theme: r.name.split(",")[0].trim(), full: r.name }))
    .filter((x) => x.theme);
}

/**
 * Is this theme a bare keyword rather than creative?
 *
 * ⚠️ A campaign named "Pest Control Near Me" or "Tires Near Me Search" is how an advertiser
 * labels an exact-match keyword group, not a headline anybody wrote. Those are skipped for
 * slot 1 in favour of the product, so the ad does not simply restate the search box.
 */
function isKeywordish(theme: string): boolean {
  return /near (me|you)\b|\bexact\b|\bsearch\b|\bbranded\b|\blocal pages\b|retargeting|conquesting/i.test(theme);
}

const PROMO = /offer|free|save|sale|deal|promo|special|financing|rebate|savings|\$|%|guarantee|bundle|event|discount/i;

/** A short benefit line, from a promotional campaign or from the prospect's own offer text. */
function offerHook(p: CustomerProfile, themes: string[], skip?: string): string | null {
  const promo = themes.find((t) => t !== skip && PROMO.test(t) && t.length <= 34 && !isKeywordish(t));
  if (promo) return promo;

  const offer = p.reports.agentConfig?.smsPlaybook?.offer ?? "";
  /* ⚠️ CAPITALISED WORDS ONLY AFTER "free", AND THAT IS WHY. A loose `free\s+(\w+...)` gave
     Big O Tires "Free With A Free" and Discount Tire "Free On Qualifying Sets" — it swallowed
     prepositions and stopped before the noun. Requiring the named thing to be capitalised
     ("a free ProAct Inspection") matches how these offers are actually written and produces
     nothing rather than nonsense when it is not. */
  const free = offer.match(/\bfree\s+((?:[A-Z][\w'-]+)(?:\s+[A-Z][\w'-]+){0,2})/);
  /* ⚠️ NEVER "Free <booking>" — the same false claim `offer` already refuses, because a
     medical appointment being free is not something this demo may assert. */
  if (free && !new RegExp(`^${p.bookingTerm}s?$`, "i").test(free[1])) return `Free ${free[1]}`;

  const pct = offer.match(/(\d{1,2})%\s*(?:off|discount)/i);
  if (pct) return `${pct[1]}% Off`;
  return null;
}

export interface AdCreative {
  /** The pipe-separated headline, in Google's own shape. */
  headline: string;
  /** The campaign's creative half, used as the headline's lead. */
  campaign: string;
  /** Its FULL row name, match type and all, which is what `utm_campaign` carries — so the
      click is traceable to the row an SE can then open on the Marketing dashboard. */
  campaignFull: string;
  /** The paid keyword, i.e. what the searcher typed. */
  query: string;
}

/** How many significant words two strings share — the ad-group rule from google-ads-demo. */
function overlap(a: string, b: string): number {
  const stop = new Set(["the", "and", "for", "near", "me", "you", "a", "an", "of", "in", "my", "your"]);
  const wa = new Set(a.toLowerCase().match(/[a-z0-9$]{3,}/g)?.filter((w) => !stop.has(w)) ?? []);
  return (b.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? []).filter((w) => !stop.has(w) && wa.has(w)).length;
}

/**
 * The prospect's paid ad: what was searched, which campaign answered, and its creative.
 *
 * ⚠️ **THE CAMPAIGN IS CHOSEN BY MATCHING THE QUERY**, two significant words minimum — the
 * same threshold `google-ads-demo.js` settled on for pairing a keyword to an ad group, after
 * one shared word matched "continuing CARE" to "Memory Care". So the ad an SE sees is the one
 * that campaign would really have served, and `utm_campaign` names it.
 */
export function adCreative(p: CustomerProfile, shortCity: string, hero: string, fallbackQuery: string): AdCreative {
  const terms = p.reports.marketingDashboard.breakdowns
    .find((b) => /search term/i.test(b.title))?.rows ?? [];
  const query = terms[0]?.name?.trim() || fallbackQuery;

  const camps = campaignThemes(p);
  const matched = camps
    .map((c) => ({ c, n: overlap(query, c.theme) }))
    .filter((x) => x.n >= 2)
    /* Stable sort, so equal scores keep the dashboard's own order — which is call volume
       descending, i.e. the biggest campaign wins a tie. */
    .sort((a, b) => b.n - a.n)[0]?.c;
  const chosen = matched ?? camps[0] ?? { theme: `${hero} Search`, full: `${hero} Search` };
  const campaign = chosen.theme;
  const themes = camps.map((c) => c.theme);

  /* Slot 1: the creative if somebody wrote one, else the PRODUCT — but only when the product
     is what was searched for.
     ⚠️ **MEASURED: AN UNGATED HERO ADVERTISED THE WRONG SERVICE.** Orlando Health's biggest
     product category is its Cancer Institute and its top search term is "emergency room near
     me", so falling back to the hero headlined an ER search with "Cancer Institute" —
     plausible-looking and wrong, which is the worst combination on a screen a prospect reads.
     The product leads only when it shares a significant word with the query; otherwise the
     campaign's own name does, which by construction is the one that matched the search. */
  const creative = campaign && !isKeywordish(campaign) && campaign.length <= 40 ? campaign : null;
  const lead = creative ?? (overlap(query, hero) >= 1 ? hero : campaign || hero);
  const hook = offerHook(p, themes, lead);
  const cta = `${p.bookingTerm}s in ${shortCity}`;

  /* ⚠️ CAPPED AND TRIMMED FROM THE RIGHT. Google shows roughly 90 characters of headline;
     past that it truncates mid-word, which reads as a broken template rather than an ad.
     Slot 3 goes first, then slot 2, so the creative itself always survives. */
  const slots = [lead, hook, cta].filter((x): x is string => !!x);
  while (slots.length > 1 && slots.join(" | ").length > 90) slots.splice(slots.length - 1, 1);
  return { headline: slots.join(" | "), campaign, campaignFull: chosen.full, query };
}

export function derive(p: CustomerProfile, override?: ResolvedPlace) {
  const r = p.reports;
  const products = r.marketingDashboard.breakdowns
    .find((b) => /Product Category/i.test(b.title))?.rows.map((x) => x.name) ?? [];
  // The hero product is the biggest category. `searchSuggestions` sometimes has
  // a better, more specific word ("lasik", "tempur-pedic") — but it's a list of
  // CALL-REVIEW search terms, so it's just as likely to hold a process word,
  // which turns the query into nonsense ("best appointment near me", "best
  // entrance fee near me"). Take it only when it looks like a product.
  const hero = products[0] ?? p.industry;
  const term = r.callReview?.searchSuggestions?.[0];
  const isProcessWord =
    !term ||
    new RegExp(`\\b${term}\\b`, "i").test(p.bookingTerm) ||
    /appoint|consult|tour|quote|estimate|price|pricing|cost|fee|financ|warrant|install|monitor|cancel|schedul|book|drive|service|support|billing/i.test(term);

  // The avatar is the CALLER from the screenpop, not the prospect — the person
  // searching here is the same one who shows up on the agent's screen later.
  const caller = r.voiceScreenpop?.callerName ?? "";
  const initials = caller.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join("").toUpperCase() || "A";

  /* Where the map centres, and the label beside it. ONE resolution, so the city, its state
     and its coordinates can never come from different places. `override` is the SE's own ZIP
     choice from the search screen when they have made one. */
  const vs = r.voiceScreenpop;
  const place = override ?? companyPlace(p);
  const usedFallback = place.source === "fallback";
  const city = place.label;
  const coords = place.ll;

  /* The organic results. The prospect is ALWAYS first. The others are built
     from the city + category rather than invented business names — this is a
     mock-up, and naming plausible-sounding real competitors with fabricated
     star ratings is not something to put on a screen. */
  /* A short city for business names and the footer. The full label can be a
     region ("Dallas–Fort Worth Metroplex", "Orlando and Central Florida"),
     which reads wrong inside a name — "Dallas–Fort Worth Metroplex Vision
     Care". Cut at the first dash or "and". */
  const shortCity = city.split(",")[0].split(/\s*[–—-]\s*|\s+and\s+/i)[0].trim();
  /* Competitor names are built from the CITY + the industry, not the product
     category. Product-based templates broke on healthcare — Key-Whitman's
     category is "LASIK / EVO ICL", which produced "LASIK / EVO ICL Warehouse".
     The industry's first segment ("Ophthalmology", "Window treatments") reads
     as a business name in every vertical. Bullets are neutral for the same
     reason: "off-the-shelf sizes" is nonsense for an eye clinic. */
  const seg = industrySeg(p.industry);
  /* Competitor names must not collide with the prospect's own name. The plain
     "<City> <Industry>" template produced "Orlando Health Systems" alongside
     the real client "Orlando Health" — indistinguishable at a glance and the
     kind of thing that derails a demo. Reject any candidate sharing two or
     more significant words with the prospect and take the next pattern. */
  const sig = (t: string) =>
    new Set(t.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
  const brandWords = sig(p.customerName);
  const collides = (n: string) => {
    let shared = 0;
    for (const w of sig(n)) if (brandWords.has(w)) shared++;
    return shared >= 2;
  };
  const rivals = [
    `${shortCity} ${seg}`, `Premier ${seg}`, `${seg} of ${shortCity}`,
    `Summit ${seg}`, `Cornerstone ${seg}`, `First Choice ${seg}`,
  ].filter((n) => !collides(n)).slice(0, 3);

  const places = [
    { name: p.customerName, rating: "4.9", type: hero, prospect: true,
      /* NOT "Free <booking>s" — same false claim that was already fixed in the
         ad headline; a hospital does not offer free appointments. */
      a: `Books ${p.bookingTerm.toLowerCase()}s over the phone, usually with same-week availability.`,
      b: "Strong reviews for getting people booked in quickly." },
    { name: rivals[0], rating: "4.7", type: seg, prospect: false,
      a: "Long-established locally, with a high volume of reviews.",
      b: "Good if you want to talk options through in person first." },
    { name: rivals[1], rating: "4.6", type: seg, prospect: false,
      a: "Competitive on price, though waits can run longer at busy times.",
      b: "Worth a call if budget is the deciding factor." },
    { name: rivals[2], rating: "4.4", type: seg, prospect: false,
      a: "Broad range of services, less specialised in any one of them.",
      b: "Fine for something straightforward." },
  ];

  /* The drawer wants a street address. We only have one for the fallback
     location, so anywhere else shows city/state rather than inventing a
     street that doesn't exist. */
  /* Keyed off whether we actually FELL BACK, not off the label matching. A
     prospect that legitimately resolves to Santa Barbara, CA compared equal to
     the fallback label and got handed the De La Vina street address — which is
     Vector Security's screenpop city, so it printed a street it has no
     connection to. */
  const address = usedFallback
    ? "2930 De La Vina St, Santa Barbara, CA 93105"
    : `${shortCity}, ${place.st}`;

  return {
    city, shortCity, places, coords, address, seg,
    /* The state that BELONGS to `city`. Screens must use this rather than reaching for
       `voiceScreenpop.state`, which is the caller's and produced "Santa Barbara, TX". */
    state: place.st, placeSource: place.source, matchedLocation: place.matched,
    /* ⚠️ THE REAL SEARCH TERM, not a phrase built from a transcript word. `isProcessWord`
       and the `best … near me` construction survive only as the fallback for a profile with
       no Search Term breakdown; every profile on disk has one. */
    ...(() => {
      const ad = adCreative(p, shortCity, hero, `best ${(isProcessWord ? hero : term!).toLowerCase()} near me`);
      return { query: ad.query, adHeadline: ad.headline, adCampaign: ad.campaignFull };
    })(),
    hero,
    others: products.slice(1, 4),
    brand: p.customerName,
    domain: p.brandDomain,
    icon: r.voiceRoutingDemo?.brandIcon ?? "◆",
    phone: r.voiceScreenpop?.callerPhone ?? "(805) 555-0142",
    // NOT "Free <booking>" — that's a false claim for verticals where the
    // booking is a medical appointment. Availability works everywhere.
    offer: `${p.bookingTerm} availability this week`,
    area: shortArea(r.agentConfig?.serviceArea),
    booking: p.bookingTerm.toLowerCase(),
    initials,
  };
}
