/* =============================================================================
   serviceCheck — the server half of src/data/serviceArea.ts (10/21/2026).

   Two things only Google can answer, both cached for the life of the process:
     - where a ZIP code really is (`geocodeZip`, already used by "Use precise location");
     - where each of the prospect's locations is, for the ones the offline city table does not
       know. Measured on 100 profiles: the table missed Comfort Keepers' Memphis office, Kia's
       dealerships, Shriners' hospitals and more, and a missing location would have turned a
       real customer away as out of area.
   The SMS agent (engine/chat.ts), the voice prompt (engine/livekitToken.ts) and the Custom CRM
   (POST /api/service-check) all read the answer from here, so the three cannot disagree.
   ============================================================================= */

import { geocodeZip } from "./places.ts";
import { checkService, type ServiceArea, type ServiceCheck, type ServiceHub } from "../src/data/serviceArea.ts";

const hubCache = new Map<string, ServiceHub | null>();

/** Coordinates and "City, ST" for one location name, from Places text search. */
async function geocodeLocation(name: string, customerName: string, apiKey?: string): Promise<ServiceHub | null> {
  const key = apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const query = name.toLowerCase().includes(customerName.toLowerCase().split(/\s+/)[0]) ? name : `${customerName} ${name}`;
  if (hubCache.has(query)) return hubCache.get(query)!;
  let hub: ServiceHub | null = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.formattedAddress,places.location" },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1, regionCode: "US" }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const p = ((await res.json()) as { places?: { formattedAddress?: string; location?: { latitude: number; longitude: number } }[] }).places?.[0];
      /* "123 Main St, Memphis, TN 38117, USA" -> "Memphis, TN". US addresses only: a clinic in
         Abu Dhabi or London is not somewhere a US ZIP can be served from. */
      const m = p?.formattedAddress?.match(/([^,]+),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:,\s*(?:USA|United States))?$/);
      if (m && p?.location) hub = { name, label: `${m[1].trim()}, ${m[2]}`, ll: [p.location.latitude, p.location.longitude] };
    }
  } catch { hub = null; }
  hubCache.set(query, hub);
  return hub;
}

/** The area with every location the table missed looked up. Unchanged when nothing needs it. */
export async function resolveServiceArea(area: ServiceArea, apiKey?: string): Promise<ServiceArea> {
  const known = new Set(area.hubs.map((h) => h.name));
  const missing = (area.locations ?? []).filter((n) => !known.has(n));
  if (!missing.length || area.zips.length) return area;
  const found = (await Promise.all(missing.map((n) => geocodeLocation(n, area.customerName, apiKey)))).filter((h): h is ServiceHub => !!h);
  if (!found.length) return area;
  const hubs = [...area.hubs];
  for (const h of found) if (!hubs.some((x) => x.label === h.label)) hubs.push(h);
  return { ...area, hubs };
}

/** The full answer for one ZIP: where it is, and whether the prospect serves it. */
export async function runServiceCheck(area: ServiceArea, zip: string, apiKey?: string): Promise<{ area: ServiceArea; check: ServiceCheck }> {
  const [resolved, where] = await Promise.all([resolveServiceArea(area, apiKey), geocodeZip(zip)]);
  return { area: resolved, check: checkService(resolved, zip, where ? { zip, label: where.label, ll: where.ll } : null) };
}

/**
 * POST /api/service-check { coverage, zip } -> { check } for the Custom CRM (both servers and
 * the share-scoped route call this, so they cannot drift). The body comes from a browser, so
 * the area is rebuilt from bounded fields rather than trusted whole: it only ever decides which
 * location names are looked up, and there are at most eight of them.
 */
export async function serviceCheckFromBody(body: unknown): Promise<{ status: number; body: unknown }> {
  const b = (body ?? {}) as { coverage?: Partial<ServiceArea>; zip?: unknown };
  const zip = String(b.zip ?? "");
  if (!/^\d{5}$/.test(zip)) return { status: 400, body: { error: "Enter a 5-digit US ZIP code." } };
  const c = b.coverage ?? {};
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
  const strs = (x: unknown, max: number, n: number) => (Array.isArray(x) ? x.map((v) => str(v, n)).filter(Boolean).slice(0, max) : []);
  const area: ServiceArea = {
    customerName: str(c.customerName, 120) || "the business",
    national: c.national === true,
    prefixes: strs(c.prefixes, 12, 5).filter((d) => /^\d{2,5}$/.test(d)),
    zips: strs(c.zips, 200, 5).filter((d) => /^\d{5}$/.test(d)),
    hubs: (Array.isArray(c.hubs) ? c.hubs : []).slice(0, 8).flatMap((h) => {
      const ll = (h as ServiceHub)?.ll;
      return Array.isArray(ll) && ll.length === 2 && ll.every((v) => typeof v === "number" && Number.isFinite(v))
        ? [{ name: str((h as ServiceHub).name, 120), label: str((h as ServiceHub).label, 80), ll: [ll[0], ll[1]] as [number, number] }]
        : [];
    }),
    locations: strs(c.locations, 8, 120),
  };
  const { check } = await runServiceCheck(area, zip);
  return { status: 200, body: { check } };
}

/* ---- the voice worker's lookup (10/21/2026) ---------------------------------------------
   The worker runs on LiveKit Cloud and cannot sign in, so it calls a PUBLIC endpoint. It may
   only ask about calls this server started: the token rides in the call's dispatch metadata,
   carries the call's own service area and an expiry, and is signed with the LiveKit secret. */
import { createHmac, timingSafeEqual } from "node:crypto";

const LOOKUP_TTL_MS = 3 * 60 * 60 * 1000;

export function signServiceLookup(area: ServiceArea, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ a: area, exp: now + LOOKUP_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readServiceLookup(token: string, secret: string, now = Date.now()): ServiceArea | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: ServiceArea; exp?: number };
    return body.a && typeof body.exp === "number" && body.exp > now ? body.a : null;
  } catch { return null; }
}

/** What the voice agent is told back, in one or two spoken sentences' worth of fact. */
export function sayServiceCheck(c: ServiceCheck, customerName: string): string {
  if (!c.label) return `ZIP ${c.zip} could not be found. Ask them to repeat the ZIP code, or which city and state they are in.`;
  const near = c.nearest ? ` The nearest ${customerName} location is ${c.nearest.name} in ${c.nearest.label}, about ${c.nearest.miles} miles away.` : "";
  if (c.serviceable === true) return `ZIP ${c.zip} is in ${c.label}. That is inside ${customerName}'s service area.${near} Confirm it to them by naming ${c.label}.`;
  if (c.serviceable === false) return `ZIP ${c.zip} is in ${c.label}. That is OUTSIDE ${customerName}'s service area.${near} Tell them ${customerName} does not serve ${c.label} yet and where it does serve, then close politely without routing or booking.`;
  return `ZIP ${c.zip} is in ${c.label}. Whether ${customerName} serves it is not known, so say the team will confirm coverage and continue.`;
}

/** POST /api/voice/service-check { token, zip } -> { check, say }. */
export async function voiceServiceCheckFromBody(body: unknown, secret: string | undefined): Promise<{ status: number; body: unknown }> {
  const b = (body ?? {}) as { token?: unknown; zip?: unknown };
  if (!secret) return { status: 501, body: { error: "Not configured." } };
  const area = readServiceLookup(String(b.token ?? ""), secret);
  if (!area) return { status: 401, body: { error: "This lookup has expired." } };
  const zip = String(b.zip ?? "");
  if (!/^\d{5}$/.test(zip)) return { status: 400, body: { error: "Enter a 5-digit US ZIP code.", say: "That is not a five digit ZIP code. Ask them to repeat it." } };
  const { check } = await runServiceCheck(area, zip);
  return { status: 200, body: { check, say: sayServiceCheck(check, area.customerName) } };
}
