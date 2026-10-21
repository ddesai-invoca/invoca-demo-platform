/* =============================================================================
   cityTable — the hand-checked city coordinates and the prospect's own location names,
   extracted from prospectPlace.ts on 10/21/2026 so engine/ can import them: prospectPlace
   reads `import.meta.env` (a Vite builtin), which the engine project cannot compile. The
   history of every entry is recorded in prospectPlace.ts, which re-exports these.
   ============================================================================= */
import type { CustomerProfile } from "./schema.ts";

export const CITY_TABLE: Record<string, { ll: [number, number]; st: string }> = {
  "asheville": { ll: [35.5975, -82.5461], st: "NC" },      // Dallas roster: Hopscotch Primary Care
  "atlanta": { ll: [33.7490, -84.3880], st: "GA" },
  "austin": { ll: [30.2672, -97.7431], st: "TX" },
  "baltimore": { ll: [39.2904, -76.6122], st: "MD" },
  "boston": { ll: [42.3601, -71.0589], st: "MA" },
  "bronx": { ll: [40.8448, -73.8648], st: "NY" },        // Dallas roster: Optimum
  "cerritos": { ll: [33.8659, -118.0639], st: "CA" },      // Dallas roster: Kia America
  "charlotte": { ll: [35.2271, -80.8431], st: "NC" },
  "chicago": { ll: [41.8781, -87.6298], st: "IL" },
  "cleveland": { ll: [41.4993, -81.6944], st: "OH" },
  "columbus": { ll: [39.9612, -82.9988], st: "OH" },
  "cornelia": { ll: [34.5115, -83.5271], st: "GA" },      // Dallas roster: Vyve Broadband
  "dallas": { ll: [32.7767, -96.7970], st: "TX" },
  "denver": { ll: [39.7392, -104.9903], st: "CO" },
  "detroit": { ll: [42.3314, -83.0458], st: "MI" },
  /* ⚠️ Duluth GA (metro Atlanta), not Minnesota — see above. */
  "duluth": { ll: [34.0029, -84.1446], st: "GA" },
  "fort worth": { ll: [32.7555, -97.3308], st: "TX" },
  "greensboro": { ll: [33.5757, -83.1824], st: "GA" },
  "hershey": { ll: [40.2859, -76.6502], st: "PA" },       // Dallas roster: Country Meadows
  "houston": { ll: [29.7604, -95.3698], st: "TX" },
  "jacksonville": { ll: [30.3322, -81.6557], st: "FL" },
  "kansas city": { ll: [39.0997, -94.5786], st: "MO" },
  "katy": { ll: [29.7858, -95.8245], st: "TX" },          // Dallas roster: Christian Brothers Automotive
  "las vegas": { ll: [36.1699, -115.1398], st: "NV" },
  "los angeles": { ll: [34.0522, -118.2437], st: "CA" },
  "miami": { ll: [25.7617, -80.1918], st: "FL" },
  "minneapolis": { ll: [44.9778, -93.2650], st: "MN" },
  "nacogdoches": { ll: [31.6039, -94.6560], st: "TX" },   // Dallas roster: Etech
  "nashville": { ll: [36.1627, -86.7816], st: "TN" },
  "new york": { ll: [40.7128, -74.0060], st: "NY" },
  "orlando": { ll: [28.5383, -81.3792], st: "FL" },
  "palm beach gardens": { ll: [26.8396, -80.1019], st: "FL" }, // Dallas roster: United Veterinary Care
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
  "southlake": { ll: [32.9412, -97.1342], st: "TX" },     // Dallas roster: Claffey Pools
  "sunnyvale": { ll: [37.3688, -122.0363], st: "CA" },    // Dallas roster: Intermedia Communications
  "tampa": { ll: [27.9506, -82.4572], st: "FL" },
  "thousand oaks": { ll: [34.1706, -118.8376], st: "CA" },
  "tyler": { ll: [32.3513, -95.3011], st: "TX" },         // Dallas roster: CHRISTUS Health
  /* ⚠️ DC, not the state — see above. */
  "washington": { ll: [38.9072, -77.0369], st: "DC" },
  "winter park": { ll: [28.6000, -81.3392], st: "FL" },
};

/** The full table entry for the longest city key contained in `text`. */
export function matchCity(text: string): { key: string; ll: [number, number]; st: string } | null {
  const s = text.toLowerCase();
  let best = "";
  for (const k of Object.keys(CITY_TABLE)) if (s.includes(k) && k.length > best.length) best = k;
  return best ? { key: best, ...CITY_TABLE[best] } : null;
}

/** "pittsburgh" -> "Pittsburgh, PA" — one canonical format, state included. */
export function cityLabel(key: string, st: string): string {
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
  const i = lh.columns.findIndex((c: string) => /location|office|branch|store|site|facility|clinic|center|centre/i.test(c));
  const col = i === -1 ? 0 : i;
  return lh.rows.map((r: { cells?: string[] }) => r.cells?.[col]).filter((x: string | undefined): x is string => !!x && x.trim().length > 0);
}
