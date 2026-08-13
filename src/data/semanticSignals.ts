/* The Semantic Signal Library's 15 stock templates and their phrase sets.

   ⚠️ PROVENANCE, because it is uneven and worth knowing before anyone trusts a phrase list:

   - The 15 NAMES, SPEAKERS and DESCRIPTIONS are all verbatim from the library capture
     ("Semantic Signals｜ Invoca For Telecom 2.0", 8/6/2026).
   - "Ask for Appointment" carries all 44 of its real phrases and its real Suggested Use,
     from the drawer capture ("Semantic Signals 2", 8/6/2026) — only ONE drawer was open when
     that page was saved, so it is the only complete list we have.
   - "Ask for Sale" and "Competitor Mention" carry the phrases VISIBLE IN THE SCREENSHOTS
     (13 and 14). Those are real Invoca phrases but the lists are cut off by the viewport;
     the real ones are probably ~40 like Ask for Appointment's.
   - The remaining 12 templates' phrases are AUTHORED HERE, not captured. They are ordinary
     English for ordinary conversational concepts, chosen to match the style of the real
     lists (short spoken fragments, lowercase, no punctuation) — but they are not Invoca's.

   Replace any `captured: false` list from a real drawer capture when one turns up. Nothing
   here is re-skinned per prospect: this is the platform's stock library, identical in every
   account. */

export type Speaker = "Agent" | "Caller";

export interface SemanticTemplate {
  name: string;
  speaker: Speaker;
  body: string;
  /* The drawer's "Suggested Use:" line. Captured for the three above; inferred from the
     signal's nature for the rest (conversion-oriented vs segmentation/quality). */
  suggestedUse: string;
  phrases: string[];
  /* true only where the phrase list came out of a capture or screenshot. */
  captured: boolean;
}

const CONVERSION = "Conversion Trends & Insights";
const SEGMENTATION = "Customer Segmentation & Insights";

export const SEMANTIC_TEMPLATES: SemanticTemplate[] = [
  {
    name: "Ask for Appointment", speaker: "Agent", suggestedUse: CONVERSION, captured: true,
    body: "Captures when an agent takes initiative to schedule a meeting, call, or service appointment.",
    /* All 44, verbatim from the drawer capture. */
    phrases: [
      "arrange a consultation", "arrange time for a", "block out some time", "check his schedule",
      "days work best for you", "do you want to come in", "get you on the calendar",
      "have some openings", "like to book an", "set up a meeting", "pencil you in",
      "pull up the schedule", "reserve a slot", "reserve a time slot", "when are you free",
      "our earliest day for", "make you an appointment", "have an appointment",
      "set up an appointment", "arrange for a", "get a crew out there", "do the pricing on-site",
      "when would you like", "schedule a visit", "you back to set up", "to give an estimate",
      "property evaluation", "provide you quote", "plenty of openings", "set up a screening",
      "how about tomorrow", "have availability", "when can you make", "due for an appointment",
      "what kind of appointment", "check availability", "what we're scheduling",
      "set up an install", "dont have anything before", "make it work in your calendar",
      "pulling up calendar", "schedule an evaluation", "book a tour", "would you be able",
    ],
  },
  {
    name: "Ask for Sale", speaker: "Agent", suggestedUse: CONVERSION, captured: true,
    body: "Captures when an agent takes initiative to directly request a purchase commitment or moves the conversation toward closing the sale.",
    /* The 13 visible in the screenshot; the real list is cut off below the fold. */
    phrases: [
      "interested in buying", "want to sign up", "complete this purchase",
      "get the paperwork started", "prepared to make this investment", "take advantage of this offer",
      "send you a quote", "put together a proposal", "lock in this pricing", "complete your order",
      "pay for order today", "get that bought and installed", "ready to close on the purchase",
      "start the contract process",
    ],
  },
  {
    name: "Competitor Mention", speaker: "Caller", suggestedUse: SEGMENTATION, captured: true,
    body: "Captures when a caller references a competing company, product or service.",
    /* The 14 visible in the screenshot. */
    phrases: [
      "competitor offers", "comparing providers", "price match", "competitor quoted me lower",
      "beat their pricing", "with your competitor", "more comprehensive features",
      "current provider", "switching vendor", "rival has better", "We use someone else",
      "leave our current provider", "looking to switch", "better product",
    ],
  },
  {
    name: "Courtesy & Professionalism", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when the agent uses courteous and professional language.",
    phrases: [
      "thank you for calling", "my pleasure", "happy to help", "if you don't mind",
      "may I ask", "please hold for", "appreciate your patience", "is there anything else",
      "thanks for waiting", "have a great day", "you're very welcome", "certainly",
    ],
  },
  {
    name: "Empathy", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when the agent expresses understanding or compassion.",
    phrases: [
      "I understand how", "I'm sorry to hear", "that must be frustrating",
      "I can imagine", "completely understand", "sorry you went through",
      "that sounds difficult", "I hear you", "let me make this right",
      "I know this is important", "thank you for your patience",
    ],
  },
  {
    name: "Existing Customer", speaker: "Caller", suggestedUse: SEGMENTATION, captured: false,
    body: "Identifies whether a caller is an existing customer based on their responses.",
    phrases: [
      "I'm an existing customer", "I already have an account", "been with you for",
      "my account number is", "I'm a current customer", "on my last bill",
      "I called about this before", "we already use", "renewing my", "my existing plan",
    ],
  },
  {
    name: "Frustrated Caller", speaker: "Caller", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when a caller expresses irritation, impatience or anger during a call.",
    phrases: [
      "this is ridiculous", "I've been on hold", "third time I've called",
      "nobody has helped me", "I'm getting frustrated", "this is unacceptable",
      "waste of my time", "let me speak to a manager", "I'm done with this",
      "keep getting transferred",
    ],
  },
  {
    name: "Helpful Agent", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when the agent provides useful, clear, or valuable assistance to the caller beyond basic script adherence.",
    phrases: [
      "let me look into that", "here's what I can do", "I'll take care of it",
      "let me walk you through", "one thing that might help", "I'll follow up with you",
      "let me check on that for you", "I found a better option", "I can handle that now",
    ],
  },
  {
    name: "Listening Skills", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when the agent demonstrates active listening by acknowledging customer statements, confirming understanding, or reflecting back key points.",
    phrases: [
      "so what I'm hearing is", "just to confirm", "let me make sure I understand",
      "if I understood correctly", "to recap what you said", "you mentioned that",
      "correct me if I'm wrong", "so you're saying",
    ],
  },
  {
    name: "New Customer", speaker: "Caller", suggestedUse: SEGMENTATION, captured: false,
    body: "Identifies whether a caller is a new customer based on their responses.",
    phrases: [
      "I'm a new customer", "first time calling", "I don't have an account",
      "just moved to the area", "never used you before", "looking to get started",
      "I'm shopping around", "new to this",
    ],
  },
  {
    name: "Objection Handling", speaker: "Agent", suggestedUse: CONVERSION, captured: false,
    body: "Captures how an agent handles objections / when customer expresses resistance.",
    phrases: [
      "I understand your concern", "let me address that", "a lot of customers ask",
      "what if we could", "that's a fair point", "the reason we", "would it help if",
      "let me explain why", "I hear the hesitation",
    ],
  },
  {
    name: "Offer Alternative Options", speaker: "Agent", suggestedUse: CONVERSION, captured: false,
    body: "Captures when the agent proposes different solutions, products and plans as an alternative to the original choice discussed.",
    phrases: [
      "another option would be", "we also offer", "if that doesn't work",
      "a different plan", "alternatively we could", "there's also", "would you consider",
      "a step down from that", "something more affordable",
    ],
  },
  {
    name: "Promotion Mention", speaker: "Agent", suggestedUse: CONVERSION, captured: false,
    body: "Captures when the agent mentions promotions, coupons, offers or discounts.",
    phrases: [
      "we're running a promotion", "current special", "discount for", "waive the fee",
      "limited time offer", "percent off", "promo code", "free installation",
      "no cost for the first", "seasonal offer",
    ],
  },
  {
    name: "Put On Hold", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when the agent explicitly tells the caller they will be placed on hold, are currently on hold or references the hold process.",
    phrases: [
      "place you on hold", "hold for a moment", "bear with me",
      "thanks for holding", "stay on the line", "put you on a brief hold",
      "give me one moment", "still there",
    ],
  },
  {
    name: "Recap Conversation", speaker: "Agent", suggestedUse: SEGMENTATION, captured: false,
    body: "Captures when an agent summarizes the conversation to ensure customer and agent alignment.",
    phrases: [
      "to summarize", "so we've got you down for", "just to recap",
      "here's what happens next", "confirming the details", "let me go over that again",
      "you'll receive a confirmation", "does that all sound right",
    ],
  },
];
