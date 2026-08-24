import { categoryOrder, pivotOrder } from "../components/ts/tsChart";
import type { CustomerProfile } from "./schema";
import {
  axisTitleFor, formatHero, formatMeasure, isAdditive, kindOf, magnitudeOf, type MeasureKind,
} from "./insightsMeasures";
import { buildCatalog } from "./insightsCatalog";
import type { GeneratedTile } from "./AiAssistantContext";

/* =============================================================================
   insightsTileData — turn a template + the SE's choices into a real tile.
   -----------------------------------------------------------------------------
   Every number comes from the PHASE-1 POOL, per the standing architecture: the
   prospect's own call volume, its breakdown rows, its weekly buckets. Nothing is
   invented where the pool can answer, and where it cannot the value is minted
   DETERMINISTICALLY from the profile id so the same tile built twice is identical.

   That last part matters more than it looks. A tile whose numbers change on rebuild
   cannot be screenshotted for a deck or rehearsed against, and if an SE builds the
   same tile in front of a prospect twice they must not get different answers.
   ============================================================================= */

type Reports = Partial<CustomerProfile["reports"]>;

/* ---- the pool's headline scale --------------------------------------------- */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/* ---- values for a chosen DIMENSION ----------------------------------------
   Read from the pool wherever the dimension is one the platform already breaks
   down by, so "Marketing Source" shows this prospect's real sources rather than a
   generic list. Falls back to minting, which is the agreed rule for a dimension
   Phase 1 never produced. */
export function dimensionValues(profile: CustomerProfile, dimension: string): string[] {
  const r = profile.reports as Reports;
  const d = dimension.toLowerCase().replace(/\s*\(t\/f\)$/, "");

  /* A (T/F) flag has exactly two values, always. */
  if (/\(t\/f\)$/i.test(dimension)) return ["True", "False"];

  const bd = (re: RegExp) => r.marketingDashboard?.breakdowns?.find((b) => re.test(b.title));
  const rowsOf = (b: ReturnType<typeof bd>) => (b?.rows ?? []).map((x) => x.name).filter(Boolean);

  if (/marketing source|^source$/.test(d)) { const v = rowsOf(bd(/by source/i)); if (v.length) return v; }
  if (/marketing medium/.test(d))          { const v = rowsOf(bd(/by medium/i)); if (v.length) return v; }
  if (/marketing campaign/.test(d))        { const v = rowsOf(bd(/by campaign/i)); if (v.length) return v; }
  if (/search term/.test(d))               { const v = rowsOf(bd(/search term/i)); if (v.length) return v; }
  if (/region/.test(d))                    { const v = rowsOf(bd(/region/i)); if (v.length) return v; }
  if (/division/.test(d))                  { const v = rowsOf(bd(/division/i)); if (v.length) return v; }
  if (/line of business/.test(d))          { const v = rowsOf(bd(/line of business/i)); if (v.length) return v; }
  /* The table-only breakdown is the prospect's product/service split, whatever the
     industry calls it. */
  if (/product category|service type|specialty|practice area/.test(d)) {
    const v = rowsOf(r.marketingDashboard?.breakdowns?.find((b) => !b.hasDonut));
    if (v.length) return v;
  }
  if (/^agent$|evaluated by|reviewed by/.test(d)) {
    /* The QM panel nests its rows under `table`, and each row is `{ cells }` — the
       agent name is the first cell. */
    const v = (r.qualityManagement?.bottomByAgentTable?.table?.rows ?? [])
      .map((x) => x.cells?.[0]).filter((n): n is string => !!n);
    if (v.length) return v.slice(0, 6);
  }
  if (/^city|facility city/.test(d)) {
    const v = rowsOf(bd(/region/i));                 // the pool's nearest geography
    if (v.length) return v;
  }
  if (/sentiment/.test(d)) return ["Positive", "Neutral", "Negative"];
  if (/business hours/.test(d)) return ["During", "Outside"];

  /* MINTED, and stable: derived from the profile id so this dimension reads the same
     in every tile, every question and every session from now on. */
  const seed = hash(profile.id + "::" + dimension);
  const n = 4 + (seed % 3);
  return Array.from({ length: n }, (_, i) => `${dimension} ${String.fromCharCode(65 + i)}`);
}

/* ---- a measure's magnitude -------------------------------------------------
   Now an adapter over `magnitudeOf` in insightsMeasures, which owns the KIND of every
   measure. Kept as a shim because the pie/bar/stacked cases below all ask "how big is
   this measure" and none of them care how the answer is derived. */
function measureScale(profile: CustomerProfile, measure: string): {
  max: number; pct: boolean; money: boolean; kind: MeasureKind;
} {
  const g = magnitudeOf(profile, measure);
  return {
    max: isAdditive(g.kind) ? g.total : g.level,
    pct: g.kind === "percent", money: g.kind === "money", kind: g.kind,
  };
}

/* Deterministic spread of a total across n buckets, weighted so the first buckets are
   larger — real breakdowns are never uniform, and a flat bar chart looks synthetic. */
function spread(total: number, n: number, seed: number): number[] {
  /* `>>>` again: a signed shift on the unsigned hash can go negative, and a negative
     jitter here would shrink or invert a bar's weight rather than vary it. */
  const w = Array.from({ length: n }, (_, i) => 100 - i * (60 / Math.max(n, 1)) + ((seed >>> i) % 17));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.max(1, Math.round((x / sum) * total)));
}

/* ---- weekly / hourly / daily axes ----------------------------------------- */

/* ---- the weekly buckets INSIDE the dashboard's filter ----------------------
   ⚠️ A TILE HONOURS THE DASHBOARD'S FILTER. The first build of this spanned two years,
   reasoning from a capture whose tile showed ~07/2024 to 08/2026. That was wrong here:
   our Summary Dashboard carries a visible chip reading
   "Call Start Time Between (01/01/2026 <= 01/31/2026)", and a tile plotting two years
   under that chip contradicts the very filter a prospect is reading. The captured tile
   was simply built somewhere the filter was not applied.

   The window comes from `marketingDashboard.dateRange` — the SAME field the chip is
   rendered from — so the chip and the tile can never disagree. Corroborated by the
   grouped-column capture, whose x axis reads 12/29/2025, 01/05/2026, 01/12/2026,
   01/19/2026, 01/26/2026: five WEEK-START dates in MM/DD/YYYY, Monday-aligned, for a
   one-month filter.

   ⚠️ BUCKETS ARE WEIGHTED BY IN-RANGE DAYS, which is what makes this a complete and
   honest partition. Jan 1-31 covers 4 + 7 + 7 + 7 + 6 = 31 days across five
   Monday-aligned weeks, so the first and last buckets are genuinely smaller. The values
   are apportioned to sum to EXACTLY the prospect's own month total, and the last bucket
   being partial is also why the final segment is dotted. */

interface Window { labels: string[]; values: number[]; partialTail: boolean }

function parseRange(profile: CustomerProfile): { start: Date; end: Date } | null {
  const raw = String((profile.reports as Reports).marketingDashboard?.dateRange ?? "");
  const [a, b] = raw.split("-").map((x) => x.trim());
  if (!a || !b) return null;
  const mk = (t: string) => {
    const [m, d, y] = t.split("/").map(Number);
    return m && d && y ? new Date(Date.UTC(y, m - 1, d)) : null;
  };
  const start = mk(a), end = mk(b);
  return start && end && end >= start ? { start, end } : null;
}

/**
 * The dashboard window's START, as `YYYY-MM-DD`.
 *
 * Exported so the interactions drawer dates its cards from the SAME field the filter chip
 * and every tile's x axis come from (`marketingDashboard.dateRange`). A drawer opened from a
 * tile that has no time axis — a pie slice, a day-of-week column — has no date of its own,
 * and the real drawer gives every card one date rather than inventing per-card dates.
 */
export function rangeStartIso(profile: CustomerProfile): string {
  const r = parseRange(profile);
  if (!r) return "";
  return r.start.toISOString().slice(0, 10);
}

/** Deterministic string hash, so a prospect's map never moves between sessions. */
function hashStr(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const DAY = 86400000;

function filteredWeeks(profile: CustomerProfile, measure: string): Window | null {
  const range = parseRange(profile);
  if (!range) return null;
  const sc = measureScale(profile, measure);
  const seed = hash(profile.id + "::win::" + measure);

  /* Monday of the week containing the start, matching the capture's 12/29/2025. */
  const back = (range.start.getUTCDay() + 6) % 7;
  const cursor = new Date(range.start.getTime() - back * DAY);

  const labels: string[] = [];
  const days: number[] = [];
  for (let t = cursor.getTime(); t <= range.end.getTime(); t += 7 * DAY) {
    const wkStart = new Date(t), wkEnd = new Date(t + 6 * DAY);
    labels.push(`${String(wkStart.getUTCMonth() + 1).padStart(2, "0")}/`
      + `${String(wkStart.getUTCDate()).padStart(2, "0")}/${wkStart.getUTCFullYear()}`);
    const lo = Math.max(wkStart.getTime(), range.start.getTime());
    const hi = Math.min(wkEnd.getTime(), range.end.getTime());
    days.push(Math.round((hi - lo) / DAY) + 1);
  }
  if (!labels.length) return null;

  const wobble = (i: number) => 1 + (((seed + hash("b" + i)) >>> 7) % 16 - 8) / 100;

  /* ⚠️ A NON-ADDITIVE MEASURE IS A LEVEL PER WEEK, NOT A PARTITION. Apportioning a
     conversion RATE across five weeks produced 13, 19, 21, 24, 23 "summing to" 100,
     which claims the rate was 13% in week one. A rate, a duration, a score and a rank
     each have their own value in every week, and a short week does not make the
     average handle time shorter — so in-range days weight the COUNT case only. */
  if (!isAdditive(sc.kind)) {
    const level = Math.max(0.1, sc.max);
    const values = days.map((_, i) => {
      const v = level * wobble(i);
      /* Percents and scores are bounded; a wobble must not push one past 100. */
      const cap = sc.kind === "percent" || sc.kind === "score" ? 99 : Infinity;
      return Math.min(cap, sc.kind === "percent" ? +v.toFixed(1) : Math.round(v));
    });
    return { labels, values, partialTail: days[days.length - 1] < 7 };
  }

  /* Weight = in-range days, nudged by the same small wobble so the line is not a
     perfectly straight staircase. */
  const weights = days.map((d, i) => d * wobble(i));
  const total = Math.max(1, Math.round(sc.max));
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / sum) * total);
  const values = exact.map(Math.floor);
  let left = total - values.reduce((a, b) => a + b, 0);
  exact.map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach((o) => { if (left > 0) { values[o.i] += 1; left -= 1; } });

  return { labels, values: values.map((v) => Math.max(1, v)),
    partialTail: days[days.length - 1] < 7 };
}

function weekLabels(profile: CustomerProfile): string[] {
  const r = profile.reports as Reports;
  const x = r.marketingDashboard?.salesCallBreakoutGraph?.xLabels;
  return x?.length ? x : ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"];
}

/* ---- the builder ---------------------------------------------------------- */
/**
 * How many INTERACTIONS sit behind a datum in the window bucket named `label`.
 *
 * ⚠️ THE CLICKED VALUE IS NOT AN INTERACTION COUNT UNLESS THE MEASURE IS ONE. Clicking a
 * revenue point opened the drawer reading "8,907,516 interactions" — the dollar figure used
 * as a card count. Only `count` and `flag` measures are numbers of calls; money, percent,
 * duration, score and rank are not, and those drawers need the bucket's own call count.
 * Falls back to the prospect's total when the label is not a window bucket (a pie slice, a
 * day of week), which is the same shape the built-in donuts use.
 */
export function interactionsAt(profile: CustomerProfile, label: string): number {
  const win = filteredWeeks(profile, "Call Count");
  if (win) {
    const i = win.labels.indexOf(label);
    if (i >= 0) return win.values[i];
  }
  return magnitudeOf(profile, "Call Count").total;
}

/**
 * A dimension's REAL breakdown — labels with the prospect's own long-tailed values.
 *
 * ⚠️ THE SYNTHETIC SPREAD MADE EVERY BAR THE SAME LENGTH. `series()` generated values in a
 * ~1.6x band, so a Marketing Source chart drew five near-identical bars and told no story;
 * the real dashboard runs 21,732 down to 4,225 (5.1x) and the reference capture runs 660
 * down to 3 (220x). The dashboard's own breakdown rows already hold those numbers, and
 * `dimensionValues` was throwing them away and keeping only the names.
 *
 * Two paths, both derive-don't-generate:
 *  - the measure MATCHES a metric column -> use that column verbatim, so the tile and the
 *    dashboard cannot disagree
 *  - otherwise -> use the first column as the SHAPE and apportion the measure's own
 *    magnitude across it, which keeps the long tail at the right order of magnitude
 * Returns null when the dimension has no breakdown, so callers keep their fallback.
 */
export function dimensionBreakdown(
  profile: CustomerProfile, dimension: string, measure: string,
): { labels: string[]; values: number[] } | null {
  const r = profile.reports as Reports;
  const d = dimension.toLowerCase();
  const bd = (r.marketingDashboard?.breakdowns ?? []).find((b) =>
    b.dimensionColumn?.toLowerCase() === d || b.title?.toLowerCase().includes(d.replace(/^marketing\s+/, "")));
  if (!bd || !bd.rows?.length) return null;

  const num = (v: string) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
  const norm = (t: string) => t.toLowerCase().replace(/^total\s+/, "").trim();
  const labels = bd.rows.map((x) => x.name);

  const col = (bd.metricColumns ?? []).findIndex((c) => norm(c) === norm(measure));
  if (col >= 0) return { labels, values: bd.rows.map((x) => num(x.metrics?.[col] ?? "")) };

  /* Shape from the first column, magnitude from the measure. */
  const weights = bd.rows.map((x) => num(x.metrics?.[0] ?? ""));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const g = magnitudeOf(profile, measure);

  if (!isAdditive(g.kind)) {
    /* A rate or a duration is a LEVEL per category, not a share of a total. Bigger
       categories skew slightly high, which is what the real tables show. */
    const max = Math.max(...weights);
    return {
      labels,
      values: weights.map((wt) => +(g.level * (0.82 + 0.36 * (wt / max))).toFixed(1)),
    };
  }
  /* Largest-remainder, so the bars sum to exactly the measure's own total. */
  const exact = weights.map((wt) => (g.total * wt) / sum);
  const out = exact.map((v) => Math.floor(v));
  let left = g.total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const o of order) { if (left <= 0) break; out[o.i] += 1; left -= 1; }
  return { labels, values: out };
}

/* ---------------------------------------------------------------------------
   Geo Heatmap points
   ---------------------------------------------------------------------------
   ⚠️ NO PROFILE CARRIES PER-CALL COORDINATES, so unlike every other template this one
   cannot read its geography off the prospect's data. The reference tile shows ~200 dots
   clustered hard on real metros — Los Angeles, the Bay Area, New York, Chicago, Atlanta,
   Houston, South Florida — and sparse in between, which is simply where people are.
   So: REAL metro coordinates and REAL population weights, with the MEASURE's own total
   apportioned across them. The geography is true, the volumes are the prospect's, and
   only the scatter inside a metro is invented.

   Seeded off the profile id, so a prospect's map is identical in every session — an SE
   demoing the same account twice must not see the dots move. */
const US_METROS: Array<[string, number, number, number]> = [
  // name, lat, lon, weight (roughly metro population, millions)
  ["New York", 40.7128, -74.006, 19.8], ["Los Angeles", 34.0522, -118.2437, 13.2],
  ["Chicago", 41.8781, -87.6298, 9.5], ["Dallas", 32.7767, -96.797, 7.6],
  ["Houston", 29.7604, -95.3698, 7.1], ["Washington", 38.9072, -77.0369, 6.3],
  ["Philadelphia", 39.9526, -75.1652, 6.2], ["Atlanta", 33.749, -84.388, 6.1],
  ["Miami", 25.7617, -80.1918, 6.1], ["Phoenix", 33.4484, -112.074, 4.9],
  ["Boston", 42.3601, -71.0589, 4.9], ["San Francisco", 37.7749, -122.4194, 4.7],
  ["Riverside", 33.9806, -117.3755, 4.6], ["Detroit", 42.3314, -83.0458, 4.3],
  ["Seattle", 47.6062, -122.3321, 4.0], ["Minneapolis", 44.9778, -93.265, 3.7],
  ["San Diego", 32.7157, -117.1611, 3.3], ["Tampa", 27.9506, -82.4572, 3.2],
  ["Denver", 39.7392, -104.9903, 3.0], ["Baltimore", 39.2904, -76.6122, 2.8],
  ["St. Louis", 38.627, -90.1994, 2.8], ["Orlando", 28.5383, -81.3792, 2.7],
  ["Charlotte", 35.2271, -80.8431, 2.7], ["San Antonio", 29.4241, -98.4936, 2.6],
  ["Portland", 45.5152, -122.6784, 2.5], ["Sacramento", 38.5816, -121.4944, 2.4],
  ["Pittsburgh", 40.4406, -79.9959, 2.3], ["Las Vegas", 36.1699, -115.1398, 2.3],
  ["Austin", 30.2672, -97.7431, 2.3], ["Cincinnati", 39.1031, -84.512, 2.2],
  ["Kansas City", 39.0997, -94.5786, 2.2], ["Columbus", 39.9612, -82.9988, 2.1],
  ["Cleveland", 41.4993, -81.6944, 2.1], ["Indianapolis", 39.7684, -86.1581, 2.1],
  ["Nashville", 36.1627, -86.7816, 2.0], ["Virginia Beach", 36.8529, -75.978, 1.8],
  ["Providence", 41.824, -71.4128, 1.7], ["Milwaukee", 43.0389, -87.9065, 1.6],
  ["Jacksonville", 30.3322, -81.6557, 1.6], ["Oklahoma City", 35.4676, -97.5164, 1.4],
  ["Raleigh", 35.7796, -78.6382, 1.4], ["Memphis", 35.1495, -90.049, 1.3],
  ["Richmond", 37.5407, -77.436, 1.3], ["New Orleans", 29.9511, -90.0715, 1.3],
  ["Salt Lake City", 40.7608, -111.891, 1.2], ["Birmingham", 33.5186, -86.8104, 1.1],
  ["Buffalo", 42.8864, -78.8784, 1.1], ["Tucson", 32.2226, -110.9747, 1.0],
  ["Boise", 43.615, -116.2023, 0.8], ["Albuquerque", 35.0844, -106.6504, 0.9],
  ["Omaha", 41.2565, -95.9345, 0.9], ["Anchorage", 61.2181, -149.9003, 0.4],
];

/**
 * Points for the Geo Heatmap, weighted to real metros and totalling the measure.
 *
 * Each metro gets one to four dots depending on its weight, scattered within ~35km so a
 * big metro reads as a cluster rather than one fat blob — which is what the reference
 * shows around Los Angeles and New York.
 */
export function geoPoints(
  profile: CustomerProfile, measure: string,
): Array<{ lat: number; lon: number; value: number; label: string }> {
  const g = magnitudeOf(profile, measure);
  const total = g.total > 0 ? g.total : Math.max(1, Math.round(g.level * 40));
  let seed = hashStr(profile.id + "::geo::" + measure);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const raw: Array<{ lat: number; lon: number; w: number; label: string }> = [];
  for (const [name, lat, lon, weight] of US_METROS) {
    const dots = weight > 8 ? 4 : weight > 4 ? 3 : weight > 1.6 ? 2 : 1;
    for (let d = 0; d < dots; d++) {
      /* ~0.32deg is roughly 35km of latitude — a metro's spread, not a state's. */
      const jl = d === 0 ? 0 : (rnd() - 0.5) * 0.64;
      const jo = d === 0 ? 0 : (rnd() - 0.5) * 0.8;
      raw.push({ lat: lat + jl, lon: lon + jo, w: (weight / dots) * (0.6 + rnd() * 0.8), label: name });
    }
  }
  const sum = raw.reduce((a, b) => a + b.w, 0);
  return raw.map((r) => ({
    lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4),
    value: Math.max(1, Math.round((total * r.w) / sum)),
    label: r.label,
  }));
}

export interface TileChoices {
  template: string;
  name: string;
  measures: string[];       // Attribute / Measure / Size (Rank) / Measure L+R
  dimensions: string[];     // Category / Categories
  /** Ticked chart-display options, e.g. "Show heatmap". */
  options?: string[];
}

/* ---------------------------------------------------------------------------
   The "Calls by Hour" / "Calls by Day of Week" pivot
   ---------------------------------------------------------------------------
   ⚠️ THESE ARE PIVOT TABLES, NOT BAR CHARTS. Measured 2026-08-21: rows are the chosen
   dimension, columns are the 24 hours (or 7 days), plus a row-total column AND a
   column-total row. The previous build drew a vertical column chart per hour, which is a
   different visualisation entirely.

   Structure, read off the capture:
     header 1:  <measure name>          | <column dimension name>
     header 2:  <row dimension name>    | 0 1 2 … 23 | <measure name>
     body:      <dimension value>       | value per hour, BLANK where zero | row total
     footer:    <measure name>          | total per hour                   | grand total
   Values abbreviate (1.62K, 42.05K) — the same hero/compact format.
   Header cells sit on #F6F8FA; the totals column header on #F5F5F5. */
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i));
const DOW_7 = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Hour-of-day shape: real call traffic is bimodal, peaking late morning and again in the
 * early evening, and near-dead overnight. A flat spread would make "spot your busiest and
 * slowest times" meaningless, which is the whole point of the template.
 */
const HOUR_WEIGHT = [
  0.8, 0.9, 0.7, 1.7, 1.0, 2.1, 3.9, 7.5, 6.0, 8.2, 5.7, 6.4,
  6.7, 6.4, 5.5, 4.7, 3.9, 2.7, 2.5, 1.4, 7.7, 11.2, 2.0, 0.7,
];
const DOW_WEIGHT = [1.0, 1.02, 0.98, 0.95, 0.9, 0.42, 0.33];

export function timePivot(
  profile: CustomerProfile, measure: string, dimension: string, unit: "hour" | "dow",
): { columns: string[]; rows: string[][]; footer: string[]; heatMax: number } {
  const cols = unit === "hour" ? HOURS_24 : DOW_7;
  const weights = unit === "hour" ? HOUR_WEIGHT : DOW_WEIGHT;
  const g = magnitudeOf(profile, measure);
  const total = g.total > 0 ? g.total : Math.max(1, Math.round(g.level * 40));

  /* Row weights come from the REAL breakdown when the dimension has one, so a pivot and a
     Stacked Bar on the same dimension agree. */
  const real = dimensionBreakdown(profile, dimension, measure);
  const rawNames = real ? real.labels : dimensionValues(profile, dimension).slice(0, 20);
  const rawW = real
    ? real.values
    : rawNames.map((_, i) => 1 + ((hashStr(profile.id + rawNames[i]) % 100) / 100));
  /* ⚠️ ROWS ARE SORTED, AND THE BREAKDOWN THEY COME FROM IS NOT. Measured on the
     Day-of-Week capture: its 51 rows run {Null}, Billboard, Bing, … Zocdoc, so the biggest
     row sits mid-list and the dashboard's own value order must not survive into the pivot.
     `pivotOrder` is LOCALE collation, deliberately not the pie's code-unit sort. */
  const sorted = pivotOrder(rawNames.map((label, i) => ({ label, w: rawW[i] ?? 0 })));
  const names = sorted.map((s) => s.label);
  const rowW = sorted.map((s) => s.w);
  const rowSum = rowW.reduce((a, b) => a + b, 0) || 1;
  const colSum = weights.reduce((a, b) => a + b, 0) || 1;

  const grid = names.map((_, ri) =>
    weights.map((w) => Math.round((total * (rowW[ri] / rowSum) * (w / colSum)))));

  const fmt = (v: number) => (v > 0 ? formatHero(v, g.kind) : "");
  const rows = names.map((n, ri) => [
    n, ...grid[ri].map(fmt),
    formatHero(grid[ri].reduce((a, b) => a + b, 0), g.kind),
  ]);
  const colTotals = cols.map((_, ci) => grid.reduce((a, r) => a + r[ci], 0));
  const footer = [axisTitleFor(measure), ...colTotals.map((v) => formatHero(v, g.kind)),
    formatHero(colTotals.reduce((a, b) => a + b, 0), g.kind)];

  /* ⚠️ THE HEAT SCALE IS GLOBAL, LINEAR FROM ZERO, AND SATURATES. Fitted on the
     Day-of-Week capture against all 367 non-blank cells: `t = min(1, v / 8024)` reproduces
     every one to a mean 0.185/255 per channel, which is well inside a rounding step. So it
     is not per-column (the Details Report's rule) and it does not stretch to the grand
     total — only 3 of 367 cells reach the darkest colour.

     ⚠️ 8,024 IS NOT DERIVABLE FROM ANYTHING ON SCREEN, so the rule below is the closest
     honest proxy rather than the real thing. Checked every candidate against the same fit:

         largest body cell     7,580   err 0.224   <- what we use
         2nd largest row total 7,870   err 0.200
         free-fit optimum      8,024   err 0.185
         largest column total 10,440   err 0.399   <- what we used before
         grand total          42,960   err 1.106

     The error surface is shallow, so anything in 7.6K-8.6K is indistinguishable; the
     largest BODY cell (totals row and column excluded) is the one that is both close and
     principled. It also explains the capture's signature exactly: the only cells that
     saturate are aggregates, because a sum is necessarily larger than the largest thing
     summed — grand total, biggest row total, biggest column total, three cells. */
  const bodyMax = Math.max(1, ...grid.flat());
  return { columns: [dimension, ...cols, axisTitleFor(measure)], rows, footer,
    heatMax: bodyMax };
}

export function buildTile(profile: CustomerProfile, c: TileChoices): Omit<GeneratedTile, "id"> {
  const seed = hash(profile.id + "::" + c.template + "::" + c.measures.join("|") + c.dimensions.join("|"));
  const primary = c.measures[0] ?? "Call Count";
  const sc = measureScale(profile, primary);
  const note = c.dimensions.length
    ? `${primary} by ${c.dimensions[0]}`
    : `${primary} over the reporting period`;

  const series = (labels: string[]) => c.measures.map((m, i) => {
    const s = measureScale(profile, m);
    return { name: m, values: spread(Math.round(s.max * 0.55), labels.length, seed + i * 31) };
  });

  switch (c.template) {
    case "Metric": {
      /* ⚠️ THE NUMBER AND NOTHING ELSE — no label under it, no period, no sparkline. The
         captured card's entire text content is "42.05K". Passing a label would render one
         where the reference has none.
         The value ABBREVIATES: 42,050 prints "42.05K". See formatHero. */
      const v = Math.round(sc.max * 0.58);
      return { tileType: "kpi", title: c.name, note: "", xLabels: [], series: [], slices: [],
        kpis: [{ label: "", value: formatHero(v, sc.kind) }] };
    }
    case "KPI": {
      /* ⚠️ THE KPI IS THE LAST BUCKET AGAINST THE ONE BEFORE IT, over the dashboard's own
         window — not an invented "+7% vs prior period". The old build printed a random
         percentage next to a number with no series behind it, so the figure and the trend
         could not agree because there was no trend.
         `filteredWeeks` is the same window machinery every time-series template uses, so
         the KPI's last point equals the last point of a Single Line tile on the same
         measure. */
      const win = filteredWeeks(profile, primary);
      const labels = win ? win.labels : weekLabels(profile);
      const vals = win
        ? win.values
        : spread(Math.round(sc.max * 0.55), labels.length, seed);
      const last = vals[vals.length - 1] ?? 0;
      const prev = vals[vals.length - 2] ?? 0;
      /* A percentage against a zero baseline is not a percentage; show the level instead. */
      const pct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
      return { tileType: "kpi", title: c.name, note: "", xLabels: labels, slices: [],
        series: [{ name: primary, values: vals }],
        kpis: [{ label: primary, value: formatHero(last, sc.kind) }],
        trend: {
          value: formatHero(last, sc.kind),
          period: `Week of ${labels[labels.length - 1] ?? ""}`,
          delta: +pct.toFixed(2),
          previous: formatMeasure(prev, sc.kind),
          previousPeriod: `Week of ${labels[labels.length - 2] ?? ""}`,
        },
        valueKind: kindOf(primary) };
    }
    case "Pie Chart": {
      const vals = dimensionValues(profile, c.dimensions[0] ?? "Marketing Source").slice(0, 6);
      const nums = spread(Math.round(sc.max * 0.6), vals.length, seed);
      return { tileType: "pie", title: c.name, note, kpis: [], xLabels: [], series: [],
        slices: vals.map((label, i) => ({ label, value: nums[i] })) };
    }
    case "Stacked Bar": {
      /* ⚠️ NOTHING IS STACKED, AND IT IS HORIZONTAL. Measured 2026-08-21: one blue series
         drawn as horizontal bars, categories down the left. The old build sliced to 6
         categories and drew every chosen measure as its own series; the real charts show
         ALL of them (12 for Marketing Source, 33 for Marketing Campaign) and exactly one
         series. Category labels are never truncated — the left inset grows instead — so a
         long list stays readable. */
      const dim = c.dimensions[0] ?? "Marketing Source";
      /* ⚠️ REAL BREAKDOWN VALUES, NOT A SPREAD. The synthetic version drew five bars within
         a ~1.6x band, which reads as fake; the prospect's own by-source rows run 21,732 down
         to 4,225 and the reference capture runs 660 down to 3. See dimensionBreakdown. */
      const real = dimensionBreakdown(profile, dim, primary);
      const labels = real ? real.labels : dimensionValues(profile, dim).slice(0, 40);
      const values = real
        ? real.values
        : spread(Math.round(measureScale(profile, primary).max * 0.55), labels.length, seed);
      /* ⚠️ CATEGORIES SORT ALPHABETICALLY, the same code-unit order as the pie — measured on
         the bar capture too. The biggest bar therefore sits mid-list; do not "helpfully"
         sort by value. */
      const rows = categoryOrder(labels.map((label, i) => ({ label, v: values[i] ?? 0 })));
      return { tileType: "bar", title: c.name, note: "", kpis: [], slices: [],
        xLabels: rows.map((r) => r.label),
        series: [{ name: primary, values: rows.map((r) => r.v) }],
        horizontal: true,
        yTitle: dim,
        xTitle: axisTitleFor(primary),
        valueKind: kindOf(primary) };
    }
    case "Calls by Hour":
    case "Calls by Day of Week": {
      /* ⚠️ A PIVOT TABLE, not a column chart — see timePivot. "Show heatmap" is a real
         checkbox on this template and now reaches here; it used to be collected by the
         drawer and dropped. */
      const unit = c.template === "Calls by Hour" ? "hour" : "dow";
      const dim = c.dimensions[0] ?? "Marketing Source";
      const pv = timePivot(profile, primary, dim, unit);
      return { tileType: "table", title: c.name, note: "", kpis: [], slices: [],
        xLabels: [], series: [],
        columns: pv.columns, rows: pv.rows, tableFooter: pv.footer,
        heatmap: (c.options ?? []).includes("Show heatmap"),
        heatScope: "table", heatMax: pv.heatMax,
        pivotHeader: { measure: axisTitleFor(primary), columnDimension:
          unit === "hour" ? "Hour of day Call Start Time" : "Day of week Call Start Time" } };
    }
    case "Dual Y-Axis": {
      /* ⚠️ LEFT MEASURE = BARS, RIGHT MEASURE = LINE. Proven by a pair of captures with the
         two measures swapped: whichever is on the left drives the teal columns and its axis,
         whichever is on the right drives the blue line and its axis. The drawer's fields are
         literally named "Measure (Left Side)" and "Measure (Right Side)".
         This case used to draw BOTH measures as bars on one axis, with a note saying no
         dual-axis renderer existed. TsDualAxis has been measured and rebuilt, so it does. */
      const leftM = c.measures[0] ?? "Call Count";
      const rightM = c.measures[1] ?? c.measures[0] ?? "Answered by Agent";
      const winL = filteredWeeks(profile, leftM);
      const winR = filteredWeeks(profile, rightM);
      const labels = winL ? winL.labels : weekLabels(profile);
      return { tileType: "dual", title: c.name, note: "", kpis: [], slices: [],
        xLabels: labels,
        series: [
          { name: leftM, values: winL ? winL.values : spread(Math.round(measureScale(profile, leftM).max * 0.55), labels.length, seed) },
          { name: rightM, values: winR ? winR.values : spread(Math.round(measureScale(profile, rightM).max * 0.55), labels.length, seed + 7) },
        ],
        seriesKinds: [kindOf(leftM), kindOf(rightM)],
        yTitle: axisTitleFor(leftM),
        rightTitle: axisTitleFor(rightM),
        xTitle: "Weekly Call Start Time",
        dashTail: winL ? winL.partialTail : false };
    }
    case "Geo Heatmap": {
      /* There IS a map renderer now (TsGeoMap, Leaflet + Mapbox tiles). This used to
         fall back to bars-by-region with a note saying no map existed. */
      const pts = geoPoints(profile, primary);
      return { tileType: "geo", title: c.name, note: "", kpis: [], slices: [],
        xLabels: pts.map((p) => p.label),
        series: [{ name: primary, values: pts.map((p) => p.value) }],
        geo: pts,
        yTitle: axisTitleFor(primary),
        valueKind: kindOf(primary) };
    }
    case "Single Line Chart Over Time": {
      /* Weekly buckets INSIDE the dashboard's own filter window. Axis titles match the
         real tile: "Total <measure>" on the left, "Weekly Call Start Time" underneath.
         The final segment is dotted only when that last week is genuinely partial. */
      const win = filteredWeeks(profile, primary);
      const labels = win ? win.labels : weekLabels(profile);
      const values = win ? win.values
        : spread(Math.round(sc.max), labels.length, seed);
      return {
        tileType: "line", title: c.name, note: "", kpis: [], slices: [],
        xLabels: labels, series: [{ name: primary, values }],
        yTitle: axisTitleFor(primary), xTitle: "Weekly Call Start Time",
        valueKind: kindOf(primary), dashTail: win ? win.partialTail : false,
      };
    }
    case "Multi-Line Chart Over Time": {
      /* Same filtered window as the single line, but EVERY measure gets its own series
         built independently — each has its own axis on screen, so each partitions or
         levels according to its own kind. Building them off one shared magnitude is
         what would flatten a percent series against a revenue one. */
      const built = c.measures.map((m) => {
        const win = filteredWeeks(profile, m);
        return {
          name: m,
          values: win ? win.values
            : spread(Math.round(measureScale(profile, m).max), weekLabels(profile).length, seed),
          partial: win ? win.partialTail : false,
        };
      });
      const labels = filteredWeeks(profile, c.measures[0] ?? "Call Count")?.labels
        ?? weekLabels(profile);
      return {
        tileType: "line", title: c.name, note: "", kpis: [], slices: [],
        xLabels: labels,
        series: built.map((b) => ({ name: b.name, values: b.values })),
        seriesKinds: c.measures.map((m) => kindOf(m)),
        xTitle: "Weekly Call Start Time",
        dashTail: built.some((b) => b.partial),
      };
    }
    default: {
      /* Any other line-ish template falls back to the five-week window. */
      const labels = weekLabels(profile);
      return { tileType: "line", title: c.name, note, kpis: [], slices: [],
        xLabels: labels, series: series(labels) };
    }
  }
}

/* Plausible filler for reported contact columns. Deliberately generic and obviously
   sample-like (no real people), and indexed deterministically so a row keeps its
   identity between rebuilds. */
const STREETS = ["Maple St", "Oak Ave", "Cedar Ln", "Main St", "Park Blvd", "Elm Dr", "Pine Way"];
const STATES = ["CA", "TX", "FL", "NY", "IL", "OH", "GA", "NC", "PA", "AZ"];
const FIRST = ["Jordan", "Avery", "Riley", "Morgan", "Casey", "Quinn", "Rowan", "Sasha"];
const LAST = ["Bennett", "Alvarez", "Okafor", "Nguyen", "Kowalski", "Rivera", "Haddad", "Moreau"];

/* ---- rows for a Report tile ------------------------------------------------
   One row per interaction, with every cell answered from the pool where the pool can
   answer: a dimension cycles its real values, a measure is formatted at the right
   magnitude, a (T/F) signal reads true/false. Everything is keyed off the profile id
   and the row index, so the same chosen columns always produce the same table — the
   rule that a number never changes once shown applies to report rows too. */
export function reportRows(
  profile: CustomerProfile, columns: string[],
  opts: { count?: number; transactions?: boolean } = {},
): string[][] {
  const { count = REPORT_ROWS, transactions = false } = opts;
  const base = hash(profile.id + "::report");
  return Array.from({ length: count }, (_, i) => {
    const shape = rowShape(base + i * 7919, transactions ? i : undefined);
    return columns.map((col, j) => cellFor(profile, col, i, base + i * 131 + j * 17, shape));
  });
}

/**
 * ONE ROW IS ONE CALL, and the columns of that row have to agree with each other.
 *
 * ⚠️ THIS IS THE CORRECTION THE CAPTURE FORCED. Every cell used to be minted from its own
 * (column, row) seed, so a count column printed "15" and "26" per row — a monthly total
 * sitting in a row-level report — and the answered flag, the answered count and the
 * answered percentage in the same row were three independent inventions that could and did
 * contradict each other. The capture's own rows fall into exactly four shapes:
 *
 *     (T/F)   Total Call Count   Not Answered   Not Ans (%)   Answered   Ans (%)   n
 *     {Null}         1                0           {Null}         0        {Null}    1
 *     false          1                1            100%          0          0%     10
 *     true           1                0             0%           1        100%     18
 *     true           1                1            100%          1        100%      5
 *
 * Three things that only that table shows:
 *   - **Total Call Count is 1 on every row.** The measure is a count of calls and the row
 *     IS one call, so the footer's TOTAL is the row count, which is what makes the column
 *     add up for anyone who checks.
 *   - **A percentage is 0% or 100%**, never anything between — a rate over a single call is
 *     binary — and it is `{Null}`, not 0%, when the call carries no agent-leg data at all.
 *     Note the flagless row prints 0 for the counts but `{Null}` for the percentages.
 *   - **The fourth shape is real**: 5 of 34 rows are answered by an agent AND counted as not
 *     answered, so both percentages read 100%. It reads like a call that rang out and was
 *     picked up on a later leg. Kept at that measured rate, because without it the two
 *     percentage columns are perfect complements and look computed rather than observed.
 */
/** What the product prints for a missing value, verbatim — not an em dash, not blank. */
const NULL_CELL = "{Null}";

interface RowShape {
  /** Marketing attribution: false renders every marketing dimension as `{Null}`. */
  attributed: boolean;
  /** The agent-leg flag. `null` is the capture's `{Null}` row. */
  flag: boolean | null;
  answered: 0 | 1;
  notAnswered: 0 | 1;
  /** Transactions Report only: this row's transaction id, ascending down the grid. */
  txId?: string;
  /** Transactions Report only: the call this transaction belongs to — deliberately unordered. */
  callId?: string;
  /**
   * Transactions Report only: whether THIS transaction is the one carrying the call.
   *
   * ⚠️ A TRANSACTION ROW'S CALL COUNT IS 0 OR 1, WHERE A DETAILS ROW'S IS ALWAYS 1. Measured:
   * the capture's Total Call Count column holds only those two values, and its TOTAL (42.28K)
   * is a fraction of the 105,359 unique transactions — a call has several transactions and
   * only one of them is the call leg.
   */
  carriesCall?: boolean;
}

/**
 * The ATTRIBUTION cells of a report row, read from the Digital Journey report.
 *
 * ⚠️ THE ATTRIBUTION COLUMNS MUST AGREE WITH EACH OTHER, and cycling each one
 * independently is what broke that. Source, medium, campaign and search term were each
 * picked from their own dimension list by the row index, which produced rows like
 * "Medium: Bing, Source: Organic" and "Medium: cpc, Source: Paid Search" side by side —
 * one coherent, one contradictory, from the same code. A marketer reads that instantly.
 * `digitalInsights.rows` already holds a COHERENT tuple per interaction, generated
 * together for this prospect, so the row is taken whole. Side benefit worth as much as the
 * fix: the Details Report and the Digital Journey report now show the same attribution
 * instead of two conflicting sets.
 *
 * ⚠️ IT ALSO SUPPLIES Website Journey, WHICH USED TO RENDER "Website Journey A". No regex
 * in `cellFor` matched that column, so it fell through to the minted-dimension fallback —
 * the same literal-placeholder failure the REPORTED CONTACT FIELDS note below was written
 * about. `InteractionRow.websiteJourney` is documented as "Home / Category / Subcategory",
 * which is exactly the shape the capture prints ("Home / Surgery / Orthopedics").
 */
function attribution(profile: CustomerProfile, col: string, row: number): string | null {
  const rows = profile.reports.digitalInsights?.rows ?? [];
  if (!rows.length) return null;
  const r = rows[row % rows.length];
  /* The report's own placeholder for "not applicable" is an em dash; in this grid the
     product prints {Null}. Same absence, two surfaces, two vocabularies. */
  const v = (s: string | undefined) => (!s || s === "—" ? NULL_CELL : s);
  if (/search term/.test(col)) return v(r.marketingSearchTerm);
  if (/campaign/.test(col)) return v(r.marketingCampaign);
  if (/medium/.test(col)) return v(r.marketingMedium);
  if (/source/.test(col)) return v(r.marketingSource);
  if (/website journey/.test(col)) return v(r.websiteJourney);
  if (/landing page|calling page/.test(col)) return v(r.landingPageUrl);
  return null;
}

/**
 * Transactions per call.
 *
 * ⚠️ MEASURED, and it is what makes the two id columns disagree in the footer: the capture
 * counts **105,359** unique Transaction IDs against **45,633** unique Call Record IDs, i.e.
 * 2.31 transactions for every call. Its Total Call Count sums to 42.28K, slightly under the
 * call count — ours sums to the call total exactly, so a prospect adding that column up lands
 * on the same figure the dashboards show.
 */
const TX_PER_CALL = 2.31;

function rowShape(seed: number, row?: number): RowShape {
  const r = (n: number, shift: number) => (seed >>> shift) % n;
  /* ~3% of rows carry no agent-leg data (1 of the capture's 34), and ~15% of the rest have
     no marketing attribution — the capture's rows 1, 4 and 5 are all-{Null}. */
  const flagless = r(34, 0) === 0;
  const flag = flagless ? null : r(100, 3) < 68;      // 18 + 5 of 33 answered ≈ 68%
  const answered: 0 | 1 = flag ? 1 : 0;
  /* An unanswered call always counts as not answered; an answered one does 5/23 of the
     time, which is the capture's own fourth shape. */
  const notAnswered: 0 | 1 = flagless ? 0 : flag ? (r(23, 9) < 5 ? 1 : 0) : 1;
  const shape: RowShape = { attributed: flagless ? false : r(100, 15) >= 15, flag, answered, notAnswered };
  if (row === undefined) return shape;
  /* ⚠️ THE TRANSACTIONS REPORT IS SORTED BY TRANSACTION ID, NOT CALL RECORD ID. Measured on the
     capture: the transaction ids ascend down the grid (4291B4C0 / 42B723DC / 446B5426 …) while
     the call record ids plainly do not. Format is 8 hex, a dash, 8 hex, against the Call Record
     ID's 4 and 12.
     ⚠️ THE JITTER MUST BE SMALLER THAN THE STEP or the sequence is not monotonic. A first pass
     used a per-row step (`row * (0x20 + seed % 0x1c0)`), and because `seed` changes per row the
     ids wandered — 420002EA was followed by 420002AC. A fixed 0x200 stride with at most 0x1F0
     of jitter keeps every id above the last while still leaving irregular gaps. */
  const hi = ((0x42000000 + row * 0x200 + (hash(`${row}:gap`) % 0x1f0)) >>> 0)
    .toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
  const lo = hash(`${seed}:tx`).toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
  shape.txId = `${hi}-${lo}`;
  /* ⚠️ AND THE CALL RECORD ID MUST *NOT* ASCEND HERE. Ordering by transaction id scatters the
     calls, which is exactly what the capture shows; deriving the call id from the row index
     (what the Details Report does, correctly, because it IS ordered by call) made ours ascend
     down both columns and lost the distinction. Hashing the transaction id also means one
     transaction always belongs to the same call. */
  const c = hash(`${shape.txId}:call`).toString(16).toUpperCase().padStart(8, "0");
  const d = hash(`${shape.txId}:call2`).toString(16).toUpperCase().padStart(8, "0");
  shape.callId = `${c.slice(0, 4)}-${(c.slice(4) + d).slice(0, 12)}`;
  /* One transaction in every TX_PER_CALL carries the call, so the column sums to the call
     total. Seeded, so the same row always reads the same way. */
  shape.carriesCall = (seed % 1000) / 1000 < 1 / TX_PER_CALL;
  return shape;
}

/**
 * How many rows a Report TILE renders.
 *
 * ⚠️ THE REAL TILE SAYS "Showing 1,000 of many rows" AND WE RENDER 200, DELIBERATELY —
 * the same call the Details Report SCREEN already made, for the same two reasons: 1,000
 * rows times a dozen chosen columns is 12,000 live cells inside a dashboard tile, which
 * stutters on a projector; and claiming 1,000 while showing 200 is catchable by anyone who
 * scrolls. The caption says what is actually rendered. It stays honest because the FOOTER
 * aggregates describe the whole dataset, not the rendered slice, which is exactly what
 * "of many rows" means.
 */
export const REPORT_ROWS = 200;

/**
 * The caption under a Report grid.
 *
 * ⚠️ TWO FORMS, BOTH MEASURED. The Details Report prints "Showing 1,000 of many rows" — it is
 * showing a slice of a dataset whose size it does not state. The Summary Report prints
 * "Showing 1 of 1 row", singular, because every row it has is on screen. So the total is
 * passed when it is known, and the noun agrees with it.
 */
export const reportCaption = (rows: number, total?: number): string =>
  total === undefined
    ? `Showing ${rows.toLocaleString("en-US")} of many rows`
    : `Showing ${rows.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} row${total === 1 ? "" : "s"}`;

/**
 * The body of a Summary Report: measures aggregated, one row.
 *
 * ⚠️ THE SINGLE ROW AND THE AGGREGATION ROW HOLD THE SAME NUMBERS, and the capture is
 * explicit about it — all seven columns read 42.96K / 6.03K / 1.46K / 172 / 8 / 1.76K /
 * 19.73K in the body and again under TOTAL in the pinned row. That is what the template IS:
 * "a condensed, aggregated view that highlights the most important figure". So the row is
 * built from the same `magnitudeOf` the footer uses rather than from a second computation,
 * which is what makes them agree by construction instead of by luck.
 *
 * With a Group By the summary breaks into one row per dimension value — the dimension leads
 * (the picker puts it first) and each measure is apportioned across the rows. ⚠️ UNMEASURED:
 * the capture has no Group By set, so the grouped shape follows the Details Report's own
 * apportionment rules rather than a captured example.
 */
export function summaryRows(
  profile: CustomerProfile, columns: string[], groupBy?: string,
): string[][] {
  const measures = new Set(buildCatalog(profile).measures);
  const cell = (col: string, share = 1): string => {
    const raw = measures.has(col) ? col
      : measures.has(col.replace(/^Total /, "")) ? col.replace(/^Total /, "") : null;
    if (!raw) return "";
    const g = magnitudeOf(profile, raw);
    return isAdditive(g.kind)
      ? formatHero(Math.round(g.total * share), g.kind)
      : formatMeasure(g.level, g.kind);
  };
  if (!groupBy) return [columns.map((c) => cell(c))];

  const real = dimensionBreakdown(profile, groupBy, columns.find((c) => c !== groupBy) ?? "Call Count");
  const labels = real ? real.labels : dimensionValues(profile, groupBy);
  const weights = real ? real.values : labels.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return pivotOrder(labels.map((label, i) => ({ label, w: weights[i] ?? 0 })))
    .map(({ label, w }) => columns.map((c) => (c === groupBy ? label : cell(c, w / sum))));
}

const REPORT_TITLES = new Set(["Details Report", "Summary Report", "Transactions Report"]);

/**
 * Bring a Report tile built by the OLD code up to the measured template.
 *
 * ⚠️ A GENERATED TILE STORES ITS COMPUTED ROWS, so nothing about a template fix reaches a
 * tile that already exists — this repo has been bitten by that before, and it surfaced here
 * as a reported "it still looks nothing like the real site" against a tile created an hour
 * earlier. The tell was the ROW COUNT: exactly 8, which was `reportRows`' old default. Such
 * a tile also has raw headers ("Call Count", not "Total Call Count"), monthly totals in a
 * row-level grid (33, 4, 15 where every row is one call), short 4-and-6 ids, and no
 * `reportFooter` — so it renders with the plain table chrome rather than the ag-Grid one.
 *
 * `reportFooter` being absent is the marker, and it is exact: only the old builder produced
 * a Report tile without one. That also guarantees `columns` still holds the RAW picked names,
 * which is what `reportHeaders` and `reportFooter` need to look up in the catalogue.
 *
 * ⚠️ IT RE-DERIVES THE ROWS, so an AI edit to a stale tile's cells would be discarded. That
 * is the deliberate trade: those rows are wrong in a way a prospect can catch (a monthly
 * total sitting in a row-level report), and the template shipped hours ago, so no saved demo
 * can hold considered edits to one. Do NOT widen this to tiles that already have the new
 * props — for those, the stored data is authoritative.
 */
export function upgradeReportTile<T extends GeneratedTile>(profile: CustomerProfile, tile: T): T {
  if (tile.tileType !== "table" || !REPORT_TITLES.has(tile.title)) return tile;
  const cols = tile.columns ?? [];
  if (!cols.length) return tile;
  /* A tile with no `reportFooter` came from the old builder, so its ROWS are wrong too. */
  const stale = !tile.reportFooter;
  const rows = stale
    ? reportRows(profile, cols, { transactions: tile.title === "Transactions Report" })
    : (tile.rows ?? []);
  /* ⚠️ THE FOOTER AND CAPTION ARE RE-DERIVED EVERY RENDER, not just for stale tiles. They
     are pure functions of the columns and rows, and storing them made a later FORMAT fix
     invisible on tiles that already existed: correcting UNIQUE COUNT from "48,293" to the
     measured "48293" left every built tile showing the comma, because its footer was stored
     and the stale check did not fire (it had a footer, just an outdated one). Deriving them
     costs nothing and means the next format correction lands everywhere. Rows are NOT
     re-derived for a current tile — those stay authoritative, so an AI edit survives. */
  /* ⚠️ A SUMMARY'S CAPTION COUNTS ITS ROWS; a details grid's does not. Re-deriving the caption
     blind overwrote the picker's "Showing 1 of 1 row" with "Showing 1 of many rows" — the
     re-derivation is right (it is what lets a format fix reach existing tiles) but it has to
     know which report it is looking at, and the title is the only thing carrying that. */
  const summary = tile.title === "Summary Report";
  return {
    ...tile, note: "", columns: stale ? reportHeaders(profile, cols) : cols, rows,
    reportFooter: reportFooter(profile, cols, rows),
    caption: summary ? reportCaption(rows.length, rows.length) : reportCaption(rows.length),
  };
}

/**
 * The pinned aggregation row under a Report tile.
 *
 * ⚠️ THREE DIFFERENT LABELS, AND THE COLUMN'S OWN KIND PICKS WHICH. Read off the capture:
 *
 *     UNIQUE COUNT      every dimension — and `Answered by Agent (T/F)`, whose value is 2
 *     TOTAL             the additive measures (42.96K, 15.35K, 20.02K)
 *     TABLE AGGREGATE   the percentages (49%, 64%)
 *
 * The percentages are the interesting confirmation: a rate cannot be summed down a column,
 * so ThoughtSpot recomputes it over the whole table and says so in the label. That is the
 * additive / non-additive split `insightsMeasures` already draws, showing up in the
 * product's own vocabulary.
 *
 * ⚠️ A `(T/F)` COLUMN IS A DIMENSION HERE, NOT A FLAG MEASURE. `kindOf` calls it `flag`,
 * which is additive, so keying the label off the kind alone would print TOTAL under a
 * column of "true"/"false". The catalogue is what decides: `(T/F)` twins live in
 * `dimensions`, and the additive measure is its "Total <name>" sibling.
 *
 * ⚠️ THE CAPTURE'S OWN PERCENTAGES DO NOT RECONCILE and ours deliberately do. Its
 * 15.35K/42.96K is 36%, printed as 49%, and 20.02K/42.96K is 47%, printed as 64% — both
 * percentages are evidently over some smaller non-null denominator that is not on screen.
 * Reproducing an inconsistency a prospect can spot with a calculator is worse than being
 * self-consistent, so ours come from `magnitudeOf`, the same source every other tile uses.
 */
/**
 * A Report's column HEADERS: a measure is printed in its aggregated form, a dimension
 * verbatim.
 *
 * ⚠️ MEASURED, AND IT IS THE SAME `axisTitleFor` EVERY CHART ALREADY USES. The capture's
 * headers read `Total Call Count` / `Total Answered by Agent` where the builder's checkbox
 * list — 371 columns of it, extracted into `insightsColumns` — offers `Call Count` and
 * `Answered by Agent`. So the aggregation prefix is applied at RENDER, exactly as it is on
 * an axis title and in a legend, and this is a third independent confirmation of that rule.
 * The percentages carry no prefix, which is `aggregationWord` returning "" for a
 * non-additive kind.
 *
 * ⚠️ ONLY CATALOGUE MEASURES GO THROUGH IT. `kindOf` defaults an unrecognised name to
 * `count`, so running a dimension through `axisTitleFor` prints "Total Marketing Source" —
 * the same trap the pie's tooltip label documents.
 *
 * ⚠️ OPEN: the capture also shows `Call Not Answered (%)` and `Answered by Agent (%)`
 * beside their `Total …` columns, and NO `(%)` name exists anywhere in the 371 extracted
 * builder columns. So either the report derives a percentage companion per conditional
 * measure, or the builder offers `(%)` names our accordion walk missed. We render exactly
 * what the SE picked and do not invent a companion column — a rule guessed from one sample
 * would put columns nobody asked for into the tile. Settle it with a capture of the
 * Details Report builder scrolled to the Call Details group.
 */
export function reportHeaders(profile: CustomerProfile, columns: string[]): string[] {
  const measures = new Set(buildCatalog(profile).measures);
  return columns.map((c) => (measures.has(c) && !/\(t\/f\)$/i.test(c) ? axisTitleFor(c) : c));
}

export function reportFooter(
  profile: CustomerProfile, columns: string[], rows?: string[][],
): { label: string; value: string }[] {
  const measures = new Set(buildCatalog(profile).measures);
  /* Through `magnitudeOf` rather than reading the dashboard directly, so an id column's
     UNIQUE COUNT is the same call total every other tile partitions. */
  const calls = magnitudeOf(profile, "Call Count").total;
  /* ⚠️ ACCEPT EITHER THE RAW OR THE AGGREGATED NAME. A freshly built tile stores the header
     form ("Total Call Count"), which is not in the catalogue, so a lookup on the stored
     columns alone classified every measure as a dimension and printed UNIQUE COUNT under it.
     `axisTitleFor` only ever PREPENDS the aggregation word, so stripping it recovers the
     catalogue name — which is what lets the footer be re-derived from a stored tile. */
  const rawName = (col: string) =>
    measures.has(col) ? col : measures.has(col.replace(/^Total /, "")) ? col.replace(/^Total /, "") : null;
  return columns.map((col, ci) => {
    const raw = rawName(col);
    if (raw && !/\(t\/f\)$/i.test(col)) {
      const g = magnitudeOf(profile, raw);
      return isAdditive(g.kind)
        ? { label: "TOTAL", value: formatHero(g.total, g.kind) }
        : { label: "TABLE AGGREGATE", value: formatMeasure(g.level, g.kind) };
    }
    /* A dimension's UNIQUE COUNT. An id column is unique per call by definition, so it
       reports the prospect's own call total — which is what the capture's 42,963 is
       against its 42.96K of calls. A `(T/F)` column has exactly two values. */
    /* ⚠️ COUNT WHAT THE COLUMN ACTUALLY RENDERS, not what `dimensionValues` lists. Website
       Journey is assembled from the Digital Journey rows rather than being a dimension with
       a value list, so the list route reported 5 where the column shows far more. Counting
       the rendered cells (excluding {Null}, which is the absence of a value, not one of
       them) is right for every dimension and cannot drift from the grid beside it. */
    const seen = rows
      ? new Set(rows.map((r) => r[ci]).filter((v) => v && v !== NULL_CELL)).size
      : 0;
    /* ⚠️ THE TWO ID COLUMNS DO NOT AGREE, and that is the point of this report. Measured:
       105,359 unique Transaction IDs against 45,633 unique Call Record IDs. Counting both as
       `calls` printed the same figure twice and lost the one fact the template exists to
       show — that a call has several transactions. */
    const n = /transaction id/i.test(col) ? Math.round(calls * TX_PER_CALL)
      : /record id|unique id|interaction id/i.test(col) ? calls
      : /\(t\/f\)$/i.test(col) ? 2
      : Math.max(1, seen, dimensionValues(profile, col).length);
    /* ⚠️ NO THOUSANDS SEPARATOR. The capture prints `42963`, not `42,963` — a raw integer,
       where the TOTAL beside it is abbreviated to `42.96K`. Two different formats in one row,
       both measured. We printed `48,293`. */
    return { label: "UNIQUE COUNT", value: String(n) };
  });
}

function cellFor(
  profile: CustomerProfile, col: string, row: number, seed: number, shape?: RowShape,
): string {
  const c = col.toLowerCase();
  /* ⚠️ LOWERCASE. The capture prints "true" / "false"; this returned "True" / "False". */
  if (/\(t\/f\)$/.test(c)) {
    if (!shape) return (seed % 3 === 0) ? "false" : "true";
    /* The answered flag drives its own column so the (T/F), the count and the percentage
       in one row cannot disagree; any OTHER (T/F) signal is its own coin toss. */
    if (/answered by agent/.test(c)) return shape.flag === null ? NULL_CELL : String(shape.flag);
    return shape.flag === null ? NULL_CELL : (seed % 3 === 0) ? "false" : "true";
  }
  /* ⚠️ THE TRANSACTION ID USED TO RENDER THE LITERAL "Transaction ID A". Third time this
     fallback has bitten — Website Journey and the measure columns were the other two — because
     no regex here matched the column and `dimensionValues` mints `<name> <letter>`. */
  if (shape?.txId && /^transaction id$/.test(c)) return shape.txId;
  if (shape?.callId && /record id/.test(c)) return shape.callId;
  if (shape) {
    const k = kindOf(col);
    /* A row-level report shows ONE call, so an additive count is an indicator, not a
       total: the base call count is 1 and every conditional count is 0 or 1. */
    if (k === "count" || k === "flag") {
      /* ⚠️ ON A TRANSACTION ROW THE CALL COUNT IS 0 OR 1 — only one of a call's transactions
         is the call leg. On a details row, where the row IS the call, it is always 1. */
      if (/^(total )?call count$/.test(c)) {
        return shape.carriesCall === undefined ? "1" : shape.carriesCall ? "1" : "0";
      }
      if (/not answered/.test(c)) return String(shape.notAnswered);
      if (/answered/.test(c)) return String(shape.answered);
    }
    /* And a rate over a single call is binary — 0% or 100%, or {Null} when the call
       carries no agent-leg data at all. */
    if (k === "percent") {
      if (shape.flag === null) return NULL_CELL;
      if (/not answered/.test(c)) return shape.notAnswered ? "100%" : "0%";
      if (/answered/.test(c)) return shape.answered ? "100%" : "0%";
      return (seed % 100) < 50 ? "100%" : "0%";
    }
    /* An unattributed call has no campaign, medium, source, term or journey — a third of
       the capture's visible rows are {Null} across all five. */
    if (!shape.attributed && /marketing |website journey|search term|campaign|medium|source/.test(c)) {
      return NULL_CELL;
    }
  }
  const attrib = attribution(profile, c, row);
  if (attrib !== null) return attrib;
  if (/record id|unique id|interaction id/.test(c)) {
    /* ⚠️ FOUR HEX, DASH, TWELVE HEX. Measured off the capture — `DD11-82B03247078E`,
       `0000-1856E2CB3EF7`, `00C4-DF5652EB3FF7` — where this produced `CFB8-ECB711`, four
       and SIX. Six characters short sounds cosmetic and is not: at the report's column
       widths the real id wraps onto two lines and ours sat on one, so the first column of
       the grid had visibly the wrong shape. A 32-bit hash is only 8 hex digits, so the
       tail is a second hash of the row to fill the remaining four. */
    const a = seed.toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
    const b = hash(`${seed}:${row}:id`).toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
    const hex = (a + b).slice(0, 16);
    return `${hex.slice(0, 4)}-${hex.slice(4)}`;
  }
  if (/start time|datetime|date of birth|existing .* time/.test(c)) {
    /* Inside the demo's own January 2026 window, so a report never disagrees with the
       date filter shown above it. */
    return `1/${1 + (seed % 28)}/26 ${1 + (seed % 12)}:${String(seed % 60).padStart(2, "0")} ${seed % 2 ? "PM" : "AM"}`;
  }
  if (/phone|callback number/.test(c)) return `(${200 + (seed % 700)}) ${100 + (seed % 900)}-${String(seed % 10000).padStart(4, "0")}`;
  /* REPORTED CONTACT FIELDS need to read like contact details. Without these the
     minted-dimension fallback produced "Address (Reported) A", which is the sort of
     placeholder a prospect spots immediately in a row-level report. */
  if (/address 2/.test(c)) return (seed % 3 === 0) ? `Apt ${1 + (seed % 40)}` : "";
  if (/address/.test(c)) return `${100 + (seed % 8900)} ${STREETS[seed % STREETS.length]}`;
  if (/country/.test(c)) return "United States";
  if (/state or province|^state/.test(c)) return STATES[seed % STATES.length];
  if (/name \(reported\)|consumer name|first name|last name|^name$/.test(c)) {
      /* UNSIGNED shift. `seed` is a >>>0 hash so it can exceed 2^31, where a signed >>
       goes negative, negative % length stays negative, and the lookup returns
       undefined — which rendered as the literal "Jordan undefined" in a report row. */
    const f = FIRST[seed % FIRST.length], l = LAST[(seed >>> 3) % LAST.length];
    return /first name/.test(c) ? f : /last name/.test(c) ? l : `${f} ${l}`;
  }
  if (/ip address/.test(c)) return `${10 + (seed % 240)}.${seed % 256}.${(seed >>> 4) % 256}.${(seed >>> 8) % 256}`;
  if (/url|calling page|landing page/.test(c)) {
    const path = ["/", "/contact", "/services", "/locations", "/quote"][seed % 5];
    return `${profile.brandDomain || "example.com"}${path}`;
  }
  if (/email/.test(c)) return `caller${row + 1}@example.com`;
  if (/zip|postal/.test(c)) return String(10000 + (seed % 89999));
  if (/duration|time|monolog|silence|overtalk|hold/.test(c)) {
    const s = 20 + (seed % 400);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (/revenue|sale amount|fees|earned|paid/.test(c)) return `$${(200 + (seed % 4800)).toLocaleString("en-US")}`;
  if (/count|messages|keypresses/.test(c)) return String(1 + (seed % 40));
  if (/score|ranking/.test(c)) return String(50 + (seed % 50));
  /* A dimension the pool knows: cycle its real values so a Marketing Source column
     shows this prospect's actual sources rather than filler. */
  const vals = dimensionValues(profile, col);
  if (vals.length && !/^{/.test(vals[0]) && !vals[0].startsWith(col)) return vals[row % vals.length];
  return vals.length ? vals[row % vals.length] : `${col} ${row + 1}`;
}
