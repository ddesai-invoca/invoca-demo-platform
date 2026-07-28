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
      if (p) {
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
