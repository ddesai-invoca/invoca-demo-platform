import { useState, type ReactNode } from "react";
import { TS_AXIS_LINE, niceTicks, plotOf, tsTick, type Plot } from "./tsChart";

/* =============================================================================
   TsShell — the pieces every ThoughtSpot tile shares: the tile frame, the HTML
   legend, the hover panel, and the cartesian axes.
   -----------------------------------------------------------------------------
   Kept apart from the charts themselves because all seven chart types draw the
   same axes and legend, and a second copy of the axis code is how two charts on
   one dashboard end up disagreeing about their left inset.
   ============================================================================= */

/* ---- the tile ------------------------------------------------------------- */

export interface TsTileProps {
  title: string;
  description?: string;
  /** Right-hand legend entries; renders ThoughtSpot's HTML legend when present. */
  legend?: Array<{ label: string; color: string }>;
  /** Controls pinned to the title row (the AI sparkle, a remove button). Optional so
      a plain tile stays exactly as it was before this existed. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Passed through for the AI layer's tile identity; see GeneratedTiles. */
  dataGenId?: string;
}

/** White, 8px radius, 1px #e7e9eb AND a faint shadow: ThoughtSpot sets both. */
export function TsTile({
  title, description, legend, actions, children, className, dataGenId,
}: TsTileProps) {
  return (
    <section className={"ts-tile" + (className ? " " + className : "")} data-genid={dataGenId}>
      <div className="ts-tile-head">
        <h2 className="ts-tile-title">{title}</h2>
        {actions ? <span className="ts-tile-actions">{actions}</span> : null}
      </div>
      {description ? <p className="ts-tile-desc">{description}</p> : null}
      <div className="ts-tile-body">
        <div className="ts-tile-viz">{children}</div>
        {legend && legend.length > 0 ? <TsLegend items={legend} /> : null}
      </div>
    </section>
  );
}

/* ---- the legend ----------------------------------------------------------- */

/** HTML, not SVG: 212px wide, 24px rows, 12px CIRCULAR swatches, 12px #777e8b. */
export function TsLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="ts-legend">
      {items.map((it) => (
        <li className="ts-legend-item" key={it.label}>
          <span className="ts-legend-dot" style={{ background: it.color }} />
          <span className="ts-legend-label" title={it.label}>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---- the hover panel ------------------------------------------------------ */

export interface TsHover { xPct: number; yPct: number; rows: Array<[string, string]> }

/** Positioned in PERCENTAGES of the chart box, so it tracks a scaling svg.
    Flips to the left past the midpoint so it cannot fall outside the tile. */
export function TsTip({ hover }: { hover: TsHover | null }) {
  if (!hover) return null;
  const flip = hover.xPct > 55;
  return (
    <div
      className={"ts-tip" + (flip ? " ts-tip--flip" : "")}
      style={{ left: `${hover.xPct}%`, top: `${hover.yPct}%` }}
    >
      {hover.rows.map(([k, v]) => (
        <div className="ts-tip-row" key={k}>
          <span className="ts-tip-k">{k}</span>
          <span className="ts-tip-v">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Shared hover state, so every chart fades and reports the same way. */
export function useTsHover() {
  const [hover, setHover] = useState<TsHover | null>(null);
  const [activeSeries, setActiveSeries] = useState<number | null>(null);
  const clear = () => { setHover(null); setActiveSeries(null); };
  return { hover, setHover, activeSeries, setActiveSeries, clear };
}

/* ---- the axes ------------------------------------------------------------- */

export interface TsAxesProps {
  plot: Plot;
  /** Category labels along the value-independent axis. */
  categories: string[];
  yMax: number;
  /** Axis floor. Defaults to 0, so every zero-based caller is untouched. */
  yMin?: number;
  yTicks: number[];
  /** Horizontal charts put categories on the y axis and values along the x. */
  horizontal?: boolean;
  /** A second value axis on the right, for the dual-axis template. */
  right?: { max: number; ticks: number[]; title?: string; format?: (v: number) => string };
  /** Explicit tick indices for the category axis; used for calendar-aligned dates. */
  tickAt?: number[];
  /** How a value-axis tick prints. Defaults to the plain compact form, so a tile that
      does not know its measure's kind behaves exactly as before. */
  tickFormat?: (v: number) => string;
}

/**
 * Axis lines and labels. NO GRIDLINES, deliberately: every grid path in the
 * capture is `stroke: none`. If a chart here ever grows gridlines, it stopped
 * matching the product.
 */
export function TsAxes({
  plot: p, categories, yMax, yMin = 0, yTicks, horizontal, right, tickAt,
  tickFormat = tsTick,
}: TsAxesProps) {
  const yPos = (t: number) => {
    const span = yMax - yMin;
    return p.y + p.h - (span > 0 ? ((t - yMin) / span) * p.h : 0);
  };
  const everyNth = (n: number, total: number) => {
    /* Category labels crowd on a narrow tile; thin them rather than rotating,
       because the real charts do not rotate. */
    const max = horizontal ? 24 : Math.max(2, Math.floor(p.w / 82));
    return total <= max ? 1 : Math.ceil(total / max) === n ? 1 : Math.ceil(total / max);
  };
  const stride = everyNth(1, categories.length);
  const explicit = tickAt ? new Set(tickAt) : null;

  return (
    <g className="ts-axes" aria-hidden="true">
      {/* value axis */}
      {!horizontal && yTicks.map((t) => {
        const y = yPos(t);
        return (
          <text key={t} className="ts-axis-label" x={p.x - 10} y={y + 4} textAnchor="end">
            {tickFormat(t)}
          </text>
        );
      })}
      {horizontal && yTicks.map((t) => {
        const x = p.x + (yMax > 0 ? (t / yMax) * p.w : 0);
        return (
          <text key={t} className="ts-axis-label" x={x} y={p.y + p.h + 20} textAnchor="middle">
            {tickFormat(t)}
          </text>
        );
      })}

      {/* the right-hand value axis of a dual-axis chart */}
      {right && right.ticks.map((t) => {
        const y = p.y + p.h - (right.max > 0 ? (t / right.max) * p.h : 0);
        return (
          <text key={"r" + t} className="ts-axis-label" x={p.x + p.w + 10} y={y + 4} textAnchor="start">
            {(right.format ?? tsTick)(t)}
          </text>
        );
      })}

      {/* category axis */}
      {categories.map((c, i) => {
        if (explicit ? !explicit.has(i) : i % stride !== 0) return null;
        if (horizontal) {
          const band = p.h / Math.max(1, categories.length);
          return (
            <text key={c + i} className="ts-axis-label" x={p.x - 10}
              y={p.y + band * (i + 0.5) + 4} textAnchor="end">
              {c.length > 22 ? c.slice(0, 21) + "…" : c}
            </text>
          );
        }
        const band = p.w / Math.max(1, categories.length);
        return (
          <text key={c + i} className="ts-axis-label" x={p.x + band * (i + 0.5)}
            y={p.y + p.h + 20} textAnchor="middle">
            {c}
          </text>
        );
      })}

      {/* axis lines: #e0e0e0, ThoughtSpot's own default */}
      <path className="ts-axis-line" d={`M ${p.x} ${p.y} L ${p.x} ${p.y + p.h}`} stroke={TS_AXIS_LINE} />
      <path className="ts-axis-line" d={`M ${p.x} ${p.y + p.h} L ${p.x + p.w} ${p.y + p.h}`} stroke={TS_AXIS_LINE} />

      {/* ⚠️ NO AXIS TITLES IN HERE. They are HTML — see TsAxisTitles. Measured: no
          `.highcharts-axis-title` exists in any captured chart's svg, and the real
          titles are `axis-label-title` divs at 12px/600. In the svg they would scale
          with the viewBox, which is the same reason the legend is HTML. */}
    </g>
  );
}

/**
 * Axis titles, as HTML overlaying the chart box.
 *
 * Positioned in PERCENTAGES of the wrapper for the same reason the hover panel is: the
 * svg scales with its column, so a px offset drifts the moment the tile is not exactly
 * its measured width. Measured on the real tile (846x633): the y title sits at x=9 and
 * the x title's centre lands on the plot centre.
 */
export function TsAxisTitles({
  xTitle, yTitle, rightTitle, plot, w, h,
}: { xTitle?: string; yTitle?: string; rightTitle?: string; plot: Plot; w: number; h: number }) {
  if (!xTitle && !yTitle && !rightTitle) return null;
  const centrePct = ((plot.x + plot.w / 2) / w) * 100;
  const midPct = ((plot.y + plot.h / 2) / h) * 100;
  return (
    <>
      {yTitle ? (
        <span className="ts-axis-ytitle" style={{ top: `${midPct}%` }}>{yTitle}</span>
      ) : null}
      {xTitle ? (
        <span className="ts-axis-xtitle" style={{ left: `${centrePct}%` }}>{xTitle}</span>
      ) : null}
      {rightTitle ? (
        <span className="ts-axis-ytitle ts-axis-ytitle--right" style={{ top: `${midPct}%` }}>
          {rightTitle}
        </span>
      ) : null}
    </>
  );
}

/** Shared setup every cartesian chart repeats: plot rect plus nice y ticks. */
export function useCartesian(w: number, h: number, legendW: number, max: number) {
  const plot = plotOf(w, h, legendW);
  const { max: yMax, ticks } = niceTicks(max);
  return { plot, yMax, ticks };
}
