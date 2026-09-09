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
  /\bpaths$/i,             // ...and the answers a Qualify leaf routes on
  /* ⚠️ THE VOICE AGENT'S OWN CONFIGURATION (8/27/2026), registered beside the diagram so one
     Ask AI instruction can build the tree AND configure the agent. Every one of these is a
     LIST whose length is its content: "add a rule", "serve these four ZIP codes instead",
     "drop the step that asks for a name". Blocking the length would leave the feature able to
     reword an existing rule and unable to add one.

     ⚠️ SCOPED TO `agent.` ON PURPOSE. A bare /rules$/ would also match the Signal Manager's
     rule strings and any other `rules` array on any screen, quietly widening rule 2 across the
     app to buy one page a feature. */
  /* ⚠️ `steps` IS THE SMS SIDE OF `informSteps` (9/8/2026), registered beside an extra
     workflow's diagram so its Ask AI matches the voice page's. Same reason it is a length
     exemption: "drop the step that asks for the reason" and "add a step that confirms the
     facility" are the whole feature, and a fixed length leaves it able to reword a step and
     unable to add one. Still scoped to `agent.` — a bare /steps$/ would widen rule 2 across
     any other screen that happens to hold a `steps` array. */
  /^agent\.(rules|informSteps|serviceZips|steps)$/i,
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

  /* DASHBOARD AND REPORT CONTENT — added when the standing AI rules were set:
     the assistant may add and remove COLUMNS, TILES, chart SERIES, pie SLICES and
     axis POINTS across the Dashboards and Reports tabs.

     This is a deliberate trade. Length was blocked because it drives layout, and
     that is still true — so the safety MOVED rather than disappeared: every shape
     listed here now renders through a total function that pads and truncates
     (fitValues / fitCells in components/chartFit.ts, DataTable's leadingCells), so a
     half-finished edit shows a gap instead of a line drawn off the plot or a body
     misaligned against its headers. Do not add a pattern here until the thing that
     renders it can survive the wrong length.

     It stays an ALLOW-LIST, not a blanket permission: anything not named is still
     refused, so a bespoke renderer nobody has hardened cannot be reshaped by a
     stray edit. TYPE changes remain blocked everywhere and unconditionally. */
  /\bseries$/i,           // a chart's series list
  /\bvalues$/i,           // one series' points, i.e. the x-axis length
  /\bxLabels$/i,          // the axis points themselves
  /\bslices$/i,           // pie/donut slices
  /\bsegments$/i,         // donut segments
  /\bbars$/i,             // horizontal bar rows
  /\bmetricColumns$/i,    // a breakdown table's headers
  /\bmetrics$/i,          // one row's cells, aligned to metricColumns
  /\bheaders$/i,          // generic table headers
  /\brows$/i,             // table rows (the donut derives from these, consistently)
  /\btiles$/i,            // KPI tiles in a group
  /\bkpis$/i,             // numbers inside a generated KPI tile
];

/* OPTIONAL FIELDS THAT MAY BE CREATED FROM ABSENT.

   A type flip is normally structural, and `undefined -> string` is a type flip. But
   an OPTIONAL field that no profile on disk carries yet is absent, not mis-typed,
   and the first edit has to be allowed to create it or the feature is dead on
   arrival for every existing demo.

   The Preview Agent's greeting is exactly that: `smsPlaybook.greeting` was added
   after all eleven profiles were generated, so the app shows a derived default
   (smsBrain.ts) until someone sets one. Without this, the assistant's first
   greeting rewrite was silently dropped, and the ONLY symptom was the model
   cheerfully reporting a change that never happened.

   Kept to a named list rather than a blanket "undefined is fine" rule, because
   allowing arbitrary key creation is how the assistant starts inventing fields the
   renderer never reads. */
const CREATABLE_WHEN_ABSENT = [
  /\bgreeting$/i,
  /* A prospect with no configured service area has NEITHER of these, so the first "only serve
     ZIPs 30097 and 30096" is an undefined -> value write. `agentConfigOf` omits them rather
     than writing undefined, so absent really does mean absent here. */
  /^agent\.(serviceZips|outOfAreaScript)$/i,
  /* ⚠️ A USE CASE'S DESTINATION, which is OPTIONAL on `TreePath` so that a spec naming no teams
     (Comfort Keepers) renders exactly as before. That made "route cancellations to the retention
     team" an undefined -> string write on precisely those prospects, so the guard refused an
     edit the drawer's own empty state offers. Caught by checking the guard against the copy
     rather than by trying it, which would only have failed on one account. */
  /\bpaths\.\d+\.route$/i,
  /* ⚠️ THE AGENT'S TTS VOICE, which no prospect carries until somebody picks one on the
     Details tab — so the FIRST pick is an undefined -> string write on every demo, and
     without this the picker would be refused by the guard on its first use and work on
     every use after. `agentConfigOf` omits it when unset, so absent is really absent.
     Safe to allow because `specWithConfig` validates the value against VOICE_OPTIONS:
     the guard decides whether a write is structural, not whether it is a real voice. */
  /^agent\.voice$/i,
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
  /* Creating an optional field that simply does not exist yet (see above). */
  if (kb === "undefined" && ka !== "undefined" && path && CREATABLE_WHEN_ABSENT.some((re) => re.test(path))) return false;
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

/* =============================================================================
   NODES THE PRODUCT ITSELF DOES NOT LET A USER RENAME.
   -----------------------------------------------------------------------------
   Some labels are the product's own wiring rather than the prospect's data. The Agent
   Studio workflow diagram is the case that forced this: in the real Invoca page the
   trigger, the conversation-start node and the two intent nodes CANNOT be renamed, so an
   assistant that happily renames them is showing an SE something the product cannot do.

   "Triggered by" and "Conversation Start" were never at risk — they are literals in
   WorkflowTree.tsx. The INTENT titles are model data, so they need enforcing.

   ⚠️ THE ALTERNATIVE WAS A SILENT NO-OP, which is why this exists at all. Fixing the
   titles in the renderer and ignoring `branch.title` would let the model accept "rename
   this to X", write the edit, and change nothing on screen — the exact failure recorded at
   the greeting, the `cells` guard and the workflow tile. Blocking the edit means the drawer
   reports a REFUSAL, which is a true statement about the product.
   ============================================================================= */

/** Leaf keys that are product chrome when their node is marked `locked`. */
/* ⚠️ `action` WAS MISSING AND THAT WAS A HOLE (8/26/2026). Locking the voice tree's leaves
   refused a rename of "All Sales Inquiry Users" and left "Qualify" wide open, so the AI could
   accept "change this to Route to Sales" and write it — half of the row protected and half
   not, which is worse than either. Only LEAVES carry `action`, so adding it here cannot affect
   a branch or the two chrome fields. */
const LOCKED_KEYS = /\.(title|subtitle|action)$/;

/* ⚠️ THE TWO TOP-OF-TREE FIELDS, which have no node of their own to carry a flag. The trigger
   line and the Conversation Start label are the product's wording on both channels, so it was
   inconsistent for the AI to be refused the intent names and allowed to rewrite these — and
   the note above already recorded that our trigger line had once been the WRONG channel's
   wording, which is exactly the kind of edit this stops. Gated on the model's own
   `chromeLocked`, so an authored extra workflow that wants its own trigger line simply does
   not set it. */
const CHROME_KEYS = new Set(["triggeredBy", "startLabel"]);

/**
 * True when `path` targets a label on a node the product does not allow renaming.
 *
 * Driven by a `locked: true` flag ON THE NODE rather than a path pattern, so the rule
 * travels with the data: a diagram that gains a third locked node needs no change here, and
 * nothing else in the app is affected by a name that happens to look similar.
 */
export function isLockedEdit(data: unknown, path: string): boolean {
  if (CHROME_KEYS.has(path)
    && !!data && typeof data === "object"
    && (data as { chromeLocked?: unknown }).chromeLocked === true) return true;
  const m = LOCKED_KEYS.exec(path);
  if (!m) return false;
  const parent = getByPath(data, path.slice(0, path.length - m[0].length));
  return !!parent && typeof parent === "object" && (parent as { locked?: unknown }).locked === true;
}

/* =============================================================================
   FOCUSED EDITS MUST LAND ON THE FOCUSED TILE.
   -----------------------------------------------------------------------------
   When an SE clicks the sparkle ON a tile, the model still has to find that tile's
   path in the data by itself, and it reasons about the page as RENDERED. Where the
   two disagree it picks the wrong index, and the failure is silent: the drawer says
   "Updated the tile title", the focused tile is untouched, and a DIFFERENT tile
   quietly gets renamed.

   That is not hypothetical. On the Marketing dashboard the breakdowns render as
   `filter(hasDonut)` first and the one table-only breakdown LAST, so the Product
   Category tile is 6th on screen but index 4 in the array, and index 5 ("Calls by
   Region") renders 5th. Asked to rename Product Category the model returned
   `breakdowns.5.title` on 6 of 6 attempts, focused and named alike, and renamed
   Calls by Region instead.

   So the tile now declares its own path and this narrows every edit to it:

     • already inside the focused tile -> kept
     • same container, WRONG index, and the same leaf exists under the focused
       path -> REMAPPED onto the focused tile (`breakdowns.5.title` ->
       `breakdowns.4.title`). This is the off-by-one above, and remapping is safe
       because it strictly narrows to the tile the user explicitly pointed at.
     • anything else -> DROPPED, so a focused edit can never touch another tile.

   Only applies when a path is supplied. Tiles that do not declare one behave
   exactly as before. */
export interface ConstrainResult { edits: { path: string; value: string }[]; remapped: number; dropped: number }

export function constrainToFocus(
  edits: { path: string; value: string }[],
  /* One prefix, or SEVERAL: some cards are a group of sibling fields
     (`trendTitle` + `trendChart`) rather than one subtree. See findTilePath. */
  focusPath: string | string[] | undefined,
  data: unknown,
): ConstrainResult {
  const focuses = (Array.isArray(focusPath) ? focusPath : focusPath ? [focusPath] : []).filter(Boolean);
  if (!focuses.length) return { edits, remapped: 0, dropped: 0 };
  const inside = (p: string) => focuses.some((f) => p === f || p.startsWith(f + "."));
  /* Remapping a wrong index only makes sense for a single array-element focus; a
     sibling group has no index to have been confused with. */
  const m = focuses.length === 1 ? /^(.*)\.(\d+)$/.exec(focuses[0]) : null;
  const focusOne = focuses[0];
  const out: { path: string; value: string }[] = [];
  let remapped = 0, dropped = 0;

  for (const e of edits) {
    if (inside(e.path)) { out.push(e); continue; }
    if (m) {
      const sib = new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)\\.(.+)$`).exec(e.path);
      /* Same array, different element. Remap only if the same leaf actually exists
         on the focused element, so we never invent a key that was not there. */
      if (sib && sib[1] !== m[2] && getByPath(data, `${focusOne}.${sib[2]}`) !== undefined) {
        out.push({ path: `${focusOne}.${sib[2]}`, value: e.value });
        remapped++;
        continue;
      }
    }
    dropped++;
  }
  return { edits: out, remapped, dropped };
}
