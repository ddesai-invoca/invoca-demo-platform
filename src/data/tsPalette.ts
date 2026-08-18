/* =============================================================================
   tsPalette — the ThoughtSpot chart palette used by Insights & Analytics.
   -----------------------------------------------------------------------------
   MEASURED, not chosen. Read out of the Highcharts SVG in a SingleFile capture of
   the live "all templates" liveboard (8/18/2026) by collecting the `fill` of every
   series shape in all 12 charts. See CLAUDE.md for how to get back inside the
   capture, because the live page cannot be read directly (cross-origin iframe).

   IT IS A STRUCTURED SYSTEM, NOT A FLAT LIST: 8 base hues x 5 steps = 40 colours.
   A chart with n series takes the first n BASE hues in order. A pie/donut that
   needs more than 8 slices continues into the tints and shades of the same hues,
   which is why the big donuts show pale and dark variants of colours already used.
   Getting that wrong is what makes a replica look "close but off": the eye reads
   the family relationship even when it cannot name the hex.

   ⚠️ THE ORDER IS PER CHART TYPE, NOT GLOBAL. Lines and areas start at BLUE
   (series 0 = #2666F9, 1 = #00DEBC, 2 = #FFD800). The grouped COLUMN chart starts
   at GREEN (0 = #2CBF58, 1 = #FFD800, 2 = #00DEBC, 3 = #2666F9) — verified against
   its own legend swatches, so it is real and not a DOM-order artefact. Do not
   assume one global sequence.
   ============================================================================= */

/* Each hue: [darkest, dark, BASE, light, lightest]. Index 2 is the base. */
export const TS_HUES: Record<string, readonly [string, string, string, string, string]> = {
  blue:   ["#173d95", "#1e52c7", "#2666F9", "#7DA3FB", "#D4E0FE"],
  teal:   ["#008571", "#00b296", "#00DEBC", "#33e5c9", "#66ebd7"],
  yellow: ["#998200", "#ccad00", "#FFD800", "#ffe033", "#ffe866"],
  green:  ["#1a7335", "#239946", "#2CBF58", "#56cc79", "#80d99b"],
  purple: ["#503885", "#6a4bb2", "#855EDE", "#9d7ee5", "#b69eeb"],
  orange: ["#994329", "#cc5a37", "#FF7045", "#ff8d6a", "#ffa98f"],
  grey:   ["#53575f", "#6e747e", "#8A919E", "#a1a7b1", "#b9bdc5"],
  red:    ["#890b10", "#b60f16", "#E4131B", "#e94249", "#ef7176"],
};

const BASE_ORDER = ["blue", "teal", "yellow", "green", "purple", "orange", "grey", "red"] as const;

/* Line, area and dual-axis charts run in this order. */
export const TS_SERIES_LINE = BASE_ORDER.map((h) => TS_HUES[h][2]);

/* The grouped column chart runs green-first. Measured off its legend, not guessed. */
export const TS_SERIES_COLUMN = ["#2CBF58", "#FFD800", "#00DEBC", "#2666F9",
  ...BASE_ORDER.slice(4).map((h) => TS_HUES[h][2])];

/* A pie/donut walks the bases, then the tints, so slice 9 relates to slice 1. */
export const TS_SLICE_COLORS: string[] = (() => {
  const out: string[] = [];
  for (const step of [2, 3, 1, 4, 0]) for (const h of BASE_ORDER) out.push(TS_HUES[h][step]);
  return out;
})();

/* An area fill is its line colour at 20% — measured as rgba(38,102,249,0.2)
   against a #2666F9 stroke. */
export const areaFill = (hex: string, alpha = 0.2): string => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/* ---------------------------------------------------------------------------
   THE TABLE HEATMAP ("show heat map" checked) is a pale CYAN ramp, and it is
   normalised PER COLUMN, not across the whole table: in the capture, 278 / 317 /
   825 all land on the same top colour because each sits at the top of its own
   column. Sampled stops, low value to high:

     1 -> #f8fdfe    9 -> #f4fcfd   23 -> #eefbfc   34 -> #eafafb
     2 -> #f7fdfe   13 -> #f2fcfd   27 -> #edfafc   41 -> #e7f9fb
     5 -> #f6fdfd   21 -> #effbfc   31 -> #ebfafc   47 -> #e5f8fa
    52 -> #e2f8fa   61 -> #dff7f9   87 -> #d4f4f7  151 -> #b9edf3   max -> #b5ecf2

   So it runs #f8fdfe (min) to #b5ecf2 (max). A straight RGB lerp between those two
   endpoints reproduces ALL 16 sampled stops to within 2/255 (verified), which is why
   this is a two-stop lerp rather than a lookup table.

   ⚠️ PASS THAT COLUMN'S OWN min/max, NOT THE TABLE'S. The first check of this failed
   badly — value 47 came out #f4fcfd against a sampled #e5f8fa — because it was given
   the whole table's range (1..825). 825 belongs to a DIFFERENT column. With the
   column's own bounds (1..160) every stop lands. The function was right and the test
   was wrong, which is the usual way round here.
   --------------------------------------------------------------------------- */
export const TS_HEAT_MIN = "#f8fdfe";
export const TS_HEAT_MAX = "#b5ecf2";

export function heatColor(value: number, min: number, max: number): string {
  if (!isFinite(value) || max <= min) return TS_HEAT_MIN;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const a = parseInt(TS_HEAT_MIN.slice(1), 16), b = parseInt(TS_HEAT_MAX.slice(1), 16);
  const mix = (sh: number) => {
    const x = (a >> sh) & 255, y = (b >> sh) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}
