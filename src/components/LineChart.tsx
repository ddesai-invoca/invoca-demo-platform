import type { MultiSeriesChart } from "../data/schema";

const SERIES_COLORS = ["#2666f9", "#ff7045", "#f3cb00", "#00d1b4", "#a182e5"];

function niceMax(v: number): number {
  const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
  return Math.ceil(v / step) * step;
}

export function LineChart({ chart, height = 340 }: { chart: MultiSeriesChart; height?: number }) {
  const W = 900, H = height, padL = 56, padR = 20, padT = 48, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(...chart.series.flatMap((s) => s.values), 1);
  const yMax = niceMax(maxVal);
  const ticks = 5;
  const n = chart.xLabels.length;
  // Thin x-axis labels when there are many points so they don't overlap
  // (the line + markers still render for every point).
  const labelEvery = Math.max(1, Math.ceil(n / 15));

  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" width="100%">
      {/* legend */}
      {chart.series.map((s, i) => {
        const cols = chart.series.length;
        const slotW = plotW / cols;
        const lx = padL + slotW * i + 10;
        // Truncate to fit the slot so long series names don't overlap the next one.
        const maxCh = Math.max(6, Math.floor((slotW - 26) / 6.5));
        const label = s.name.length > maxCh ? s.name.slice(0, maxCh - 1).trimEnd() + "…" : s.name;
        return (
          <g key={s.name}>
            <title>{s.name}</title>
            <line x1={lx} y1={22} x2={lx + 16} y2={22} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} />
            <circle cx={lx + 8} cy={22} r={3} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            <text x={lx + 20} y={26} className="chart-legend-text">{label}</text>
          </g>
        );
      })}
      {/* y grid + labels */}
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
      {/* x labels (thinned for long series) */}
      {chart.xLabels.map((lab, i) =>
        (i % labelEvery === 0 || i === n - 1)
          ? <text key={i} x={x(i)} y={H - 12} textAnchor="middle" className="chart-axis">{lab}</text>
          : null
      )}
      {/* lines + markers */}
      {chart.series.map((s, si) => {
        const color = SERIES_COLORS[si % SERIES_COLORS.length];
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        return (
          <g key={s.name}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
