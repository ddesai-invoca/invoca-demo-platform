import type { QmBarLine } from "../data/schema";

/* Flexible bar/line chart for the Quality Management dashboards:
   - bars only + red dashed average line  ("Baseline Sales Quality Score")
   - bars (blue) + overlaid orange line    ("Trending … to Conversion/Revenue")
   - line (blue, primary) + secondary bars  ("Trending Essential Metrics", linePrimary)
   - line only, zoomed with a non-zero yMin ("Trending Answer Rate")
   Custom y tick labels (tickLabels) support time axes like "1:20". */
const BLUE = "#2666f9";
const ORANGE = "#ff7045";
const AVG = "#e4131b";

export function BarLineChart({ chart, height = 300 }: { chart: QmBarLine; height?: number }) {
  const W = 900, H = height, padL = 60, padT = 44, padB = 40;
  const hasRight = chart.rightMax != null;   // dual-axis: line plotted on a right scale
  const padR = hasRight ? 66 : 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = chart.points.length;
  const { yMax, yTicks, suffix, tickLabels } = chart;
  const yMin = chart.yMin ?? 0;

  const slot = plotW / Math.max(1, n);
  const barW = Math.min(22, slot * 0.6);
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const baseY = padT + plotH; // y for yMin (bar/axis floor)

  const linePrimary = !!chart.linePrimary;
  const barColor = linePrimary ? ORANGE : BLUE;
  const lineColor = linePrimary ? BLUE : ORANGE;

  // The optional right axis belongs to the SECONDARY series: the bars when the
  // line is primary (line=left), otherwise the line (bars=left).
  const rMin = chart.rightMin ?? 0;
  const rMax = chart.rightMax ?? 1;
  const rightY = (v: number) => padT + plotH - ((v - rMin) / (rMax - rMin)) * plotH;
  const barsOnRight = hasRight && linePrimary;
  const lineOnRight = hasRight && !linePrimary;
  const yBarTop = (v: number) => (barsOnRight ? rightY(v) : y(v));
  const yLine = (v: number) => (lineOnRight ? rightY(v) : y(v));

  const hasBar = chart.points.some((p) => p.bar != null);
  const hasLine = chart.points.some((p) => p.line != null);
  // Show ~9 evenly-spaced x labels, horizontal, so dates stay readable even on a short chart.
  const labelEvery = Math.max(1, Math.round(n / 9));
  const linePts = chart.points
    .map((p, i) => (p.line != null ? `${cx(i)},${yLine(p.line)}` : null))
    .filter(Boolean)
    .join(" ");

  /* Legend entries in draw order (primary first). */
  const legend: { color: string; label: string; line: boolean }[] = [];
  if (linePrimary) {
    if (hasLine && chart.lineLabel) legend.push({ color: lineColor, label: chart.lineLabel, line: true });
    if (hasBar && chart.barLabel) legend.push({ color: barColor, label: chart.barLabel, line: false });
  } else {
    if (hasBar && chart.barLabel) legend.push({ color: barColor, label: chart.barLabel, line: false });
    if (hasLine && chart.lineLabel) legend.push({ color: lineColor, label: chart.lineLabel, line: true });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" width="100%">
      {/* legend */}
      {legend.map((l, i) => {
        const lx = padL + i * 320 + 10;
        return (
          <g key={i}>
            {l.line ? (
              <>
                <line x1={lx - 4} y1={20} x2={lx + 20} y2={20} stroke={l.color} strokeWidth={2.5} />
                <circle cx={lx + 8} cy={20} r={3.5} fill={l.color} />
              </>
            ) : (
              <rect x={lx} y={15} width={12} height={10} fill={l.color} rx={1} />
            )}
            <text x={lx + 28} y={24} className="chart-legend-text">{l.label}</text>
          </g>
        );
      })}

      {/* y grid + ticks */}
      {yTicks.map((val, t) => {
        const yy = y(val);
        return (
          <g key={t}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#e7e9eb" strokeWidth={1} />
            <text x={padL - 10} y={yy + 4} textAnchor="end" className="chart-axis">{tickLabels ? tickLabels[t] : `${val}${suffix}`}</text>
          </g>
        );
      })}

      {/* right axis (the secondary series' scale) + title */}
      {hasRight && chart.rightTicks?.map((val, t) => (
        <text key={"r" + t} x={W - padR + 10} y={rightY(val) + 4} textAnchor="start" className="chart-axis">{chart.rightPrefix ?? ""}{val.toLocaleString()}{chart.rightSuffix ?? ""}</text>
      ))}
      {hasRight && chart.rightLabel && (
        <text className="chart-axis-title" transform={`translate(${W - 8} ${padT + plotH / 2}) rotate(-90)`} textAnchor="middle">{chart.rightLabel}</text>
      )}

      {/* bars */}
      {chart.points.map((p, i) =>
        p.bar != null ? (
          <rect key={i} x={cx(i) - barW / 2} y={yBarTop(p.bar)} width={barW} height={Math.max(0, baseY - yBarTop(p.bar))} fill={barColor} rx={1} />
        ) : null
      )}

      {/* average line (dashed red) + value badge at the right end */}
      {chart.average != null && (
        <g>
          <line x1={padL} y1={y(chart.average)} x2={W - padR} y2={y(chart.average)} stroke={AVG} strokeWidth={2} strokeDasharray="6 4" />
          <rect x={W - padR - 34} y={y(chart.average) - 9} width={32} height={16} rx={2} fill={AVG} />
          <text x={W - padR - 18} y={y(chart.average) + 3} textAnchor="middle" className="chart-avg-label">{chart.average}{suffix}</text>
        </g>
      )}

      {/* data line + markers */}
      {hasLine && (
        <>
          <polyline points={linePts} fill="none" stroke={lineColor} strokeWidth={1.25} />
          {chart.points.map((p, i) => (p.line != null ? <circle key={i} cx={cx(i)} cy={yLine(p.line)} r={3} fill={lineColor} /> : null))}
        </>
      )}

      {/* x labels (sparse, horizontal) */}
      {chart.points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={cx(i)} y={H - 12} textAnchor="middle" className="chart-axis">{p.label}</text>
        ) : null
      )}
    </svg>
  );
}
