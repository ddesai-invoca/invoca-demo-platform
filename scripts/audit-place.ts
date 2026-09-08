/* =============================================================================
   audit-place.ts — the search screen's location is one the business actually has
   -----------------------------------------------------------------------------
   Asked for 9/8/2026: "the location has to be one of the locations where the business
   actually is." Two defects were measured before the fix — 12 of 27 profiles fell back to a
   hardcoded Santa Barbara, and 14 showed the screenpop CALLER's city as though it were the
   company's. Neither showed up as a type error, and neither was visible on the screen unless
   you happened to know where that prospect's sites are, which is exactly why this exists.

   ⚠️ This file could not be audited at all until `prospectPlace.ts`'s Mapbox token read was
   optional-chained: `import.meta.env` is a Vite builtin and threw under plain Node.
   ============================================================================= */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { derive, companyPlace, companyLocations } from "../src/data/prospectPlace.ts";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");

function load(dir: string, unwrap: (j: any) => any) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => unwrap(JSON.parse(read(join(dir, f)))))
    .filter((p) => p?.customerName);
}
const all = [...load("src/data/generated", (j) => j), ...load(".data/demos", (j) => j.profile)];
const seen = new Set<string>();
const profiles = all.filter((p) => !seen.has(p.customerName) && seen.add(p.customerName));

/* ⚠️ THE ONLY PROSPECTS ALLOWED TO FALL BACK, NAMED. Marriott's "locations" are reservation
   centres rather than hotels; the other two are fictional healthcare demos whose clinic
   names are invented. Keeping the fallback for exactly these was the user's own call when the
   three were put to them. A NEW name appearing here means a prospect lost its real location,
   which is the regression this check is for. */
const MAY_FALL_BACK = new Set(["Marriott", "Health Spring (preview)", "Surfside Healthcare"]);

console.log(`\nLocation resolution across ${profiles.length} prospects\n`);
let fellBack = 0, fromOwn = 0;
for (const p of profiles) {
  const place = companyPlace(p);
  if (place.source === "fallback") {
    fellBack++;
    if (!MAY_FALL_BACK.has(p.customerName)) bad(`${p.customerName} falls back to a location it has no connection to`);
    continue;
  }
  fromOwn++;
  /* ⚠️ THE CLAIM IS CHECKED AGAINST THE SOURCE, not merely recorded. A city that does not
     appear in the row it says it came from is the "Santa Barbara, TX" failure one level up. */
  const bare = place.label.split(",")[0].toLowerCase();
  const src = place.source === "location"
    ? (place.matched ?? "")
    : String(p.reports.agentConfig?.serviceArea ?? "");
  if (!src.toLowerCase().includes(bare)) {
    bad(`${p.customerName}: shows "${place.label}" but its ${place.source} reads "${src.slice(0, 60)}"`);
  }
  if (!/^[A-Z]{2}$/.test(place.st)) bad(`${p.customerName}: state "${place.st}" is not a 2-letter code`);
  if (!Number.isFinite(place.ll[0]) || !Number.isFinite(place.ll[1])) bad(`${p.customerName}: coordinates are not finite`);
}
fromOwn >= profiles.length - MAY_FALL_BACK.size
  ? ok(`${fromOwn} of ${profiles.length} resolve from the prospect's own locations`)
  : bad(`only ${fromOwn} of ${profiles.length} resolve from their own locations`);
fellBack <= MAY_FALL_BACK.size
  ? ok(`only the ${fellBack} prospect(s) that name no place anywhere fall back`)
  : bad(`${fellBack} prospects fall back — more than the ${MAY_FALL_BACK.size} that legitimately name no place`);

/* ⚠️ A CALLER IS NOT A LOCATION. The screenpop city was the SECOND source in the old order,
   which is what rendered Portland for a Mattress Firm whose stores are Houston/Dallas/Atlanta. */
{
  const src = read("src/data/prospectPlace.ts");
  const resolver = src.slice(src.indexOf("export function companyPlace"), src.indexOf("/* Kept as the shape"));
  !/voiceScreenpop/.test(resolver)
    ? ok("the resolver never consults the screenpop caller")
    : bad("the caller's city is back in the location resolver");

  /* The two the geocoder gets wrong for this app, pinned. */
  /"washington":\s*\{[^}]*st:\s*"DC"/.test(src)
    ? ok('"washington" is DC, not the state')
    : bad('"washington" is no longer DC — a geocoder probably overwrote it');
  /"duluth":\s*\{[^}]*st:\s*"GA"/.test(src)
    ? ok('"duluth" is GA (metro Atlanta), not Minnesota')
    : bad('"duluth" is no longer GA');

  /* Every entry carries both halves, so a label can never borrow someone else's state. */
  const entries = [...src.matchAll(/"([a-z .]+)":\s*\{\s*ll:\s*\[[^\]]+\],\s*st:\s*"([A-Z?]{2})"/g)];
  entries.length >= 42 && entries.every(([, , st]) => /^[A-Z]{2}$/.test(st))
    ? ok(`all ${entries.length} cities carry coordinates AND a state`)
    : bad(`only ${entries.length} well-formed city entries — some are missing a state`);
}

/* ⚠️ THE SCREEN MUST NOT RE-DERIVE THE STATE. It read `voiceScreenpop.state` until 9/8/2026,
   completing a city from the table with the CALLER's state. */
{
  const gs = read("src/screens/GoogleSearch.tsx");
  !/voiceScreenpop\?\.state/.test(gs)
    ? ok("the search screen no longer builds its label from the caller's state")
    : bad("the search screen is reading voiceScreenpop.state again");
  /d\.state/.test(gs) ? ok("it uses the state that belongs to the resolved city")
    : bad("the search screen is not using derive's own state");
}

/* ---- the ZIP override ---------------------------------------------------------------- */
{
  const pl = read("engine/places.ts");
  /export async function geocodeZip/.test(pl) ? ok("geocodeZip exists") : bad("geocodeZip is gone");
  /\^\\d\{5\}\$/.test(pl) ? ok("it accepts only a 5-digit US ZIP") : bad("the ZIP shape is no longer validated");
  /* ⚠️ Places answers a NEARBY place for a ZIP it does not know, which would move the map
     somewhere the SE did not type. A mismatch must be treated as unresolved. */
  /m\[3\] === z/.test(pl)
    ? ok("a returned ZIP that differs from the one asked for is refused")
    : bad("geocodeZip no longer checks the ZIP it got back — the map can land elsewhere");
  /* ⚠️ COMMENTS ARE STRIPPED FIRST, AND THEY HAD TO BE — this check fired on its own
     documentation. `geocodeZip`'s note NAMES the Geocoding API to record that it returns
     REQUEST_DENIED on this project, which is exactly the kind of correct file a
     reddening check gets deleted over. Same fix the vendor scan already needed. */
  const plCode = pl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /places:searchText/.test(plCode) && !/maps\/api\/geocode/.test(plCode)
    ? ok("it uses Places, which is the API actually enabled on this key")
    : bad("it is calling the Geocoding API, which returns REQUEST_DENIED on this project");

  const vite = read("vite.config.ts"), server = read("server.ts");
  /\/api\/zip/.test(vite) && /\/api\/zip/.test(server)
    ? ok("both endpoint twins serve /api/zip")
    : bad("only one twin serves /api/zip — dev and prod disagree");

  const ov = read("src/data/locationOverride.ts");
  /Number\.isFinite/.test(ov)
    ? ok("a stored override is validated before it moves a map")
    : bad("a malformed stored override would be trusted");
  const gs = read("src/screens/GoogleSearch.tsx"), cg = read("src/screens/ChatGptAd.tsx");
  /useLocationOverride/.test(gs) && /useLocationOverride/.test(cg)
    ? ok("both the search and ChatGPT screens honour the same ZIP choice")
    : bad("the two screens can now show one prospect in two different cities");
}


/* =============================================================================
   THE PAID AD'S CREATIVE AND ITS KEYWORD (9/8/2026)
   -----------------------------------------------------------------------------
   Reported as "best quarterly near me which make no sense for this aptive prospect". Both
   halves are per-prospect derivations that LOOK fine on the one screen an SE happens to open,
   which is why they are checked across every profile here.
   ============================================================================= */
{
  console.log("");
  const { adCreative } = await import("../src/data/prospectPlace.ts");
  let ok1 = 0, ok2 = 0;
  for (const p of profiles) {
    const d: any = derive(p);
    const terms = p.reports.marketingDashboard.breakdowns
      .find((b: any) => /search term/i.test(b.title))?.rows ?? [];
    const top = terms[0]?.name?.trim();

    /* ⚠️ THE KEYWORD IS THE PROSPECT'S OWN TOP SEARCH TERM, VERBATIM. The old construction
       was `best <searchSuggestions[0]> near me`, and those are CALL REVIEW TRANSCRIPT WORDS —
       "quarterly", "gold", "daytona". */
    if (top && d.query === top) ok1++;
    else bad(`${p.customerName}: query is "${d.query}" but its top search term is "${top}"`);

    /* ⚠️ AND IT MUST NOT BE THE OLD SHAPE. A profile with no Search Term breakdown may still
       fall back to it, so this is asserted only where a real term exists. */
    if (top && /^best .* near me$/.test(d.query)) bad(`${p.customerName}: query is still the "best … near me" template`);

    const headline: string = d.adHeadline;
    /* Google shows ~90 characters; past that it truncates mid-word. */
    if (headline.length > 90) bad(`${p.customerName}: headline is ${headline.length} chars`);
    if (!headline.includes(" | ")) bad(`${p.customerName}: headline has no second slot`);
    /* ⚠️ NO PROSPECT MAY WEAR THE OLD TEMPLATE, which was one sentence with three words
       swapped for every business on the platform. */
    if (/ in .+ \| .*s This Week$/.test(headline)) bad(`${p.customerName}: headline is the old template`);
    /* ⚠️ EVERY SLOT COMES FROM THE PROSPECT'S OWN DATA. The lead must be one of its campaign
       themes or its hero product — never invented copy. */
    const themes: string[] = (p.reports.marketingDashboard.breakdowns
      .find((b: any) => /campaign/i.test(b.title))?.rows ?? []).map((r: any) => r.name.split(",")[0].trim());
    const lead = headline.split(" | ")[0];
    if (themes.includes(lead) || lead === d.hero) ok2++;
    else bad(`${p.customerName}: headline leads with "${lead}", which is neither a campaign nor its hero product`);

    /* ⚠️ THE LEAD MUST BE RELEVANT TO WHAT WAS SEARCHED. Ungated, Orlando Health headlined an
       "emergency room near me" search with "Cancer Institute" — its biggest product category
       and nothing to do with the query. Plausible and wrong is the worst combination here. */
    const sig = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9$]{4,}/g) ?? []));
    const leadWords = sig(lead), qWords = sig(d.query);
    const related = [...leadWords].some((w) => qWords.has(w)) || themes.includes(lead);
    if (!related) bad(`${p.customerName}: headline "${lead}" is unrelated to the query "${d.query}"`);

    /* ⚠️ NEVER "Free <booking>" — the false claim `offer` already refuses, since a free
       medical appointment is not something this demo may assert. */
    if (new RegExp(`free ${p.bookingTerm}`, "i").test(headline)) bad(`${p.customerName}: headline promises a free ${p.bookingTerm}`);

    /* The utm must name the campaign whose creative the headline used. */
    const full: string = adCreative(p, d.shortCity, d.hero, d.query).campaignFull;
    if (!full.startsWith(adCreative(p, d.shortCity, d.hero, d.query).campaign)) {
      bad(`${p.customerName}: utm campaign "${full}" is not the one the headline leads with`);
    }
  }
  ok1 === profiles.length
    ? ok(`all ${ok1} queries are the prospect's own top search term`)
    : bad(`only ${ok1} of ${profiles.length} queries are a real search term`);
  ok2 === profiles.length
    ? ok(`all ${ok2} headlines lead with the prospect's own campaign or product`)
    : bad(`only ${ok2} of ${profiles.length} headlines lead with the prospect's own data`);

  /* ⚠️ THE OLD SOURCE MUST NOT COME BACK as the query. `searchSuggestions` still legitimately
     feeds the Call Review placeholder, so this is scoped to the query expression. */
  const src = read("src/data/prospectPlace.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  /searchSuggestions/.test(src) && !/query: ad\.query/.test(src)
    ? bad("the query is being built from searchSuggestions again")
    : ok("the query no longer comes from Call Review transcript words");

  /* ⚠️ `\b` IN A REGEX HERE IS A REAL HAZARD, and it bit this very change: written through a
     Python heredoc, `isKeywordish`'s word boundaries were saved as literal BACKSPACE bytes
     (0x08). tsc accepts it — a backspace between two slashes is a valid regex — and grep
     renders it invisibly, so the classifier silently matched nothing. Checked as bytes. */
  const raw = readFileSync("src/data/prospectPlace.ts");
  const ctrl = [...raw].filter((b) => b < 9 || (b >= 11 && b <= 12) || (b >= 14 && b <= 31)).length;
  ctrl === 0 ? ok("no corrupted escape bytes in prospectPlace")
    : bad(`${ctrl} control byte(s) in prospectPlace — a \\b was probably saved as a backspace`);
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll location checks passed\n");
process.exit(fail ? 1 : 0);
