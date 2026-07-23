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
  transcript: { speaker: "consumer" | "agent"; text: string }[];
}
export interface Signal {
  name: string;
  badges: string[];
  count: number;
}

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

export async function analyzeSms(input: AnalyzeInput, apiKey?: string): Promise<Signal[]> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });

  const bookingTerm = input.bookingTerm || "Consultation";
  const customerNoun = input.customerNoun || "Customer";
  const medium = input.channel === "voice" ? "phone call" : "SMS conversation";
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
    `- 1–3 product/intent signals naming what the customer was interested in (["Keyword Spotting"], count 0).`;

  const resp = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: SIGNALS_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  } as any);
  const text = (resp.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.signals) ? parsed.signals : [];
}
