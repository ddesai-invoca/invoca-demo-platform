import {
  TsTile, TsLine, TsColumn, TsBar, TsDualAxis, TsPie, TsTable, TsKpi, TsMetric, TsTrend,
  legendFor, pieLegend, TS_SERIES_COLUMN, TS_SERIES_LINE, TS_SIZE,
} from "../components/ts";

/* =============================================================================
   TsGallery (`/ts-gallery`) — every ThoughtSpot template on one page.
   -----------------------------------------------------------------------------
   A bench, not a demo screen: it exists so the layer can be checked against the
   saved capture side by side, at more than one width, without hunting through the
   product. Nothing links to it and no prospect ever sees it.

   The data is deliberately shaped like the capture's (a 5-week January window, the
   same four call measures) so the two can be compared directly. It is NOT read from
   a profile: this page must render identically whoever is active, or it stops being
   a reference. Re-skinning belongs in the screens that use these components.
   ============================================================================= */

const WEEKS = ["12/29/2025", "01/05/2026", "01/12/2026", "01/19/2026", "01/26/2026"];

const CALL_SERIES = [
  { name: "Total Call Count", values: [87, 492, 503, 465, 436] },
  { name: "Total Answered by Agent", values: [78, 442, 455, 405, 374] },
  { name: "Total Appointment: Discussed", values: [64, 331, 356, 318, 291] },
  { name: "Total Appointment: Scheduled", values: [55, 249, 252, 232, 215] },
];

const MEDIUM_SLICES = [
  { label: "Paid Search", value: 6842 },
  { label: "Organic Search", value: 4218 },
  { label: "Direct", value: 2967 },
  { label: "Referral", value: 1844 },
  { label: "Paid Social", value: 1305 },
  { label: "Email", value: 917 },
  { label: "Display", value: 612 },
  { label: "Affiliate", value: 388 },
  /* A ninth slice on purpose: it proves the palette continues into the tints of
     hues already used rather than running out or repeating a base colour. */
  { label: "Organic Social", value: 241 },
];

const HOURS = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];
const BY_HOUR = [96, 184, 267, 311, 288, 243, 296, 274, 198, 121];

const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DOW_TABLE = {
  columns: ["Day of Week", "Call Type", "Total Call Count", "Answered", "Appointment Set", "Revenue"],
  rows: [
    ["Monday", "New Patient", "825", "742", "318", "$184,220"],
    ["Monday", "Existing Patient", "317", "296", "104", "$52,140"],
    ["Tuesday", "New Patient", "278", "251", "97", "$61,880"],
    ["Tuesday", "Existing Patient", "265", "238", "88", "$44,310"],
    ["Wednesday", "New Patient", "160", "141", "61", "$38,470"],
    ["Wednesday", "Existing Patient", "136", "122", "47", "$27,905"],
    ["Thursday", "New Patient", "128", "117", "51", "$31,260"],
    ["Thursday", "Existing Patient", "117", "104", "40", "$22,845"],
    ["Friday", "New Patient", "87", "79", "34", "$19,730"],
    ["Friday", "Existing Patient", "51", "45", "19", "$11,415"],
  ],
  footer: ["TOTAL", "", "2,364", "2,135", "859", "$494,175"],
};

export function TsGallery() {
  return (
    <div className="ts-page">
      <h1 style={{ font: "400 24px/36px var(--ts-var-root-font-family)", margin: "0 0 4px" }}>
        ThoughtSpot component layer
      </h1>
      <p style={{ font: "400 13px/20px var(--ts-var-root-font-family)", color: "#777e8b", margin: "0 0 20px" }}>
        Every template, drawn from the measured tokens and palette. Compare against the
        saved capture at a narrow and a wide viewport.
      </p>

      <div className="ts-grid">
        {/* KPI + metric + trend, as the Summary Metrics tile stacks them */}
        <TsTile title="Summary Metrics">
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div style={{ minWidth: 180 }}>
              <TsMetric label="Total Calls" value="1,942" />
              <TsMetric label="Missed Conversations" value="560" />
              <TsMetric label="Total Conversations" value="1,717" />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="ts-metric-label" style={{ marginBottom: 4 }}>
                Total Conversations Weekly Trend
              </div>
              <TsTrend value="366" period="Week of 01/26/2026" delta={-7.81}
                previous="397" previousPeriod="Week of 01/19/2026"
                spark={[92, 118, 372, 389, 366]} />
            </div>
          </div>
        </TsTile>

        <TsTile title="Conversations/Metrics Over Time"
          legend={legendFor(CALL_SERIES, TS_SERIES_COLUMN)}>
          <TsColumn categories={WEEKS} series={CALL_SERIES}
            xTitle="Weekly Call Start Time"
            yTitle="Total Call Count & Total Answered by Agent" showLegend={false} />
        </TsTile>

        <TsTile title="Buying Intent"><TsKpi value="69.16%" /></TsTile>
        <TsTile title="Conversions"><TsKpi value="55.46%" /></TsTile>

        <TsTile title="Performance By Medium (Donut)" legend={pieLegend(MEDIUM_SLICES)}>
          <TsPie slices={MEDIUM_SLICES} showLegend={false} w={TS_SIZE.pie.w} h={TS_SIZE.pie.h} />
        </TsTile>

        <TsTile title="Performance By Medium (Pie)" legend={pieLegend(MEDIUM_SLICES.slice(0, 5))}>
          <TsPie slices={MEDIUM_SLICES.slice(0, 5)} donut={false} showLegend={false} />
        </TsTile>

        <TsTile className="ts-span-2" title="Single Line Chart Over Time">
          <TsLine categories={WEEKS} series={[CALL_SERIES[0]]}
            xTitle="Weekly Call Start Time" yTitle="Total Call Count" showLegend={false} />
        </TsTile>

        <TsTile className="ts-span-2" title="Multi-Line Chart Over Time"
          legend={legendFor(CALL_SERIES.slice(0, 3), TS_SERIES_LINE)}>
          <TsLine categories={WEEKS} series={CALL_SERIES.slice(0, 3)}
            xTitle="Weekly Call Start Time" yTitle="Call Measures" showLegend={false} />
        </TsTile>

        <TsTile className="ts-span-2" title="Dual Y-Axis"
          legend={[
            { label: "Total Call Count", color: TS_SERIES_LINE[1] },
            { label: "Appointment Rate", color: TS_SERIES_LINE[0] },
          ]}>
          <TsDualAxis categories={WEEKS}
            columnSeries={CALL_SERIES[0]}
            lineSeries={{ name: "Appointment Rate", values: [63, 50, 50, 49, 49] }}
            xTitle="Weekly Call Start Time" yTitle="Total Call Count"
            rightTitle="Appointment Rate" rightFormat={(v) => v + "%"} />
        </TsTile>

        <TsTile title="Calls by Hour">
          <TsBar categories={HOURS} values={BY_HOUR} xTitle="Total Call Count"
            seriesName="Total Call Count" w={TS_SIZE.bar.w} h={520} />
        </TsTile>

        <TsTile title="Stacked Bar" legend={legendFor(CALL_SERIES.slice(2), TS_SERIES_COLUMN)}>
          <TsColumn categories={DOW} series={CALL_SERIES.slice(2)} stacked
            xTitle="Day of Week" yTitle="Appointments" showLegend={false} />
        </TsTile>

        <TsTile className="ts-span-2" title="Calls by Day of Week (table, heat map on)"
          description="Extra categories plus the heat map option, which colours each numeric column against its own range.">
          <TsTable columns={DOW_TABLE.columns} rows={DOW_TABLE.rows}
            footer={DOW_TABLE.footer} heatmap />
        </TsTile>

        <TsTile className="ts-span-2" title="Details Report (table, heat map off)">
          <TsTable columns={DOW_TABLE.columns} rows={DOW_TABLE.rows} footer={DOW_TABLE.footer} />
        </TsTile>
      </div>
    </div>
  );
}
