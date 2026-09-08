/* Real business data for the ChatGPT sponsored placement: photo, rating, review
   count, address, phone and open/closed.

   Why this exists on top of engine/ogImage.ts: og:image only works for sites
   that answer a server-side fetch, and enterprise marketing sites do not.
   Measured on our own prospects: orlandohealth.com 429, mattressfirm.com 403,
   autonation.com 403, all with a full browser UA, so it is bot protection rather
   than our request shape. Microlink's API refuses the same URLs for the same
   reason. Places has no such problem because we ask Google, not the site.

   Cost/latency shape is deliberately the same as ogImage: NOTHING here runs
   during profile generation. It resolves lazily the first time a prospect's
   ChatGPT page is opened, and the result is cached per prospect for the life of
   the process, so a demo costs one Places call per prospect.

   Requires GOOGLE_PLACES_API_KEY (Places API "New"). SERVER-SIDE ONLY: unlike
   VITE_MAPBOX_TOKEN this is a secret and must never reach the browser, which is
   why it is proxied through /api/place and has no VITE_ prefix. Absent key =>
   returns null and the caller falls back to og:image, then the brand mark. */

export interface PlaceInfo {
  photoUrl?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  phone?: string;
  openNow?: boolean;
  name?: string;
}

const cache = new Map<string, PlaceInfo | null>();

/* A text search ALWAYS returns its best guess, even when the business does not
   exist. Measured: "Shady Blinds Santa Barbara" returned "Santa Barbara Screen &
   Shade" and "Vector Security Santa Barbara" returned "Taurus Protection Inc." —
   real, unrelated companies. Rendering those under the prospect's name would put
   a stranger's phone number, reviews and storefront photo on the screen, and an
   SE could dial it on a call. That is worse than the invented data this replaces.

   So the result is only accepted when every significant word of the prospect's
   name appears in the returned name. "Orlando Health" ⊂ "Orlando Health Orlando
   Regional Medical Center" passes; "Shady Blinds" vs "Santa Barbara Screen &
   Shade" does not. Fictional prospects therefore fall back to the brand mark,
   which is the correct outcome for a business that has no listing. */
const NAME_STOP = new Set(["the", "and", "inc", "llc", "ltd", "corp", "co",
  "company", "group", "usa"]);

const nameWords = (t: string) =>
  (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !NAME_STOP.has(w));

export function nameMatches(prospect: string, found: string): boolean {
  const want = nameWords(prospect);
  if (!want.length) return false;
  const got = new Set(nameWords(found));
  return want.every((w) => got.has(w));
}

/* Places (New) wants an explicit field mask; asking for everything is both
   slower and billed at a higher SKU. These are exactly the fields the flyout
   renders, nothing more. */
const FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours.openNow",
  "places.photos",
].join(",");

export async function fetchPlace(
  name: string,
  city?: string,
  apiKey?: string,
): Promise<PlaceInfo | null> {
  const key = apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !name.trim()) return null;

  const query = [name.trim(), city?.trim()].filter(Boolean).join(" ");
  if (cache.has(query)) return cache.get(query)!;

  let info: PlaceInfo | null = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS,
      },
      // maxResultCount 1: we want the single best match for a named business,
      // not a list to choose from.
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { places?: any[] };
      const p = body?.places?.[0];
      if (p && !nameMatches(name, p.displayName?.text ?? "")) {
        console.warn(`[places] rejected "${p.displayName?.text}" for "${name}" (name mismatch)`);
      }
      if (p && nameMatches(name, p.displayName?.text ?? "")) {
        /* A photo is referenced by name and fetched from a second endpoint. We
           hand back the media URL with the key ALREADY APPLIED server-side, so
           the browser loads an image without ever seeing the secret. */
        const photo = p.photos?.[0]?.name;
        info = {
          name: p.displayName?.text,
          address: p.formattedAddress,
          phone: p.nationalPhoneNumber,
          rating: typeof p.rating === "number" ? p.rating : undefined,
          reviews: p.userRatingCount,
          openNow: p.regularOpeningHours?.openNow,
          photoUrl: photo
            ? `https://places.googleapis.com/v1/${photo}/media` +
              `?maxWidthPx=800&skipHttpRedirect=false&key=${encodeURIComponent(key)}`
            : undefined,
        };
      }
    } else {
      // 403 here usually means the key is restricted to the wrong API or the
      // referrer/IP allowlist excludes the server. Worth seeing in the log.
      console.warn(`[places] ${res.status} for "${query}"`);
    }
  } catch {
    info = null;                       // offline, timeout, quota
  }

  cache.set(query, info);              // negatives cached: don't retry a miss
  return info;
}

/* =============================================================================
   ZIP -> a real place, for the search screen's "Use precise location"
   -----------------------------------------------------------------------------
   Asked for 9/8/2026 alongside the company-location fix: *"for all prospects let add a
   feature, allow users to click on the 'Use precise location' button and give a zipcode to
   change the location."*

   ⚠️⚠️ **A ZIP MUST RESOLVE TO REAL COORDINATES OR NOT AT ALL.** This repo already refused a
   ZIP3-prefix guess for the pre-call artifacts, on the grounds that printing "Atlanta, GA
   30097" when USPS assigns 30097 to Duluth is exactly what the prospect who knows their own
   service area will catch. Same rule here, one level up: the ZIP moves a MAP, so a plausible
   guess puts the pin in the wrong city. Unresolvable means an error the SE can see, never an
   approximation.

   ⚠️ **PLACES, NOT THE GEOCODING API — measured, not assumed.** The obvious call is
   `maps.googleapis.com/maps/api/geocode/json`, and on this project's key it returns
   `REQUEST_DENIED: This API is not activated`. Places Text Search IS enabled (it is what
   `fetchPlace` above already uses) and resolves a bare ZIP perfectly: "85001" comes back
   "Phoenix, AZ 85001, USA" with real coordinates. So this needs no new key and no new API
   enabled in the Cloud Console.
   ============================================================================= */

export interface ZipPlace {
  /** "Phoenix, AZ" — the label the screens show. */
  label: string;
  city: string;
  st: string;
  zip: string;
  ll: [number, number];
}

/* A ZIP resolves to the same place forever, so this is cached for the life of the process
   the way `fetchPlace`'s lookups are. An SE trying a handful of ZIPs mid-demo then pays for
   at most one call each. */
const zipCache = new Map<string, ZipPlace | null>();

export async function geocodeZip(zip: string, apiKey?: string): Promise<ZipPlace | null> {
  const key = apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  const z = String(zip ?? "").trim();
  /* ⚠️ VALIDATED HERE, not just in the UI: this reaches a paid API from a browser, so
     anything that is not a US ZIP is refused before it costs a call. */
  if (!key || !/^\d{5}$/.test(z)) return null;
  if (zipCache.has(z)) return zipCache.get(z)!;

  let out: ZipPlace | null = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.formattedAddress,places.location",
      },
      /* The country qualifier stops a five-digit query matching a postcode elsewhere. */
      body: JSON.stringify({ textQuery: `${z} USA`, maxResultCount: 1 }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { places?: { formattedAddress?: string; location?: { latitude: number; longitude: number } }[] };
      const p = body.places?.[0];
      const addr = p?.formattedAddress ?? "";
      /* "Phoenix, AZ 85001, USA" -> city "Phoenix", state "AZ".
         ⚠️ THE RETURNED ZIP IS CHECKED AGAINST THE ONE ASKED FOR. Places will happily answer
         a nearby place for a ZIP it does not know, which would move the map somewhere the SE
         did not type; a mismatch is treated as unresolved rather than as a near-enough hit. */
      const m = addr.match(/^([^,]+),\s*([A-Z]{2})\s+(\d{5})/);
      if (m && p?.location && m[3] === z) {
        out = {
          label: `${m[1].trim()}, ${m[2]}`,
          city: m[1].trim(),
          st: m[2],
          zip: z,
          ll: [p.location.latitude, p.location.longitude],
        };
      }
    }
  } catch {
    /* A timeout or a network failure is "unresolved"; the endpoint reports it. */
  }
  zipCache.set(z, out);
  return out;
}
