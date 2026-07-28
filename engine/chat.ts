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
  /* An extra workflow's own playbook (reports.extraWorkflows[].systemPrompt).
     When set it REPLACES the generated sales persona — a nurture agent has a
     different job on the same channel. Our SMS format rules are still appended
     underneath, so a hand-written prompt can't accidentally produce a wall of
     text or markdown that the phone UI can't render. */
  customSystem?: string;
  /* Per-prospect VOICE routing, from reports.voiceRoutingDemo.queues plus the
     prospect's booking term and product categories. Without it the voice prompt
     used to fall back to hardcoded retail language: it asked every caller for an
     ORDER NUMBER and routed them to "our fulfillment team", which is wrong for a
     hospital, a law firm or a security company. */
  voiceRouting?: {
    newQueue: string;          // queues[0] — new business / booking
    supportQueue: string;      // queues[1] — existing customer
    generalQueue?: string;     // queues[2] — everything else
    bookingTerm: string;       // "Appointment", "Consultation", "Test Drive"
    products?: string[];       // main things they offer, used as spoken examples
    who?: string;              // "patient" | "resident" | "customer"
  };
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* Em dashes and dash-joined clauses are one of the clearest "written by an AI"
   tells, and this text is read by prospects during a demo. Banned outright for
   every agent, on both channels — use a comma, or start a new sentence. */
const NO_DASH_RULE =
  "NEVER use em dashes, en dashes, or a hyphen joining two clauses. " +
  "Use a comma, a full stop, or a new sentence instead. This matters: " +
  "dashes make the message read as machine-written.";

const SMS_FORMAT_RULES = [
  "FORMAT (always): plain text only, no markdown, asterisks, bullets or headings.",
  NO_DASH_RULE,
  "Keep every message to 1-3 short sentences. Never send a wall of text.",
  "One question at a time.",
].join("\n");

function buildSystem(brain: ChatBrain, voice: boolean): string {
  /* A workflow-supplied playbook wins over the generated persona, with our
     channel format rules appended so the phone UI stays renderable. */
  if (!voice && brain.customSystem) {
    return `${brain.customSystem}\n\n${SMS_FORMAT_RULES}`;
  }
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
    NO_DASH_RULE,
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
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
/* Spoken aloud, so "Shady Blinds's assistant" grates. Names ending in s take a
   bare apostrophe. */
const poss = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

function buildVoiceSystem(brain: ChatBrain, rules: string, knowledge: string): string {
  const serviceArea = brain.serviceArea?.trim();
  /* Fall back to neutral wording rather than retail wording when a profile has
     no routing data, so an old profile degrades to "book an appointment /
     existing customer" instead of asking a patient for an order number. */
  const r = brain.voiceRouting ?? {
    newQueue: "the new enquiries team",
    supportQueue: "the support team",
    bookingTerm: "appointment",
  };
  const book = (r.bookingTerm || "appointment").toLowerCase();
  const who = r.who || "customer";
  const products = r.products ?? [];
  return [
    NO_DASH_RULE,
    `You are the AI phone assistant for ${brain.customerName}${brain.industry ? `, a ${brain.industry} business` : ""}.`,
    `You are on a LIVE PHONE CALL. Your ONLY job is to QUALIFY the caller and ROUTE them to the right team — you do NOT sell, quote prices, or resolve issues yourself. You gather a couple of details, then hand the caller off.`,
    ``,
    `CALL FLOW, adapt naturally to what the caller says:`,
    `1. OPEN: greet them as ${poss(brain.customerName)} AI assistant and ask whether they are calling to book ${aOrAn(book)} ${book}, or need help as an existing ${who}. Phrase it naturally for this business. Wait for their answer.`,
    ``,
    `PATH A: BOOKING ${book.toUpperCase()} (new ${who})`,
    serviceArea
      ? `   - FIRST ask for their ZIP code. SERVICE-AREA CHECK: treat "12345" as the ONLY out-of-area ZIP. If they say 12345, politely apologise, explain ${brain.customerName} serves ${serviceArea}, say you cannot book them, then STOP: do not ask anything else or route them. For ANY other ZIP, briefly confirm you serve their area and continue.`
      : ``,
    products.length
      ? `   - Ask which of these they need: ${products.slice(0, 4).join(", ")}. Offer them as spoken examples, not a list.`
      : `   - Ask what they need help with, in their own words.`,
    `   - Then ask how soon they need it.`,
    `   - Then ROUTE on urgency:`,
    `      • URGENT (today, this week, ASAP): treat as a HOT LEAD. Offer to connect them to ${r.newQueue}, confirm, then say "OK, I'm transferring you to ${r.newQueue} now."`,
    `      • Still deciding or comparing: offer ${r.generalQueue ?? r.newQueue} instead, same confirm-then-transfer wording.`,
    ``,
    `PATH B: EXISTING ${who.toUpperCase()}`,
    `   a. Ask for whatever reference they have so the team can find them: the name on the account, and a reference or account number if they have one. Do NOT invent a required format.`,
    `   b. Then ask what the issue is, in their own words.`,
    `   c. Do NOT try to solve it. Once you have who they are AND what the issue is, offer to connect them to ${r.supportQueue}, confirm, then transfer ("Transferring you now.").`,
    `      If it clearly is not a ${r.supportQueue} matter, route to ${r.generalQueue ?? r.supportQueue} instead.`,
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
  return stripDashes(text) || "…";
}

/* The NO_DASH_RULE in the prompt is advisory and the model ignores it often
   enough to matter, so strip them for real on the way out. Prospects read this
   text during a demo and dash-joined clauses are the clearest AI tell.

   Only SPACED dashes and em/en dashes are touched, so hyphenated words survive:
   "rear-ended", "EV-qualified" and "24-48h" all pass through unchanged. */
export function stripDashes(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")     // em/en dash anywhere
    .replace(/ +- +/g, ", ")           // spaced hyphen used as a connector
    .replace(/,\s*,/g, ",")            // collapse any doubled commas
    .replace(/,\s*([.!?])/g, "$1")     // ", ." -> "."
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Test hook: lets a script assert the voice prompt re-skins per prospect
   without standing up the whole app or spending an API call. */
export const __buildVoiceSystemForTest = (brain: ChatBrain) =>
  buildVoiceSystem(brain, "", "");
