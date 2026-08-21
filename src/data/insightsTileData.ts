import type { CustomerProfile } from "./schema";
import {
  axisTitleFor, formatMeasure, isAdditive, kindOf, magnitudeOf, type MeasureKind,
} from "./insightsMeasures";
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
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 12 }, (_, i) => `${(i * 2) || 12}${i * 2 < 12 ? "am" : "pm"}`);

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

export interface TileChoices {
  template: string;
  name: string;
  measures: string[];       // Attribute / Measure / Size (Rank) / Measure L+R
  dimensions: string[];     // Category / Categories
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
    case "KPI":
    case "Metric": {
      /* Metric is a single number; KPI pairs it with its trend, which is the only
         difference between the two templates on the live drawer. */
      const v = Math.round(sc.max * 0.58);
      const kpis = [{ label: primary, value: formatMeasure(v, sc.kind) }];
      if (c.template === "KPI") kpis.push({ label: "vs. prior period", value: `+${4 + (seed % 12)}%` });
      return { tileType: "kpi", title: c.name, note, kpis, xLabels: [], series: [], slices: [] };
    }
    case "Pie Chart": {
      const vals = dimensionValues(profile, c.dimensions[0] ?? "Marketing Source").slice(0, 6);
      const nums = spread(Math.round(sc.max * 0.6), vals.length, seed);
      return { tileType: "pie", title: c.name, note, kpis: [], xLabels: [], series: [],
        slices: vals.map((label, i) => ({ label, value: nums[i] })) };
    }
    case "Stacked Bar": {
      const vals = dimensionValues(profile, c.dimensions[0] ?? "Marketing Source").slice(0, 6);
      return { tileType: "bar", title: c.name, note, kpis: [], slices: [],
        xLabels: vals, series: series(vals) };
    }
    case "Calls by Hour": {
      return { tileType: "bar", title: c.name, note: `${primary} by hour of day`, kpis: [], slices: [],
        xLabels: HOURS, series: series(HOURS) };
    }
    case "Calls by Day of Week": {
      return { tileType: "bar", title: c.name, note: `${primary} by day of week`, kpis: [], slices: [],
        xLabels: DOW, series: series(DOW) };
    }
    case "Dual Y-Axis": {
      /* No dual-axis renderer exists, so this draws both measures as bars on one
         axis. Recorded rather than silently approximated: a second axis is a renderer
         change, not data, and inventing one here would break the no-template-changes
         rule the AI edits live under. */
      const labels = weekLabels(profile);
      return { tileType: "bar", title: c.name, note, kpis: [], slices: [],
        xLabels: labels, series: series(labels) };
    }
    case "Geo Heatmap": {
      /* Same honesty: there is no map renderer. The prospect's real geography from the
         pool, drawn as bars, beats a fake map. */
      const vals = dimensionValues(profile, "Region").slice(0, 6);
      return { tileType: "bar", title: c.name, note: `${primary} by region`, kpis: [], slices: [],
        xLabels: vals, series: series(vals) };
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
   magnitude, a (T/F) signal reads True/False. Everything is keyed off the profile id
   and the row index, so the same chosen columns always produce the same table — the
   rule that a number never changes once shown applies to report rows too. */
export function reportRows(profile: CustomerProfile, columns: string[], count = 8): string[][] {
  const base = hash(profile.id + "::report");
  return Array.from({ length: count }, (_, i) =>
    columns.map((col, j) => cellFor(profile, col, i, base + i * 131 + j * 17)));
}

function cellFor(profile: CustomerProfile, col: string, row: number, seed: number): string {
  const c = col.toLowerCase();
  if (/\(t\/f\)$/.test(c)) return (seed % 3 === 0) ? "False" : "True";
  if (/record id|unique id|interaction id/.test(c)) {
    const hex = seed.toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
    return `${hex.slice(0, 4)}-${hex.slice(4)}${(row + 17).toString(16).toUpperCase()}`;
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
