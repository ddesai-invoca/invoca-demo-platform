import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  /**
   * A Report tile's pinned aggregation row: a grey label over a large value, per column.
   *
   * ⚠️ THE REPORT TABLE IS A THIRD RENDERER, not a variant of the other two. Measured:
   * the Details Report tile is **ag-Grid** in 12px LATO `#15243E`; the Calls-by-Hour pivot
   * is DevExtreme in 11.9px optimo-plain `#333`. Passing this switches the chrome to
   * `--report`, the same way `pivotHeader` switches it to `--pivot`.
   */
  reportFooter?: { label: string; value: string }[];
  /** `Showing 200 of many rows`, printed under the grid. */
  caption?: string;
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

/**
 * Width for the Report grid's trailing filler cell.
 *
 * ⚠️ MEASURED IN JS, BECAUSE NO CSS EXPRESSION OF THIS WORKS. The goal is the reference's
 * behaviour: data columns at their CONTENT width (capped in the 145-202 band) and the leftover
 * space taken by the filler, so the row rules reach the full width of the tile. Three CSS
 * attempts, each measured and each wrong:
 *   - `width: max-content` — columns correct, but the table stops at the last column and
 *     takes its rules with it, so nothing crosses the empty area.
 *   - `width: 100%` — the browser negotiates every column against the available space and
 *     resolves it by handing the slack to the DATA columns, past their cap (226.1 measured).
 *   - `width: 100%` on the filler (with or without `max-content` on the table) — a percentage
 *     cell width forces every other column to its MINIMUM: all six came out 145.
 * So the filler's width is computed from what the data columns actually measured. The table
 * stays `max-content` (correct columns) with `min-width: 100%`, and this fills the gap.
 */
function useFillerWidth(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  headRef: React.RefObject<HTMLTableRowElement | null>,
  enabled: boolean,
): number {
  const [w, setW] = useState(0);
  const measure = useCallback(() => {
    const wrap = wrapRef.current, head = headRef.current;
    if (!wrap || !head) return;
    /* Sum the DATA cells, never the table's own width — the filler is part of that, so using
       it would feed this measurement back into itself. */
    let data = 0;
    for (const c of Array.from(head.cells)) {
      if (!c.classList.contains("ts-report-spacer")) data += c.getBoundingClientRect().width;
    }
    const room = wrap.clientWidth - data;
    setW((prev) => (Math.abs(prev - Math.max(0, room)) < 0.5 ? prev : Math.max(0, Math.round(room))));
  }, [wrapRef, headRef]);

  /* ⚠️ A LAYOUT EFFECT PLUS A rAF PASS, NOT ONE `useEffect` — the same first-paint trap
     TsGeoMap documents. Measured: the first pass runs before this wrapper has a real width, so
     `room` comes out 0, and the ResizeObserver then never fires again because the box it is
     watching does not change after `observe()`. The filler sat at 0 forever and the rules
     stopped at the last column; forcing a real resize by hand corrected it to 116, which is
     how the ordering was confirmed rather than guessed. */
  useLayoutEffect(() => {
    if (!enabled) return;
    measure();
    const raf = requestAnimationFrame(measure);
    const wrap = wrapRef.current;
    const ro = wrap ? new ResizeObserver(measure) : null;
    ro?.observe(wrap!);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [enabled, measure, wrapRef]);

  return enabled ? w : 0;
}

export function TsTable({
  columns, rows, heatmap, footer, alignRight, onRow, heatScope = "column", heatMax, pivotHeader,
  reportFooter, caption,
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
    /* ⚠️ THE FOOTER IS PART OF THE RAMP, not exempt from it. Measured on the Day-of-Week
       capture: all 367 non-blank cells fit ONE linear ramp, the per-day totals among them,
       and the grand total is one of only three cells that reach the darkest colour. The
       first version tinted the body alone, which left the row a prospect's eye goes to
       first — the totals — as the one row carrying no signal. */
    const cells = [...body, ...(footer && footer.length ? [footer] : [])];
    const nums = cells.flatMap((r) => r.map(numOf)).filter((v): v is number => v !== null);
    return { min: 0, max: heatMax ?? (nums.length ? Math.max(...nums) : 0) };
  }, [heatScope, heatMax, body, footer]);

  const heatCols = useMemo(() => {
    if (!heatmap) return new Set<number>();
    if (heatmap === true) return new Set(stats.map((s, i) => (s.numeric ? i : -1)).filter((i) => i >= 0));
    return new Set(heatmap);
  }, [heatmap, stats]);

  const rightCols = useMemo(() => {
    if (alignRight) return new Set(alignRight);
    return new Set(stats.map((s, i) => (s.numeric ? i : -1)).filter((i) => i >= 0));
  }, [alignRight, stats]);

  /* A pivot's LAST column is its row-total column, and the capture prints it bold on a
     #F5F5F5 ground — the same treatment as the totals row. Structural rather than a
     guess: the column only exists because `timePivot` appends it. */
  const totalCol = pivotHeader ? n - 1 : -1;
  const cellCls = (ci: number) => {
    const parts = [];
    if (rightCols.has(ci)) parts.push("ts-td--right");
    if (ci === totalCol) parts.push("ts-td--total");
    return parts.length ? parts.join(" ") : undefined;
  };

  const variant = pivotHeader ? " ts-table--pivot" : reportFooter ? " ts-table--report" : "";
  /**
   * ⚠️ A TRAILING SPACER COLUMN, ON THE REPORT GRID ONLY — this is what makes the row rules
   * run the FULL width of the tile when the chosen columns do not fill it.
   *
   * Measured across two captures of the same 6-column report, one in an 863px tile and one
   * in a 1760px tile. The column widths are IDENTICAL in both (187.93 / 201.59 / 201.59 /
   * 144.69 / 166.26 / 158.29), so columns never flex — they are content-sized and fixed, and
   * the grid simply scrolls when they overflow. In the wide tile the columns total 1060 in a
   * 1742 viewport, and there the grid splits in two:
   *
   *   - `.ag-row` is **1734** wide — the full container — so its 1px #DDE2EB bottom rule runs
   *     right across the empty area. Same for the header's 2px black rule (on
   *     `.ag-header-viewport`, 1742) and the aggregation row's 1px top rule (on
   *     `.ag-floating-bottom`, 1742).
   *   - the header ROW and the aggregation ROW are only **1060** — cells, text and the
   *     vertical column rules all stop at the last column.
   *
   * A `width: max-content` table stops dead at the last column and takes its rules with it,
   * which is what ours did. Giving the table `width: 100%` alone would instead hand the slack
   * to the data columns and blow past their measured widths. An uncapped spacer cell absorbs
   * it: the real columns keep their band, the rules span the tile, and when the columns
   * overflow the spacer collapses to zero and the grid scrolls exactly as before.
   */
  const spacer = !!reportFooter;
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  const fillerW = useFillerWidth(wrapRef, headRef, spacer);
  const fillerStyle = { width: fillerW ? `${fillerW}px` : 0 } as const;

  return (
    /* ⚠️ A FRAGMENT, because the caption sits OUTSIDE the scroller. Inside it, the caption
       landed at the bottom of 8,958px of rows and could only be read by scrolling to the
       end — the capture has it under the grid, always visible. Every other table passes no
       caption, so the fragment renders exactly one child and their DOM is unchanged. */
    <>
    {/* The wrapper carries the variant too: a Report grid scrolls its BODY inside a fixed
        height (measured 477px in the capture) with the header and the aggregation row
        pinned, and only the wrapper can own that. */}
    <div ref={wrapRef} className={`ts-tablewrap${reportFooter ? " ts-tablewrap--report" : ""}`}>
      <table className={`ts-table${variant}`}>
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
          <tr ref={headRef}>
            {columns.map((c, i) => (
              <th key={c + i} className={cellCls(i)}>{c}</th>
            ))}
            {spacer ? <th className="ts-report-spacer" aria-hidden="true" style={fillerStyle} /> : null}
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
                  <td key={ci} className={cellCls(ci)}
                    style={bg ? { background: bg } : undefined}>
                    {cell}
                  </td>
                );
              })}
              {spacer ? <td className="ts-report-spacer" style={fillerStyle} /> : null}
            </tr>
          ))}
          {body.length === 0 ? (
            <tr><td className="ts-table-empty" colSpan={n}>No rows to show.</td></tr>
          ) : null}
        </tbody>
        {footer && footer.length ? (
          <tfoot>
            <tr>
              {fitCells(footer, n).map((f, i) => {
                const v = heatCols.has(i) ? numOf(f) : null;
                const bg = v !== null && tableRange ? heatColor(v, tableRange.min, tableRange.max) : undefined;
                return (
                  <td key={i} className={cellCls(i)} style={bg ? { background: bg } : undefined}>{f}</td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
        {/* ⚠️ THE AGGREGATION ROW IS TWO LINES PER CELL, and both are RIGHT-ALIGNED even
            under a left-aligned dimension column — measured, and it is what makes the row
            read as a row of figures rather than as another data row. The label is 12px
            `#777E8B`, the value 16px/700 `#15243E`. */}
        {reportFooter && reportFooter.length ? (
          <tfoot className="ts-report-agg">
            <tr>
              {Array.from({ length: n }, (_, i) => reportFooter[i]).map((f, i) => (
                <td key={i}>
                  <span className="ts-agg-label">{f?.label ?? ""}</span>
                  <span className="ts-agg-value">{f?.value ?? ""}</span>
                </td>
              ))}
              {spacer ? <td className="ts-report-spacer" style={fillerStyle} /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
    {caption ? <div className="ts-table-caption">{caption}</div> : null}
    </>
  );
}
