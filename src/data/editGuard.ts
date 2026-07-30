/* =============================================================================
   editGuard.ts — rule 2, enforced in CODE
   -----------------------------------------------------------------------------
   The assistant may change a page's DATA, never its template. CSS, colours and
   fonts are already impossible: no data value reaches a className or a style
   attribute (the handful of data-driven classNames are boolean toggles between
   states the designer built), and nothing renders data as raw HTML.

   The hole this closes is subtler. The prompt tells the model not to change the
   LENGTH of arrays or the TYPE of a value, and applyEdits used to apply whatever
   came back regardless. Those two changes are structural, not data:

     • array length drives layout — `gridTemplateColumns: repeat(${tiles.length},
       1fr)` on the AI Messaging cards, a table's row count, a chart's series and
       its legend. Adding a series is a template change wearing a data costume.
     • a type flip (string → array, object → number) breaks the component that
       renders it, usually as a blank tile or a crash boundary.

   This is the same instruct-then-enforce pairing the dash rule needed: the model
   mostly complies, and "mostly" is not a guarantee you can demo on.

   Pure and dependency-free so it can be unit tested directly. */

type Kind = "array" | "null" | "object" | "string" | "number" | "boolean" | "undefined" | "other";

function kindOf(v: unknown): Kind {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  const t = typeof v;
  return t === "object" || t === "string" || t === "number" || t === "boolean" || t === "undefined"
    ? (t as Kind) : "other";
}

/** Read a dot/bracket path, matching setByPath's traversal. */
export function getByPath(source: unknown, path: string): unknown {
  const keys = path.replace(/\[(\w+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = source;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object" || !(k in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * True when replacing `before` with `after` would change the page's SHAPE rather
 * than its content — which rule 2 forbids.
 */
export function isStructuralChange(before: unknown, after: unknown): boolean {
  const kb = kindOf(before), ka = kindOf(after);
  // A type flip is structural: the component renders one shape, not the other.
  // null <-> a value is allowed, since "no value" is a legitimate data state.
  if (kb !== ka && kb !== "null" && ka !== "null") return true;
  // Same-length array edits are the whole point ("make Q4 trend up"); a different
  // length adds or removes a row, series, column or tile.
  if (kb === "array" && ka === "array") {
    return (before as unknown[]).length !== (after as unknown[]).length;
  }
  return false;
}
