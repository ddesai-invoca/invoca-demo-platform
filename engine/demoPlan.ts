import Anthropic from "@anthropic-ai/sdk";

/* =============================================================================
   demoPlan.ts — read an SE's custom prompt back to them BEFORE spending 3 minutes
   -----------------------------------------------------------------------------
   Asked for 10/9/2026: *"I want you to confirm with them your understanding of what
   they are asking. Once they hit Confirm, then generate, so they're not having to
   waste their time."*

   ⚠️⚠️ **THE PLAN IS THE CONTRACT, NOT A SUMMARY.** It would be cheaper to paraphrase
   the prompt in a sentence and generate — and that is exactly the version that wastes
   the three minutes it exists to save, because "I'll make it healthcare-flavoured" is
   agreeable right up to the point where the dashboard was not what you meant. So each
   item names ONE surface and carries the instruction that will actually be sent to
   that surface's Ask AI. What you confirm is what runs.

   ⚠️⚠️ **TWO HALVES, AND THEY REACH THE DEMO BY DIFFERENT ROADS.** `steer` rides the
   research brief into all 20 generation phases (see `genContext.ts`) and decides
   WORDING and CONTENT while the work is being done. `items` are applied AFTERWARDS,
   through the same `applyEdits` path Ask AI uses, and are the only way to reach
   anything structural. Asking one model call for both is deliberate: they are two
   views of one request, and splitting them across two calls is how they come to
   disagree about what was asked.

   ⚠️⚠️ **`cannot` IS NOT POLITENESS EITHER.** Design, colours, fonts, spacing and a
   built-in tile's chart TYPE are not editable by anything in this platform — not by
   Ask AI, not by this. That is structural (`editGuard` drops it, and no data value
   reaches a className), so a prompt asking for it will silently do nothing. Saying so
   on the confirm screen is the difference between an SE rewording their request and
   an SE concluding the feature is broken.
   ============================================================================= */

const MODEL = "claude-opus-5";

/** A surface the plan may target. Mirrors `src/data/demoSurfaces.ts`, passed IN rather
 *  than imported: that module reaches React-side code, and this one runs on the server.
 *  The CLIENT owns the catalogue because it owns the bases. */
export interface PlanSurface { id: string; label: string; what: string }

export interface PlanItem {
  /** A `PlanSurface.id`. Anything else is dropped — see `sanitizePlan`. */
  surface: string;
  /** What the SE will read on the confirm screen. */
  says: string;
  /** What is actually sent to that surface's assistant. */
  instruction: string;
}

export interface DemoPlan {
  /** The request in our words, one or two sentences. */
  understood: string;
  /** Appended to the research brief; steers the generation itself. */
  steer: string;
  items: PlanItem[];
  /** Parts of the request this platform cannot do, said plainly. */
  cannot: string[];
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["understood", "steer", "items", "cannot"],
  properties: {
    understood: { type: "string" },
    steer: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["surface", "says", "instruction"],
        properties: {
          surface: { type: "string" },
          says: { type: "string" },
          instruction: { type: "string" },
        },
      },
    },
    cannot: { type: "array", items: { type: "string" } },
  },
} as const;

export interface PlanInput {
  prospect: string;
  url: string;
  prompt: string;
  surfaces: PlanSurface[];
  /** True when one prompt is being planned for a whole roster, so the plan must not
   *  name one company's products or city. */
  bulk?: boolean;
}

/* ⚠️ CAPS, FOR THE SAME REASON `genContext.ts` HAS THEM: this text is pasted by a human
   and ends up inside prompts that already carry a research brief. A book here would push
   the brief out of every one of them. */
const MAX_PROMPT = 4_000;
const MAX_ITEMS = 10;

function buildSystem(input: PlanInput): string {
  const lines: string[] = [
    `You are planning a sales-demo build for the Invoca demo platform.`,
    ``,
    input.bulk
      ? `A sales engineer is about to generate a WHOLE ROSTER of prospect demos and has written one instruction that applies to every one of them.`
      : `A sales engineer is about to generate a demo for "${input.prospect}" (${input.url}) and has written an instruction for how they want it built.`,
    ``,
    `Turn their instruction into a PLAN they will read and confirm before anything runs. Return JSON only.`,
    ``,
    `=== THE TWO HALVES OF A PLAN ===`,
    `"steer": one paragraph appended to the research brief that every generation phase reads. It decides WORDING, VOCABULARY and CONTENT: which vertical's language the whole demo uses, which call reasons and signals matter, what the agents talk about, which products and locations appear. It CANNOT change how many columns, tiles, rows or chart series a screen has; the templates win there, and saying otherwise produces a prompt that contradicts itself. Leave it an empty string if the request is purely about editing specific screens after the fact.`,
    ``,
    `"items": edits applied to specific screens AFTER the demo generates, through the same assistant an SE would otherwise open on each screen by hand. This is the only way to reach anything structural: adding a branch to a workflow, adding or removing a tile or a table column, rewriting what a report lists. One item per screen. At most ${MAX_ITEMS}.`,
    ``,
    `=== THE SCREENS YOU MAY TARGET ===`,
    `Use the id exactly. A screen not on this list does not exist for this prospect, so never invent one.`,
    ...input.surfaces.map((s) => `- ${s.id} (${s.label}): ${s.what}`),
    ``,
    `=== WHAT AN ITEM'S "instruction" HAS TO BE ===`,
    `It is sent verbatim to that screen's assistant, which sees that screen's data and nothing else. So write it as a direct instruction to someone looking at that one screen, naming the concrete change. "Open by asking which pest the caller is seeing, then their ZIP" is usable; "make the SMS agent better for pest control" is not.`,
    `"says" is the same change in one short line for the person confirming it.`,
    ``,
    `=== WHAT THIS PLATFORM CANNOT DO ===`,
    `Put anything in the request that falls under these into "cannot", in plain language, and do NOT write an item for it:`,
    `- Design: colours, fonts, spacing, layout, dark mode, "make it look like <brand>". None of it is editable by any path, so an item asking for it would silently do nothing.`,
    `- Changing which KIND of chart a built-in tile is (a donut cannot become a line).`,
    `- Renaming the locked workflow chrome: "Triggered by", "Conversation Start", "Sales Inquiry", "Need Support", "All Sales Inquiry Users", "All Support Users".`,
    `- Anything needing real data from a real system: live CRM records, real call recordings, a real integration firing.`,
    `If the request is entirely doable, return an empty "cannot" array.`,
    ``,
    `=== RULES ===`,
    `1. Cover the whole request. If they asked for three things, the plan has all three.`,
    `2. Never invent a requirement they did not state. A short prompt gets a short plan.`,
    /* ⚠️⚠️ **MEASURED, NOT ANTICIPATED.** The first real run of this returned a plan whose
       "understood" promised "three targeted edits" and whose "items" array was EMPTY, so
       the confirm screen described changes and then listed none. That contradiction reads
       as the feature being broken, and it is the exact shape of the silent no-op this
       whole feature exists to remove. The rule is explicit because the model will
       otherwise narrate its intent rather than its output. */
    `3. "understood" is one or two sentences in plain English, addressed to them, describing what you are about to build. No preamble, no restating these instructions. It must describe ONLY what this plan actually contains: if you write no items, do not say you are going to change specific screens, and if you put something in "cannot" do not describe it as something you will do.`,
    /* ⚠️ The standing rule, and it applies to anything a person reads: a dash joining two
       clauses is the single clearest tell that a machine wrote the sentence. */
    `4. Never use an em dash or an en dash anywhere in your output. Use a comma, a full stop or a colon.`,
  ];
  if (input.bulk) {
    lines.push(
      `5. This one plan runs for EVERY prospect in the roster, so it must not name a specific company, product, city or person. Write it so it reads correctly whichever prospect it lands on.`,
    );
  }
  return lines.join("\n");
}

/* ⚠️⚠️ VALIDATED, NOT TRUSTED, AND THE SURFACE CHECK IS THE ONE THAT MATTERS. An item
   naming a surface that does not exist would be shown on the confirm screen as a change
   that is going to happen and then silently apply to nothing — the "reported success,
   changed nothing" shape this repo has recorded six times. Dropped here, where there is
   still a list to check against. */
export function sanitizePlan(raw: unknown, surfaces: PlanSurface[]): DemoPlan {
  const ids = new Set(surfaces.map((s) => s.id));
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const seen = new Set<string>();
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((i: any) => ({
      surface: str(i?.surface, 60),
      says: str(i?.says, 300),
      instruction: str(i?.instruction, 1500),
    }))
    /* One item per surface: two instructions for one screen would run as two
       assistant calls against the same key, and the second would be applied on top of
       a base the first had already replaced. */
    .filter((i) => ids.has(i.surface) && i.instruction && !seen.has(i.surface) && seen.add(i.surface))
    .slice(0, MAX_ITEMS);
  return {
    understood: str(o.understood, 1200),
    steer: str(o.steer, 2000),
    items,
    cannot: (Array.isArray(o.cannot) ? o.cannot : []).map((c) => str(c, 300)).filter(Boolean).slice(0, 8),
  };
}

export async function planDemo(input: PlanInput, apiKey?: string): Promise<DemoPlan> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const prompt = (input.prompt ?? "").trim().slice(0, MAX_PROMPT);
  if (!prompt) throw new Error("Write what you want this demo to do first.");
  if (!input.surfaces.length) throw new Error("No screens are available to plan against.");

  const client = new Anthropic({ apiKey: key, maxRetries: 3 });
  /* ⚠️ STREAMED for the same reason every other Opus call here is: the SDK refuses a
     non-streaming request it estimates could exceed 10 minutes, which adaptive thinking
     plus this max_tokens reaches. See the note in `assistant.ts`. */
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system: buildSystem({ ...input, prompt }),
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  } as any);

  const resp = await stream.finalMessage();
  const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) throw new Error("The planner returned nothing. Try again.");
  return sanitizePlan(JSON.parse(text), input.surfaces);
}
