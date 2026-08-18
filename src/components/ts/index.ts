/* The ThoughtSpot component layer for Insights & Analytics.
   Import from here, not from the individual files, so a future re-organisation of
   this folder does not touch every screen that uses it. */
export { TsTile, TsLegend, TsTip, TsAxes, useTsHover, useCartesian } from "./TsShell";
export type { TsTileProps, TsHover, TsAxesProps } from "./TsShell";
export { TsLine, TsColumn, TsBar, TsDualAxis, TsPie, legendFor, pieLegend } from "./TsCharts";
export type { TsSeries, TsSlice } from "./TsCharts";
export { TsKpi, TsMetric, TsTrend } from "./TsKpi";
export { TsTable } from "./TsTable";
export type { TsTableProps } from "./TsTable";
export {
  TS_PLOT, TS_SIZE, TS_AXIS_LINE, TS_AXIS_LABEL, TS_LEGEND_TEXT,
  TS_COLUMN_W, TS_COLUMN_GAP, TS_BAR_THICK, TS_LINE_W, TS_DONUT_INNER,
  niceTicks, tsNum, plotOf, bands, yOf, slicePath, sliceAngles, linePath, areaPath,
} from "./tsChart";
export { TS_HUES, TS_SERIES_LINE, TS_SERIES_COLUMN, TS_SLICE_COLORS, heatColor, areaFill }
  from "../../data/tsPalette";
