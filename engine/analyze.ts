/* =============================================================================
   analyze.ts — fast signal extraction for a live captured conversation
   -----------------------------------------------------------------------------
   When the SE ends a Preview Agent session (SMS chat or Voice call), the just-had
   transcript is sent here and Haiku (fast) extracts the Invoca "signals" for the
   AI SMS / AI Voice Conversation Intelligence report's Analysis tab. The channel
   ("sms" | "voice") only tunes the prompt wording. Server-side; key never in the
   browser. */

import Anthropic from "@anthropic-ai/sdk";

const FAST_MODEL = "claude-haiku-4-5-20251001";

export interface AnalyzeInput {
  customerName: string;
  bookingTerm?: string;
  customerNoun?: string;
  channel?: "sms" | "voice";
  /**
   * Voice only: the departments this workflow can route to.
   *
   * ⚠️⚠️ **WITHOUT THIS, `routedTo` IS THE AGENT'S PARAPHRASE AND NOT A REAL QUEUE.** Measured:
   * a Marriott cancellation transferred to "Guest Support, Existing Reservation" came back as
   * "our support team", because that is what the agent said out loud — the naming rule
   * deliberately keeps it speakable. The routing demo then drew a FOURTH queue with that name
   * beside the real one. Handing the list over turns this from extraction into classification,
   * so the answer is always a department the workflow actually has.
   */
  destinations?: string[];
  transcript: { speaker: "consumer" | "agent"; text: string }[];
}
export interface Signal {
  name: string;
  badges: string[];
  count: number;
}

/**
 * How a VOICE call ended, extracted from the same pass that reads the signals.
 *
 * ⚠️⚠️ **THIS IS A MODEL JUDGEMENT ON PURPOSE, NOT A REGEX OVER THE AGENT'S LAST LINE.** The
 * obvious implementation is to look for "transferring you" in the closing turn. This repo has
 * already been bitten twice by reading model prose that way: the Salesforce appointment slot
 * (recorded as "breaks the first time a model phrases it differently") and the Comfort Keepers
 * simulator, which false-failed 5 runs in 6 because the agent used a curly apostrophe. The
 * artifacts built from this NAME A DEPARTMENT on screen, so a wrong reading is worse than no
 * artifact at all.
 *
 * ⚠️ **AND IT COSTS NO EXTRA CALL.** `/api/analyze` already runs once when a call ends; this
 * rides along in the same request.
 */
export interface VoiceOutcome {
  /** True ONLY if the agent actually handed the caller to a team at the end. */
  transferred: boolean;
  /** The team named on transfer, verbatim. "" when nobody was routed. */
  routedTo: string;
  /** The caller's name if they gave one, else "". */
  callerName: string;
  /** One short line: what the caller wanted. */
  intent: string;
  /** ZIP, city or destination if the caller gave one, else "". */
  location: string;
}

export interface AnalyzeResult {
  signals: Signal[];
  /** Voice only. Absent for SMS, and absent when the model could not read the call. */
  outcome?: VoiceOutcome;
}

const OUTCOME_PROPS = {
  transferred: { type: "boolean" },
  routedTo: { type: "string" },
  callerName: { type: "string" },
  intent: { type: "string" },
  location: { type: "string" },
};

/* Strict structured output has no optionals, so the VOICE schema is its own object rather than
   a shared one with `outcome` marked optional. */
const VOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals", "outcome"],
  properties: {
    signals: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["name", "badges", "count"],
      properties: { name: { type: "string" }, badges: { type: "array", items: { type: "string" } }, count: { type: "number" } } } },
    outcome: { type: "object", additionalProperties: false,
      required: ["transferred", "routedTo", "callerName", "intent", "location"],
      properties: OUTCOME_PROPS },
  },
};

const SIGNALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals"],
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "badges", "count"],
        properties: {
          name: { type: "string" },
          badges: { type: "array", items: { type: "string" } },
          count: { type: "number" },
        },
      },
    },
  },
};

/** The model's answer, held to the list it was given. */
function matchDestination(answer: string, dests: string[]): string {
  if (!dests.length) return answer;
  const norm = (x: string) => x.trim().toLowerCase();
  return dests.find((d) => norm(d) === norm(answer)) ?? "";
}

export async function analyzeSms(input: AnalyzeInput, apiKey?: string): Promise<AnalyzeResult> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });

  const bookingTerm = input.bookingTerm || "Consultation";
  const customerNoun = input.customerNoun || "Customer";
  const voice = input.channel === "voice";
  const dests = (input.destinations ?? []).map((x) => String(x).trim()).filter(Boolean);
  const medium = voice ? "phone call" : "SMS conversation";
  const convo = input.transcript.map((t) => `${t.speaker === "agent" ? "Agent" : "Customer"}: ${t.text}`).join("\n");

  const prompt =
    `Extract the Invoca "signals" (detections) present in this ${medium} between ${input.customerName}'s AI agent and a customer.\n\n` +
    `CONVERSATION:\n${convo}\n\n` +
    `Return 6–8 signals. Each: name, badges (a subset of ["Keyword Spotting","Rule","Keypress"]), count (integer 0–3; use 0 to hide the trailing count).\n` +
    `Base every signal on what ACTUALLY happened in the conversation. Include when applicable:\n` +
    `- "(QA) Proper Greeting" and "(QA) Proper Close" (["Keyword Spotting","Rule"], count 1)\n` +
    `- "${bookingTerm}: Scheduled" (["Keyword Spotting","Rule"], count 0) if a booking was made\n` +
    `- "Caller Type: New ${customerNoun}" (["Keyword Spotting","Rule"], count 1)\n` +
    `- "Qualified Lead" (["Rule"], count 0)\n` +
    `- 1–3 product/intent signals naming what the customer was interested in (["Keyword Spotting"], count 0).` +
    (voice
      ? `\n\nALSO return "outcome" describing how the call ended:\n` +
        `- transferred: true ONLY if the agent actually handed the caller off to a team or department at the end. False if the call ended any other way, including the agent turning the caller away as out of area, the caller hanging up, or the conversation simply stopping.\n` +
        (dests.length
          ? `- routedTo: which of these departments the call was handed to. Copy ONE of them EXACTLY, character for character: ${dests.map((x) => `"${x}"`).join(", ")}. The agent will have said it in its own words ("our support team"), so match on MEANING, not wording. Use "" only if the call was not transferred at all. Never return a name that is not in this list.\n`
          : `- routedTo: the team the agent named on transfer, copied VERBATIM from what the agent said. "" if nobody was routed. Do NOT invent a department name.\n`) +
        `- callerName: the caller's name if they gave one, else "".\n` +
        `- intent: ONE SENTENCE naming what the caller wanted, in this business's own words, specific enough for the receiving rep to open with. Not a two-word label.\n` +
        `- location: the ZIP code, city or destination the caller gave, else "".`
      : ``);

  const resp = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: voice ? VOICE_SCHEMA : SIGNALS_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  } as any);
  const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) return { signals: [] };
  const parsed = JSON.parse(text);
  const signals: Signal[] = Array.isArray(parsed?.signals) ? parsed.signals : [];
  if (!voice) return { signals };
  const o = parsed?.outcome;
  /* ⚠️ FAIL CLOSED. A missing or malformed outcome yields NO outcome, so the caller shows no
     artifacts rather than artifacts naming a department nobody was sent to. */
  const outcome: VoiceOutcome | undefined =
    o && typeof o.transferred === "boolean"
      ? {
          transferred: o.transferred,
          /* ⚠️ ENFORCED, NOT JUST ASKED FOR — the same instruct-then-enforce pairing the dash
             rule and the edit guard use. A name outside the list is dropped to "", which makes
             the call read as untransferred and produces no artifacts, rather than one naming a
             department this workflow does not have. */
          routedTo: matchDestination(String(o.routedTo ?? "").trim(), dests),
          callerName: String(o.callerName ?? "").trim(),
          intent: String(o.intent ?? "").trim(),
          location: String(o.location ?? "").trim(),
        }
      : undefined;
  return { signals, outcome };
}
