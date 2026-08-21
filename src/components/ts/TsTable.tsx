import { useMemo } from "react";
import { fitCells } from "../chartFit";
import { heatColor } from "../../data/tsPalette";

/* =============================================================================
   TsTable — the ThoughtSpot table, including the "show heat map" option.
   -----------------------------------------------------------------------------
   Measured off the capture:

     body        11.9px, #333333, rows ~50px tall
     header      13px / 700 / #15243e, 48px tall
     cell rule   1px #eaedf2
     tinted fill #f6f8fa
     secondary   #777e8b
     font        optimo-plain, "Helvetica Neue", Helvetica, Arial

   ⚠️ THE TABLE IS NOT LATO, even though every chart on the same page is. ThoughtSpot's
   table CSS sets the family explicitly, which beats the Lato inherited from
   --ts-var-root-font-family. Both were read from the same captured document, so this
   is real rather than a capture artefact. Setting Lato here is the kind of "tidy up"
   that silently stops matching the product.

   HEAT MAP: a pale cyan ramp normalised PER COLUMN, not across the table. Each numeric
   column gets its own min and max, which is why in the capture 278 and 825 can share
   the top colour while sitting in different columns.
   ============================================================================= */

export interface TsTableProps {
  columns: string[];
  /** Row cells as display strings. Length is fitted to `columns`, never trusted. */
  rows: string[][];
  /** Column indices to colour as a heat map, or `true` for every numeric column. */
  heatmap?: number[] | boolean;
  /** An aggregation row under the body, e.g. ["TOTAL", "48,293", …]. */
  footer?: string[];
  /** Right-align these columns; numeric columns are detected when omitted. */
  alignRight?: number[];
  onRow?: (row: string[], index: number) => void;
  /**
   * How the heat ramp is normalised.
   *
   * ⚠️ A REAL PER-TEMPLATE DIFFERENCE, not a preference. The Details Report measured
   * per-COLUMN; the Calls-by-Hour pivot measured GLOBAL across the grid. Defaults to
   * "column" so the report is untouched.
   */
  heatScope?: "column" | "table";
  /** Saturation point for a table-scoped ramp; it clamps rather than stretching to the max. */
  heatMax?: number;
  /** A pivot's extra first header row: the measure, then the column dimension's name. */
  pivotHeader?: { measure: string; columnDimension: string };
}

/** Digits, currency, percentages and thousands separators all count as numeric. */
const numOf = (s: string): number | null => {
  if (!s) return null;
  const t = s.replace(/[$,%\s]/g, "");
  /* ⚠️ K/M/B SUFFIXES MUST PARSE, or an abbreviated cell silently gets no heat. Found by
     verifying the Calls-by-Hour pivot: it renders "1.63K" / "21.73K", every one of which
     failed this test, so the only cells that took a colour were the plain ones under 1,000
     — i.e. all the SMALL ones — and the whole grid came out near-white with "845" as its
     darkest cell. Sorting by heat is what exposed it; a glance would not have. */
  const m = /^(-?\d*\.?\d+)([KMB])?$/i.exec(t);
  if (!m) return null;
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1 : 1;
  const n = parseFloat(m[1]) * mult;
  return isFinite(n) ? n : null;
};

export function TsTable({
  columns, rows, heatmap, footer, alignRight, onRow, heatScope = "column", heatMax, pivotHeader,
}: TsTableProps) {
  const n = columns.length;
  const body = useMemo(() => rows.map((r) => fitCells(r, n)), [rows, n]);

  /* Which columns are numeric, and each one's own range for the heat ramp. */
  const stats = useMemo(() => {
    return columns.map((_, c) => {
      const nums = body.map((r) => numOf(r[c])).filter((v): v is number => v !== null);
      const numeric = nums.length > 0 && nums.length >= body.length * 0.6;
      return { numeric, min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
    });
  }, [columns, body]);

  /* ⚠️ "table" SCOPE NORMALISES ACROSS THE WHOLE GRID AND SATURATES. Measured on the
     Calls-by-Hour pivot: its column maxima carry 20 DIFFERENT colours, so it is not
     per-column like the Details Report, and its ramp hits darkest at ~4,320 while the grand
     total is 42,050 — it clamps rather than stretching to the biggest number. `heatMax` is
     that saturation point. Default stays "column" so the Details Report is untouched. */
  const tableRange = useMemo(() => {
    if (heatScope !== "table") return null;
    const nums = body.flatMap((r) => r.map(numOf)).filter((v): v is number => v !== null);
    return { min: 0, max: heatMax ?? (nums.length ? Math.max(...nums) : 0) };
  }, [heatScope, heatMax, body]);

  const heatCols = useMemo(() => {
    if (!heatmap) return new Set<number>();
    if (heatmap === true) return new Set(stats.map((s, i) => (s.numeric ? i : -1)).filter((i) => i >= 0));
    return new Set(heatmap);
  }, [heatmap, stats]);

  const rightCols = useMemo(() => {
    if (alignRight) return new Set(alignRight);
    return new Set(stats.map((s, i) => (s.numeric ? i : -1)).filter((i) => i >= 0));
  }, [alignRight, stats]);

  return (
    <div className="ts-tablewrap">
      <table className="ts-table">
        <thead>
          {/* ⚠️ A PIVOT HAS TWO HEADER ROWS. The first names the MEASURE over the row-label
              column and the COLUMN DIMENSION over everything else — "Total Call Count" then
              "Hour of day Call Start Time", spanning the hours. Measured; a single header row
              loses the fact that the numbers 0–23 are hours at all. */}
          {pivotHeader ? (
            <tr className="ts-pivot-head">
              <th>{pivotHeader.measure}</th>
              <th colSpan={Math.max(1, columns.length - 1)}>{pivotHeader.columnDimension}</th>
            </tr>
          ) : null}
          <tr>
            {columns.map((c, i) => (
              <th key={c + i} className={rightCols.has(i) ? "ts-td--right" : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className={onRow ? "ts-tr--click" : undefined}
              onClick={onRow ? () => onRow(r, ri) : undefined}>
              {r.map((cell, ci) => {
                const st = stats[ci];
                const v = heatCols.has(ci) ? numOf(cell) : null;
                const rng = tableRange ?? st;
                const bg = v !== null && rng ? heatColor(v, rng.min, rng.max) : undefined;
                return (
                  <td key={ci} className={rightCols.has(ci) ? "ts-td--right" : undefined}
                    style={bg ? { background: bg } : undefined}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
          {body.length === 0 ? (
            <tr><td className="ts-table-empty" colSpan={n}>No rows to show.</td></tr>
          ) : null}
        </tbody>
        {footer && footer.length ? (
          <tfoot>
            <tr>
              {fitCells(footer, n).map((f, i) => (
                <td key={i} className={rightCols.has(i) ? "ts-td--right" : undefined}>{f}</td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
