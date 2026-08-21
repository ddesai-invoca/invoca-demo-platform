import { fitValues } from "../chartFit";
import { TS_SERIES_COLUMN, TS_SERIES_LINE, TS_PIE_ACTIVE_COLORS, areaFill } from "../../data/tsPalette";
import {
  TS_AREA_ALPHA, TS_BAR_THICK, TS_COLUMN_GAP, TS_COLUMN_W, TS_LINE_W, TS_SIZE,
  areaPath, bands, calendarTicks, leftInsetFor, linePath, niceScale, niceTicks, plotOf,
  rightAxisLayout, TS_RIGHT_LABEL_GAP, TS_TITLE_BAND_PX, nearestIndex, TS_TRACKER_W,
  piePlot, pieOrder, fitPieLabel, TS_PIE_GAP_DEG,
  slicePath, TS_AXIS_LINE, TS_PLOT, tsNum, yOf,
} from "./tsChart";
import { TsAxes, TsAxisTitles, TsTip, TsPointMarker, useTsHover, useTsBox } from "./TsShell";

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
  categories, series, w: wIn = TS_SIZE.line.w, h: hIn = TS_SIZE.line.h, xTitle, yTitle,
  area = false, showLegend = true, dashTail = false, tickFormat, onSelect,
}: {
  categories: string[]; series: TsSeries[]; w?: number; h?: number;
  xTitle?: string; yTitle?: string; area?: boolean; showLegend?: boolean;
  /** Dot the final segment, as the real chart does for an incomplete period. */
  dashTail?: boolean;
  /** Value-axis tick formatter, so money keeps its $ and a duration reads m:ss. */
  tickFormat?: (v: number) => string;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
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
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <TsAxes plot={p} categories={categories} yMax={yMax} yMin={yMin} yTicks={ticks}
          tickAt={tickAt} tickFormat={tickFormat} />
        {fitted.map((s, si) => {
          const color = TS_SERIES_LINE[si % TS_SERIES_LINE.length];
          const pts = s.values.map((v, i) => [b.centre(i), yOf(p, v, yMax, yMin)] as [number, number]);
          const dim = hv.activeSeries !== null && hv.activeSeries !== si;
          /* Highcharts' `lineWidthPlus` default, which is what ThoughtSpot renders. */
          const lw = hv.activeSeries === si ? TS_LINE_W + 1 : TS_LINE_W;
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
                strokeWidth={lw} strokeLinejoin="round" strokeLinecap="round" />
              {dashTail && pts.length > 1 ? (
                <path d={linePath(pts.slice(-2))} fill="none" stroke={color}
                  strokeWidth={lw} strokeDasharray="2,2" strokeLinecap="round" />
              ) : null}
              {hv.activeSeries === si && hv.activePoint !== null && pts[hv.activePoint] ? (
                <TsPointMarker x={pts[hv.activePoint][0]} y={pts[hv.activePoint][1]} color={color} />
              ) : null}
              {/* ⚠️ ONE TRACKER FOR THE WHOLE LINE, not a hit circle per point. Point-only
                  targets meant hovering the line BETWEEN two points did nothing; this
                  snaps to the nearest point wherever the line is hovered. */}
              <path className={onSelect ? "ts-track ts-track--click" : "ts-track"}
                d={linePath(pts)} fill="none" stroke="transparent" strokeWidth={TS_TRACKER_W}
                strokeLinejoin="round" strokeLinecap="round"
                onMouseMove={(e) => {
                  /* The SVG's own rect is the reference, not the path's bbox — the path's
                     box starts at its leftmost point, not at the svg origin. At 1:1 one
                     user unit is one CSS px, so this needs no viewBox conversion. */
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const i = nearestIndex(pts, e.clientX - svg.getBoundingClientRect().left);
                  hv.setActiveSeries(si);
                  hv.setActivePoint(i);
                  hv.setHover({
                    xPct: (pts[i][0] / w) * 100, yPct: (pts[i][1] / h) * 100,
                    rows: [[s.name, (tickFormat ?? tsNum)(s.values[i])],
                           [xTitle ?? "Category", categories[i]]],
                  });
                }}
                onMouseLeave={hv.clear}
                onClick={onSelect ? () => {
                  const i = hv.activePoint ?? 0;
                  onSelect(s.name, categories[i], s.values[i]);
                } : undefined} />
            </g>
          );
        })}
      </svg>
      <TsAxisTitles xTitle={xTitle} yTitle={yTitle} plot={p} w={w} h={h} />
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- multi-line: one Y AXIS PER SERIES ------------------------------------- */

export interface TsAxisSeries extends TsSeries {
  /** How this series' own axis ticks print — `$4.7M`, `88%`, `2:43`. */
  tickFormat?: (v: number) => string;
  /** This series' own axis title, already carrying "Total" or not. */
  title?: string;
}

/**
 * The Multi-Line template. Same principles as the single line — filtered window, zoomed
 * floor, dotted partial tail, no gridlines — with three differences measured off the
 * capture:
 *
 *   1. EVERY SERIES HAS ITS OWN Y AXIS AND ITS OWN SCALE. Series 0 takes the left axis;
 *      series 1..n take right-hand axes stacked outward, each with its own line, its own
 *      labels (anchored start, 15px out) and its own rotated title. A shared scale would
 *      flatten a percent series against a revenue one into a straight line at the floor.
 *   2. The plot NARROWS as series are added — 626 / 561 / 487 measured for 2 / 3 / 4
 *      series — because the axis columns eat the width.
 *   3. The legend is TOP-right, one 12px round swatch per series.
 */
export function TsMultiLine({
  categories, series, w: wIn = 748, h: hIn = 704, xTitle, dashTail = false, onSelect,
}: {
  categories: string[]; series: TsAxisSeries[]; w?: number; h?: number;
  xTitle?: string; dashTail?: boolean;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
  const hv = useTsHover();
  const n = categories.length;
  const fitted = series
    .map((s) => ({ ...s, values: fitValues(s.values, n) }))
    .filter((s): s is TsAxisSeries & { values: number[] } => s.values !== null);
  if (!fitted.length) return <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style} />;

  /* One scale per series, each zoomed to its own floor so every line uses the full
     height of the plot rather than being squashed by a neighbour's magnitude. */
  const scales = fitted.map((s) => niceScale(Math.min(...s.values), Math.max(...s.values), false));
  const leftInset = leftInsetFor(scales[0].ticks);
  const fmtOf = (i: number) => fitted[i].tickFormat ?? tsNum;

  /* The right-hand axes are laid out from the labels they will actually print — a fixed
     reservation put a `$4.7M` axis's title on top of its own labels and across the next
     axis line. Drawing 1:1 means the title band is simply its measured 18px; it used to
     need a `/ scale` conversion, and getting that wrong was the original defect. */
  const ra = rightAxisLayout(
    fitted.slice(1).map((_, k) => scales[k + 1].ticks.map((t) => fmtOf(k + 1)(t))),
    TS_TITLE_BAND_PX,
  );
  const p: typeof TS_PLOT & { x: number; y: number; w: number; h: number } = {
    ...TS_PLOT,
    x: leftInset, y: TS_PLOT.top,
    w: Math.max(1, w - leftInset - ra.inset),
    h: Math.max(1, h - TS_PLOT.top - TS_PLOT.bottom),
  };
  const b = bands(p, n);
  const plotRight = p.x + p.w;
  const tickAt = n > 12 && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(categories[0] ?? "")
    ? calendarTicks(categories) : undefined;

  return (
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        {/* the category axis and the LEFT value axis */}
        <TsAxes plot={p} categories={categories} yMin={scales[0].min} yMax={scales[0].max}
          yTicks={scales[0].ticks} tickAt={tickAt} tickFormat={fmtOf(0)} />

        {/* one axis line + labels per right-hand series */}
        {fitted.slice(1).map((s, k) => {
          const sc = scales[k + 1];
          const x = plotRight + ra.lineAt[k];
          return (
            <g key={"axis" + s.name} aria-hidden="true">
              <path className="ts-axis-line" d={`M ${x} ${p.y} L ${x} ${p.y + p.h}`} stroke={TS_AXIS_LINE} />
              {sc.ticks.map((t) => {
                const span = sc.max - sc.min;
                const y = p.y + p.h - (span > 0 ? ((t - sc.min) / span) * p.h : p.h / 2);
                return (
                  <text key={t} className="ts-axis-label" x={x + TS_RIGHT_LABEL_GAP} y={y + 4}
                    textAnchor="start">
                    {fmtOf(k + 1)(t)}
                  </text>
                );
              })}
            </g>
          );
        })}

        {/* the lines themselves, each on its own scale */}
        {fitted.map((s, si) => {
          const colour = TS_SERIES_LINE[si % TS_SERIES_LINE.length];
          const sc = scales[si];
          const pts = s.values.map((v, i) => {
            const span = sc.max - sc.min;
            const y = span > 0 ? yOf(p, v, sc.max, sc.min) : p.y + p.h / 2;
            return [b.centre(i), y] as [number, number];
          });
          const dim = hv.activeSeries !== null && hv.activeSeries !== si;
          /* The hovered series thickens by 1px — Highcharts' `lineWidthPlus` default, which
             is what ThoughtSpot renders, and what the reference screenshots show. */
          const lw = hv.activeSeries === si ? TS_LINE_W + 1 : TS_LINE_W;
          return (
            <g key={s.name} className="ts-series" opacity={dim ? 0.22 : 1}>
              <path d={linePath(dashTail ? pts.slice(0, -1) : pts)} fill="none" stroke={colour}
                strokeWidth={lw} strokeLinejoin="round" strokeLinecap="round" />
              {dashTail && pts.length > 1 ? (
                <path d={linePath(pts.slice(-2))} fill="none" stroke={colour}
                  strokeWidth={lw} strokeDasharray="2,2" strokeLinecap="round" />
              ) : null}
              {hv.activeSeries === si && hv.activePoint !== null && pts[hv.activePoint] ? (
                <TsPointMarker x={pts[hv.activePoint][0]} y={pts[hv.activePoint][1]} color={colour} />
              ) : null}
              {/* One tracker for the whole line — see the note in TsLine. */}
              <path className={onSelect ? "ts-track ts-track--click" : "ts-track"}
                d={linePath(pts)} fill="none" stroke="transparent" strokeWidth={TS_TRACKER_W}
                strokeLinejoin="round" strokeLinecap="round"
                onMouseMove={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const i = nearestIndex(pts, e.clientX - svg.getBoundingClientRect().left);
                  hv.setActiveSeries(si);
                  hv.setActivePoint(i);
                  hv.setHover({
                    xPct: (pts[i][0] / w) * 100, yPct: (pts[i][1] / h) * 100,
                    rows: [[s.name, fmtOf(si)(s.values[i])],
                           [xTitle ?? "Category", categories[i]]],
                  });
                }}
                onMouseLeave={hv.clear}
                onClick={onSelect ? () => {
                  const i = hv.activePoint ?? 0;
                  onSelect(s.name, categories[i], s.values[i]);
                } : undefined} />
            </g>
          );
        })}
      </svg>

      {/* Titles are HTML, like every other chart here. Each right axis gets its own,
          sitting at the right edge of its column. */}
      <TsAxisTitles xTitle={xTitle} yTitle={fitted[0].title} plot={p} w={w} h={h} />
      {fitted.slice(1).map((s, k) => (
        <span key={"t" + s.name} className="ts-axis-ytitle ts-axis-ytitle--extra"
          style={{
            left: `${((plotRight + ra.titleAt[k]) / w) * 100}%`,
            top: `${((p.y + p.h / 2) / h) * 100}%`,
          }}>
          {s.title ?? s.name}
        </span>
      ))}
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* ---- grouped and stacked column ------------------------------------------- */

export function TsColumn({
  categories, series, w: wIn = TS_SIZE.column.w, h: hIn = TS_SIZE.column.h, xTitle, yTitle,
  stacked = false, showLegend = true, onSelect,
}: {
  categories: string[]; series: TsSeries[]; w?: number; h?: number;
  xTitle?: string; yTitle?: string; stacked?: boolean; showLegend?: boolean;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
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
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
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
  categories, values, w: wIn = TS_SIZE.bar.w, h: hIn = TS_SIZE.bar.h, xTitle, seriesName = "Value", onSelect,
}: {
  categories: string[]; values: number[]; w?: number; h?: number;
  xTitle?: string; seriesName?: string;
  onSelect?: (category: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
  const hv = useTsHover();
  const n = categories.length;
  const vals = fitValues(values, n) ?? [];
  if (!vals.length) return <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style} />;
  const p = plotOf(w, h, 0);
  const { max: xMax, ticks } = niceTicks(Math.max(1, ...vals));
  const band = p.h / Math.max(1, n);
  const thick = Math.min(TS_BAR_THICK, band * 0.8);

  return (
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
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
  categories, columnSeries, lineSeries, w: wIn = TS_SIZE.line.w, h: hIn = TS_SIZE.line.h,
  xTitle, yTitle, rightTitle, rightFormat, onSelect,
}: {
  categories: string[]; columnSeries: TsSeries; lineSeries: TsSeries;
  w?: number; h?: number; xTitle?: string; yTitle?: string; rightTitle?: string;
  rightFormat?: (v: number) => string;
  onSelect?: (seriesName: string, category: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
  const hv = useTsHover();
  const n = categories.length;
  const cols = fitValues(columnSeries.values, n) ?? [];
  const lines = fitValues(lineSeries.values, n) ?? [];
  const p = plotOf(w, h, LEGEND_W);
  const left = niceTicks(Math.max(1, ...cols));
  const right = niceTicks(Math.max(1, ...lines));
  const b = bands(p, n);
  /* ⚠️ THE SAME MEASURED FIT RULE AS TsColumn — this used to be
     `min(TS_COLUMN_W * 4, b.width * 0.55)`, an 88px cap and a 55%-of-band heuristic that
     predated the measured 22/5 rule and was never brought in line. It rendered an 88px
     column beside the grouped chart's 22px one, in the same layer, off the same capture.
     (It was 82px on screen before the charts were drawn 1:1, so this is a pre-existing
     defect that 1:1 exposed rather than caused.) One series, so the group IS one bar. */
  const barW = TS_COLUMN_W * Math.min(1, Math.max(0.1, b.width - 8) / TS_COLUMN_W);

  return (
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
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
              <path d={linePath(pts)} fill="none" stroke={TS_SERIES_LINE[0]}
                strokeWidth={hv.activeSeries === 1 ? TS_LINE_W + 1 : TS_LINE_W}
                strokeLinejoin="round" strokeLinecap="round" />
              {hv.activeSeries === 1 && hv.activePoint !== null && pts[hv.activePoint] ? (
                <TsPointMarker x={pts[hv.activePoint][0]} y={pts[hv.activePoint][1]}
                  color={TS_SERIES_LINE[0]} />
              ) : null}
              {/* One tracker for the whole line — see the note in TsLine. */}
              <path className={onSelect ? "ts-track ts-track--click" : "ts-track"}
                d={linePath(pts)} fill="none" stroke="transparent" strokeWidth={TS_TRACKER_W}
                strokeLinejoin="round" strokeLinecap="round"
                onMouseMove={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const i = nearestIndex(pts, e.clientX - svg.getBoundingClientRect().left);
                  hv.setActiveSeries(1);
                  hv.setActivePoint(i);
                  hv.setHover({ xPct: (pts[i][0] / w) * 100, yPct: (pts[i][1] / h) * 100,
                    rows: [[lineSeries.name, (rightFormat ?? tsNum)(lines[i])],
                           [xTitle ?? "Category", categories[i]]] });
                }}
                onMouseLeave={hv.clear}
                onClick={onSelect ? () => {
                  const i = hv.activePoint ?? 0;
                  onSelect(lineSeries.name, categories[i], lines[i]);
                } : undefined} />
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

/* ---- the pie / donut template -------------------------------------------------
   Re-measured 2026-08-20 off a 33-slice capture, and the first build was wrong in six
   ways. Canvas 847x635 drawn 1:1; centre (420.458, 300); outer radius 206, hole exactly
   half of it. See tsChart.ts for the geometry, ordering and label rules. */
export function TsPie({
  slices, w: wIn = TS_SIZE.pie.w, h: hIn = TS_SIZE.pie.h, donut = true, showLegend = false,
  dataLabels = true, onSelect,
}: {
  slices: TsSlice[]; w?: number; h?: number; donut?: boolean;
  /** ⚠️ Defaults to FALSE: the measured tile has NO legend — the labels replace it. */
  showLegend?: boolean;
  dataLabels?: boolean;
  onSelect?: (label: string, value: number) => void;
}) {
  const box = useTsBox(wIn, hIn);
  const { w, h } = box;
  const hv = useTsHover();
  const positive = slices.filter((s) => isFinite(s.value) && s.value > 0);
  if (!positive.length) return <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style} />;
  /* ⚠️ ALPHABETICAL, `{Null}` FIRST — measured, not the incoming order. */
  const clean = pieOrder(positive);
  const legendW = showLegend ? LEGEND_W : 0;
  const p = piePlot(w - legendW, h);
  const rOut = p.r;
  const rIn = donut ? p.rIn : 0;
  const total = clean.reduce((t, s) => t + s.value, 0);

  /* Angles from 12 o'clock, clockwise, with the measured gap taken off each slice's END
     so the sequence still closes at 360. */
  const GAP = (TS_PIE_GAP_DEG * Math.PI) / 180;
  const arcs = (() => {
    let acc = -Math.PI / 2;                      // -90deg = 12 o'clock in svg terms
    return clean.map((s) => {
      const span = (s.value / total) * Math.PI * 2;
      const a0 = acc;
      acc += span;
      return { a0, a1: Math.max(a0 + GAP * 0.5, acc - GAP) };
    });
  })();

  const LABEL_GAP = 16;
  const labels = dataLabels ? (() => {
    const raw = arcs.map((a, i) => {
      const mid = (a.a0 + a.a1) / 2;
      return {
        i, right: Math.cos(mid) >= 0,
        x: p.cx + Math.cos(mid) * (rOut + 12),
        y: p.cy + Math.sin(mid) * (rOut + 12),
        ax: p.cx + Math.cos(mid) * rOut, ay: p.cy + Math.sin(mid) * rOut,
        text: "",   // filled below, once the side and x are known
      };
    });
    /* The text is fitted to the room between each label and the canvas edge, which depends
       on the side and the x it ended up at — so it is computed here, not above. */
    for (const r of raw) {
      const anchorX = r.right ? r.x + 14 : r.x - 14;
      r.text = fitPieLabel(clean[r.i].label, clean[r.i].value, total, anchorX, w, r.right);
    }
    /* Labels are pushed apart per side: with 33 slices several mid-angles land within a
       degree of each other and un-separated labels stack into an illegible smudge. */
    for (const side of [true, false]) {
      const col = raw.filter((r) => r.right === side).sort((q, r) => q.y - r.y);
      for (let k = 1; k < col.length; k++) {
        if (col[k].y - col[k - 1].y < LABEL_GAP) col[k].y = col[k - 1].y + LABEL_GAP;
      }
    }
    return raw;
  })() : [];

  return (
    <div className="ts-chartwrap ts-chartwrap--fill" ref={box.ref} style={box.style}>
      <svg className="ts-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        {arcs.map((a, i) => {
          const color = TS_PIE_ACTIVE_COLORS[i % TS_PIE_ACTIVE_COLORS.length];
          const dim = hv.activeSeries !== null && hv.activeSeries !== i;
          const on = hv.activeSeries === i;
          return (
            <g key={clean[i].label + i}>
              {on ? (
                <path d={slicePath(p.cx, p.cy, rOut + 8, rOut + 2, a.a0, a.a1)} fill={color} opacity={0.28} />
              ) : null}
              {/* ⚠️ NO STROKE. The visible separation is the 0.057deg gap above; the
                  captured slices carry no stroke attribute and no CSS stroke rule. */}
              <path d={slicePath(p.cx, p.cy, rOut, rIn, a.a0, a.a1)} fill={color}
                opacity={dim ? 0.16 : 1}
                className={onSelect ? "ts-slice ts-slice--click" : "ts-slice"}
                onMouseEnter={() => {
                  const mid = (a.a0 + a.a1) / 2;
                  hv.setActiveSeries(i);
                  hv.setHover({
                    xPct: ((p.cx + Math.cos(mid) * rOut * 0.8) / w) * 100,
                    yPct: ((p.cy + Math.sin(mid) * rOut * 0.8) / h) * 100,
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
          /* ⚠️ THE CONNECTOR IS ITS SLICE'S COLOUR at 2px, and it CURVES — measured on
             6/6 slices, and the captured path is a cubic, not an elbow. A 1px grey line
             was the earlier guess. */
          const colour = TS_PIE_ACTIVE_COLORS[l.i % TS_PIE_ACTIVE_COLORS.length];
          const cxc = l.right ? l.x - 5 : l.x + 5;
          return (
            <g key={l.i} className="ts-series" opacity={dim ? 0.16 : 1}>
              <path d={`M ${l.ax} ${l.ay} Q ${cxc} ${l.y} ${l.x} ${l.y} L ${elbow} ${l.y}`}
                fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" />
              {/* ⚠️ THE FULL TEXT LIVES IN A <title>. Our tile is one column wide (the same
                  as the line charts, asked for explicitly) where the measured 847px canvas
                  is not, so names elide hard — "Buil… - 3,794". The real chart does the
                  same thing at its own width and keeps the untruncated string reachable;
                  that is the doubled label text visible in the capture's DOM. Without this
                  a viewer has no way to read a name the layout had to cut. */}
              <text className="ts-pie-label" x={l.right ? elbow + 4 : elbow - 4} y={l.y + 4}
                textAnchor={l.right ? "start" : "end"}>
                <title>{`${clean[l.i].label} - ${tsNum(clean[l.i].value)} (${+((clean[l.i].value / total) * 100).toFixed(2)}%)`}</title>
                {l.text}
              </text>
            </g>
          );
        })}
        {/* Measured verbatim at x=13, y=615, 12px #5b6577 — the real tile states its
            slice count under the chart. */}
        <text className="ts-pie-footer" x={13} y={h - 20}>
          {`Showing ${clean.length} of ${clean.length} data points`}
        </text>
      </svg>
      <TsTip hover={hv.hover} />
    </div>
  );
}

/* Ordered and coloured exactly as TsPie draws them, or a legend swatch would name the
   wrong slice. */
export const pieLegend = (slices: TsSlice[]) =>
  pieOrder(slices.filter((s) => s.value > 0)).map((s, i) => ({
    label: s.label, color: TS_PIE_ACTIVE_COLORS[i % TS_PIE_ACTIVE_COLORS.length],
  }));
