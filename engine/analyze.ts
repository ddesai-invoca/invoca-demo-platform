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
  /**
   * For a BOOKING workflow: the only weekdays, times and locations an appointment may be
   * reported at.
   *
   * ⚠️ SAME REASON `destinations` EXISTS. Asked to report what the agent booked, the model
   * would otherwise paraphrase ("Thursday afternoon", "the New York store") and the Salesforce
   * Calendar would render a slot the call never offered. It picks from these and anything off
   * the list is dropped, so a stray answer produces NO booking rather than a wrong one.
   */
  bookingDays?: string[];
  bookingTimes?: string[];
  bookingLocations?: string[];
  /**
   * The prospect's own products, so a booked lead's Product of Interest is one of THEIRS.
   *
   * ⚠️ Same classify-not-extract rule as `destinations`. Asked what the caller wanted, the
   * model would otherwise write "a nice watch" into a Salesforce field that sits beside a
   * Product Category row read off the prospect's own dashboard — two rows of one section
   * disagreeing, which is the contradiction the Lead page's own notes already record.
   */
  bookingProducts?: string[];
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
  /** True only when a day AND time both matched what the agent actually offered. */
  booked?: boolean;
  bookedDay?: string;
  bookedTime?: string;
  bookedLocation?: string;
  /** 5 digits, or "" — validated, because a Lead's city and state are derived from it. */
  bookedZip?: string;
  bookedProduct?: string;
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

/** The one non-boutique "location" a booking can have. Exported so the Calendar and the
    audit use the same string the model is offered. */
export const VIRTUAL = "Virtual consultation";

const OUTCOME_PROPS = {
  transferred: { type: "boolean" },
  routedTo: { type: "string" },
  callerName: { type: "string" },
  intent: { type: "string" },
  location: { type: "string" },
  /* A booking workflow's outcome. Flat rather than a nested object because a strict
     structured-output schema has no optionals — the same constraint that made `VOICE_SCHEMA`
     its own object instead of sharing one with `outcome` marked optional. */
  booked: { type: "boolean" },
  bookedDay: { type: "string" },
  bookedTime: { type: "string" },
  bookedLocation: { type: "string" },
  /* The caller's OWN ZIP, which is what a Lead record's address is built from. Kept apart
     from `location` because that field is free text and has come back as a city, a ZIP or a
     boutique depending on the call. */
  bookedZip: { type: "string" },
  bookedProduct: { type: "string" },
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
      required: ["transferred", "routedTo", "callerName", "intent", "location", "booked", "bookedDay", "bookedTime", "bookedLocation", "bookedZip", "bookedProduct"],
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

/**
 * Match a booked location against the allow-list, tolerating the article the agent SAYS.
 *
 * ⚠️⚠️ **AN EXACT MATCH WAS TOO LITERAL AND SILENTLY LOST THE BOUTIQUE — measured, not
 * imagined.** On a real transcript the agent said "at our New York boutique" while the list
 * holds "the New York boutique", so a strict comparison dropped it to "" and the Salesforce
 * chip lost the one detail that proves the caller's ZIP decided anything. The article and any
 * possessive are exactly what a speaking agent varies, so they are normalised away — while
 * the PLACE still has to match one on the list, so an invented location is still refused.
 */
export function matchLocation(answer: string, locs: string[]): string {
  const a = answer.trim();
  if (!a) return "";
  if (a === VIRTUAL) return VIRTUAL;
  const norm = (x: string) => x.trim().toLowerCase().replace(/^(the|our|a)\s+/, "");
  if (norm(a) === norm(VIRTUAL)) return VIRTUAL;
  return locs.find((l) => norm(l) === norm(a)) ?? "";
}

export async function analyzeSms(input: AnalyzeInput, apiKey?: string): Promise<AnalyzeResult> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });

  const bookingTerm = input.bookingTerm || "Consultation";
  const customerNoun = input.customerNoun || "Customer";
  const voice = input.channel === "voice";
  const dests = (input.destinations ?? []).map((x) => String(x).trim()).filter(Boolean);
  const days = (input.bookingDays ?? []).map((x) => String(x).trim()).filter(Boolean);
  const times = (input.bookingTimes ?? []).map((x) => String(x).trim()).filter(Boolean);
  const locs = (input.bookingLocations ?? []).map((x) => String(x).trim()).filter(Boolean);
  const prods = (input.bookingProducts ?? []).map((x) => String(x).trim()).filter(Boolean);
  const medium = voice ? "phone call" : "SMS conversation";
  const convo = input.transcript.map((t) => `${t.speaker === "agent" ? "Agent" : "Customer"}: ${t.text}`).join("\n");

  const prompt =
    `Extract the Invoca "signals" (detections) present in this ${medium} between ${input.customerName}'s AI agent and a customer.\n\n` +
    `CONVERSATION:\n${convo}\n\n` +
    `Return 6–8 signals. Each: name, badges (a subset of ["Keyword Spotting","Rule","Keypress"]), count (integer 0–3; use 0 to hide the trailing count).\n` +
    `Base every signal on what ACTUALLY happened in the conversation. Include when applicable:\n` +
    `- "${bookingTerm}: Scheduled" (["Keyword Spotting","Rule"], count 0) if a booking was made\n` +
    `- "Caller Type: New ${customerNoun}" (["Keyword Spotting","Rule"], count 1)\n` +
    `- "Qualified Lead" (["Rule"], count 0)\n` +
    /* ⚠️ NO "(QA) …" SIGNALS. This analyses a conversation an AI agent handled, so human
       agent-quality scoring does not apply — asked for 9/3/2026. The slots they used to take go to
       signals grounded in the conversation instead, which is what an SE can actually point at. Both AI
       CI screens ALSO strip them on read (src/data/aiSignals.ts), so a stale response cannot show one. */
    `- 3–5 signals for what the agent established: the qualifying answers it captured, the product or
       service the customer named, any estimate or offer it gave, a service area it confirmed
       (["Keyword Spotting"], count 0).` +
    (voice
      ? `\n\nALSO return "outcome" describing how the call ended:\n` +
        `- transferred: true ONLY if the agent actually handed the caller off to a team or department at the end. False if the call ended any other way, including the agent turning the caller away as out of area, the caller hanging up, or the conversation simply stopping.\n` +
        (dests.length
          ? `- routedTo: which of these departments the call was handed to. Copy ONE of them EXACTLY, character for character: ${dests.map((x) => `"${x}"`).join(", ")}. The agent will have said it in its own words ("our support team"), so match on MEANING, not wording. Use "" only if the call was not transferred at all. Never return a name that is not in this list.\n`
        + (days.length
          ? `- booked: true ONLY if the agent clearly CONFIRMED an appointment at the end (it will have said the appointment is booked). False otherwise, including a call that discussed times and never confirmed one.\n`
            + `- bookedDay: the weekday of the confirmed appointment. Copy ONE of these EXACTLY: ${days.map((x) => `"${x}"`).join(", ")}. Use "" if nothing was confirmed.\n`
            + `- bookedTime: the time of the confirmed appointment. Copy ONE of these EXACTLY: ${times.map((x) => `"${x}"`).join(", ")}. Use "" if nothing was confirmed.\n`
            + `- bookedLocation: where it was booked. Copy ONE of these EXACTLY: ${locs.map((x) => `"${x}"`).join(", ")}${locs.length ? ", " : ""}or "${VIRTUAL}" if the agent booked a virtual consultation instead. Use "" if nothing was confirmed.\n`
            + `- bookedZip: the caller's OWN 5-digit ZIP code, exactly as they said it. "" if they never gave one.\n`
            + (prods.length
              ? `- bookedProduct: what the caller is interested in. Copy ONE of these EXACTLY: ${prods.map((x) => `"${x}"`).join(", ")}. Match on MEANING (a caller saying "a Daytona" means the Rolex line). Use "" if they named nothing.\n`
              : `- bookedProduct: "".\n`)
          : `- booked: false, bookedDay: "", bookedTime: "", bookedLocation: "" — this workflow does not book appointments.\n`)
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
          /* ⚠️⚠️ **A BOOKING IS ONLY REAL IF BOTH THE DAY AND THE TIME CAME BACK FROM THE
             LISTS.** The Salesforce Calendar renders this, so a paraphrase ("Thursday
             afternoon") would put an appointment on screen at a time the call never offered —
             the fabricated-evidence failure `audit:tiers` exists to catch, one screen over.
             Anything unmatched collapses the whole booking to false. */
          ...(() => {
            const day = days.includes(String(o.bookedDay ?? "").trim()) ? String(o.bookedDay).trim() : "";
            const time = times.includes(String(o.bookedTime ?? "").trim()) ? String(o.bookedTime).trim() : "";
            const locRaw = String(o.bookedLocation ?? "").trim();
            const loc = matchLocation(locRaw, locs);
            const booked = o.booked === true && !!day && !!time;
            /* The ZIP is a Lead's address, so it is only accepted in the shape one really is. */
            const zipRaw = String(o.bookedZip ?? "").trim();
            const zip = /^\d{5}$/.test(zipRaw) ? zipRaw : "";
            const prodRaw = String(o.bookedProduct ?? "").trim();
            const norm = (x: string) => x.trim().toLowerCase();
            const prod = prods.find((x) => norm(x) === norm(prodRaw)) ?? "";
            return booked
              ? { booked: true, bookedDay: day, bookedTime: time, bookedLocation: loc, bookedZip: zip, bookedProduct: prod }
              : { booked: false };
          })(),
        }
      : undefined;
  return { signals, outcome };
}
