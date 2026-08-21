/* =============================================================================
   tsChart — measured constants and geometry helpers for the ThoughtSpot layer.
   -----------------------------------------------------------------------------
   Every number here was read out of the Highcharts SVG in the saved capture of the
   live "all templates" liveboard (8/18/2026). See CLAUDE.md for how to reopen that
   capture; the live page is a cross-origin iframe and cannot be measured directly.

   THE SURPRISE, and the one most likely to be "corrected" by mistake later:
   THERE ARE NO GRIDLINES. All 12 grid paths on the column chart and all 23 on the
   line chart carry `stroke: none`. The Dashboards tab draws #e7e9eb gridlines, so
   the instinct is to add them here too. Do not. Their absence is a large part of
   why the two tabs look like different products.

   The other structural difference from our Dashboards charts: THE LEGEND IS HTML,
   not SVG. ThoughtSpot renders it as a `vertical-legend-container` div beside the
   chart, 212px wide, with 12x12 CIRCULAR swatches. Drawing it inside the viewBox
   would scale the text with the chart, which is exactly the drift the real one
   avoids.
   ============================================================================= */

/* Plot-area insets. `left` is a FALLBACK only — see `plotOf`.
   ⚠️ THE LEFT INSET IS CONTENT-DERIVED, NOT FIXED. An earlier note here claimed 68 on
   every cartesian chart; re-measuring a chart whose y labels read "8K" gave 62, against
   68 where they read "600". The axis TITLES are not in the svg at all (they are HTML,
   see TsAxisTitles), so the only thing setting the left inset is the widest y label. */
export const TS_PLOT = { left: 68, top: 15, bottom: 54, right: 3 } as const;

export const TS_AXIS_LINE = "#e0e0e0";      // ThoughtSpot's default, NOT overridden
export const TS_AXIS_LABEL = "#5b6577";     // Invoca's override, applied
export const TS_LEGEND_TEXT = "#777e8b";    // ThoughtSpot's default, NOT overridden
export const TS_AXIS_FONT = 12;

export const TS_COLUMN_W = 22;              // bar width in a grouped column chart
export const TS_COLUMN_GAP = 5;             // gap BETWEEN bars inside one group
export const TS_BAR_THICK = 56;             // horizontal bar thickness
export const TS_LINE_W = 2;
export const TS_AREA_ALPHA = 0.2;
export const TS_DONUT_INNER = 0.5;          // inner/outer radius, measured 62.225/124.45

/* Default canvases, from the capture: column 634.5x449, pie 563x402,
   line 1538x633, bar 846x633, sparkline 398x157. */
export const TS_SIZE = {
  column: { w: 634.5, h: 449 },
  pie: { w: 563, h: 402 },
  /* Measured on the real single-line tile: 846x633 with the plot 781x564. */
  line: { w: 846, h: 633 },
  wide: { w: 1538, h: 633 },
  bar: { w: 846, h: 633 },
  spark: { w: 398, h: 157 },
} as const;

/* ---------------------------------------------------------------------------
   Scales and ticks
   --------------------------------------------------------------------------- */

/**
 * A "nice" axis maximum and its tick stops, so 0..583 reads 0..600 by 100.
 *
 * ⚠️ COUNT IS 8, AND 2.5 IS NOT AN ALLOWED STEP. Both come from the captures rather
 * than taste: the single-line chart's axis reads 0..8K by 1K (9 labels) off a ~7.4K
 * max, and the column chart reads 0..600 by 100 (7 labels) off a ~503 max. A count of
 * 8 reproduces BOTH; a count of 6 gave the line chart 2.5K steps, and no captured axis
 * anywhere uses a 2.5 step.
 */
/**
 * A scale that does NOT start at zero, for LINE and AREA charts — measured off the real
 * tile, whose axis reads 100..550 by 50 for data spanning ~103..490. Reverse-engineered
 * from that: step from the DATA RANGE (not the max), the bottom is the min floored to a
 * tick, and the top is the max plus ~5% headroom ceiled to a tick. Reproduces 100 and
 * 550 exactly, ten ticks, with the line starting at the very bottom of the plot.
 *
 * ⚠️ ZERO-BASED IS STILL RIGHT FOR BARS AND COLUMNS. A bar's length IS its value, so a
 * non-zero baseline overstates every difference — the capture's column chart runs 0..600
 * even though its smallest group is ~48. `zeroBased` is therefore a parameter, not a
 * global preference: lines and areas zoom, bars never do.
 */
export function niceScale(
  min: number, max: number, zeroBased: boolean, count = 8,
): { min: number; max: number; ticks: number[] } {
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (zeroBased) {
    const t = niceTicks(Math.max(0, max), count);
    return { min: 0, max: t.max, ticks: t.ticks };
  }
  /* ⚠️ A FLAT SERIES GETS ONE TICK AND SITS MID-PLOT. The capture's revenue series is
     all zeros, and its axis shows a single "0" label at half height with the line drawn
     across the middle — not collapsed onto the floor. Padding symmetrically around the
     value reproduces both. */
  if (max === min) return { min: min - 1, max: min + 1, ticks: [min] };
  const span = max - min;
  const step = niceStep(span / count);

  /* ⚠️ THE FLOOR IS THE EXACT MINIMUM, so the lowest point SITS ON the x axis. Flooring
     to the tick below (the obvious reading of the captured 100..550 axis) leaves up to a
     full step of gap, and with a coarse step that is very visible: a $4.74M minimum
     floored to $4M sat 12% up the axis, and 2:32 floored to 2:30 sat 8% up. Both read as
     the line hovering.
     The TICKS above are still round, so the axis labels stay readable; the bottom label
     is the real minimum. A nice tick sitting almost on top of that label is dropped,
     since two labels a few pixels apart is worse than one. */
  const lo = min;
  const hi = Math.ceil((max + span * 0.05) / step) * step;
  const ticks: number[] = [lo];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step / 2; v += step) {
    if (v - lo < step * 0.35) continue;          // too close to the floor label
    ticks.push(+v.toFixed(6));
  }
  return { min: lo, max: hi, ticks };
}

/** The 1 / 2 / 5 / 10 progression both captured axes use. 2.5 is deliberately absent. */
function niceStep(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

export function niceTicks(max: number, count = 8): { max: number; ticks: number[] } {
  if (!isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { max: top, ticks };
}

/** Compact formatting for a VALUE (tooltips, KPI numbers). */
export function tsNum(v: number): string {
  if (!isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + "M";
  if (a >= 10_000) return Math.round(v / 1000) + "K";
  return v % 1 === 0 ? v.toLocaleString("en-US") : v.toFixed(1);
}

/**
 * Formatting for an AXIS TICK, which is compact from 1,000 up — measured: the y axis
 * reads 0, 1K, 2K … 8K, where `tsNum` would print "1,000". Ticks are round by
 * construction (niceTicks), so a fraction only appears on a sub-10 axis.
 */
export function tsTick(v: number): string {
  if (!isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return +(v / 1_000_000).toFixed(1) + "M";
  if (a >= 1_000) return +(v / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + "K";
  return String(+v.toFixed(1));
}

/** Widest tick label decides the left inset, so long numbers are never clipped. */
export function leftInsetFor(ticks: number[]): number {
  const widest = ticks.reduce((n, t) => Math.max(n, tsTick(t).length), 1);
  /* Measured: "8K" (2 chars) -> 62, "600" (3) -> 68. ~6px per character off a 50px base,
     which reproduces both and degrades sensibly for "1.2M". */
  return Math.round(50 + widest * 6);
}

/**
 * Which of a series of DATE labels get a tick. The real axis is calendar-aligned, not
 * every-nth-point: over 112 weekly points it printed 6 labels, one per 4-month
 * boundary (09/01/2024, 01/01/2025, 05/01/2025, …). Evenly spacing indices lands close
 * but drifts off the month, which reads as arbitrary next to a real date axis.
 */
export function calendarTicks(labels: string[], everyMonths = 4): number[] {
  const month = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getFullYear() * 12 + d.getMonth();
  };
  const first = labels.map(month).find((m): m is number => m !== null);
  if (first === undefined) return labels.map((_, i) => i);
  const out: number[] = [];
  let prev: number | null = null;
  labels.forEach((l, i) => {
    const m = month(l);
    if (m === null) return;
    if (m !== prev && (m - first) % everyMonths === 0) out.push(i);
    prev = m;
  });
  return out.length ? out : labels.map((_, i) => i);
}

/* ---------------------------------------------------------------------------
   Right-hand axis columns (the multi-line template)
   ---------------------------------------------------------------------------
   Measured on the 4-series capture (viewBox 740x704, plot x=68 w=487):
     axis lines at x = 555 (the plot's right edge), 607, 672 — gaps of 52 then 65
     labels 15px right of each line, text-anchor start
     the rotated title then sits in the space between those labels and the NEXT axis line

   ⚠️ THE GAPS ARE CONTENT-DERIVED, EXACTLY LIKE `leftInsetFor`. The first version of this
   froze 52 and 65 as constants and explained the difference as "the first gap really is
   narrower than the rest". It is not: the capture's first right axis had the single label
   `0` and its second had `91%`, and the gap is just wide enough for that axis's own
   labels plus its title. One rule reproduces both:

     gap = 15 (label offset) + widestChars * 6 + 7 + titleBand + 6
       "0"   -> 15 +  6 + 7 + 18 + 6 = 52   (measured 52)
       "91%" -> 15 + 18 + 7 + 18 + 6 = 64   (measured 65)

   With the constants, a `$4.7M` axis put its title 7px INSIDE its own tick labels and
   straddling the next axis line, which is the defect this replaces.

   ⚠️ `titleBand` IS IN VIEWBOX UNITS AND IS NOT 18. The title is HTML at a fixed 12px
   (see TsAxisTitles) laid over an svg that SCALES with its column, so its 18px band costs
   `18 / scale` viewBox units — 30 units in a half-width tile. Reserving a flat 18 is what
   made the shortfall grow as the tile got narrower. Callers pass the measured band. */
export const TS_RIGHT_LABEL_GAP = 15;
/** A rotated 12px title occupies its line-height across. CSS px — convert before use. */
export const TS_TITLE_BAND_PX = 18;
/** Measured: ~7px between the tick labels and the title, ~6px before the next axis line. */
export const TS_RIGHT_TITLE_PAD = 7;
export const TS_RIGHT_CLEAR = 6;

export interface RightAxisLayout {
  /** Total width to reserve to the right of the plot. */
  inset: number;
  /** x of each right axis line, relative to the plot's right edge (lineAt[0] is 0). */
  lineAt: number[];
  /** x where each axis's rotated title starts, relative to the plot's right edge. */
  titleAt: number[];
}

/**
 * Lay out the right-hand axes from the tick labels they will actually print.
 *
 * `tickLabels` is one array of FORMATTED labels per right axis, so a `$4.7M` column gets
 * the room it needs and a `0` column does not take room it does not need.
 * `titleBand` is the title's width in VIEWBOX units (see the warning above).
 */
export function rightAxisLayout(tickLabels: string[][], titleBand: number): RightAxisLayout {
  const lineAt: number[] = [];
  const titleAt: number[] = [];
  let x = 0;
  for (const labels of tickLabels) {
    const widest = labels.reduce((n, l) => Math.max(n, l.length), 1);
    const labelEnd = TS_RIGHT_LABEL_GAP + widest * 6;
    lineAt.push(x);
    titleAt.push(x + labelEnd + TS_RIGHT_TITLE_PAD);
    x += labelEnd + TS_RIGHT_TITLE_PAD + titleBand + TS_RIGHT_CLEAR;
  }
  return { inset: tickLabels.length ? x : TS_PLOT.right, lineAt, titleAt };
}

/* ---------------------------------------------------------------------------
   Line trackers — hovering anywhere ALONG a line, not just on its points
   --------------------------------------------------------------------------- */

/**
 * Width of the invisible tracker stroke laid over a line.
 *
 * The point-only hit circles meant a user had to find a data point; hovering the line
 * between two points did nothing. Highcharts gives each series a tracker path and snaps to
 * the nearest point (`stickyTracking`, `tooltip.snap` = 10), which is what ThoughtSpot
 * renders. 14 gives 7px either side of a 2px line — enough to catch the line comfortably
 * without swallowing a neighbouring series.
 */
export const TS_TRACKER_W = 14;

/**
 * Index of the point nearest an x position, in svg user units.
 *
 * ⚠️ CALLERS CAN PASS `clientX - svgRect.left` DIRECTLY, but only because charts are drawn
 * 1:1 — one user unit is one CSS pixel. If the svg ever scales again this needs the
 * viewBox conversion back.
 */
export function nearestIndex(pts: Array<[number, number]>, x: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i][0] - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export type Plot = { x: number; y: number; w: number; h: number };

/** The plot rect for a canvas, reserving `legendW` on the right when there is one. */
export function plotOf(w: number, h: number, legendW = 0, left: number = TS_PLOT.left): Plot {
  return {
    x: left,
    y: TS_PLOT.top,
    w: Math.max(1, w - left - (legendW || TS_PLOT.right)),
    h: Math.max(1, h - TS_PLOT.top - TS_PLOT.bottom),
  };
}

/** Band positions for n categories across a plot, as the column charts lay them out. */
export function bands(p: Plot, n: number): { centre: (i: number) => number; width: number } {
  const width = n > 0 ? p.w / n : p.w;
  return { centre: (i: number) => p.x + width * (i + 0.5), width };
}

/**
 * y for a value on a scale. `min` defaults to 0, so every zero-based caller is
 * unchanged; a zoomed line axis passes its own floor.
 */
export function yOf(p: Plot, v: number, max: number, min = 0): number {
  const span = max - min;
  const t = span > 0 ? Math.min(1, Math.max(0, (v - min) / span)) : 0;
  return p.y + p.h - t * p.h;
}

/** An SVG donut/pie slice path. `rIn = 0` gives a solid pie. */
export function slicePath(
  cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number,
): string {
  const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(rOut, a0), [x1, y1] = pt(rOut, a1);
  if (rIn <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rOut} ${rOut} 0 ${big} 1 ${x1} ${y1} Z`;
  }
  const [x2, y2] = pt(rIn, a1), [x3, y3] = pt(rIn, a0);
  return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} `
    + `A ${rIn} ${rIn} 0 ${big} 0 ${x3} ${y3} Z`;
}

/** Slice angles from values, starting at 12 o'clock like the real donuts. */
export function sliceAngles(values: number[]): Array<{ a0: number; a1: number; frac: number }> {
  const total = values.reduce((s, v) => s + (isFinite(v) && v > 0 ? v : 0), 0);
  if (total <= 0) return [];
  let a = -Math.PI / 2;
  return values.map((v) => {
    const frac = (isFinite(v) && v > 0 ? v : 0) / total;
    const a0 = a;
    a += frac * Math.PI * 2;
    return { a0, a1: a, frac };
  });
}

/* A polyline through points, and its closed area twin for the sparklines. */
export const linePath = (pts: Array<[number, number]>): string =>
  pts.length ? pts.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ") : "";

export const areaPath = (pts: Array<[number, number]>, baseY: number): string =>
  pts.length ? `${linePath(pts)} L ${pts[pts.length - 1][0]} ${baseY} L ${pts[0][0]} ${baseY} Z` : "";
