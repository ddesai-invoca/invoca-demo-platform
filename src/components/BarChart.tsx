import type { ChartPoint } from "../data/schema";

interface Props {
  legend: string;
  data: ChartPoint[];
  yMax: number;
  yTicks: number[];
  yAxisTitle?: string;
}

/* Reusable SVG bar chart. Bar heights derive from value/yMax, so changing the
   data (or swapping customer) re-draws automatically. */
export function BarChart({ legend, data, yMax, yTicks, yAxisTitle = "Interactions" }: Props) {
  const W = 1526, H = 264, padL = 80, padTop = 47, padBottom = 47;
  const areaTop = padTop;
  const areaBottom = H - padBottom;
  const areaH = areaBottom - areaTop;
  const n = data.length;
  const slot = (W - padL) / n;
  const barW = 92;

  return (
    <div className="card chart-card">
      <div className="chart-legend">
        <span className="dot" />
        <span>{legend}</span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H + 30}`} preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t) => {
          const y = areaBottom - (t / yMax) * areaH;
          return (
            <g key={t}>
              <line className="grid-line" x1={padL} y1={y} x2={W} y2={y} />
              <text className="axis-label" x={padL - 12} y={y + 4} textAnchor="end">{t}</text>
            </g>
          );
        })}
        <text
          className="y-title"
          transform={`translate(24 ${areaTop + areaH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yAxisTitle}
        </text>
        {data.map((d, i) => {
          const h = (d.value / yMax) * areaH;
          const cx = padL + slot * i + slot / 2;
          const x = cx - barW / 2;
          const y = areaBottom - h;
          return (
            <g key={d.date}>
              <rect className="bar" x={x} y={y} width={barW} height={h} />
              <text className="axis-label" x={cx} y={areaBottom + 22} textAnchor="middle">{d.date}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
