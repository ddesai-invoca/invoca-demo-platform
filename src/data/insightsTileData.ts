import type { CustomerProfile } from "./schema";
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
function totalCalls(profile: CustomerProfile): number {
  const r = profile.reports as Reports;
  const tile = r.marketingDashboard?.kpiGroups?.[0]?.tiles?.find((t) => /call count/i.test(t.label));
  const n = parseInt((tile?.value ?? "0").replace(/[^\d]/g, ""), 10);
  return n || 20000;
}

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
   Percent-ish measures stay in 0..100; counts and money scale off the prospect's own
   call volume, so a tile never contradicts the dashboards beside it. */
function measureScale(profile: CustomerProfile, measure: string): { max: number; pct: boolean; money: boolean } {
  const calls = totalCalls(profile);
  const m = measure.toLowerCase();
  if (/revenue|sale amount|fees|earned|paid/.test(m)) return { max: Math.round(calls * 780), pct: false, money: true };
  if (/time|duration|monolog|hold|silence|overtalk|offset/.test(m)) return { max: 420, pct: false, money: false };
  if (/score|ranking/.test(m)) return { max: 100, pct: true, money: false };
  if (/count|messages|interaction/.test(m)) return { max: calls, pct: false, money: false };
  /* A signal flag used as a measure is a COUNT of calls carrying it. */
  return { max: Math.round(calls * 0.62), pct: false, money: false };
}

const fmt = (n: number, money: boolean, pct: boolean) =>
  pct ? `${n}%` : money ? `$${n.toLocaleString("en-US")}` : n.toLocaleString("en-US");

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

function weekLabels(profile: CustomerProfile): string[] {
  const r = profile.reports as Reports;
  const x = r.marketingDashboard?.salesCallBreakoutGraph?.xLabels;
  return x?.length ? x : ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"];
}

/* ---- the builder ---------------------------------------------------------- */
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
      const kpis = [{ label: primary, value: fmt(v, sc.money, sc.pct) }];
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
    default: {
      /* Single- and Multi-Line both land here; the only difference is how many
         measures the drawer collected. */
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
