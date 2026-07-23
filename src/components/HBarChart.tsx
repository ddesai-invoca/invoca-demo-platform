import type { OpsBarChart } from "../data/schema";

/* Horizontal bar chart (blue bars, value labels, x-axis + gridlines) for the
   Marketing & Operations dashboard. Uses the shared chart blue (#2666f9). */
export function HBarChart({ chart }: { chart: OpsBarChart }) {
  const { legend, axisMax, axisTicks, axisSuffix, bars } = chart;
  const stepPct = axisTicks.length > 1 ? 100 / (axisTicks.length - 1) : 100;
  // Continuous vertical gridlines across the whole plot (behind bars AND the gaps
  // between rows), aligned to the axis ticks — a single overlay over the track area.
  const grid = `repeating-linear-gradient(90deg, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent ${stepPct}%)`;

  return (
    <div className="hbar">
      <div className="hbar-legend"><span className="hbar-dot" />{legend}</div>
      <div className="hbar-body">
        <div className="hbar-grid" style={{ backgroundImage: grid }} />
        {bars.map((b, i) => {
          const pct = Math.max(0, Math.min(100, (b.value / axisMax) * 100));
          const inside = pct >= 14;
          return (
            <div className="hbar-row" key={i}>
              <div className="hbar-label" title={b.name}>{b.name}</div>
              <div className="hbar-track">
                <div className="hbar-bar" style={{ width: pct + "%" }}>
                  {inside && <span className="hbar-val">{b.display}</span>}
                </div>
                {!inside && <span className="hbar-val-out">{b.display}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hbar-axis">
        <div className="hbar-axis-spacer" />
        <div className="hbar-ticks">
          {axisTicks.map((t, i) => (
            <span key={i}>{t.toLocaleString()}{axisSuffix}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
