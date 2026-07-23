/* Donut chart matching the live Invoca style:
   - arc size = each segment's share of the shown segments (fills 360°)
   - % label ON each slice, computed against the grand total (call count)
   - category label OUTSIDE with a leader line (no bottom legend) */

const COLORS = ["#2666f9", "#129922", "#f5575a", "#009788", "#a182e5", "#f5b800", "#8892a0"];

export interface DonutSegment {
  label: string;
  value: number;
}

const CX = 175, CY = 130, R_OUT = 84, R_IN = 50;

function sector(a0: number, a1: number): string {
  const p = (r: number, a: number) => [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  const [x0, y0] = p(R_OUT, a0);
  const [x1, y1] = p(R_OUT, a1);
  const [x2, y2] = p(R_IN, a1);
  const [x3, y3] = p(R_IN, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${R_OUT} ${R_OUT} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 ${large} 0 ${x3} ${y3} Z`;
}

function truncate(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function DonutChart({ segments, total }: { segments: DonutSegment[]; total: number }) {
  const shownSum = segments.reduce((s, d) => s + d.value, 0) || 1;
  const grand = total || shownSum;
  let angle = -Math.PI / 2;

  return (
    <svg viewBox="0 0 350 260" className="donut-svg" width="100%">
      {segments.map((seg, i) => {
        const frac = seg.value / shownSum;
        const a0 = angle;
        const a1 = angle + frac * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        angle = a1;

        // on-slice % label (share of grand total)
        const rMid = (R_OUT + R_IN) / 2;
        const lx = CX + rMid * Math.cos(mid);
        const ly = CY + rMid * Math.sin(mid);
        const pct = Math.round((seg.value / grand) * 100);

        // external label + leader line
        const right = Math.cos(mid) >= 0;
        const p1 = [CX + R_OUT * Math.cos(mid), CY + R_OUT * Math.sin(mid)];
        const p2 = [CX + (R_OUT + 14) * Math.cos(mid), CY + (R_OUT + 14) * Math.sin(mid)];
        const p3 = [p2[0] + (right ? 20 : -20), p2[1]];

        return (
          <g key={i}>
            <path d={sector(a0, a1)} fill={COLORS[i % COLORS.length]} />
            {frac > 0.05 && (
              <text x={lx} y={ly + 4} textAnchor="middle" className="donut-pct">{pct}%</text>
            )}
            <polyline
              points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`}
              fill="none" stroke="#c7ccd3" strokeWidth={1}
            />
            <text
              x={p3[0] + (right ? 4 : -4)} y={p3[1] + 4}
              textAnchor={right ? "start" : "end"}
              className="donut-ext-label"
            >
              {truncate(seg.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
