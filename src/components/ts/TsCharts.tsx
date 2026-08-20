import { fitValues } from "../chartFit";
import { TS_SERIES_COLUMN, TS_SERIES_LINE, TS_SLICE_COLORS, areaFill } from "../../data/tsPalette";
import {
  TS_AREA_ALPHA, TS_BAR_THICK, TS_COLUMN_GAP, TS_COLUMN_W, TS_DONUT_INNER, TS_LINE_W, TS_SIZE,
  areaPath, bands, calendarTicks, leftInsetFor, linePath, niceScale, niceTicks, plotOf,
  slicePath, sliceAngles, tsNum, yOf,
} from "./tsChart";
import { TsAxes, TsAxisTitles, TsTip, useTsHover } from "./TsShell";

/* =============================================================================
   TsCharts — the seven ThoughtSpot chart templates, drawn to measured geometry.
   -----------------------------------------------------------------------------
   Line / Multi-Line / Area · Column (grouped and stacked) · Horizontal Bar ·
   Dual Y-Axis · Pie and Donut.

   Every one obeys the standing Insights rule: hover HIGHLIGHTS by fading the rest
   (bars to 0.22, slices to 0.16 with a halo), shows a metrics panel, and calls
   `onSelect` on click so a screen can open the interaction drawer. The fades
   transition OPACITY ONLY at 180ms; transitioning `all` makes the panel glide a
   beat behind the cursor because React reuses the element as the pointer moves.

   All series data goes through `fitValues`, so a wrong-length or empty series
   cannot throw or draw a fake flat line at zero. That is what lets the AI edit
   these values without a renderer crashing.
   ============================================================================= */

export interface TsSeries { name: string; values: number[] }
export interface TsSlice { label: string; value: number }

export const legendFor = (series: TsSeries[], palette: string[]) =>
  series.map((s, i) => ({ label: s.name, color: palette[i % palette.length] }));

const LEGEND_W = 212;

/* ---- line, multi-line and area -------------------------------------------- */

export function TsLine({
  categories, series, w = TS_SIZE.line.w, h = TS_SIZE.line.h, xTitle, yTitle,
  area = false, showLegend = true, dashTail = false, onSelect,
}: {
  categories: string[]; series: TsSeries[]; w?: number; h?: number;
  xTitle?: string; yTitle?: string; area?: boolean; showLegend?: boolean;
  /** Dot the final segment, as the real chart does for an incomplete period. */
  dashTail?: boolean;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const hv = useTsHover();
  const n = categories.length;
  const fitted = series
    .map((s) => ({ name: s.name, values: fitValues(s.values, n) }))
    .filter((s): s is { name: string; values: number[] } => s.values !== null);
  const max = Math.max(1, ...fitted.flatMap((s) => s.values));
  const min = Math.min(...fitted.flatMap((s) => s.values), max);
  const legendW = showLegend && fitted.length > 1 ? LEGEND_W : 0;
  /* ⚠️ A LINE ZOOMS, AN AREA DOES NOT. The real tile's axis starts near the data floor
     (100 for a ~103 minimum) so the line uses the full height instead of hugging the
     top. An AREA's fill encodes magnitude the way a bar's length does, so zooming one
     would overstate every difference — same reason columns keep a zero baseline. */
  const { min: yMin, max: yMax, ticks } = niceScale(min, max, area);
  const p = plotOf(w, h, legendW, leftInsetFor(ticks));
  const b = bands(p, n);
  /* Date labels get calendar-aligned ticks, but ONLY when there are enough points to
     need thinning. The grouped column's five weekly dates all sit inside one month, so
     a 4-month rule there would print exactly one label and drop the rest. */
  const tickAt = categories.length > 12 && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(categories[0] ?? "")
    ? calendarTicks(categories) : undefined;

  return (
    <div className="ts-chartwrap">
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <TsAxes plot={p} categories={categories} yMax={yMax} yMin={yMin} yTicks={ticks}
          tickAt={tickAt} />
        {fitted.map((s, si) => {
          const color = TS_SERIES_LINE[si % TS_SERIES_LINE.length];
          const pts = s.values.map((v, i) => [b.centre(i), yOf(p, v, yMax, yMin)] as [number, number]);
          const dim = hv.activeSeries !== null && hv.activeSeries !== si;
          return (
            <g key={s.name} className="ts-series" opacity={dim ? 0.22 : 1}>
              {area ? (
                <path d={areaPath(pts, p.y + p.h)} fill={areaFill(color, TS_AREA_ALPHA)} stroke="none" />
              ) : null}
              {/* The last segment is DOTTED: the real chart re-draws the series with
                  `stroke-dasharray: 2,2` clipped to the final period, because that
                  period is still incomplete. Drawing the tail as its own short dashed
                  path is visually identical without needing a clip. */}
              <path d={linePath(dashTail ? pts.slice(0, -1) : pts)} fill="none" stroke={color}
                strokeWidth={TS_LINE_W} strokeLinejoin="round" strokeLinecap="round" />
              {dashTail && pts.length > 1 ? (
                <path d={linePath(pts.slice(-2))} fill="none" stroke={color}
                  strokeWidth={TS_LINE_W} strokeDasharray="2,2" strokeLinecap="round" />
              ) : null}
              {pts.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={10} fill="transparent"
                  className={onSelect ? "ts-hit ts-hit--click" : "ts-hit"}
                  onMouseEnter={() => {
                    hv.setActiveSeries(si);
                    hv.setHover({
                      xPct: ((cx - 0) / w) * 100, yPct: (cy / h) * 100,
                      rows: [[s.name, tsNum(s.values[i])], [xTitle ?? "Category", categories[i]]],
                    });
                  }}
                  onMouseLeave={hv.clear}
                  onClick={onSelect ? () => onSelect(s.name, categories[i], s.values[i]) : undefined} />
              ))}
            </g>
          );
        })}
      </svg>
      <TsAxisTitles xTitle={xTitle} yTitle={yTitle} plot={p} w={w} h={h} />
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- grouped and stacked column ------------------------------------------- */

export function TsColumn({
  categories, series, w = TS_SIZE.column.w, h = TS_SIZE.column.h, xTitle, yTitle,
  stacked = false, showLegend = true, onSelect,
}: {
  categories: string[]; series: TsSeries[]; w?: number; h?: number;
  xTitle?: string; yTitle?: string; stacked?: boolean; showLegend?: boolean;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const hv = useTsHover();
  const n = categories.length;
  const fitted = series
    .map((s) => ({ name: s.name, values: fitValues(s.values, n) }))
    .filter((s): s is { name: string; values: number[] } => s.values !== null);
  const max = stacked
    ? Math.max(1, ...categories.map((_, i) => fitted.reduce((t, s) => t + s.values[i], 0)))
    : Math.max(1, ...fitted.flatMap((s) => s.values));
  const legendW = showLegend && fitted.length > 1 ? LEGEND_W : 0;
  const { max: yMax, ticks } = niceTicks(max);
  const p = plotOf(w, h, legendW, leftInsetFor(ticks));
  const b = bands(p, n);

  /* Measured: bars are 22 wide with a 5px gap INSIDE a group, and a group fills
     almost all of its band (103 of 111 on the capture) with only a small gutter
     between groups. So the constraint is "fit the band minus a gutter", NOT a
     fraction of the band: capping at 0.72 of the band shrank the bars to 17.2 and
     the gap to 3.9 even where the measured 22/5 fitted perfectly. Narrow tiles
     still shrink, and nothing ever grows past the measured width. */
  const GROUP_GUTTER = 8;
  const groupW = stacked ? TS_COLUMN_W : fitted.length * TS_COLUMN_W + (fitted.length - 1) * TS_COLUMN_GAP;
  const scale = Math.min(1, Math.max(0.1, b.width - GROUP_GUTTER) / Math.max(1, groupW));
  const barW = TS_COLUMN_W * scale;
  const gap = TS_COLUMN_GAP * scale;

  return (
    <div className="ts-chartwrap">
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <TsAxes plot={p} categories={categories} yMax={yMax} yTicks={ticks} />
        {categories.map((cat, ci) => {
          const cx = b.centre(ci);
          const totalW = stacked ? barW : fitted.length * barW + (fitted.length - 1) * gap;
          let stackTop = p.y + p.h;
          return (
            <g key={cat + ci}>
              {fitted.map((s, si) => {
                const color = TS_SERIES_COLUMN[si % TS_SERIES_COLUMN.length];
                const v = s.values[ci];
                const yTop = yOf(p, stacked ? v : v, yMax);
                const barH = Math.max(0, p.y + p.h - yTop);
                const x = stacked ? cx - barW / 2 : cx - totalW / 2 + si * (barW + gap);
                const y = stacked ? stackTop - barH : yTop;
                if (stacked) stackTop -= barH;
                const dim = hv.activeSeries !== null && hv.activeSeries !== si;
                return (
                  /* No rx: the real columns have square corners. */
                  <rect key={s.name} x={x} y={y} width={barW} height={barH} fill={color}
                    opacity={dim ? 0.22 : 1}
                    className={onSelect ? "ts-bar ts-bar--click" : "ts-bar"}
                    onMouseEnter={() => {
                      hv.setActiveSeries(si);
                      hv.setHover({
                        xPct: ((x + barW / 2) / w) * 100, yPct: (y / h) * 100,
                        rows: [[s.name, tsNum(v)], [xTitle ?? "Category", cat]],
                      });
                    }}
                    onMouseLeave={hv.clear}
                    onClick={onSelect ? () => onSelect(s.name, cat, v) : undefined} />
                );
              })}
            </g>
          );
        })}
      </svg>
      <TsAxisTitles xTitle={xTitle} yTitle={yTitle} plot={p} w={w} h={h} />
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- horizontal bar ------------------------------------------------------- */

export function TsBar({
  categories, values, w = TS_SIZE.bar.w, h = TS_SIZE.bar.h, xTitle, seriesName = "Value", onSelect,
}: {
  categories: string[]; values: number[]; w?: number; h?: number;
  xTitle?: string; seriesName?: string;
  onSelect?: (category: string, value: number) => void;
}) {
  const hv = useTsHover();
  const n = categories.length;
  const vals = fitValues(values, n) ?? [];
  if (!vals.length) return <div className="ts-chartwrap" />;
  const p = plotOf(w, h, 0);
  const { max: xMax, ticks } = niceTicks(Math.max(1, ...vals));
  const band = p.h / Math.max(1, n);
  const thick = Math.min(TS_BAR_THICK, band * 0.8);

  return (
    <div className="ts-chartwrap">
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <TsAxes plot={p} categories={categories} yMax={xMax} yTicks={ticks} horizontal />
        {vals.map((v, i) => {
          const barW = xMax > 0 ? (v / xMax) * p.w : 0;
          const y = p.y + band * (i + 0.5) - thick / 2;
          const dim = hv.activeSeries !== null && hv.activeSeries !== i;
          return (
            <rect key={categories[i] + i} x={p.x} y={y} width={barW} height={thick}
              fill={TS_SERIES_LINE[0]} opacity={dim ? 0.22 : 1}
              className={onSelect ? "ts-bar ts-bar--click" : "ts-bar"}
              onMouseEnter={() => {
                hv.setActiveSeries(i);
                hv.setHover({
                  xPct: ((p.x + barW) / w) * 100, yPct: (y / h) * 100,
                  rows: [[seriesName, tsNum(v)], ["Category", categories[i]]],
                });
              }}
              onMouseLeave={hv.clear}
              onClick={onSelect ? () => onSelect(categories[i], v) : undefined} />
          );
        })}
      </svg>
      <TsAxisTitles xTitle={xTitle} plot={p} w={w} h={h} />
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- dual Y-axis (column + line) ------------------------------------------ */

export function TsDualAxis({
  categories, columnSeries, lineSeries, w = TS_SIZE.line.w, h = TS_SIZE.line.h,
  xTitle, yTitle, rightTitle, rightFormat, onSelect,
}: {
  categories: string[]; columnSeries: TsSeries; lineSeries: TsSeries;
  w?: number; h?: number; xTitle?: string; yTitle?: string; rightTitle?: string;
  rightFormat?: (v: number) => string;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const hv = useTsHover();
  const n = categories.length;
  const cols = fitValues(columnSeries.values, n) ?? [];
  const lines = fitValues(lineSeries.values, n) ?? [];
  const p = plotOf(w, h, LEGEND_W);
  const left = niceTicks(Math.max(1, ...cols));
  const right = niceTicks(Math.max(1, ...lines));
  const b = bands(p, n);
  const barW = Math.min(TS_COLUMN_W * 4, b.width * 0.55);

  return (
    <div className="ts-chartwrap">
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <TsAxes plot={p} categories={categories} yMax={left.max} yTicks={left.ticks}
          right={{ max: right.max, ticks: right.ticks, title: rightTitle, format: rightFormat }} />
        {cols.map((v, i) => {
          const yTop = yOf(p, v, left.max);
          const dim = hv.activeSeries !== null && hv.activeSeries !== 0;
          return (
            <rect key={i} x={b.centre(i) - barW / 2} y={yTop} width={barW}
              height={Math.max(0, p.y + p.h - yTop)} fill={TS_SERIES_LINE[1]}
              opacity={dim ? 0.22 : 1}
              className={onSelect ? "ts-bar ts-bar--click" : "ts-bar"}
              onMouseEnter={() => {
                hv.setActiveSeries(0);
                hv.setHover({ xPct: (b.centre(i) / w) * 100, yPct: (yTop / h) * 100,
                  rows: [[columnSeries.name, tsNum(v)], [xTitle ?? "Category", categories[i]]] });
              }}
              onMouseLeave={hv.clear}
              onClick={onSelect ? () => onSelect(columnSeries.name, categories[i], v) : undefined} />
          );
        })}
        {(() => {
          const pts = lines.map((v, i) => [b.centre(i), yOf(p, v, right.max)] as [number, number]);
          const dim = hv.activeSeries !== null && hv.activeSeries !== 1;
          return (
            <g opacity={dim ? 0.22 : 1}>
              <path d={linePath(pts)} fill="none" stroke={TS_SERIES_LINE[0]} strokeWidth={TS_LINE_W}
                strokeLinejoin="round" strokeLinecap="round" />
              {pts.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={10} fill="transparent" className="ts-hit"
                  onMouseEnter={() => {
                    hv.setActiveSeries(1);
                    hv.setHover({ xPct: (cx / w) * 100, yPct: (cy / h) * 100,
                      rows: [[lineSeries.name, (rightFormat ?? tsNum)(lines[i])],
                             [xTitle ?? "Category", categories[i]]] });
                  }}
                  onMouseLeave={hv.clear}
                  onClick={onSelect ? () => onSelect(lineSeries.name, categories[i], lines[i]) : undefined} />
              ))}
            </g>
          );
        })()}
      </svg>
      <TsAxisTitles xTitle={xTitle} yTitle={yTitle} rightTitle={rightTitle} plot={p} w={w} h={h} />
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- pie and donut -------------------------------------------------------- */

export function TsPie({
  slices, w = TS_SIZE.pie.w, h = TS_SIZE.pie.h, donut = true, showLegend = true,
  dataLabels = true, onSelect,
}: {
  slices: TsSlice[]; w?: number; h?: number; donut?: boolean; showLegend?: boolean;
  dataLabels?: boolean;
  onSelect?: (label: string, value: number) => void;
}) {
  const hv = useTsHover();
  const clean = slices.filter((s) => isFinite(s.value) && s.value > 0);
  if (!clean.length) return <div className="ts-chartwrap" />;
  const legendW = showLegend ? LEGEND_W : 0;
  const cx = (w - legendW) / 2;
  const cy = h / 2;
  /* Measured 124.45 outer in a 563x402 box, and the hole is exactly half of it. */
  const rOut = Math.min((w - legendW) / 2, h / 2) * 0.62;
  const rIn = donut ? rOut * TS_DONUT_INNER : 0;
  const angles = sliceAngles(clean.map((s) => s.value));
  const total = clean.reduce((t, s) => t + s.value, 0);

  /* OUTSIDE DATA LABELS WITH LEADER LINES. The capture's pies carry 16 labels and 16
     connectors reading `Label - count (pct%)` at 12px #5b6577; the column and line
     charts carry NONE. Leaving them off made the donuts read as a different chart.

     Labels are laid out per SIDE and then pushed apart so they cannot overlap: a pie
     with nine slices puts several mid-angles within a few degrees of each other, and
     un-separated labels stack into an illegible smudge exactly where the small slices
     are. Sort by y, then walk down enforcing a minimum gap. */
  const LABEL_GAP = 16;
  const labels = dataLabels ? (() => {
    const raw = angles.map((a, i) => {
      const mid = (a.a0 + a.a1) / 2;
      return {
        i, right: Math.cos(mid) >= 0,
        x: cx + Math.cos(mid) * (rOut + 12),
        y: cy + Math.sin(mid) * (rOut + 12),
        ax: cx + Math.cos(mid) * rOut, ay: cy + Math.sin(mid) * rOut,
        text: `${clean[i].label} - ${tsNum(clean[i].value)} (${((clean[i].value / total) * 100).toFixed(2)}%)`,
      };
    });
    for (const side of [true, false]) {
      const col = raw.filter((r) => r.right === side).sort((p, q) => p.y - q.y);
      for (let k = 1; k < col.length; k++) {
        if (col[k].y - col[k - 1].y < LABEL_GAP) col[k].y = col[k - 1].y + LABEL_GAP;
      }
    }
    return raw;
  })() : [];

  return (
    <div className="ts-chartwrap">
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        {angles.map((a, i) => {
          const color = TS_SLICE_COLORS[i % TS_SLICE_COLORS.length];
          const dim = hv.activeSeries !== null && hv.activeSeries !== i;
          const on = hv.activeSeries === i;
          return (
            <g key={clean[i].label}>
              {/* a thin halo just outside the hovered slice, as the Insights rule asks */}
              {on ? (
                <path d={slicePath(cx, cy, rOut + 8, rOut + 2, a.a0, a.a1)} fill={color} opacity={0.28} />
              ) : null}
              <path d={slicePath(cx, cy, rOut, rIn, a.a0, a.a1)} fill={color}
                opacity={dim ? 0.16 : 1}
                className={onSelect ? "ts-slice ts-slice--click" : "ts-slice"}
                onMouseEnter={() => {
                  const mid = (a.a0 + a.a1) / 2;
                  hv.setActiveSeries(i);
                  hv.setHover({
                    xPct: ((cx + Math.cos(mid) * rOut * 0.8) / w) * 100,
                    yPct: ((cy + Math.sin(mid) * rOut * 0.8) / h) * 100,
                    rows: [[clean[i].label, tsNum(clean[i].value)],
                           ["Share", ((clean[i].value / total) * 100).toFixed(1) + "%"]],
                  });
                }}
                onMouseLeave={hv.clear}
                onClick={onSelect ? () => onSelect(clean[i].label, clean[i].value) : undefined} />
            </g>
          );
        })}
        {labels.map((l) => {
          const dim = hv.activeSeries !== null && hv.activeSeries !== l.i;
          const elbow = l.right ? l.x + 10 : l.x - 10;
          return (
            <g key={l.i} className="ts-series" opacity={dim ? 0.16 : 1}>
              <path d={`M ${l.ax} ${l.ay} L ${l.x} ${l.y} L ${elbow} ${l.y}`}
                fill="none" stroke={TS_SLICE_COLORS[l.i % TS_SLICE_COLORS.length]} strokeWidth={1} />
              <text className="ts-pie-label" x={l.right ? elbow + 4 : elbow - 4} y={l.y + 4}
                textAnchor={l.right ? "start" : "end"}>
                {l.text}
              </text>
            </g>
          );
        })}
      </svg>
      <TsTip hover={hv.hover} />
    </div>
  );
}

export const pieLegend = (slices: TsSlice[]) =>
  slices.filter((s) => s.value > 0).map((s, i) => ({
    label: s.label, color: TS_SLICE_COLORS[i % TS_SLICE_COLORS.length],
  }));
