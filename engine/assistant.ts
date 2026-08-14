/* =============================================================================
   assistant.ts — the "Ask AI" page assistant (chat + edit + tile creation)
   -----------------------------------------------------------------------------
   Powers the AI sparkle on the top bar of EVERY platform screen (and the
   per-tile sparkles on dashboards). Two scopes:
     • DASHBOARD (header sparkle): ask about anything, edit any tile BY NAME,
       reshape the overall "story" (coherent multi-tile number/chart changes),
       or suggest scenarios the user can then apply.
     • TILE (a tile's sparkle): the same, but scoped to ONE tile (built-in or a
       previously AI-generated tile).

   It returns ONE of four actions:
     • kind:"answer"    — a text answer about the data.
     • kind:"create"    — a NEW tile (KPI/line/bar/pie) to append to the page.
     • kind:"editData"  — path-based edits to the page's DATA (built-in
                          tiles / the whole story). Never structure or styling.
     • kind:"editTile"  — a replacement spec for the focused AI-generated tile.

   HARD RULE (enforced here + in the UI): the assistant edits DATA ONLY — values,
   labels, titles, series numbers. It never changes layout, CSS, colors, keys, or
   the shape/length of arrays the dashboard depends on. Fast Haiku model; key is
   server-side only (called from the Vite dev endpoint / never in the browser).
   ============================================================================= */

import Anthropic from "@anthropic-ai/sdk";

const FAST_MODEL = "claude-haiku-4-5-20251001";

export interface AssistantFocus {
  scope: "dashboard" | "tile";
  tileKind?: "builtin" | "generated";
  label?: string;    // the focused tile's title
  preview?: string;  // a short text preview of the focused tile (to disambiguate)
}
export interface AssistantInput {
  customerName: string;
  dashboardTitle: string;
  /* False on any page that cannot render a generated tile (anything outside the
     platform dashboards). Additions there must be data edits instead. */
  canCreateTiles?: boolean;
  dataContext: string;                 // serialized (possibly already-edited) dashboard data
  question: string;
  focus?: AssistantFocus;
  /* Set only by a page that OWNS a question list (the Preview Agent tab). Turns
     on the question-list rule below. Absent everywhere else, so no other screen's
     assistant behaviour changes. */
  questionPath?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface AssistantKpi { label: string; value: string }
export interface AssistantSeries { name: string; values: number[] }
export interface AssistantSlice { label: string; value: number }
export interface AssistantTile {
  tileType: "kpi" | "line" | "bar" | "pie";
  title: string;
  note: string;
  kpis: AssistantKpi[];
  xLabels: string[];
  series: AssistantSeries[];
  slices: AssistantSlice[];
}
export interface AssistantEdit { path: string; value: string } // value is JSON-encoded
/* A COLUMN OPERATION on the Digital Journey report's leading columns.

   Deliberately NOT expressed as path edits. Asked to insert a column, the model was
   told to copy every other cell across verbatim and simply would not: measured on
   Avi & Co it rewrote "cpc" to "Google Ads", replaced real tracked URLs with invented
   ones, wrote the literal placeholder "Home / Category / Subcategory" into a live
   demo, and covered only 5 of 21 rows. That is a small model being asked to echo
   ~126 long strings, which is the wrong job for it.

   So it now supplies ONLY what it actually knows — where the column goes, what it is
   called, and one value per row — and the CLIENT splices that into the existing
   cells. Preservation is then guaranteed by construction rather than requested. */
export interface AssistantColumnOp {
  op: "insert" | "remove" | "rename" | "move" | "none";
  index: number;        // position acted on (0-based, among the leading columns)
  toIndex: number;      // move only; -1 otherwise
  header: string;       // insert/rename only; "" otherwise
  values: string[];     // insert only: one value per row, IN ROW ORDER; [] otherwise
}
export interface AssistantResult {
  kind: "answer" | "create" | "editData" | "editTile" | "editColumn";
  answer: string;
  edits: AssistantEdit[];
  tile: AssistantTile;
  column: AssistantColumnOp;
}

const TILE_PROPS = {
  tileType: { type: "string", enum: ["kpi", "line", "bar", "pie"] },
  title: { type: "string" },
  note: { type: "string" },
  kpis: {
    type: "array",
    items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } },
  },
  xLabels: { type: "array", items: { type: "string" } },
  series: {
    type: "array",
    items: { type: "object", additionalProperties: false, required: ["name", "values"], properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } },
  },
  slices: {
    type: "array",
    items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "number" } } },
  },
};

/* Every field required, because strict structured output has no optional keys; the
   instructions say which to leave empty for each op. */
const COLUMN_PROPS = {
  op: { type: "string", enum: ["insert", "remove", "rename", "move", "none"] },
  index: { type: "number" },
  toIndex: { type: "number" },
  header: { type: "string" },
  values: { type: "array", items: { type: "string" } },
};

// Single object so the model always returns valid JSON; unused fields come back
// empty per the instructions below.
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "answer", "edits", "tile", "column"],
  properties: {
    kind: { type: "string", enum: ["answer", "create", "editData", "editTile", "editColumn"] },
    answer: { type: "string" },
    edits: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["path", "value"],
        properties: {
          path: { type: "string" },   // dot-path into the dashboard JSON, e.g. "kpiGroups.0.tiles.1.value"
          value: { type: "string" },  // JSON-encoded replacement value, e.g. "\"84%\"" or "[70,80,90]"
        },
      },
    },
    tile: { type: "object", additionalProperties: false, required: ["tileType", "title", "note", "kpis", "xLabels", "series", "slices"], properties: TILE_PROPS },
    column: { type: "object", additionalProperties: false, required: ["op", "index", "toIndex", "header", "values"], properties: COLUMN_PROPS },
  },
};

function buildSystem(input: AssistantInput): string {
  const f = input.focus;
  const scopeLine =
    f?.scope === "tile"
      ? [
          `SCOPE: the user is focused on a SINGLE tile titled "${f.label ?? "(untitled)"}"${f.tileKind === "generated" ? " (an AI-generated tile)" : ""}.`,
          f.preview ? `That tile currently shows: ${f.preview}` : ``,
          `Keep answers and edits about THIS tile only.`,
          f.tileKind === "generated"
            ? `To change this generated tile, return kind:"editTile" with the FULL updated tile spec in "tile" (same tileType unless the user asks to change it).`
            : `To change this tile, return kind:"editData" with path edits that target ONLY this tile's data in the JSON below.`,
        ].filter(Boolean).join("\n")
      : `SCOPE: the whole "${input.dashboardTitle}" page. The user may ask about anything on it, edit a part they NAME, or reshape the overall story across several parts.`;

  return [
    `You are the "Ask AI" assistant embedded in a page of ${input.customerName}'s Invoca platform demo. The page may be a dashboard, a report, a call review, a signal list or an agent-configuration screen.`,
    scopeLine,
    ``,
    `Choose exactly ONE action ("kind"):`,
    `1. "answer" — answer a question, or SUGGEST scenario options for the user to pick from. Concise plain text in "answer" (no markdown). Leave edits [] and tile empty (tileType:"kpi", title:"", note:"", empty arrays).`,
    `2. "create" — the user asks to ADD / create / make a NEW tile. Fill "tile" (see tile rules) and put a short confirmation in "answer". Leave edits [].`,
    ...(input.canCreateTiles === false ? [
      `OVERRIDE: this page CANNOT render a new tile, so NEVER return kind "create" here. When the user asks to ADD something (a branch, a path, a question, a row of options), return kind "editData" instead: one edit whose path is the LIST it belongs to and whose value is that WHOLE list with the new item appended, copied from the DATA below and left otherwise identical. To REMOVE something, return the same list with that item left out.`,
    ] : []),
    `3. "editData" — the user asks to CHANGE existing page data (a named/focused BUILT-IN tile's numbers, a chart's trend, a title/label, or the whole story). Return "edits": each { path, value } where path is a DOT-PATH into the DATA JSON below (numeric array indices), and value is the JSON-ENCODED replacement (e.g. "\\"84%\\"", "1250", "[70,80,90,85,95,100]", "\\"New Title\\""). Put a confirmation in "answer". Leave tile empty.`,
    `4. "editTile" — change the focused AI-GENERATED tile: return the FULL updated spec in "tile" and a confirmation in "answer". Leave edits [].`,
    ``,
    `TILE rules (kind create/editTile): pick tileType — "kpi" (2–4 headline numbers → kpis), "line" (trend over time → xLabels + series[].values), "bar" (comparison across categories → xLabels + series[].values), "pie" (share of a whole → slices). Give a clear title + one-line note. Leave the arrays you don't use empty.`,
    ``,
    `HARD RULES:`,
    `- You may ONLY change DATA values. Each edit path MUST point at a SCALAR leaf (a string or number, e.g. a tile value, a label, a title) OR a chart series' number array (e.g. "…series.0.values"), and when replacing an array you MUST keep the SAME length. NEVER replace or restructure an object, NEVER change the number of tiles/rows/series/xLabels, NEVER add or remove JSON keys, and NEVER touch layout, CSS, colors, or styling. A chart series keeps exactly one value per xLabel; a table row keeps one cell per column. If asked to restyle/recolor/resize/add-remove tiles-via-edit, DECLINE via "answer" (say you can change the data, and that adding a tile is a separate "create" action).`,
    `- REPORT COLUMNS — when the page data has "dimensionColumns" and a "rows" array of interactions (the Digital Journey & Call Attribution Report), you CAN add, remove, rename or move its leading columns. Return kind:"editColumn" and fill "column" ONLY; leave "edits" empty.`,
    `  DO NOT copy the other columns' values. You supply only the operation; the app splices it into the existing rows and every other value is preserved automatically.`,
    `    insert — index = 0-based position the new column takes (0 puts it FIRST, left of everything). header = its name. toIndex = -1. values = ONE value per row, in the SAME order as "rows" in the DATA below. COUNT the rows and return exactly that many values. "values" MUST NOT be empty for an insert: an empty list produces a blank column and is a failed answer. This is the only part of the table you generate, so spend your effort here.`,
    `    remove — index = the column to drop. header = "", values = [], toIndex = -1.`,
    `    rename — index = the column, header = its new name. values = [], toIndex = -1.`,
    `    move   — index = the column's current position, toIndex = where it should end up. header = "", values = [].`,
    `  Values for an inserted column must fit THIS business and that specific row (a Location column on a retailer gets real cities or regions it serves, never "N/A" or a placeholder). Never touch "signalColumns" or a row's "signals": those render as check/cancel icons, not text. On any page WITHOUT "dimensionColumns", adding or removing a table column is not possible — say so in "answer" and return kind "answer".`,
    `- Base every number on the DATA below or on a coherent scenario the user requested. Keep values realistic and internally consistent (percentages that should sum ~100 do; totals match their parts).`,
    `- For chart series/bars, strip %/$ to plain numbers; kpi values may keep formatting.`,
    `- For a "story" / scenario change, edit the KEY HEADLINE numbers that carry the story (the KPI tile values and the primary chart series) so it stays consistent — you do NOT need to touch every single value. Prefer ~5–15 focused edits over exhaustively rewriting every leaf.`,
    ...(input.questionPath ? [
      `- THE AGENT'S QUESTION LIST. "${input.questionPath}" in the DATA below is the ordered list of questions this SMS agent asks, one per message. Changing it is the main thing this page is for, so treat these as normal data edits and do NOT decline them.`,
      `  Return kind:"editData" with ONE edit whose path is exactly "${input.questionPath}" and whose value is the COMPLETE new list as a JSON array of strings. Never edit a single element by index (no "${input.questionPath}.2") — always send the whole list.`,
      `  This list MAY change length: adding, removing and reordering questions are all allowed here, unlike every other array on every other page.`,
      `  Carry every question the user did not ask you to touch across VERBATIM, character for character. If they say "change question 3", questions 1, 2, 4… come back exactly as they are in the DATA. Rewording an untouched question is a bug, not an improvement.`,
      `  Asked to rewrite the list for a USE CASE, replace ALL of them with 4-6 questions that serve that goal, specific to THIS business's products and vocabulary, ordered so the easy ones come first. Never return generic questions that would fit any company. The user's message describes the use case; follow that description rather than your own reading of the label.`,
      `  NURTURE means RE-ENGAGING someone who went quiet, NOT a cold first contact and NOT a no-booking newsletter. They were interested before and stopped replying, or a rep could not reach them. Those questions must assume prior contact, check whether they are still interested, surface what stalled it, and still drive toward booking. Never open a nurture flow as if you had never spoken.`,
      `  Each question is one text message: a single question, conversational, under ~20 words, ending in "?".`,
    ] : []),
    `- Be concise and professional.`,
    ``,
    `DATA (current JSON for this page):`,
    input.dataContext,
  ].join("\n");
}

export async function askAssistant(input: AssistantInput, apiKey?: string): Promise<AssistantResult> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });

  const history = (input.history ?? []).slice(-8);
  const messages = [...history, { role: "user" as const, content: input.question }];

  const resp = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 8000,
    system: buildSystem(input),
    output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
    messages,
  } as any);

  const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) throw new Error("Empty assistant response.");
  return JSON.parse(text) as AssistantResult;
}
