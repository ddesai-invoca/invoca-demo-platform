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

/* Plot-area insets, identical on every cartesian chart measured (plot x=68, y=15).
   `right` is the no-legend value; a chart with a legend hands that space to it. */
export const TS_PLOT = { left: 68, top: 15, bottom: 54, right: 8 } as const;

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
  line: { w: 1538, h: 633 },
  bar: { w: 846, h: 633 },
  spark: { w: 398, h: 157 },
} as const;

/* ---------------------------------------------------------------------------
   Scales and ticks
   --------------------------------------------------------------------------- */

/** A "nice" axis maximum and its tick stops, so 0..583 reads 0..600 by 100. */
export function niceTicks(max: number, count = 6): { max: number; ticks: number[] } {
  if (!isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { max: top, ticks };
}

/** Compact axis/label formatting, matching what the real charts print. */
export function tsNum(v: number): string {
  if (!isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + "M";
  if (a >= 10_000) return Math.round(v / 1000) + "K";
  return v % 1 === 0 ? v.toLocaleString("en-US") : v.toFixed(1);
}

export type Plot = { x: number; y: number; w: number; h: number };

/** The plot rect for a canvas, reserving `legendW` on the right when there is one. */
export function plotOf(w: number, h: number, legendW = 0): Plot {
  return {
    x: TS_PLOT.left,
    y: TS_PLOT.top,
    w: Math.max(1, w - TS_PLOT.left - (legendW || TS_PLOT.right)),
    h: Math.max(1, h - TS_PLOT.top - TS_PLOT.bottom),
  };
}

/** Band positions for n categories across a plot, as the column charts lay them out. */
export function bands(p: Plot, n: number): { centre: (i: number) => number; width: number } {
  const width = n > 0 ? p.w / n : p.w;
  return { centre: (i: number) => p.x + width * (i + 0.5), width };
}

/** y for a value, given a nice max. */
export function yOf(p: Plot, v: number, max: number): number {
  const t = max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
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
