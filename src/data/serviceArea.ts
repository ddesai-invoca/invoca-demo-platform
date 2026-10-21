/* =============================================================================
   serviceArea — is this ZIP code somewhere the prospect actually serves? (10/21/2026)

   Reported with a CRM screenshot: a Colorado ZIP (80126, Highlands Ranch) read
   "Serviceable: Yes · Chicago service area". Asked for, for every prospect and for both the
   SMS and the voice agent: (1) the right location for the ZIP, (2) a real serviceable answer.

   ⚠️⚠️ MEASURED FIRST: NOTHING WAS CHECKED ANYWHERE. The CRM printed "Yes" for any ZIP, the SMS
   agent was told to "confirm you serve their area" with nothing to check against, and the
   voice prompt's only rule was a demo placeholder that treated "12345" as the one out-of-area
   ZIP. So every answer was yes.

   ONE DEFINITION, read by the SMS agent (engine/chat.ts, server-side, with the ZIP's real
   location from Google), the Custom CRM (the same check on the same lookup) and the voice
   agent (the served areas as facts in its prompt). The area comes from the prospect's OWN data:
     1. an exact ZIP allow-list, when one is configured (the voice spec's `serviceZips`);
     2. ZIP prefixes its stated `serviceArea` names ("ZIP codes starting with 802");
     3. nationwide, when its `serviceArea` says so or the business has no local footprint
        (insurance, finance, hotels, movers, B2B);
     4. otherwise its own locations (`opsDashboard.locationHandling`), resolved to real
        coordinates, with a ZIP served when it is within RADIUS_MILES of one of them.
   Nothing else is guessed: with none of these the answer is `null` ("not verified").

   DOM-free and import.meta-free, so engine/ and the audits can import it.
   ============================================================================= */

import type { CustomerProfile } from "./schema.ts";
import { companyLocations, matchCity, cityLabel } from "./cityTable.ts";
import { intentKindOf } from "./prospectIntent.ts";

/** How far from one of the prospect's own locations a ZIP still counts as served. */
export const RADIUS_MILES = 75;

export interface ServiceHub { name: string; label: string; ll: [number, number] }

export interface ServiceArea {
  customerName: string;
  national: boolean;
  /** ZIP prefixes the prospect's own service-area text names. */
  prefixes: string[];
  /** An exact allow-list (a configured voice spec). */
  zips: string[];
  /** The prospect's own locations, resolved to coordinates where the city table knows them;
   *  the server resolves the rest with Google (engine/serviceCheck.ts). */
  hubs: ServiceHub[];
  /** Every location name, so the server can resolve the ones the table does not know. */
  locations: string[];
}

/** Where a ZIP really is, from Google (engine/places.ts `geocodeZip`). */
export interface ZipLocation { zip: string; label: string; ll: [number, number] }

export interface ServiceCheck {
  zip: string;
  /** "Highlands Ranch, CO", when the ZIP was looked up. */
  label?: string;
  /** true / false, or null when nothing here can decide it. */
  serviceable: boolean | null;
  nearest?: { name: string; label: string; miles: number };
  basis: "zips" | "prefix" | "national" | "distance" | "unknown";
}

/* A contact centre, an online store or a head office is not somewhere a customer is served. */
const NOT_A_SERVICE_POINT = /\b(online|virtual|concierge|reservations?|contact cent(er|re)|call cent(er|re)|headquarters|hq|corporate|support office|member care|sales cent(er|re))\b/i;

const NATIONAL_TEXT = /\b(nationwide|nationally|national coverage|all 50 states|every state|across the (us|u\.s\.|united states|country))\b/i;
/* Businesses whose customer can be anywhere: the ZIP decides the nearest office, never a refusal. */
const NATIONAL_KINDS = new Set(["insurance", "financial", "hospitality", "moving", "b2b"]);

export function serviceAreaFor(p: CustomerProfile, opts: { zips?: string[] } = {}): ServiceArea {
  const text = p.reports.agentConfig?.serviceArea?.trim() ?? "";
  const prefixes: string[] = [];
  const m = text.match(/zip codes?\s+(?:starting|beginning)\s+with\s+([\d\s,]+(?:\s*(?:and|or)\s*\d+)*)/i);
  if (m) for (const d of m[1].match(/\d{2,5}/g) ?? []) prefixes.push(d);
  const hubs: ServiceHub[] = [];
  const seen = new Set<string>();
  const places = companyLocations(p).map((n) => n.trim()).filter((n) => n && !NOT_A_SERVICE_POINT.test(n));
  for (const name of places) {
    const hit = matchCity(name);
    if (!hit || seen.has(hit.key)) continue;
    seen.add(hit.key);
    hubs.push({ name: name.trim(), label: cityLabel(hit.key, hit.st), ll: hit.ll });
  }
  if (!hubs.length && text) {
    const hit = matchCity(text);
    if (hit) hubs.push({ name: cityLabel(hit.key, hit.st), label: cityLabel(hit.key, hit.st), ll: hit.ll });
  }
  const kind = intentKindOf({ industry: p.industry, customerNoun: p.customerNoun, bookingTerm: p.bookingTerm, intentKind: p.intentKind });
  return {
    customerName: p.customerName,
    national: NATIONAL_TEXT.test(text) || NATIONAL_KINDS.has(kind),
    prefixes,
    zips: (opts.zips ?? []).filter((z) => /^\d{5}$/.test(z)),
    hubs,
    locations: places.slice(0, 8),
  };
}

export function milesBetween(a: [number, number], b: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** The answer for one ZIP. `where` is the ZIP's real location, or null when it was not found. */
export function checkService(area: ServiceArea, zip: string, where: ZipLocation | null): ServiceCheck {
  const nearest = where && area.hubs.length
    ? area.hubs
        .map((h) => ({ name: h.name, label: h.label, miles: Math.round(milesBetween(where.ll, h.ll)) }))
        .sort((x, y) => x.miles - y.miles)[0]
    : undefined;
  const base = { zip, ...(where ? { label: where.label } : {}), ...(nearest ? { nearest } : {}) };
  if (area.zips.length) return { ...base, serviceable: area.zips.includes(zip), basis: "zips" };
  /* A stated prefix list is narrower than the region it describes: Denver Health's says "the
     greater Denver area, ZIP codes starting with 802", and a Littleton ZIP (801xx, 13 miles out)
     is plainly greater Denver. So a ZIP close to one of its own locations counts as well. */
  if (area.prefixes.length) return { ...base, serviceable: area.prefixes.some((pre) => zip.startsWith(pre)) || (!!nearest && nearest.miles <= RADIUS_MILES), basis: "prefix" };
  if (area.national) return { ...base, serviceable: true, basis: "national" };
  if (nearest) return { ...base, serviceable: nearest.miles <= RADIUS_MILES, basis: "distance" };
  return { ...base, serviceable: null, basis: "unknown" };
}

/** "Chicago, IL; Dallas, TX and Phoenix, AZ" style list of where the prospect is. */
export function servedPlaces(area: ServiceArea): string {
  const names = area.hubs.map((h) => h.label);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join("; ")} and ${names[names.length - 1]}`;
}

/** One sentence describing the service area, for a prompt. */
export function serviceAreaSummary(area: ServiceArea): string {
  if (area.zips.length) return `${area.customerName} serves these ZIP codes only: ${area.zips.join(", ")}.`;
  if (area.prefixes.length) return `${area.customerName} serves ZIP codes starting with ${area.prefixes.join(", ")}${area.hubs.length ? `, and anywhere within about ${RADIUS_MILES} miles of its locations in ${servedPlaces(area)}` : ""}.`;
  if (area.national) return `${area.customerName} serves customers nationwide.`;
  if (area.hubs.length) return `${area.customerName}'s locations are in ${servedPlaces(area)}; a ZIP code is in the service area when it is within about ${RADIUS_MILES} miles of one of them.`;
  return "";
}
