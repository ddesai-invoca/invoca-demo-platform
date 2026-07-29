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

const CITY_LL: Record<string, [number, number]> = {
  "san francisco": [37.7749, -122.4194], "santa barbara": [34.4208, -119.6982],
  "los angeles": [34.0522, -118.2437], "san diego": [32.7157, -117.1611],
  "thousand oaks": [34.1706, -118.8376], "sacramento": [38.5816, -121.4944],
  "san jose": [37.3382, -121.8863], "portland": [45.5152, -122.6784],
  "seattle": [47.6062, -122.3321], "phoenix": [33.4484, -112.0740],
  "denver": [39.7392, -104.9903], "dallas": [32.7767, -96.7970],
  "fort worth": [32.7555, -97.3308], "houston": [29.7604, -95.3698],
  "austin": [30.2672, -97.7431], "san antonio": [29.4241, -98.4936],
  "orlando": [28.5383, -81.3792], "winter park": [28.6000, -81.3392],
  "tampa": [27.9506, -82.4572], "miami": [25.7617, -80.1918],
  "jacksonville": [30.3322, -81.6557], "atlanta": [33.7490, -84.3880],
  "charlotte": [35.2271, -80.8431], "raleigh": [35.7796, -78.6382],
  "nashville": [36.1627, -86.7816], "chicago": [41.8781, -87.6298],
  "detroit": [42.3314, -83.0458], "minneapolis": [44.9778, -93.2650],
  "kansas city": [39.0997, -94.5786], "columbus": [39.9612, -82.9988],
  "cleveland": [41.4993, -81.6944], "pittsburgh": [40.4406, -79.9959],
  "philadelphia": [39.9526, -75.1652], "new york": [40.7128, -74.0060],
  "boston": [42.3601, -71.0589], "baltimore": [39.2904, -76.6122],
  "washington": [38.9072, -77.0369], "richmond": [37.5407, -77.4360],
  "las vegas": [36.1699, -115.1398], "salt lake city": [40.7608, -111.8910],
  "duluth": [34.0029, -84.1446],
};

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
export const MAPBOX_TOKEN = (import.meta.env as Record<string, string | undefined>)
  .VITE_MAPBOX_TOKEN;

export function derive(p: CustomerProfile) {
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

  /* Where the map centres. Preference order, per the brief: the prospect's own
     stated area first, then the screenpop location (populated for every
     prospect on disk), then San Francisco as the explicit fallback. There is no
     true HQ field on the profile — if we ever want one it has to come from the
     engine, since only research knows it. */
  const vs = r.voiceScreenpop;
  const stated = shortArea(r.agentConfig?.serviceArea)
    ?? (vs?.city ? `${vs.city}${vs.state ? `, ${vs.state}` : ""}` : undefined);
  /* Label and coordinates resolve TOGETHER and fall back together. An earlier
     version kept the label and swapped only the coordinates when a place
     wasn't in the table, which rendered "Dallas-Fort Worth Metroplex" over a
     map of San Francisco. A wrong map is worse than a generic one. */
  const ll = stated ? lookupLL(stated) : null;
  const usedFallback = !ll;
  const city = ll ? stated! : DEFAULT_PLACE.label;
  const coords = ll ?? DEFAULT_PLACE.ll;

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
    : `${shortCity}${vs?.state ? `, ${vs.state}` : ""}`;

  return {
    city, shortCity, places, coords, address, seg,
    query: `best ${(isProcessWord ? hero : term!).toLowerCase()} near me`,
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
