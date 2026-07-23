/* =============================================================================
   assistant.ts — the "Ask AI" dashboard assistant (chat + edit + tile creation)
   -----------------------------------------------------------------------------
   Powers the AI sparkle on every dashboard. Two scopes:
     • DASHBOARD (header sparkle): ask about anything, edit any tile BY NAME,
       reshape the overall "story" (coherent multi-tile number/chart changes),
       or suggest scenarios the user can then apply.
     • TILE (a tile's sparkle): the same, but scoped to ONE tile (built-in or a
       previously AI-generated tile).

   It returns ONE of four actions:
     • kind:"answer"    — a text answer about the data.
     • kind:"create"    — a NEW tile (KPI/line/bar/pie) to append to the page.
     • kind:"editData"  — path-based edits to the dashboard's DATA (built-in
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
  dataContext: string;                 // serialized (possibly already-edited) dashboard data
  question: string;
  focus?: AssistantFocus;
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
export interface AssistantResult {
  kind: "answer" | "create" | "editData" | "editTile";
  answer: string;
  edits: AssistantEdit[];
  tile: AssistantTile;
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

// Single object so the model always returns valid JSON; unused fields come back
// empty per the instructions below.
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "answer", "edits", "tile"],
  properties: {
    kind: { type: "string", enum: ["answer", "create", "editData", "editTile"] },
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
      : `SCOPE: the whole "${input.dashboardTitle}" dashboard. The user may ask about any tile, edit a tile they NAME, or reshape the overall story across multiple tiles.`;

  return [
    `You are the "Ask AI" assistant embedded in ${input.customerName}'s Invoca analytics dashboard.`,
    scopeLine,
    ``,
    `Choose exactly ONE action ("kind"):`,
    `1. "answer" — answer a question, or SUGGEST scenario options for the user to pick from. Concise plain text in "answer" (no markdown). Leave edits [] and tile empty (tileType:"kpi", title:"", note:"", empty arrays).`,
    `2. "create" — the user asks to ADD / create / make a NEW tile. Fill "tile" (see tile rules) and put a short confirmation in "answer". Leave edits [].`,
    `3. "editData" — the user asks to CHANGE existing dashboard data (a named/focused BUILT-IN tile's numbers, a chart's trend, a title/label, or the whole story). Return "edits": each { path, value } where path is a DOT-PATH into the DATA JSON below (numeric array indices), and value is the JSON-ENCODED replacement (e.g. "\\"84%\\"", "1250", "[70,80,90,85,95,100]", "\\"New Title\\""). Put a confirmation in "answer". Leave tile empty.`,
    `4. "editTile" — change the focused AI-GENERATED tile: return the FULL updated spec in "tile" and a confirmation in "answer". Leave edits [].`,
    ``,
    `TILE rules (kind create/editTile): pick tileType — "kpi" (2–4 headline numbers → kpis), "line" (trend over time → xLabels + series[].values), "bar" (comparison across categories → xLabels + series[].values), "pie" (share of a whole → slices). Give a clear title + one-line note. Leave the arrays you don't use empty.`,
    ``,
    `HARD RULES:`,
    `- You may ONLY change DATA values. Each edit path MUST point at a SCALAR leaf (a string or number, e.g. a tile value, a label, a title) OR a chart series' number array (e.g. "…series.0.values"), and when replacing an array you MUST keep the SAME length. NEVER replace or restructure an object, NEVER change the number of tiles/rows/series/xLabels, NEVER add or remove JSON keys, and NEVER touch layout, CSS, colors, or styling. A chart series keeps exactly one value per xLabel; a table row keeps one cell per column. If asked to restyle/recolor/resize/add-remove tiles-via-edit, DECLINE via "answer" (say you can change the data, and that adding a tile is a separate "create" action).`,
    `- Base every number on the DATA below or on a coherent scenario the user requested. Keep values realistic and internally consistent (percentages that should sum ~100 do; totals match their parts).`,
    `- For chart series/bars, strip %/$ to plain numbers; kpi values may keep formatting.`,
    `- For a "story" / scenario change, edit the KEY HEADLINE numbers that carry the story (the KPI tile values and the primary chart series) so it stays consistent — you do NOT need to touch every single value. Prefer ~5–15 focused edits over exhaustively rewriting every leaf.`,
    `- Be concise and professional.`,
    ``,
    `DATA (current JSON for this dashboard):`,
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
