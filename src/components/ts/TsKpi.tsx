import { fitValues } from "../chartFit";
import { TS_SERIES_LINE, areaFill } from "../../data/tsPalette";
import { TS_AREA_ALPHA, TS_LINE_W, TS_SIZE, areaPath, linePath } from "./tsChart";

/* =============================================================================
   TsKpi / TsMetric / TsTrend — the number tiles.
   -----------------------------------------------------------------------------
   Measured off the capture:

     value      28px / 700 / #1d232f      <- ThoughtSpot's ink, NOT Invoca's #15243e
     label      14px / 600 / #15243e      <- Invoca's ink
     sub-line   16px / 400 / #777e8b
     delta down 16px / 400 / #f04152

   ⚠️ The value and its label use DIFFERENT inks, and that is not a mistake in the
   measurement: it is the two-layer token model showing through. Invoca overrides the
   label colour; the big number falls back to ThoughtSpot's own content-primary. Using
   one ink for both is a small thing that reads as "not quite the product".
   ============================================================================= */

/** One number under a label. Several of these stack inside a Summary Metrics tile. */
export function TsMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ts-metric">
      <div className="ts-metric-label">{label}</div>
      <div className="ts-metric-value">{value}</div>
    </div>
  );
}

/** The single big number a KPI template renders on its own. */
export function TsKpi({ value, label }: { value: string; label?: string }) {
  return (
    <div className="ts-kpi">
      {label ? <div className="ts-metric-label">{label}</div> : null}
      <div className="ts-metric-value ts-kpi-value">{value}</div>
    </div>
  );
}

/**
 * A number, the period it covers, the change against the previous period, and a
 * filled sparkline. `delta` is a signed percentage; a negative one turns red and
 * takes a down arrow, which is what the real tile does.
 */
export function TsTrend({
  value, period, delta, previous, previousPeriod, spark,
  w = TS_SIZE.spark.w, h = TS_SIZE.spark.h,
}: {
  value: string; period: string; delta: number; previous: string; previousPeriod: string;
  spark: number[]; w?: number; h?: number;
}) {
  const vals = fitValues(spark, spark.length) ?? [];
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const pad = 6;
  const pts: Array<[number, number]> = vals.map((v, i) => [
    vals.length > 1 ? pad + (i / (vals.length - 1)) * (w - pad * 2) : w / 2,
    h - pad - ((v - min) / Math.max(1, max - min)) * (h - pad * 2),
  ]);
  const down = delta < 0;
  const color = TS_SERIES_LINE[0];

  return (
    <div className="ts-trend">
      <div className="ts-metric-value">{value}</div>
      <div className="ts-trend-period">{period}</div>
      <div className={"ts-trend-delta" + (down ? " ts-trend-delta--down" : "")}>
        <span className="ts-trend-arrow">{down ? "▼" : "▲"}</span>
        {Math.abs(delta).toFixed(2)}% ({previous}) {previousPeriod}
      </div>
      {pts.length > 1 ? (
        <svg className="ts-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Trend">
          <path d={areaPath(pts, h - pad)} fill={areaFill(color, TS_AREA_ALPHA)} stroke="none" />
          <path d={linePath(pts)} fill="none" stroke={color} strokeWidth={TS_LINE_W}
            strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}
