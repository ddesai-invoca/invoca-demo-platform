/* =============================================================================
   chat.ts — the live agent conversation engine (SMS + Voice)
   -----------------------------------------------------------------------------
   Powers the iPhone "Preview Agent" SMS chat and — with { voice: true } — the
   live Voice-agent phone call. Given a compact "brain" (the agent's brand rules
   + Q&A pairs + knowledge, all built at profile-generation time) and the
   conversation so far, it returns the agent's next reply. The two channels are
   DIFFERENT use cases: SMS is a SALES flow (qualify → quote → book a
   consultation); Voice is QUALIFY-AND-ROUTE (gather a couple of details, then
   hand the caller to the right team — never sell, quote, or resolve).

   Uses the FASTEST model (Haiku) so replies feel instant — critical for a live
   phone call. The API key stays server-side (called from the Vite dev endpoint
   / never in the browser).
   ============================================================================= */

import Anthropic from "@anthropic-ai/sdk";

const CHAT_MODEL = "claude-haiku-4-5-20251001";

export interface SmsPlaybook {
  goal: string;
  bookingType: string;            // "virtual consultation" | "in-home estimate" | "showroom tour" | "test drive" | "appointment" …
  offer: string;
  providesEstimate: boolean;
  qualifyingQuestions: string[];
}
export interface ChatBrain {
  customerName: string;
  industry?: string;
  rules?: string[];
  qaPairs?: { question: string; answer: string }[];
  knowledge?: string[];
  playbook?: SmsPlaybook;
  serviceArea?: string;   // voice: gate new orders by ZIP (empty/absent = no geo limit)
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystem(brain: ChatBrain, voice: boolean): string {
  const rules = (brain.rules ?? []).map((r) => `- ${r}`).join("\n");
  const qa = (brain.qaPairs ?? [])
    .map((p) => `Q: ${p.question}\nA: ${p.answer}`)
    .join("\n\n");
  const knowledge = (brain.knowledge ?? []).map((k) => `- ${k}`).join("\n");

  // Voice and SMS are DIFFERENT use cases:
  //   • Voice = qualify-and-ROUTE (never sell, quote, or resolve — hand off)
  //   • SMS   = SALES: qualify → quote → book a consultation
  if (voice) return buildVoiceSystem(brain, rules, knowledge);

  // ---- SMS sales / quote / book flow -------------------------------------
  // The playbook is chosen per prospect from research; fall back to sensible
  // generics so the agent still works if a profile lacks one.
  const p = brain.playbook;
  const bookingType = p?.bookingType?.trim() || "appointment";
  const goal = p?.goal?.trim() || `answer questions, qualify the customer, and schedule a ${bookingType}`;
  const offer = p?.offer?.trim() || "";
  const providesEstimate = p?.providesEstimate ?? false;
  const questions = p?.qualifyingQuestions?.length
    ? p.qualifyingQuestions
    : ["what they're looking for and any key details", "their timeline", "their ZIP code, to confirm service availability"];
  const qList = questions.map((q) => `   • ${q}`).join("\n");

  return [
    `You are the SMS sales assistant for ${brain.customerName}${brain.industry ? `, a ${brain.industry} business` : ""}.`,
    `You are texting a prospective customer. Your goal: ${goal}.`,
    ``,
    `CONVERSATION FLOW — follow this path start to finish, but adapt naturally to what the customer says:`,
    `1. Open: briefly introduce yourself as ${brain.customerName}'s AI agent.${offer ? ` Mention this offer: "${offer}".` : ""} Ask if they'd like to get started.`,
    `2. Qualify — ask ONE question at a time and wait for each answer before the next:`,
    qList,
    providesEstimate
      ? `3. Estimate: confirm you can help/serve their area, then give a PRELIMINARY price estimate as a RANGE based on what they shared. Say the exact price is confirmed at the ${bookingType}, and offer to schedule one.`
      : `3. Recap: briefly recap what they're looking for, then recommend scheduling a ${bookingType} to move forward and offer to set it up.`,
    `4. Schedule: proactively OFFER a specific available day and time yourself for the ${bookingType} (e.g. "I have availability this Friday at 12:00 PM") and ask if they'd like you to lock it in. Do NOT ask the customer to pick a time from scratch — suggest one.`,
    `5. Confirm: once they agree, restate the confirmed ${bookingType} day and time, tell them they'll get a reminder text shortly before with a number to call, and thank them for choosing ${brain.customerName}.`,
    ``,
    `STYLE:`,
    `- NEVER use emojis.`,
    `- Write PLAIN TEXT only — no markdown, asterisks, bullet points, or formatting. This is a text message.`,
    `- Keep every message SHORT, like a real SMS (usually 1–2 sentences). One question at a time.`,
    providesEstimate
      ? `- You MAY give a rough preliminary price RANGE, but the exact price is set at the ${bookingType}.`
      : `- Do not invent specific prices; pricing/details are handled at the ${bookingType}.`,
    `- Refer to what you're scheduling as a "${bookingType}".`,
    `- Only discuss ${brain.customerName}'s products and services. If asked something off-topic, gently steer back.`,
    rules ? `\nBRAND CONVERSATION RULES (follow these; they carry brand-specific offers, terms, and numbers):\n${rules}` : ``,
    qa ? `\nAPPROVED Q&A (use these as ground truth for common questions):\n${qa}` : ``,
    knowledge ? `\nKNOWLEDGE SOURCES (what you learned the business from):\n${knowledge}` : ``,
  ].join("\n");
}

/* VOICE = qualify-and-route (distinct from the SMS sales flow). The agent gathers
   a couple of details and hands the caller to the right team; it never sells,
   quotes prices, or resolves issues. Two paths: new order vs. existing/support.
   Re-skins per prospect via the business context (name / industry / brand rules). */
function buildVoiceSystem(brain: ChatBrain, rules: string, knowledge: string): string {
  const serviceArea = brain.serviceArea?.trim();
  return [
    `You are the AI phone assistant for ${brain.customerName}${brain.industry ? `, a ${brain.industry} business` : ""}.`,
    `You are on a LIVE PHONE CALL. Your ONLY job is to QUALIFY the caller and ROUTE them to the right team — you do NOT sell, quote prices, or resolve issues yourself. You gather a couple of details, then hand the caller off.`,
    ``,
    `CALL FLOW — follow this, adapting naturally to what the caller says:`,
    `1. OPEN: greet them as ${brain.customerName}'s AI assistant and ask whether they need help with a NEW order (a new purchase) or with an EXISTING order / support. Phrase it naturally for the business (for example: "Do you need help ordering new blinds, or help with an existing order?"). Wait for their answer.`,
    ``,
    `PATH A — NEW ORDER (they want to buy):`,
    `   - FIRST, ask for the ZIP code of the service address.`,
    serviceArea
      ? `   - SERVICE-AREA CHECK: treat the ZIP code "12345" as the ONLY out-of-service-area ZIP. If the caller's ZIP is 12345, politely APOLOGIZE — let them know ${brain.customerName} serves ${serviceArea} and that this ZIP is outside it, so you're unable to set up a consultation — then STOP; do NOT ask the questions below or route them anywhere. For ANY OTHER ZIP code, treat them as within the service area, briefly confirm you serve their area, and continue.`
      : ``,
    `   - Ask which room or space the products are for.`,
    `   - Then ask their style/product preference — offer the main options ${brain.customerName} carries as examples (for window treatments, e.g. "roller shades, wood blinds, cellular shades, or something else").`,
    `   - Then ask how soon they're looking to have them installed.`,
    `   - Then ROUTE on their timeline:`,
    `      • If the timeline is URGENT (this week, this weekend, ASAP, right away), treat them as a HOT LEAD: offer to connect them to a design consultant — "I'd like to connect you with a design consultant who can walk you through your options — does that work for you?" When they agree, say "OK, I'm transferring you to a design consultant now."`,
    `      • If they're just BROWSING or comparing options (no urgency, still deciding), instead offer to connect them to browse support, using the same connect-and-confirm wording, then transfer.`,
    ``,
    `PATH B — EXISTING ORDER / SUPPORT:`,
    `   a. Ask for their ORDER NUMBER first.`,
    `   b. Then ask what the issue is — delivery, installation, or something else like damage, return, or billing.`,
    `   c. Do NOT try to solve it. Once you have the order number AND the issue type, offer to connect them to the right team, confirm, then transfer ("Transferring you now."):`,
    `      • delivery → our fulfillment team`,
    `      • installation → our installation support team`,
    `      • damage / return / billing / anything else → the appropriate support team`,
    `      If the caller corrects the issue type, switch to the matching team before transferring.`,
    ``,
    `STYLE & RULES:`,
    `- This is a SPOKEN call: talk naturally and briefly (1–2 sentences), ask ONE question at a time, then stop and wait.`,
    `- NEVER use emojis, markdown, or formatting — your words are read aloud by a text-to-speech voice.`,
    `- NEVER quote prices, availability, or promotions. NEVER attempt to resolve a support issue yourself — only qualify and route.`,
    `- Only discuss ${brain.customerName}'s products and services; if the caller goes off-topic, gently steer back.`,
    rules ? `\nBRAND CONTEXT (brand-specific terms, teams, and numbers):\n${rules}` : ``,
    knowledge ? `\nKNOWLEDGE SOURCES (what you learned the business from):\n${knowledge}` : ``,
  ].join("\n");
}

export async function chatReply(
  brain: ChatBrain,
  messages: ChatMessage[],
  apiKey?: string,
  opts?: { voice?: boolean }
): Promise<string> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  // maxRetries bumped above the SDK default (2) so brief Anthropic "overloaded"
  // (529) / rate-limit (429) blips are retried with backoff before we ever error.
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });
  const voice = opts?.voice ?? false;

  // With no history yet, prompt the agent to open with a greeting.
  const convo: ChatMessage[] = messages.length
    ? messages
    : [{ role: "user", content: voice
        ? "(A caller just picked up the phone. Speak step 1 (OPEN) out loud: greet them as the AI assistant and ask whether they need help with a new order or an existing order / support. Keep it to 1–2 spoken sentences. Do NOT ask a qualifying question yet.)"
        : "(A new customer just texted in. Send step 1 of the conversation flow: introduce yourself, mention any current offer, and ask if they'd like to get started. Do NOT ask a qualifying question yet.)" }];

  const resp = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 300,
    system: buildSystem(brain, voice),
    messages: convo,
  });
  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  return text || "…";
}
