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

interface ReportLike {
  dimensionColumns?: string[];
  rows?: { cells?: string[]; [k: string]: unknown }[];
}

/** Edits for the op, or null when this page has no such table. */
export function columnEdits(data: unknown, col: AssistantColumnOp): AssistantEdit[] | null {
  const d = data as ReportLike | null | undefined;
  const headers = d?.dimensionColumns;
  const rows = d?.rows;
  if (!Array.isArray(headers) || !headers.length || !Array.isArray(rows)) return null;

  /* Every row's CURRENT cells, via the same reader the table renders with, so the
     starting point is exactly what is on screen — including the header-driven
     fallback for rows that have no `cells` yet. */
  const current = rows.map((r) => leadingCells(r as never, headers));

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
    { path: "dimensionColumns", value: JSON.stringify(nextHeaders) },
    ...nextRows.map((cells, i) => ({ path: `rows.${i}.cells`, value: JSON.stringify(cells) })),
  ];
}
