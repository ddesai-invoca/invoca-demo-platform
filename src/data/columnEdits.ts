/* =============================================================================
   columnEdits.ts — turn a column OPERATION into path edits, in code
   -----------------------------------------------------------------------------
   The assistant returns only WHAT to do to the Digital Journey report's leading
   columns — insert at position N called "Location" with these per-row values, or
   remove / rename / move column N. This module reads the page's CURRENT data and
   produces the edits.

   WHY THE MODEL DOES NOT DO THIS. It was first asked to emit the full new cell list
   for every row, copying the untouched columns across verbatim. Measured against the
   real Avi & Co report it would not: it rewrote "cpc" to "Google Ads", swapped real
   tracked URLs for invented ones, wrote the literal placeholder
   "Home / Category / Subcategory" into a live demo, renamed a header it was told to
   leave alone, and produced cells for only 5 of 21 rows. Prompting harder moved it
   from 7 rows to 5.

   That is the wrong job for a fast model: ~126 long strings echoed exactly. Here the
   copying is a splice, so every value the user did not ask to change is preserved by
   construction and every row is covered whether the model remembered it or not.
   ============================================================================= */

import type { AssistantColumnOp } from "../../engine/assistant";
import { leadingCells } from "../components/DataTable";
import type { AssistantEdit } from "../../engine/assistant";

/* TWO TABLE SHAPES QUALIFY.

   The Digital Journey report keeps its headers in `dimensionColumns` and a row's cells
   in `cells`; a dashboard breakdown keeps them in `metricColumns` and `metrics`. The
   splice is identical and only the field names differ, so the shape is resolved once
   here. `basePath` is how a FOCUSED breakdown gets its own column changed instead of
   whichever table happens to come first on the page. */
interface Shape { headersPath: string; cellsKey: string; rowsPath: string; headers: string[]; rows: Record<string, unknown>[] }

export function resolveTableShape(data: unknown, basePath?: string): Shape | null {
  const at = (obj: unknown, path?: string): unknown =>
    !path ? obj : path.split(".").reduce<unknown>(
      (cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), obj);
  const node = at(data, basePath) as Record<string, unknown> | undefined;
  if (!node || typeof node !== "object") return null;
  const pre = basePath ? basePath + "." : "";
  if (Array.isArray(node.dimensionColumns) && (node.dimensionColumns as string[]).length && Array.isArray(node.rows)) {
    return { headersPath: pre + "dimensionColumns", cellsKey: "cells", rowsPath: pre + "rows",
             headers: node.dimensionColumns as string[], rows: node.rows as Record<string, unknown>[] };
  }
  if (Array.isArray(node.metricColumns) && (node.metricColumns as string[]).length && Array.isArray(node.rows)) {
    return { headersPath: pre + "metricColumns", cellsKey: "metrics", rowsPath: pre + "rows",
             headers: node.metricColumns as string[], rows: node.rows as Record<string, unknown>[] };
  }
  return null;
}

/** Edits for the op, or null when this page has no such table. */
export function columnEdits(
  data: unknown,
  col: AssistantColumnOp,
  /* The FOCUSED table, when there is one. Without it a breakdown's column change
     resolved against the page root, found no table there, and reported "this page's
     table doesn't support columns" on a page full of tables. */
  basePath?: string | string[],
): AssistantEdit[] | null {
  const first = Array.isArray(basePath) ? basePath[0] : basePath;
  /* Try the focused node, then the page root, so a page-level request still works. */
  const shape = resolveTableShape(data, first) ?? resolveTableShape(data, undefined);
  if (!shape) return null;
  const { headers, rows, headersPath, cellsKey, rowsPath } = shape;

  /* Every row's CURRENT cells, via the same reader the table renders with, so the
     starting point is exactly what is on screen — including the header-driven
     fallback for rows that have no cell list yet. */
  const current = rows.map((r) =>
    cellsKey === "cells"
      ? leadingCells(r as never, headers)
      : (Array.isArray((r as Record<string, unknown>).metrics)
          ? ((r as Record<string, unknown>).metrics as string[]).slice(0, headers.length)
          : []
        ).concat(Array(Math.max(0, headers.length - (((r as Record<string, unknown>).metrics as string[])?.length ?? 0))).fill("—")));

  const clamp = (n: number, max: number) => Math.max(0, Math.min(Math.trunc(n), max));
  let nextHeaders: string[];
  let nextRows: string[][];

  switch (col.op) {
    case "insert": {
      const at = clamp(col.index, headers.length);          // === length appends
      nextHeaders = [...headers.slice(0, at), col.header || "New Column", ...headers.slice(at)];
      nextRows = current.map((cells, i) => {
        /* A missing value becomes "", never a guess and never a shifted cell. */
        const v = col.values?.[i] ?? "";
        return [...cells.slice(0, at), v, ...cells.slice(at)];
      });
      break;
    }
    case "remove": {
      if (headers.length <= 1) return null;                 // never leave a headless table
      const at = clamp(col.index, headers.length - 1);
      nextHeaders = headers.filter((_, i) => i !== at);
      nextRows = current.map((cells) => cells.filter((_, i) => i !== at));
      break;
    }
    case "rename": {
      const at = clamp(col.index, headers.length - 1);
      if (!col.header) return null;
      nextHeaders = headers.map((h, i) => (i === at ? col.header : h));
      nextRows = current;                                   // cells unchanged
      break;
    }
    case "move": {
      const from = clamp(col.index, headers.length - 1);
      const to = clamp(col.toIndex, headers.length - 1);
      if (from === to) return null;
      const moveOne = <T,>(a: T[]): T[] => {
        const out = [...a];
        out.splice(to, 0, ...out.splice(from, 1));
        return out;
      };
      nextHeaders = moveOne(headers);
      nextRows = current.map(moveOne);
      break;
    }
    default:
      return null;
  }

  /* One edit for the headers, one per row. Writing `cells` for EVERY row (not only
     the touched ones) is what stops a half-migrated table: from here on every row
     carries an explicit cell list aligned to the headers. */
  return [
    { path: headersPath, value: JSON.stringify(nextHeaders) },
    ...nextRows.map((cells, i) => ({ path: `${rowsPath}.${i}.${cellsKey}`, value: JSON.stringify(cells) })),
  ];
}
