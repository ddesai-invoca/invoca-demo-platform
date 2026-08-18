/* =============================================================================
   chartFit — make a chart survive a series that does not match its x-axis.
   -----------------------------------------------------------------------------
   The AI may now ADD and REMOVE chart series, pie slices and axis points, not just
   edit their numbers. That is a deliberate widening, and it removes the old safety
   net: editGuard used to refuse any array-length change precisely because a series
   with the wrong number of values draws off the edge of the plot.

   So the safety moves here. A renderer must be TOTAL — defined for every input the
   assistant can now produce — because the model is inconsistent about filling a new
   series (the same request has produced a full set one run and none the next). The
   rule we want is the one DataTable already follows for columns: a half-finished
   edit shows a GAP, never a broken or misaligned picture.

     • too many values  -> truncate to the axis
     • too few          -> hold the last value flat, which reads as "no further
                           data" rather than collapsing the line to zero
     • none at all      -> return null, and the caller SKIPS the series entirely;
                           a brand-new empty series must not draw a flat line along
                           y=0, which looks like a real measurement of zero

   Pure and dependency-free so it can be unit tested directly. */

export function fitValues(values: number[] | undefined | null, n: number): number[] | null {
  if (!Array.isArray(values) || values.length === 0 || n <= 0) return null;
  const clean = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  if (clean.length === n) return clean;
  if (clean.length > n) return clean.slice(0, n);
  return [...clean, ...Array(n - clean.length).fill(clean[clean.length - 1])];
}

/* The same idea for a table row: pad to the header count with a visible blank and
   drop anything past it, so a row can never run wider than its headers. */
export function fitCells(cells: string[] | undefined | null, n: number, blank = "—"): string[] {
  const src = Array.isArray(cells) ? cells : [];
  if (src.length === n) return src.slice();
  if (src.length > n) return src.slice(0, n);
  return [...src, ...Array(n - src.length).fill(blank)];
}
