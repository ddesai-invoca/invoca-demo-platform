import type { MultiSeriesChart } from "../data/schema";

const SERIES_COLORS = ["#2666f9", "#ff7045", "#f3cb00", "#00d1b4", "#a182e5"];

function niceMax(v: number): number {
  const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
  return Math.ceil(v / step) * step;
}

export function StackedBarChart({ chart, height = 340 }: { chart: MultiSeriesChart; height?: number }) {
  const W = 900, H = height, padL = 56, padR = 20, padT = 48, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = chart.xLabels.length;

  const totals = chart.xLabels.map((_, i) => chart.series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
  const yMax = niceMax(Math.max(...totals, 1));
  const ticks = 5;

  const slot = plotW / n;
  const barW = Math.min(64, slot * 0.6);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" width="100%">
      {/* legend */}
      {chart.series.map((s, i) => {
        const cols = chart.series.length;
        const slotW = plotW / cols;
        const lx = padL + slotW * i + 10;
        // Truncate to fit the slot so long series names don't overlap the next one
        // (~6.5px/char at 12px; SVG <title> keeps the full name on hover).
        const maxCh = Math.max(6, Math.floor((slotW - 18) / 6.5));
        const label = s.name.length > maxCh ? s.name.slice(0, maxCh - 1).trimEnd() + "…" : s.name;
        return (
          <g key={s.name}>
            <title>{s.name}</title>
            <circle cx={lx} cy={22} r={5} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            <text x={lx + 12} y={26} className="chart-legend-text">{label}</text>
          </g>
        );
      })}
      {/* y grid */}
      {Array.from({ length: ticks + 1 }, (_, t) => {
        const val = (yMax / ticks) * t;
        const yy = y(val);
        return (
          <g key={t}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#e7e9eb" strokeWidth={1} />
            <text x={padL - 10} y={yy + 4} textAnchor="end" className="chart-axis">{Math.round(val)}</text>
          </g>
        );
      })}
      <text className="chart-axis-title" transform={`translate(16 ${padT + plotH / 2}) rotate(-90)`} textAnchor="middle">{chart.yLabel}</text>
      {/* stacked bars */}
      {chart.xLabels.map((lab, i) => {
        const cx = padL + slot * i + slot / 2;
        let acc = 0;
        return (
          <g key={lab}>
            {chart.series.map((s, si) => {
              const v = s.values[i] || 0;
              const yTop = y(acc + v);
              const h = (v / yMax) * plotH;
              acc += v;
              const seg = (
                <g key={s.name}>
                  <rect x={cx - barW / 2} y={yTop} width={barW} height={h} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
                  {h > 11 && <text x={cx} y={yTop + h / 2 + 3} textAnchor="middle" className="bar-label">{v}</text>}
                </g>
              );
              return seg;
            })}
            <text x={cx} y={H - 12} textAnchor="middle" className="chart-axis">{lab}</text>
          </g>
        );
      })}
    </svg>
  );
}
