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

/* ARRAYS WHOSE LENGTH IS CONTENT, NOT LAYOUT.

   The length rule exists because array length drives layout — a chart's series, a
   table's rows, a KPI grid's columns. But some arrays are just a list of things,
   and their length is the whole point of editing them: the Preview Agent's
   qualifying questions are exactly that. "Ask three questions instead of five" is
   a data change; refusing it would make the feature useless.

   The same is true of a workflow DIAGRAM: on that screen the tree's shape is the
   content, so "add a branch" and "remove that path" have to be allowed. The
   renderer computes the layout from the branch list (components/WorkflowTree.tsx),
   which is what makes that safe — a new branch positions itself and draws its own
   connectors instead of landing on top of something.

   Matched against the edit PATH, so it stays narrow: only these lists may change
   length, everything else is still blocked. Node styling, sizes, colours and the
   icon set are not data and remain out of reach. */
const LENGTH_IS_CONTENT = [
  /qualifyingQuestions$/i,
  /\bquestions$/i,
  /\bbranches$/i,          // a workflow diagram's branches ARE its content
  /\bleaves$/i,            // ...and so are a branch's routing outcomes
  /\bchips$/i,             // the signals collected on a leaf
  /* THE DIGITAL JOURNEY REPORT'S LEADING COLUMNS. Adding, removing, renaming or
     moving one is a normal thing to want of a demo table ("put a Location column
     before Marketing Source"), and it used to be declined as structural.

     Safe because DataTable renders every row through leadingCells(), which pads and
     truncates to the header count — so a row the assistant did not finish updating
     shows a blank cell rather than a body misaligned against its headers.

     Scoped deliberately: only this report's columns. The dashboards' breakdown
     tables, every chart's series, xLabels and table ROW counts are all still
     blocked, and column styling is not data and remains unreachable. */
  /\bdimensionColumns$/i,  // the report's leading headers, in display order
  /\bcells$/i,             // InteractionRow.cells — aligned to dimensionColumns
];

/**
 * True when replacing `before` with `after` would change the page's SHAPE rather
 * than its content — which rule 2 forbids. `path` is optional; when given, a
 * list whose length is content (see above) may change length.
 */
export function isStructuralChange(before: unknown, after: unknown, path?: string): boolean {
  const kb = kindOf(before), ka = kindOf(after);
  /* CREATING an exempt list is allowed. `cells` is optional on a row and absent
     until the first column edit, so the very first write is undefined -> array.
     Without this the guard blocked EVERY row's cells while letting the header
     change through, which added a correctly-placed column with all 21 values
     silently dropped — a table that looked half-built for no visible reason. The
     unit tests missed it because columnEdits() and isStructuralChange() were each
     tested alone; the bug only exists in their COMPOSITION, on a row that has no
     `cells` key yet. */
  if (kb === "undefined" && ka === "array" && path && LENGTH_IS_CONTENT.some((re) => re.test(path))) return false;
  // A type flip is structural: the component renders one shape, not the other.
  // null <-> a value is allowed, since "no value" is a legitimate data state.
  if (kb !== ka && kb !== "null" && ka !== "null") return true;
  // Same-length array edits are the whole point ("make Q4 trend up"); a different
  // length adds or removes a row, series, column or tile.
  if (kb === "array" && ka === "array") {
    if (path && LENGTH_IS_CONTENT.some((re) => re.test(path))) return false;
    return (before as unknown[]).length !== (after as unknown[]).length;
  }
  return false;
}
