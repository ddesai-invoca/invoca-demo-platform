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
import { VOICE_OPTIONS } from "../src/data/voiceOptions.ts";

const FAST_MODEL = "claude-haiku-4-5-20251001";

/* =============================================================================
   THE VOICE AGENT DIRECTOR — a second, far stronger model for one kind of page
   -----------------------------------------------------------------------------
   Asked for 9/3/2026, from the voice workflow's Ask AI drawer: "you know how I can ask you
   to change how the voice agent acts, and does, and what questions it asks, I want the ASK
   AI to have all the abilities that you have to change the Voice AI behavior... It's ok if
   it takes a bit like it does for you, just put the progress bar or a percentage."

   ⚠️⚠️ **THE GAP WAS THE MODEL, NOT THE DATA MODEL — measured before changing anything.**
   `agent.rules[]` already reaches the live call prompt verbatim ("CONVERSATION RULES
   configured on this workflow"), `agent.informSteps[]` is the numbered flow, and the tree's
   paths and chips are what the agent collects. `editGuard` already permits every one of
   those to change LENGTH. So almost anything an SE can describe was already expressible —
   what was missing was a model strong enough to translate "make it qualify on budget before
   it books" into the right combination of six or seven edits across two halves of one
   object. Haiku wrote one plausible edit and stopped.

   ⚠️ **SO ONLY THIS ONE PAGE PAYS FOR IT.** Dashboards, reports and the tile builder keep
   Haiku and stay instant — a "bump revenue to $1.2M" edit does not need reasoning and an
   SE mid-demo should not wait for it. The gate is the same `"agent":` test that already
   decides whether to describe the agent at all, so the drawer's promise, the prompt's
   instructions and the model choice cannot drift apart.

   ⚠️ **ADAPTIVE THINKING AND `effort` ARE OPUS-ONLY** — Haiku 400s on either, which
   `engine/core.ts` records for the generation pipeline. Both are set ONLY on this path.
   ============================================================================= */
const DIRECTOR_MODEL = "claude-opus-5";

/** Does this page carry a voice agent's configuration beside its diagram? */
function isVoiceAgentPage(dataContext: string): boolean {
  return /"agent"\s*:/.test(dataContext);
}

/** What the endpoint streams to the drawer so a slow answer shows real progress. */
export interface AssistantProgress {
  /** A short label for what is happening now. */
  phase: string;
  /** 0-100. Never reaches 100 before the answer is actually parsed. */
  pct: number;
  /** The model's own summarized reasoning, when it is thinking. */
  note?: string;
}

export interface AssistantFocus {
  scope: "dashboard" | "tile";
  tileKind?: "builtin" | "generated";
  label?: string;    // the focused tile's title
  preview?: string;  // a short text preview of the focused tile (to disambiguate)
  path?: string | string[];  // the focused tile's data path(s), when the tile knows them
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
  required: ["kind", "answer", "edits", "tile", "column", "visibility"],
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
    /* HIDING A TILE. The target is the tile's HEADING as shown on screen, never a
       data path: the model has no reliable way to know a path, and the client already
       resolves a heading to one (findTilePath) for rule 3. Keeping this separate from
       `edits` also means hiding is not a data change and cannot be confused with one. */
    visibility: {
      type: "object", additionalProperties: false, required: ["op", "target"],
      properties: {
        op: { type: "string", enum: ["none", "hide", "show"] },
        target: { type: "string" },
      },
    },
  },
};

function buildSystem(input: AssistantInput): string {
  /* Named in the prompt so "make it a man's voice" resolves to a real id. One list, from
     the same module the picker and the call read, so the drawer cannot offer a seventh. */
  const VOICE_IDS = VOICE_OPTIONS.map((v) => `"${v.id}"`).join(", ");
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
          /* THE EXACT PATH, when the tile knows it. Do not make the model count
             array positions: it reasons about the page as RENDERED, and where render
             order and array order disagree it picks the neighbouring index and
             rewrites the wrong tile. Telling it outright is cheaper and more reliable
             than any wording about being careful, and editGuard's constrainToFocus
             still enforces it if the model ignores this line. */
          /* An ARRAY is not interpolatable. Some cards are a group of sibling fields
             (`trendTitle` + `trendChip` + `trendChart`) rather than one subtree, and
             `${f.path}` on an array produced the literal path
             "trendTitle,trendChip,trendChart" — the model dutifully used it, every
             edit fell outside the focus and was discarded. Formatted as a list. */
          f.path
            ? (Array.isArray(f.path)
                ? `THIS TILE'S DATA IS SPREAD ACROSS THESE PATHS in the JSON below: ${f.path.map((x) => `"${x}"`).join(", ")}. EVERY edit path MUST begin with one of them — nothing else on the page belongs to this tile, and any other path will be discarded. Do NOT count tiles by their position on screen.`
                : `THIS TILE'S DATA IS AT "${f.path}" in the JSON below. EVERY edit path MUST begin with "${f.path}." — for example "${f.path}.title". Do NOT count tiles by their position on screen; the array order is not the render order. Any path outside "${f.path}" will be discarded.`)
            : ``,
        ].filter(Boolean).join("\n")
      : `SCOPE: the whole "${input.dashboardTitle}" page. The user may ask about anything on it, edit a part they NAME, or reshape the overall story across several parts.`;

  return [
    `You are the "Ask AI" assistant embedded in a page of ${input.customerName}'s Invoca platform demo. The page may be a dashboard, a report, a call review, a signal list or an agent-configuration screen.`,
    scopeLine,
    ``,
    /* ⚠️ **THE VOICE WORKFLOW PAGE CARRIES ITS AGENT'S CONFIG BESIDE THE DIAGRAM**, so one
       instruction ("qualify callers by whether they own or rent, then route") has to produce
       edits to BOTH. Gated on the data actually having an `agent` key rather than on the
       pathname: the SMS workflow registers a tree with no agent slice, and telling the model
       about fields that are not in its DATA is how it invents a path and writes the edit
       somewhere else — the exact failure recorded at the SMS greeting. */
    /* ⚠️⚠️ **THE DIRECTOR BRIEF (9/3/2026): everything an SE can say about how the agent
       behaves has to land somewhere real.** This replaced a field-by-field description that
       was accurate and too timid — it told the model which paths existed and then forbade
       most of the interesting edits ("leave informSteps alone unless the user is changing
       which areas are served", "the opening question is two-way and STAYS that way"). Both
       were written to stop a WEAK model wrecking a working agent, and both stopped a strong
       one doing what was asked. The guards that actually matter are in code — `editGuard`
       refuses locked chrome and type flips, `specWithConfig` validates the voice, `toSteps`
       normalises a shape — so the prompt can now describe the machine honestly and let the
       model use it.
       ⚠️ Gated on the DATA carrying an `agent` key, not on the pathname: an SMS workflow
       registers a tree with no agent slice, and naming fields that are not in the model's
       data is how it invents a path and writes the edit somewhere else. */
    ...(isVoiceAgentPage(input.dataContext) ? [
      `THIS PAGE IS A VOICE AGENT WORKFLOW, AND YOU ARE ITS DIRECTOR. The DATA below holds BOTH the diagram and the agent's own configuration. The user will describe what they want the agent to DO, SAY, ASK or DECIDE — rarely a field name. Your job is to translate that into edits, and a real instruction usually touches SEVERAL fields in BOTH halves. Take the whole request; do not answer the easy half and stop.`,
      ``,
      `HOW A CALL IS ACTUALLY BUILT, so you can reason about what to change:`,
      `  The agent's system prompt is assembled at call time from the fields below. It opens with "agent.greeting" spoken verbatim, then follows a numbered CALL FLOW built from "agent.informSteps" and the use-case paths, and it is bound by "agent.rules", which are appended verbatim under "CONVERSATION RULES configured on this workflow". Whatever the caller says is classified onto one of the diagram's paths, and that path's "chips" are the fields the agent then collects.`,
      ``,
      `WHAT THE DIAGRAM OWNS (the routing, and what gets collected):`,
      `   - "branches[i].leaves[j].paths" — the use cases. ADD or REMOVE a path to add or remove an outcome the agent can reach. Each has "title" (how a caller in that situation sounds), "action", optional "route" (the team it hands off to, spoken aloud), and "chips".`,
      `   - "…paths[k].chips" — WHAT THE AGENT COLLECTS on that path, and the pills drawn on the node. "also get their email" = append "Consumer Email" here, NOT a new step.`,
      ``,
      `WHAT "agent" OWNS (how it talks, what it checks, how it sounds):`,
      `   - "agent.greeting" — the exact opening line, spoken word for word. "answer the phone with X" edits this.`,
      `   - "agent.qualifyQuestion" / "agent.qualifyFallback" — the question that sorts callers onto the paths, and the reprompt when the answer is unclear. You MAY rewrite either, including changing what the opening question sorts on, when that is what the user asked for. Keep it SPEAKABLE: a phone question offering six options is unusable, so sort on a small number of things and let the paths do the rest.`,
      `   - "agent.rules" — an array of plain strings, appended to the prompt verbatim. ⚠️ THIS IS YOUR GENERAL-PURPOSE CHANNEL: any behaviour with no field of its own belongs here. Tone ("be warm with anxious callers"), prohibitions ("never quote a price"), judgement ("if they mention a competitor, acknowledge it and move on"), escalation ("offer a human the moment they sound frustrated"), pacing ("one question at a time"). Add, reword, reorder and remove them freely.`,
      `   - "agent.informSteps" — the NUMBERED steps the agent works through, as an array of PLAIN STRINGS ("1. Ask the caller for their zip code."). NOT objects: never emit {step, action, description}. This is the flow itself — reorder it, add a step, drop one, rewrite all of them. Renumber them yourself. You are NOT limited to the service-area check; if the user wants the agent to qualify on budget before booking, or confirm the address back, that is a step.`,
      `   - "agent.serviceZips" — an allow-list of in-area ZIPs; absent means it serves everywhere. "only cover 30097 and 30096" CREATES it. When you create or change it, REWRITE "agent.informSteps" in the same answer so the steps describe the same policy — steps that still say the agent serves everywhere are obeyed INSTEAD of the list.`,
      `   - "agent.outOfAreaScript" — what it says to an out-of-area caller. THE SCRIPT DECIDES WHAT HAPPENS NEXT: it may turn them away, or offer the nearest location and ask if that works. Write a COMPLETE spoken line with NO fill-in placeholders — never "[CLOSEST_LOCATION]", "[NAME]" or any bracketed token, because the agent reads this out loud. If the nearest location varies by caller, say so in the steps and let the agent name it.`,
      `   - "agent.voice" — which voice it speaks in. One of exactly: ${VOICE_IDS}. "make it a man's voice" = "arcas" or "neptune"; "warmer" = "harmonia"; "calm and mature" = "athena". Any other value is ignored, so pick from that list or leave it alone.`,
      ``,
      `HOW TO ANSWER A BEHAVIOUR REQUEST WELL:`,
      `  1. Decide what the agent should DO differently on the call, in order, from hello to hand-off.`,
      `  2. Put each piece where it belongs: what it SAYS -> greeting / script; what it WORKS THROUGH -> informSteps; what it COLLECTS -> that path's chips; where it SENDS people -> paths and routes; how it BEHAVES throughout -> rules.`,
      `  3. Keep the two halves consistent. A new use case needs a path AND the chips it collects. A new policy needs the rule AND the step that enacts it. Contradictory instructions are worse than either one alone, because the agent will follow whichever it reads first.`,
      /* ⚠️ **STATED BECAUSE A LIST EDIT IS A REPLACEMENT, AND THE COST OF GETTING IT WRONG IS
         SILENT.** Every one of these is a `LENGTH_IS_CONTENT` path, so `editGuard` accepts a
         shorter array as a legitimate removal — nothing downstream can tell "the user asked me
         to drop this" from "I forgot to copy it across". The question-list rule below already
         spells the same contract out for the same reason.
         ⚠️ **THIS IS NOT A RECORD OF A BUG.** A first run appeared to show the model replacing
         a path's chips wholesale; the chips it was shown were `undefined`, because the harness
         read `u.chips` where the field is `u.collect`. Given real chips it carried them across
         correctly. The instruction is kept as a guard, not as a fix. */
      `  4. AN EDIT TO A LIST REPLACES THE WHOLE LIST, so send the COMPLETE new contents every time — everything that was already there PLUS your change. This applies to "chips", "agent.rules", "agent.informSteps", "agent.serviceZips" and "paths". Adding "Trade-In Year" to a path whose chips are ["Consumer Name","Consumer Zip"] means writing ["Consumer Name","Consumer Zip","Trade-In Year"], NEVER ["Trade-In Year"] — the short version deletes the two fields the agent was collecting and it will stop asking for them. Only leave something out when the user asked you to remove it.`,
      `  5. Carry untouched content across VERBATIM. Rewording a rule nobody asked you to touch is a bug, not an improvement.`,
      `  6. NEVER invent ZIP codes, phone numbers, addresses, prices or team names. Use only what the user gave you or what is already in the DATA.`,
      `  The trigger node, "Conversation Start", the two intent nodes and the two user-group nodes are the product's own wiring and CANNOT be renamed. If asked, say so and change the row below instead.`,
      ``,
    ] : []),
    `Choose exactly ONE action ("kind"):`,
    `1. "answer" — answer a question, or SUGGEST scenario options for the user to pick from. Concise plain text in "answer" (no markdown). Leave edits [] and tile empty (tileType:"kpi", title:"", note:"", empty arrays).`,
    `2. "create" — the user asks to ADD / create / make a NEW tile. Fill "tile" (see tile rules) and put a short confirmation in "answer". Leave edits [].`,
    ...(input.canCreateTiles === false ? [
      `OVERRIDE: this page CANNOT render a new tile, so NEVER return kind "create" here. When the user asks to ADD something (a branch, a path, a question, a row of options), return kind "editData" instead: one edit whose path is the LIST it belongs to and whose value is that WHOLE list with the new item appended, copied from the DATA below and left otherwise identical. To REMOVE something, return the same list with that item left out.`,
    ] : []),
    `3b. "setVisibility" — the user asks to REMOVE or RESTORE a whole tile ("remove the lead form tile", "drop this card", "put the region tile back"). Return "visibility": { op:"hide"|"show", target:"<the tile's exact heading as shown>" }. This HIDES a tile, it never deletes data, so it is always reversible. Leave edits [] and tile empty.`,
    `3. "editData" — the user asks to CHANGE existing page data (a named/focused BUILT-IN tile's numbers, a chart's trend, a title/label, or the whole story). Return "edits": each { path, value } where path is a DOT-PATH into the DATA JSON below (numeric array indices), and value is the JSON-ENCODED replacement (e.g. "\\"84%\\"", "1250", "[70,80,90,85,95,100]", "\\"New Title\\""). Put a confirmation in "answer". Leave tile empty.`,
    `4. "editTile" — change the focused AI-GENERATED tile: return the FULL updated spec in "tile" and a confirmation in "answer". Leave edits [].`,
    ``,
    `TILE rules (kind create/editTile): pick tileType — "kpi" (2–4 headline numbers → kpis), "line" (trend over time → xLabels + series[].values), "bar" (comparison across categories → xLabels + series[].values), "pie" (share of a whole → slices). Give a clear title + one-line note. Leave the arrays you don't use empty.`,
    ``,
    `HARD RULES:`,
    `- YOU MAY add and remove COLUMNS, TILES, chart SERIES, pie SLICES and axis POINTS, and change any number, percentage, label or title. "Show a massive dip on Jan 5th" means editing that series' value at that index.`,
    `- YOU MAY NEVER change CSS, fonts, colours, spacing, or WHICH KIND of chart a built-in tile is (a line stays a line, a pie stays a pie). Those are not data. If asked, DECLINE via "answer" and say what you can change instead.`,
    /* This line used to forbid every length change, which now CONTRADICTS the two
       capability lines above it. A self-contradicting prompt is worse than either
       rule alone: asked to add a column the model read the prohibition and refused,
       so "add a Total Calls column" came back as a plain answer. Rewritten to state
       the one thing that is still absolutely true — data only, never presentation. */
    `- You may ONLY change DATA values, never PRESENTATION. Each edit path MUST point at a scalar leaf (a value, a label, a title) or an array of numbers. When you add or remove a chart series, a slice, an axis point or a table column, keep the SHAPE consistent: one value per axis point, one cell per column. NEVER add or remove JSON keys, never replace an object with something of a different type, and never touch layout, CSS, colours, fonts or styling. If asked to restyle, recolour, resize, or change WHICH KIND of chart a built-in tile is, DECLINE via "answer" and offer what you can do instead.`,
    `- TABLE COLUMNS — you CAN add, remove, rename or move a table's columns. Two shapes qualify: the Digital Journey report ("dimensionColumns" + "rows" of interactions) and a dashboard breakdown table ("metricColumns" + "rows" with "metrics"). Return kind:"editColumn" and fill "column" ONLY; leave "edits" empty. When the user is focused on ONE table, the column op applies to THAT table.`,
    `  DO NOT copy the other columns' values. You supply only the operation; the app splices it into the existing rows and every other value is preserved automatically.`,
    `    insert — index = 0-based position the new column takes (0 puts it FIRST, left of everything). header = its name. toIndex = -1. values = ONE value per row, in the SAME order as "rows" in the DATA below. COUNT the rows and return exactly that many values. "values" MUST NOT be empty for an insert: an empty list produces a blank column and is a failed answer. This is the only part of the table you generate, so spend your effort here.`,
    `    remove — index = the column to drop. header = "", values = [], toIndex = -1.`,
    `    rename — index = the column, header = its new name. values = [], toIndex = -1.`,
    `    move   — index = the column's current position, toIndex = where it should end up. header = "", values = [].`,
    `  Values for an inserted column must fit THIS business and that specific row (a Location column on a retailer gets real cities or regions it serves, never "N/A" or a placeholder). Never touch "signalColumns" or a row's "signals": those render as check/cancel icons, not text. On a page with NEITHER "dimensionColumns" nor "metricColumns", a column change is not possible — say so in "answer" and return kind "answer".`,
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
      `- THE AGENT'S OPENING MESSAGE lives at "smsPlaybook.greeting" and is the first text the customer receives. Edit it with kind:"editData", path exactly "smsPlaybook.greeting", value a JSON string containing the full new message.`,
      `  "smsPlaybook.greeting" is the ONLY path for the opening message. NEVER write a greeting into "brandConversationRules", a qualifying question, or any other field because it looks like a plausible home for one. Those are different things and overwriting them corrupts the page.`,
      `  When the user changes the USE CASE, rewrite the greeting AND the questions together. The greeting has to carry the use case on its own, because it is often the only message a prospect reads: a re-engagement opener references the earlier conversation and asks if they are still interested, a first-contact opener introduces the business and any current offer. An opener that would fit any situation equally well is a failed answer.`,
      `  Keep it to 1-3 short sentences of plain text, no markdown and no emoji, and end by inviting a reply.`,
      `  ADDRESS THE CUSTOMER BY NAME. The greeting must contain the literal token {name}, which the app replaces with the real customer's first name at send time. Write "Hi {name}," and NEVER a specific name like "Hi Sarah,": a hard-coded name is wrong for every other customer this demo is shown to. Keep the token exactly as {name}, in the first sentence.`,
    ] : []),
    `- Be concise and professional.`,
    ``,
    `DATA (current JSON for this page):`,
    input.dataContext,
  ].join("\n");
}

export async function askAssistant(
  input: AssistantInput,
  apiKey?: string,
  onProgress?: (p: AssistantProgress) => void,
): Promise<AssistantResult> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });

  const history = (input.history ?? []).slice(-8);
  const messages = [...history, { role: "user" as const, content: input.question }];
  const system = buildSystem(input);
  const director = isVoiceAgentPage(input.dataContext);

  /* ---- the fast path, unchanged ------------------------------------------------
     Every screen but the voice workflow. One non-streaming Haiku call, no thinking, no
     effort — exactly as before, so nothing outside that page got slower or costlier. */
  if (!director) {
    const resp = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 8000,
      system,
      output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages,
    } as any);
    const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
    if (!text) throw new Error("Empty assistant response.");
    return JSON.parse(text) as AssistantResult;
  }

  /* ---- the director path -------------------------------------------------------
     ⚠️ **STREAMED, AND NOT ONLY FOR THE PROGRESS BAR.** The SDK refuses a non-streaming
     call it estimates could exceed 10 minutes, which is what `max_tokens` plus adaptive
     thinking on Opus reaches — the identical failure `engine/core.ts` records for the
     generation pipeline ("`structured()` MUST use streaming... which was silently failing
     every generation at the ops phase"). Streaming is the requirement; the progress events
     are what it makes possible.

     ⚠️ **`display: "summarized"` IS DELIBERATE.** Opus 5 defaults thinking display to
     "omitted", which streams thinking blocks with EMPTY text — so the drawer would show a
     long silent pause and a bar moving on nothing. Summarized gives the SE the model's own
     account of what it is doing, which is a real signal rather than a spinner with a
     percentage painted on it. */
  const report = (p: AssistantProgress) => { try { onProgress?.(p); } catch { /* never let a UI callback break the answer */ } };
  report({ phase: "Sending to Claude Opus", pct: 4 });

  const stream = client.messages.stream({
    model: DIRECTOR_MODEL,
    max_tokens: 16000,
    system,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high", format: { type: "json_schema", schema: RESULT_SCHEMA } },
    messages,
  } as any);

  /* ⚠️⚠️ **THE BAR IS DRIVEN BY REAL EVENTS AND APPROACHES ITS CEILING ASYMPTOTICALLY —
     it must never print 100 before the JSON has actually parsed.** The phases are true
     (thinking blocks and text blocks are distinct events on the wire); what is ESTIMATED is
     only how far through each one we are, because neither a thinking budget nor the length
     of a JSON answer is knowable in advance. So each phase creeps toward its own ceiling and
     never crosses it, and only a parsed result reports 100. Same shape as the Launch
     screen's build bar, and for the same reason: a bar that sits still reads as a hang. */
  let thought = 0, written = 0, phase: "think" | "write" = "think";
  const creep = (chars: number, from: number, to: number, half: number) =>
    from + (to - from) * (1 - Math.exp(-chars / half));

  stream.on("streamEvent", (ev: any) => {
    const d = ev?.delta;
    if (ev?.type !== "content_block_delta" || !d) return;
    if (d.type === "thinking_delta" && typeof d.thinking === "string") {
      thought += d.thinking.length;
      report({ phase: "Working out the changes", pct: creep(thought, 8, 48, 900), note: d.thinking.trim().slice(-160) });
    } else if (d.type === "text_delta" && typeof d.text === "string") {
      if (phase === "think") { phase = "write"; report({ phase: "Writing the edits", pct: 52 }); }
      written += d.text.length;
      report({ phase: "Writing the edits", pct: creep(written, 52, 94, 1200) });
    }
  });

  const resp = await stream.finalMessage();
  const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) throw new Error("Empty assistant response.");
  const parsed = JSON.parse(text) as AssistantResult;
  report({ phase: "Applying", pct: 100 });
  return parsed;
}
