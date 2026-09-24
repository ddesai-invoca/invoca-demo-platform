/* =============================================================================
   genContext.ts — the extra context an SE can steer a generation with
   -----------------------------------------------------------------------------
   Asked for 9/10/2026 as an "Advanced Settings" panel on the launch form: a
   custom prompt ("use healthcare language instead of sales"), an uploaded or
   linked strategy doc, and context pulled from Gong / Slack / Drive.

   ⚠️⚠️ THREE ASKS, ONE PATH — AND THAT IS THE WHOLE DESIGN. A typed prompt, the
   text of a strategy doc, and whatever an integration returns are all the same
   thing to the model: extra context that steers vocabulary, emphasis and which
   signals / agents / dashboards get built. Building three plumbing paths would
   mean three places to thread through 20 phases, three places to get the
   precedence wording wrong, and three places to audit. They converge here.

   ⚠️⚠️ IT REACHES THE MODEL BY BEING APPENDED TO THE RESEARCH BRIEF, WHICH IS
   ALREADY THREADED INTO ALL 20 PHASES. `research()` returns a string that 19
   phases interpolate as `BRIEF:\n${brief}` and `generateTerms` takes as its
   third argument — so appending to it reaches every phase with ZERO changes to
   any phase signature. The alternatives were both worse: threading a parameter
   through 18 generate* functions and their 20 `structured()` calls, or a
   module-level global, which would leak one SE's custom prompt into a
   concurrent generation (two SEs on the live server, or the nightly canary
   overlapping a real one). `brief` is a per-generation local, so it cannot.

   ⚠️ TERMS MUST SEE IT, which is why it is appended BEFORE `generateTerms` runs
   rather than just before the pool. "Use healthcare language" has to reach the
   phase that picks `bookingTerm` and `customerNoun` — otherwise the vocabulary
   is decided as "Purchase"/"Customer" and then threaded, unchanged, into every
   screen no matter what the rest of the prompts were told.
   ============================================================================= */

/** One piece of context and where it came from, so the prompt can say so and the
 *  profile can record it. `label` is shown to the model: a strategy doc's own
 *  filename and a Gong brief carry different authority and it should know which
 *  it is reading. */
export interface ContextSource {
  /** "Q4 strategy.docx", "Gong — account brief", "Slack #acme-deal" */
  label: string;
  text: string;
}

export interface GenerationContext {
  /** The SE's typed instruction. */
  steer?: string;
  /** Documents and integration pulls, already reduced to text. */
  sources?: ContextSource[];
}

/** Which slices a generation builds. "agent" is Agent Studio only. */
export type GenerationScope = "full" | "agent";

/* ⚠️ PER-SOURCE CAP, NOT ONE TOTAL. A 40-page strategy doc would otherwise crowd
   out the research brief in every one of the 20 prompts, and the brief is what
   makes the demo about the right business at all. Capped per source so one long
   document cannot starve the others either. Generous enough for a strategy doc's
   substance (~8k chars is roughly 3–4 pages of prose). */
const MAX_SOURCE_CHARS = 8_000;
const MAX_STEER_CHARS = 2_000;
const MAX_SOURCES = 6;

const clip = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max)}\n[…truncated at ${max} characters]`;

/** True when there is anything to say — lets the caller skip the block entirely
 *  rather than appending an empty header to every prompt. */
export function hasContext(ctx: GenerationContext | undefined): boolean {
  return !!(ctx?.steer?.trim() || ctx?.sources?.some((s) => s.text?.trim()));
}

/**
 * Render the operator context as a block to append to the research brief.
 *
 * ⚠️⚠️ THE PRECEDENCE SENTENCE IS LOAD-BEARING, NOT POLITENESS. `reskin()` already
 * tells every phase to keep each section's STRUCTURE identical — same column,
 * tile, row and series counts. A custom prompt saying "add a column for
 * insurance type" or "make it a 90-day range" fights that directly, and this
 * file's own history records the outcome: *"a self-contradicting prompt is worse
 * than either rule"* — the model picks one at random and you cannot tell which.
 * So the block states outright that it steers WORDING, EMPHASIS and CONTENT
 * CHOICES, and that the structural rules win where they disagree.
 */
export function contextBlock(ctx: GenerationContext | undefined): string {
  if (!hasContext(ctx)) return "";
  const parts: string[] = ["\n\n=== OPERATOR CONTEXT ==="];

  if (ctx?.steer?.trim()) {
    parts.push(
      `The sales engineer requesting this demo asked for:`,
      clip(ctx.steer.trim(), MAX_STEER_CHARS),
    );
  }

  const sources = (ctx?.sources ?? []).filter((s) => s.text?.trim()).slice(0, MAX_SOURCES);
  for (const s of sources) {
    parts.push(`\n--- ${s.label} ---`, clip(s.text.trim(), MAX_SOURCE_CHARS));
  }

  parts.push(
    `\n=== HOW TO USE THE OPERATOR CONTEXT ===`,
    `Let it decide WORDING and CONTENT: the vocabulary this vertical uses, which call reasons and signals matter, whether the AI agent story is SMS or voice, which products and locations appear, and what the conversation is really about.`,
    /* Named individually because "follow the structural rules" is easy to nod at
       and ignore; a count is checkable. */
    `Do NOT let it change STRUCTURE: keep the same number of columns, KPI tiles, table rows and chart series that the instructions elsewhere in this prompt specify. Where the operator context and those structural rules disagree, THE STRUCTURAL RULES WIN.`,
    `Do NOT quote it back verbatim, and do NOT invent facts it does not contain — it is background for choosing among plausible options, not source data to copy.`,
  );
  return parts.join("\n");
}

/**
 * Read the Advanced Settings off a `POST /api/generate` body.
 *
 * ⚠️ ONE PARSER, TWO SERVERS. `server.ts` and the `vite.config.ts` dev twin both
 * mount this endpoint, and this repo's standing rule is that the two must not
 * drift — a field one accepts and the other silently ignores is a feature that
 * works in dev and does nothing in production, or the reverse.
 *
 * ⚠️ VALIDATED, NOT TRUSTED. This is a request boundary: `scope` is an
 * allow-list (anything else falls back to a FULL generation, because silently
 * skipping 13 phases is the more damaging way to be wrong), and every string is
 * clamped so a pasted book cannot push the research brief out of the prompts.
 */
export function parseGenerationRequest(body: any): { context: GenerationContext; scope: GenerationScope } {
  const steer = typeof body?.steer === "string" ? body.steer.trim().slice(0, MAX_STEER_CHARS) : "";
  const raw = Array.isArray(body?.sources) ? body.sources : [];
  const sources: ContextSource[] = raw
    .filter((s: any) => s && typeof s.text === "string" && s.text.trim())
    .slice(0, MAX_SOURCES)
    .map((s: any) => ({
      label: (typeof s.label === "string" && s.label.trim() ? s.label.trim() : "Attached document").slice(0, 120),
      text: s.text.slice(0, MAX_SOURCE_CHARS),
    }));
  return {
    context: { ...(steer ? { steer } : {}), ...(sources.length ? { sources } : {}) },
    scope: body?.scope === "agent" ? "agent" : "full",
  };
}

/** What went into a generation, recorded on the profile. Text is deliberately
 *  NOT kept — only labels, so a demo does not carry a copy of a strategy doc
 *  around in a record the whole team can read. */
export function contextProvenance(ctx: GenerationContext | undefined, scope: GenerationScope) {
  return {
    at: new Date().toISOString(),
    scope,
    ...(ctx?.steer?.trim() ? { steer: clip(ctx.steer.trim(), MAX_STEER_CHARS) } : {}),
    ...((ctx?.sources ?? []).length
      ? { sources: (ctx!.sources ?? []).filter((s) => s.text?.trim()).slice(0, MAX_SOURCES).map((s) => s.label) }
      : {}),
  };
}
