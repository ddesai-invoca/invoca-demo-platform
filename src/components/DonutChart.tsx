import { useState } from "react";

/* Donut chart matching the live Invoca style:
   - arc size = each segment's share of the shown segments (fills 360°)
   - % label ON each slice, computed against the grand total (call count)
   - category label OUTSIDE with a leader line (no bottom legend) */

const COLORS = ["#2666f9", "#129922", "#f5575a", "#009788", "#a182e5", "#f5b800", "#8892a0"];

export interface DonutSegment {
  label: string;
  value: number;
}

/* Geometry as DATA rather than module constants, so one screen can use a different
   box without the other six changing. `lead1`/`lead2` are the two legs of the leader
   line: radially out from the arc, then horizontally to the label. */
export interface DonutGeom {
  w: number; h: number; cx: number; cy: number; rOut: number; rIn: number;
  lead1: number; lead2: number;
  /* Align labels into two columns instead of letting each sit at its own radius.
     OFF by default so the six dashboards that share this component keep the exact
     label positions they already have. */
  column?: boolean;
}

const DEFAULT_GEOM: DonutGeom = {
  w: 350, h: 260, cx: 175, cy: 130, rOut: 84, rIn: 50, lead1: 14, lead2: 20,
};

/* ThoughtSpot's proportions, measured off the real Performance By Medium tile
   (network 2160): a 620-wide chart area with a 250-wide donut, so the donut takes
   ~40% of the width and the remaining 30% each side holds the label. The leader
   lines are SHORT there — the label sits almost against the arc — which is what buys
   the room for "Paid Search - 763 (15.65%)" on one line.

   This box only pays off at real screen widths. Single-line "name - count (pct)"
   labels need roughly three times the donut's diameter, so below ~500px of rendered
   width the text gets small; the donut column is ~610px on a 1800px screen, which is
   the reference's own width.

   Measured at 620 wide, then widened twice. At 620 the longest left label
   ("Facebook - 5.33K (11.04%)", 172 units) started at x=-8 and lost its first letter;
   at 660 the Performance By Campaign labels still overran.

   740 with cx at 370 leaves 227 units each side, which is sized for the WORST CASE
   rather than for one prospect. Across the ten generated profiles the longest
   breakdown name runs 47 characters and the largest count is 34,218, so with the name
   truncated to 13 the widest label anyone can produce measured 219 units (an all-caps
   campaign, "SUMMER SALE … - 34.22K (45.67%)"). Shady Blinds alone would have fitted
   in 700, and then a longer-named prospect would have spilled into the table beside
   it. The cost is that the donut is 34% of the box rather than the reference's 40%. */
export const TS_GEOM: DonutGeom = {
  w: 740, h: 340, cx: 370, cy: 170, rOut: 125, rIn: 76, lead1: 8, lead2: 10, column: true,
};

/* Takes its radii as arguments rather than reading g.rIn/g.rOut, so the same function
   draws both the slice and the hover halo (a thin ring just outside it). */
function ring(a0: number, a1: number, rIn: number, rOut: number, g: DonutGeom): string {
  const p = (r: number, a: number) => [g.cx + r * Math.cos(a), g.cy + r * Math.sin(a)];
  const [x0, y0] = p(rOut, a0);
  const [x1, y1] = p(rOut, a1);
  const [x2, y2] = p(rIn, a1);
  const [x3, y3] = p(rIn, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function truncate(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* Hover behaviour, measured off the real tile's three hover states: the pointed-at
   slice keeps its colour while the rest fade almost out, a pale halo of the slice's own
   colour sits just beyond its outer edge, the other labels and leader lines fade
   (less far than the slices — they stay readable), and a dark panel names the metric
   and the dimension.

   Passing this object is what TURNS THE WHOLE THING ON; the two labels are the panel's
   captions ("Total Call Count:" / "Marketing Medium:"). */
export interface DonutHover {
  metricLabel: string;
  dimensionLabel: string;
  /* The real panel shows the same abbreviated count the labels use ("1.26K"), not a
     raw number. */
  format?: (n: number) => string;
}

/* `colors` lets ONE screen override the palette without touching the six
   dashboards that rely on the Invoca default. Added for Insights & Analytics,
   which is embedded ThoughtSpot and uses a different palette entirely.

   `onSlice`, `slicePct`, `label`, `geom` and `hover` are opt-in for the same reason:
   Insights & Analytics drills into an interaction drawer, prints no percent on the
   slice, puts the count and percent beside the name, and highlights on hover — none of
   which the six dashboards do. Left at their defaults, this renders exactly as it did
   before: no halo path, no opacity attribute below 1, no tooltip, and no wrapper div —
   the return value stays a bare <svg>, so `.donut-svg { margin: 0 auto }` still centres
   against `.donut-wrap` on those screens. (The leader line and label did gain a <g>
   around them, which carries opacity="1" there — inert, and it is what lets the two fade
   together here.) */
export function DonutChart({
  segments, total, colors = COLORS, onSlice, geom = DEFAULT_GEOM,
  slicePct = true, label = (seg) => truncate(seg.label), hover,
}: {
  segments: DonutSegment[]; total: number; colors?: string[];
  onSlice?: (segment: DonutSegment, index: number) => void;
  geom?: DonutGeom;
  /* false hides the percent printed inside the ring. */
  slicePct?: boolean;
  /* The text outside the ring. `pct` is the UNROUNDED share of the grand total, so
     the caller picks its own precision (ThoughtSpot shows two decimals). */
  label?: (segment: DonutSegment, pct: number) => string;
  hover?: DonutHover;
}) {
  const shownSum = segments.reduce((s, d) => s + d.value, 0) || 1;
  const grand = total || shownSum;
  const g = geom;
  let angle = -Math.PI / 2;

  const [hot, setHot] = useState<number | null>(null);
  /* Where the panel goes, and which side of the slice it sits on. Anchored at the
     slice's mid-arc point, then flipped toward the middle of the chart — which is what
     the reference does in all three of its hover shots: a slice on the right gets its
     panel to the LEFT, a slice on the left gets it to the right. Flipping inward is
     also what keeps the panel inside the tile. */
  const tip = (() => {
    if (hot === null || !hover) return null;
    let a = -Math.PI / 2;
    for (let i = 0; i < segments.length; i++) {
      const span = ((segments[i]?.value ?? 0) / shownSum) * Math.PI * 2;
      if (i === hot) {
        const mid = a + span / 2;
        const rMid = (g.rOut + g.rIn) / 2;
        const x = g.cx + rMid * Math.cos(mid), y = g.cy + rMid * Math.sin(mid);
        const seg = segments[i]!;
        return {
          seg, x, y,
          flipX: x > g.cx, flipY: y > g.cy,
          value: hover.format ? hover.format(seg.value) : seg.value.toLocaleString("en-US"),
        };
      }
      a += span;
    }
    return null;
  })();

  const svg = (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className="donut-svg" width="100%">
      {segments.map((seg, i) => {
        const frac = seg.value / shownSum;
        const a0 = angle;
        const a1 = angle + frac * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        angle = a1;

        // on-slice % label (share of grand total)
        const rMid = (g.rOut + g.rIn) / 2;
        const lx = g.cx + rMid * Math.cos(mid);
        const ly = g.cy + rMid * Math.sin(mid);
        const pct = (seg.value / grand) * 100;

        // external label + leader line
        const right = Math.cos(mid) >= 0;
        const p1 = [g.cx + g.rOut * Math.cos(mid), g.cy + g.rOut * Math.sin(mid)];
        const p2 = [g.cx + (g.rOut + g.lead1) * Math.cos(mid), g.cy + (g.rOut + g.lead1) * Math.sin(mid)];
        /* Labels line up in a COLUMN rather than each sitting wherever its own radius
           lands. A slice near the top or bottom has its p2 close to the centre
           horizontally, so left-anchoring there would give that label barely half the
           room a side label gets — which is what clipped "Facebook - 5.33K (11.04%)"
           while "Bing" beside it had space to spare. Pushing every label out to the
           widest column gives them all the same budget, and it matches the real tile:
           its left labels all END at x≈170-178 and its right labels all START at
           x≈445-452, ragged on the outer edge only. */
        const col = g.cx + g.rOut + g.lead1 + g.lead2;
        const p3 = !g.column
          ? [p2[0] + (right ? g.lead2 : -g.lead2), p2[1]]
          : right
            ? [Math.max(p2[0] + g.lead2, col), p2[1]]
            : [Math.min(p2[0] - g.lead2, 2 * g.cx - col), p2[1]];

        /* Slices fade much further than text does. At the labels' own 0.4 the ring
           still read as "several colours", losing the point; at the slices' 0.16 the
           grey labels would be all but gone. */
        const dim = hot !== null && hot !== i;
        const fill = colors[i % colors.length];

        return (
          <g key={i}>
            {hot === i && hover && (
              <path d={ring(a0, a1, g.rOut + 1, g.rOut + 10, g)} fill={fill} opacity={0.28} />
            )}
            <path d={ring(a0, a1, g.rIn, g.rOut, g)} fill={fill}
              opacity={dim ? 0.16 : 1}
              onMouseEnter={hover ? () => setHot(i) : undefined}
              onMouseLeave={hover ? () => setHot(null) : undefined}
              onClick={onSlice ? () => onSlice(seg, i) : undefined} />
            {slicePct && frac > 0.05 && (
              <text x={lx} y={ly + 4} textAnchor="middle" className="donut-pct">
                {Math.round(pct)}%
              </text>
            )}
            <g opacity={dim ? 0.4 : 1}>
              <polyline
                points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`}
                fill="none" stroke="#c7ccd3" strokeWidth={1}
              />
              <text
                x={p3[0] + (right ? 4 : -4)} y={p3[1] + 4}
                textAnchor={right ? "start" : "end"}
                className="donut-ext-label"
              >
                {label(seg, pct)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );

  if (!hover) return svg;

  /* The panel is HTML, not SVG, positioned in PERCENTAGES of the viewBox — the same
     approach the dashboard's other two tooltips use. The svg scales with its column, so
     viewBox units are not screen units and anything placed in px would drift. It reuses
     .ind-tip so all three tooltips on this dashboard cannot diverge.

     It shows the FULL slice name, which is a real gain: the labels around the ring are
     truncated at 13 characters, so hovering is how you read a long campaign name. */
  return (
    <div className="donut-hoverwrap">
      {svg}
      {tip && (
        <div className="ind-tip" style={{
          left: `${(tip.x / g.w) * 100}%`,
          top: `${(tip.y / g.h) * 100}%`,
          transform: `translate(${tip.flipX ? "calc(-100% - 14px)" : "14px"}, ${tip.flipY ? "calc(-100% - 10px)" : "10px"})`,
        }}>
          <div className="ind-tip-k">{hover.metricLabel}:</div>
          <div className="ind-tip-v">{tip.value}</div>
          <div className="ind-tip-k ind-tip-gap">{hover.dimensionLabel}:</div>
          <div className="ind-tip-v">{tip.seg.label}</div>
        </div>
      )}
    </div>
  );
}
