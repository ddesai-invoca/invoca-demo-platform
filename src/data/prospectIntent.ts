/* =============================================================================
   prospectIntent.ts — what a caller or texter is actually trying to do, per industry
   -----------------------------------------------------------------------------
   Asked for directly (10/14/2026): *"It should be health-related and not sales-related…
   do one for some of the top categories, like health, auto, home services… Always
   understand what the intent of the prospect is based on their website and other research.
   Make sure to gear and tailor the voice and the SMS workflow for that outcome. Make sure the
   preview agent, the preview workflow, and the workflow reflect that as well."* And on the
   follow-up: keep the locked "Sales Inquiry" / "All Sales Inquiry Users" chrome, but the
   wording inside every drawer and the agent's behaviour must match the industry and the
   prospect.

   ⚠️⚠️ **MEASURED FIRST: EVERY PROSPECT GOT ONE SALES TEMPLATE.** A hospital's Sales Inquiry
   drawer read "interested in starting Baptist Health South Florida service, or an existing
   patient who wants to add or upgrade what they already have", its voice use cases were
   "Ready to book now / Comparing options", and a care concern was routed to "Insurance
   Verification and Billing". Auto, home services, hotels and insurance had the same three
   shopping branches and the same subscription wording.

   ⚠️ **ONE DEFINITION, MANY READERS** — the SMS intent drawers, the voice use cases and their
   routes, the voice spec, the support drawers and both agent prompts all read this, so the
   diagram, the drawers and what the agent does cannot describe different businesses.

   ⚠️⚠️ **DOM-FREE AND IMPORT-FREE**, so `engine/` can read it too (the prompt builder decides
   the agent's role from it). It takes plain fields rather than a `CustomerProfile` for the
   same reason `workflowIntents.ts` was extracted.

   ⚠️ **THE GENERATED `intentKind` WINS** — a prospect generated from 10/14/2026 is classified
   by the engine from its own website research. Older profiles are classified here from their
   industry, customer noun and booking term, which is why the keyword lists are ordered most
   specific first.
   ============================================================================= */

export const INTENT_KINDS = [
  "care", "seniorCare", "insurance", "autoSales", "autoService", "homeService", "security",
  "telecom", "financial", "hospitality", "moving", "retail", "legal", "education",
  "funeral", "b2b", "general",
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export interface IntentFields {
  industry?: string;
  customerNoun?: string;
  bookingTerm?: string;
  intentKind?: string;
}

/** Word-start match, never a bare substring: "car" inside "care" turned a senior-care agent
 *  into a car dealership once (recorded at `voiceVocab`). */
function hasWord(text: string, ...words: string[]): boolean {
  return words.some((w) => new RegExp(`(^|[^a-z])${w}`, "i").test(text));
}

export function intentKindOf(f: IntentFields): IntentKind {
  if (f.intentKind && (INTENT_KINDS as readonly string[]).includes(f.intentKind)) return f.intentKind as IntentKind;
  const ind = (f.industry ?? "").toLowerCase();
  const noun = (f.customerNoun ?? "").toLowerCase().trim();
  const term = (f.bookingTerm ?? "").toLowerCase();
  const h = (...w: string[]) => hasWord(ind, ...w);

  /* Selling INTO a business first: a dental support organisation whose customer is a DOCTOR,
     a healthcare SaaS, an agency. Industry words alone would call several of these care. */
  if (["doctor", "property manager", "owner", "merchant"].includes(noun)) return "b2b";
  /* A car maker that also retails (Kia) sells to drivers, so auto is tested before the
     "manufacturing" keyword can call it B2B. */
  if (h("automotive manufactur", "auto manufactur") || (h("automotive", "vehicle", "dealer") && h("retail") && !h("tire", "repair")))
    return "autoSales";
  if (h("saas", "software", "martech", "marketing", "advertising", "agency", "outsourc", "bpo",
    "consulting", "it services", "manufactur", "contracting", "revenue cycle", "staffing agency",
    "fintech", "payment processing", "merchant", "cloud communications", "unified communications",
    "contact center", "b2b", "hospitality management", "security logistics", "cash management"))
    return "b2b";
  if (h("funeral", "cremation", "cemetery")) return "funeral";
  if (h("insur", "medicare", "managed health", "home warranty", "home protection")) return "insurance";
  /* Before senior care: a reverse-mortgage lender says "retirement" and is a lender. */
  if (h("bank", "lending", "mortgage", "financial", "wealth", "credit union", "loan")) return "financial";
  /* Before care: "hospital" is a word-START match, so it matches "Hospitality". */
  if (h("hotel", "lodging", "resort", "hospitality", "travel", "vacation", "golf community"))
    return "hospitality";
  /* Before senior care: a senior PRIMARY CARE practice is a medical practice. */
  if (h("primary care", "physician")) return "care";
  if (h("senior", "assisted living", "memory care", "retirement", "hospice", "home health",
    "in-home", "home care", "palliative") || noun === "resident") return "seniorCare";
  if (h("health", "hospital", "medical", "clinic", "dental", "dermatolog", "oncolog", "pediatric",
    "ophthalm", "optometr", "eye care", "vision", "hearing", "behavioral", "addiction",
    "orthopedic", "veterinar", "emergency room", "primary care", "physician") ||
    ["patient"].includes(noun)) return "care";
  if (h("tire", "auto repair", "maintenance", "collision") && !h("dealer", "manufactur", "lending", "leasing"))
    return "autoService";
  if (h("auto", "automotive", "vehicle", "dealer", "motor")) return "autoSales";
  if (h("security", "alarm")) return "security";
  if (h("broadband", "telecom", "wireless", "isp", "pay-tv", "cable", "fiber", "streaming"))
    return "telecom";
  if (h("moving", "relocation", "van line")) return "moving";
  if (h("pest", "plumb", "hvac", "roof", "restoration", "clean", "pool", "garage", "electric",
    "solar", "landscap", "lawn", "window", "blind", "home service", "water damage", "contractor"))
    return "homeService";
  if (h("law", "legal", "attorney", "injury")) return "legal";
  if (h("education", "learning", "school", "university", "college", "training")) return "education";
  if (h("retail", "store", "luxury", "fashion", "jewel", "watch", "mattress", "furnish", "e-commerce"))
    return "retail";
  if (/test drive/.test(term)) return "autoSales";
  return "general";
}

/** A new-side branch: its title, what it collects, and which of the prospect's own routing
 *  queues it should hand off to (matched by keyword, never invented). */
export interface IntentUseCase {
  title: string;
  /** Field labels. `{where}` / `{when}` are replaced by the vertical's own words. */
  collect: string[];
  /** Queue-name keywords, most specific first. */
  route: RegExp;
}

export interface IntentCopy {
  kind: IntentKind;
  /** Is this a business whose agent may talk about buying at all? */
  sells: boolean;
  /** How the agent introduces its own job, e.g. "scheduling assistant". */
  role: string;
  /** What a NEW contact wants, as a list for the Sales Inquiry description. */
  newNeeds: string;
  /** What an EXISTING contact wants, for the Need Support description. */
  supportNeeds: string;
  /** The voice Sales Inquiry subtitle (line 1 is drawn on the node). */
  newSub: string;
  /** The three branches under All Sales Inquiry Users on the voice tree. */
  useCases: IntentUseCase[];
  /** Support routing keywords, per support case. */
  supportRoute: { issue: RegExp; status: RegExp; billing: RegExp; other: RegExp };
  /** The Support Qualify's open question. */
  supportQuestion: string;
  /** "simple account details" the agent may update itself, in this vertical's words. */
  simpleDetails: string;
  /** What the agent says when asked about price. */
  pricingRule: string;
  /** Industry behaviour the agent must follow, on both channels. */
  agentRules: string[];
  /** Extra escalation triggers for this vertical. */
  escalateTriggers: string;
  /** "new service" in the service-area gate, in this vertical's words. */
  newWord: string;
}

const SCHED = /schedul|appointment|booking|book|new patient|intake|enroll|reservation|new/i;
const BILL = /billing|payment|financ|account/i;
const SUPPORT = /support|existing|service|customer care|help/i;

/* ⚠️⚠️ **EMPATHY IS SITUATIONAL, NOT A TONE SETTING (10/14/2026).** Asked for directly: an
   empathetic tone for healthcare, senior living and anything that needs it, *"only specific
   situations where an empathetic tone or verbiage is required… not for everything"*. So each
   vertical names the moments that warrant it (a frightening diagnosis, a parent's fall, a
   flooded basement, an accident) and the rule says to stay matter-of-fact otherwise: a
   sympathy line on "I need to book a check-up" reads as scripted, which is the opposite of
   empathy. Funeral is the one kind where the whole call is the situation, so its standing
   "may be grieving" rule covers it and nothing is added here. */
const EMPATHY: Partial<Record<IntentKind, string>> = {
  care: "a worrying symptom, pain, a frightening diagnosis or test result, care for a sick child or parent, or a recent loss",
  seniorCare: "a parent's decline, a fall or a hospital stay, memory loss, feeling overwhelmed as a caregiver, or end-of-life care",
  legal: "an accident, an injury, a death in the family or a frightening legal situation",
  insurance: "a claim after an accident, a fire, a theft, a death or a health scare",
  homeService: "flooding, a burst pipe, no heat or cooling in extreme weather, or damage to their home",
  autoService: "an accident, a breakdown or being stranded",
  autoSales: "an accident or losing their vehicle",
  financial: "fraud, a stolen card, a bereavement or financial hardship",
  moving: "a move forced by a job loss, a divorce, a death or a family emergency",
  hospitality: "a trip cancelled by illness or a family emergency, or a stay that went badly wrong",
  security: "a break-in or feeling unsafe at home",
};

/** The situational empathy rule for this kind, or null where none applies. */
export function empathyRule(kind: IntentKind, noun: string): string | null {
  const when = EMPATHY[kind];
  return when
    ? `Be empathetic only when the situation calls for it: if the ${noun} mentions ${when}, acknowledge it warmly in one short, sincere sentence and keep a gentle pace. Stay friendly and matter-of-fact for routine requests such as booking or rescheduling.`
    : null;
}

export function intentCopyFor(f: IntentFields & { customerName: string }): IntentCopy {
  const copy = intentCopyBase(f);
  const e = empathyRule(copy.kind, (f.customerNoun || "customer").toLowerCase());
  return e ? { ...copy, agentRules: [...copy.agentRules, e] } : copy;
}

function intentCopyBase(f: IntentFields & { customerName: string }): IntentCopy {
  const kind = intentKindOf(f);
  const name = f.customerName;
  const noun = (f.customerNoun || "customer").toLowerCase();
  const term = (f.bookingTerm || "appointment").toLowerCase();
  const an = /^[aeiou]/.test(term) ? "an" : "a";
  const generic: IntentCopy = {
    kind, sells: true, role: "sales assistant",
    newNeeds: `getting started with ${name} for the first time, booking ${an} ${term}, asking about services or availability, or adding to what they already have`,
    supportNeeds: `rescheduling, a billing or payment question, a concern about recent service, changing or cancelling what they have, or checking on status`,
    newSub: `Caller wants to book ${an} ${term} and is not an existing ${noun}`,
    useCases: [
      { title: "Ready to book now", collect: ["Consumer Name", "{where}", "{when}"], route: SCHED },
      { title: "Comparing options", collect: ["Consumer Name", "Consumer Email", "{where}"], route: SCHED },
    ],
    supportRoute: { issue: /retention|issue|complaint|repair|service/i, status: SUPPORT, billing: BILL, other: SUPPORT },
    supportQuestion: `Happy to help. Is it about something already booked, a recent visit, a charge, or something else?`,
    simpleDetails: `a phone number, an email or a mailing address`,
    pricingRule: `If asked about cost or pricing, do not provide specific numbers. Acknowledge that pricing varies and let the ${noun} know the local team will cover exact pricing.`,
    agentRules: [],
    escalateTriggers: `requests a cancellation or refund, reports a problem that recurred after recent service`,
    newWord: "new service",
  };

  switch (kind) {
    case "care": return {
      ...generic, sells: false, role: "scheduling assistant",
      newNeeds: `booking a new appointment, seeing a specialist, scheduling a screening or test, finding same-day or urgent care, or becoming a new ${noun}, for themselves or a family member`,
      supportNeeds: `changing or cancelling an appointment, asking about test results or a prescription, a bill or an insurance question, or a concern about care they received`,
      newSub: `Caller wants to book an appointment or find care, for themselves or a family member`,
      useCases: [
        { title: "New appointment", collect: ["Consumer Name", "{where}", "{when}"], route: SCHED },
        { title: "Specialist or referral", collect: ["Consumer Name", "Specialty Needed", "Insurance Provider"], route: /special|referr|schedul|appointment/i },
        { title: "Same-day or urgent care", collect: ["Consumer Name", "Reason for Visit", "{where}"], route: /urgent|same.?day|walk|emergency|schedul/i },
      ],
      supportRoute: { issue: /nurse|clinical|care team|patient services|patient experience|follow|support/i, status: /schedul|appointment|patient|support/i, billing: /billing|insurance|financ|payment/i, other: /patient|support|service/i },
      supportQuestion: `Happy to help. Is it about an upcoming appointment, a test result or prescription, a bill, or something else?`,
      simpleDetails: `a phone number, an email, a mailing address or the insurance on file`,
      pricingRule: `If asked about cost, explain that it depends on the ${noun}'s insurance and the care they need, and that the billing team can give an estimate. Never quote a number.`,
      agentRules: [
        `Never give medical advice, a diagnosis or an opinion on symptoms.`,
        `If the ${noun} mentions symptoms such as chest pain, trouble breathing or severe bleeding, tell them to call 911 or go to the nearest emergency room right away. Otherwise carry on with booking.`,
        `Ask only what is needed to book: the ${noun}'s name, the kind of care, a preferred time and location. Never ask for medical history over text or on this call.`,
      ],
      escalateTriggers: `describes worsening or urgent symptoms (tell them to call 911 for an emergency), asks about a test result or a medication change, raises a billing dispute`,
      newWord: "a new appointment",
    };
    case "seniorCare": return {
      ...generic, sells: false, role: "care coordinator",
      newNeeds: `arranging care or a community visit for a parent or loved one, booking ${an} ${term}, asking what care is available and when it can start, or applying to work as a caregiver`,
      supportNeeds: `a change to a care schedule or a visit, a concern about the care a loved one is receiving, a billing question, or updating family contact details`,
      newSub: `Caller is arranging care for themselves or a loved one, or asking about joining as a caregiver`,
      useCases: [
        { title: "Arrange care for a loved one", collect: ["Consumer Name", "{where}", "Care Start Date"], route: SCHED },
        { title: `Book ${an} ${f.bookingTerm || "Visit"}`, collect: ["Consumer Name", "Relationship to Client", "{when}"], route: SCHED },
        { title: "Join as a caregiver", collect: ["Consumer Name", "{where}", "Consumer Email"], route: /career|recruit|hiring|caregiver|employ|support/i },
      ],
      supportQuestion: `Happy to help. Is it about a care schedule or visit, a concern about care, a bill, or something else?`,
      simpleDetails: `a family contact, a phone number, an email or access instructions for the home`,
      pricingRule: `If asked about cost, explain that it depends on the level of care and the hours needed, and that the care team will go through it at the ${term}. Never quote a number.`,
      agentRules: [
        `Speak with warmth and patience; the caller is often a worried family member.`,
        `Never give medical advice. If the caller says someone is in danger or having a medical emergency, tell them to call 911.`,
      ],
      escalateTriggers: `raises a concern about a loved one's safety or care, is distressed, raises a billing dispute`,
      newWord: "care",
    };
    case "insurance": return {
      ...generic, role: "insurance assistant",
      newNeeds: `getting a quote, comparing or switching coverage, adding a vehicle, home or family member, or booking ${an} ${term} with an agent`,
      supportNeeds: `a claim, a question about their coverage or policy, a payment or billing question, or a change to their policy`,
      newSub: `Caller wants a quote or new coverage and is not an existing ${noun}`,
      useCases: [
        { title: "New quote", collect: ["Consumer Name", "Coverage Type", "Consumer Zip"], route: /quote|new|sales|enroll|consult/i },
        { title: "Compare or switch coverage", collect: ["Consumer Name", "Current Carrier", "Renewal Date"], route: /quote|new|sales|consult/i },
        { title: "Add or bundle coverage", collect: ["Consumer Name", "Coverage Type", "Consumer Email"], route: /bundle|quote|sales|new/i },
      ],
      supportRoute: { issue: /claim|coverage|support|service/i, status: /policy|service|support|existing/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about a claim, your coverage or policy, a payment, or something else?`,
      simpleDetails: `a phone number, an email, a mailing address or a payment due date reminder`,
      pricingRule: `If asked about price, explain that a rate depends on the coverage and the details of the ${noun}, and that a licensed agent will give an exact quote. Never guess a premium.`,
      agentRules: [`Never promise coverage, a rate or a claim outcome; a licensed agent confirms those.`],
      escalateTriggers: `wants to file or dispute a claim, wants to cancel a policy, raises a billing dispute`,
      newWord: "a new quote",
    };
    case "autoSales": return {
      ...generic, role: "sales and service assistant",
      newNeeds: `shopping for a new or used vehicle, booking ${an} ${term}, asking about a trade-in or financing, or booking service or repair`,
      supportNeeds: `a vehicle already in for service or repair, a recent purchase, a warranty or recall question, or a bill`,
      newSub: `Caller is shopping for a vehicle or wants to book service`,
      useCases: [
        { title: "Shop for a vehicle", collect: ["Consumer Name", "Vehicle of Interest", "Purchase Timeline"], route: /sales|test drive|new|used|inventory/i },
        { title: "Book service or repair", collect: ["Consumer Name", "Vehicle or Plate", "Preferred Date"], route: /service|repair|maintenance/i },
        { title: "Trade-in or financing", collect: ["Consumer Name", "Trade-In Vehicle", "Consumer Email"], route: /financ|trade|credit|sales/i },
      ],
      supportRoute: { issue: /service|repair|warranty|support/i, status: /service|support|existing/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about a vehicle in for service, a recent purchase, a warranty, or something else?`,
      pricingRule: `If asked about a vehicle's price or a payment, do not quote a number. Let them know the sales team will confirm current pricing and offers.`,
      agentRules: [`Never quote a vehicle price, a trade-in value or a finance rate; the team confirms those.`],
      escalateTriggers: `has a safety concern with a vehicle, disputes a repair or a bill, wants to cancel a purchase`,
      newWord: "a new purchase or service",
    };
    case "autoService": return {
      ...generic, role: "service assistant",
      newNeeds: `booking ${an} ${term}, a repair, maintenance or tires, asking what is wrong with their vehicle, or getting an estimate`,
      supportNeeds: `a vehicle already in the shop, a repair that did not fix the problem, a warranty question, or a bill`,
      newSub: `Caller wants to book service, a repair or tires for their vehicle`,
      useCases: [
        { title: "Book service or repair", collect: ["Consumer Name", "Vehicle or Plate", "Preferred Date"], route: /service|repair|appointment|schedul/i },
        { title: "Tires or quick maintenance", collect: ["Consumer Name", "Vehicle or Plate", "{where}"], route: /tire|maintenance|service/i },
        { title: "Estimate for a problem", collect: ["Consumer Name", "Vehicle or Plate", "Issue Description"], route: /estimate|repair|service/i },
      ],
      supportRoute: { issue: /repair|warranty|service|support/i, status: /service|support|existing/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about a vehicle in the shop, a recent repair, a warranty, or something else?`,
      pricingRule: `If asked about cost, explain that the shop gives an exact estimate once it has looked at the vehicle. Never quote a number.`,
      agentRules: [`If the vehicle is unsafe to drive, suggest they do not drive it and offer a tow or the earliest slot.`],
      newWord: "service",
    };
    case "homeService": return {
      ...generic, role: "booking assistant",
      newNeeds: `booking ${an} ${term}, an urgent or same-day problem at their property, an estimate for a project, or starting a recurring plan`,
      supportNeeds: `a problem that came back after a visit, a scheduled visit they want to check or move, a bill, or updating access details for their property`,
      newSub: `Caller needs service at their property, from an urgent problem to a planned project`,
      useCases: [
        { title: "Urgent or same-day service", collect: ["Consumer Name", "Service Address", "Issue Description"], route: /emergency|urgent|same.?day|dispatch|service/i },
        { title: `Schedule ${an} ${f.bookingTerm || "Service Visit"}`, collect: ["Consumer Name", "Service Address", "Preferred Date"], route: SCHED },
        { title: "Estimate or new project", collect: ["Consumer Name", "Service Address", "Timeline"], route: /estimate|project|consult|sales|new/i },
      ],
      supportQuestion: `Happy to help. Is it about a problem that came back, a scheduled visit, a bill, or something else?`,
      simpleDetails: `access instructions, a gate code, a phone number or an email`,
      pricingRule: `If asked about cost, do not quote a number. Explain that a technician confirms the price once they have seen the job.`,
      agentRules: [`Only if the caller mentions a safety hazard such as a gas leak, flooding or an electrical fire, tell them to get to safety and call 911 or the utility first.`],
      newWord: "new service",
    };
    case "security": return {
      ...generic, role: "security assistant",
      newNeeds: `protecting a home or business for the first time, getting a quote, booking ${an} ${term}, or adding cameras or smart-home devices`,
      supportNeeds: `a system or alarm that is not working, a false alarm, a monitoring or billing question, or moving their service`,
      newSub: `Caller wants to protect a home or business and is not an existing ${noun}`,
      useCases: [
        { title: "New system or quote", collect: ["Consumer Name", "{where}", "Property Type"], route: /sales|new|quote|consult/i },
        { title: `Book ${an} ${f.bookingTerm || "Consultation"}`, collect: ["Consumer Name", "{where}", "{when}"], route: SCHED },
        { title: "Business or multi-site", collect: ["Consumer Name", "Number of Locations", "{when}"], route: /business|commercial|sales/i },
      ],
      supportQuestion: `Happy to help. Is it about a system or alarm issue, monitoring, a bill, or something else?`,
      agentRules: [`Only if the caller mentions an active break-in, fire or emergency, tell them to call 911 first.`],
      newWord: "new protection",
    };
    case "telecom": return {
      ...generic, role: "service assistant",
      newNeeds: `getting new internet, TV or mobile service at their address, checking what is available, booking ${an} ${term}, or upgrading their plan`,
      supportNeeds: `an outage or slow service, an installation they want to check or move, a bill, or moving their service to a new address`,
      newSub: `Caller wants new service or to upgrade, and is not calling about an existing problem`,
      useCases: [
        { title: "New service at an address", collect: ["Consumer Name", "Service Address", "Service Type"], route: /sales|new|order|connect/i },
        { title: `Book ${an} ${f.bookingTerm || "Installation"}`, collect: ["Consumer Name", "Service Address", "Preferred Date"], route: /install|schedul|appointment|new/i },
        { title: "Upgrade or add a line", collect: ["Consumer Name", "Account Phone", "Service Type"], route: /upgrade|sales|retention|account/i },
      ],
      supportRoute: { issue: /tech|repair|outage|support/i, status: /install|support|service/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about an outage or slow service, an installation, a bill, or something else?`,
      newWord: "new service",
    };
    case "financial": return {
      ...generic, role: "client assistant",
      newNeeds: `opening an account, applying or prequalifying for a loan, booking ${an} ${term} with an advisor or banker, or asking about rates and products`,
      supportNeeds: `a question about an existing account or loan, a transaction or a fee, a change to their details, or a concern about fraud`,
      newSub: `Caller wants to open an account, apply, or meet with an advisor`,
      useCases: [
        { title: "Open an account", collect: ["Consumer Name", "Account Type", "Consumer Zip"], route: /new|open|account|sales|branch/i },
        { title: "Apply or prequalify", collect: ["Consumer Name", "Product of Interest", "Consumer Email"], route: /loan|lend|mortgage|apply|credit/i },
        { title: `Meet with an advisor`, collect: ["Consumer Name", "{where}", "{when}"], route: /advis|banker|consult|appointment|schedul/i },
      ],
      supportRoute: { issue: /fraud|dispute|support|service/i, status: /account|service|support/i, billing: /fee|billing|payment|account/i, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about an account or loan, a transaction or fee, your details, or something else?`,
      simpleDetails: `a phone number, an email or a mailing address`,
      pricingRule: `If asked about a rate or a fee, do not quote one. Explain that rates depend on the product and their details, and that a banker will confirm them.`,
      agentRules: [`Never ask for a full account number, a PIN, a password or a full Social Security number.`, `If the ${noun} reports fraud or a stolen card, tell them to call the number on the back of their card right away.`],
      escalateTriggers: `reports fraud or an unrecognised transaction, disputes a fee`,
      newWord: "a new account",
    };
    case "hospitality": return {
      ...generic, role: "reservations assistant",
      newNeeds: `booking a stay or ${an} ${term}, asking about rates, rooms or availability, planning a group or event, or a loyalty or package question`,
      supportNeeds: `changing or cancelling an existing reservation, a problem with a stay, a charge on their bill, or a special request`,
      newSub: `Caller wants to book a stay or plan a visit`,
      useCases: [
        { title: "Book a stay", collect: ["Consumer Name", "Destination", "Travel Dates"], route: /reserv|book|new|sales/i },
        { title: "Group or event booking", collect: ["Consumer Name", "Group Size", "Event Dates"], route: /group|event|meeting|wedding|sales/i },
        { title: "Rates, packages or loyalty", collect: ["Consumer Name", "Consumer Email", "Travel Dates"], route: /loyal|member|package|reserv/i },
      ],
      supportRoute: { issue: /guest|concierge|relation|support/i, status: /existing|guest|support|reserv/i, billing: BILL, other: /guest|support/i },
      supportQuestion: `Happy to help. Is it about an existing reservation, a problem with your stay, a charge, or something else?`,
      pricingRule: `If asked about a rate, give no specific number. Explain that rates depend on the dates and room, and offer to check availability for their dates.`,
      newWord: "a new reservation",
    };
    case "moving": return {
      ...generic, role: "moving coordinator",
      newNeeds: `getting a moving quote, booking ${an} ${term} or a move date, a long-distance or corporate relocation, or packing and storage`,
      supportNeeds: `checking on or changing a booked move, a delivery or damage claim, a bill, or updating their move details`,
      newSub: `Caller is planning a move and wants a quote or a move date`,
      useCases: [
        { title: "Get a moving quote", collect: ["Consumer Name", "Moving From", "Moving To"], route: /quote|estimate|sales|new/i },
        { title: "Book a move date", collect: ["Consumer Name", "Move Date", "Home Size"], route: /book|schedul|sales|new/i },
        { title: "Long-distance or corporate move", collect: ["Consumer Name", "Moving To", "Consumer Email"], route: /corporate|long|relocat|sales/i },
      ],
      supportRoute: { issue: /claim|damage|support|service/i, status: /move|dispatch|support|existing/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about a booked move, a delivery or damage claim, a bill, or something else?`,
      newWord: "a new move",
    };
    case "retail": return {
      ...generic, role: "shopping assistant",
      newNeeds: `finding or buying a product, booking ${an} ${term} or a store visit, checking availability or a store near them, or a special order`,
      supportNeeds: `an order, a delivery, a return or exchange, a repair or warranty, or a charge`,
      newSub: `Caller wants to shop, buy or book a store visit`,
      useCases: [
        { title: "Shop or buy", collect: ["Consumer Name", "Product of Interest", "{where}"], route: /sales|shop|store|new/i },
        { title: `Book ${an} ${f.bookingTerm || "Store Visit"}`, collect: ["Consumer Name", "{where}", "{when}"], route: /appointment|store|boutique|schedul|sales/i },
        { title: "Special order or bulk purchase", collect: ["Consumer Name", "Product of Interest", "Consumer Email"], route: /trade|bulk|special|sales/i },
      ],
      supportRoute: { issue: /return|repair|warranty|support/i, status: /order|delivery|support|service/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about an order or delivery, a return or repair, a charge, or something else?`,
      newWord: "a new purchase",
    };
    case "legal": return {
      ...generic, sells: false, role: "intake assistant",
      newNeeds: `a free case review, an injury or accident they want help with, booking ${an} ${term}, or asking whether the firm handles their kind of matter`,
      supportNeeds: `an update on their case, a document or a deadline, a bill, or speaking with their attorney`,
      newSub: `Caller wants help with a new legal matter or a free case review`,
      useCases: [
        { title: "Free case review", collect: ["Consumer Name", "Case Type", "Incident Date"], route: /intake|case|new|consult/i },
        { title: "Recent accident or injury", collect: ["Consumer Name", "Incident Date", "{where}"], route: /intake|injury|case|new/i },
        { title: `Book ${an} ${f.bookingTerm || "Consultation"}`, collect: ["Consumer Name", "Case Type", "{when}"], route: /consult|appointment|intake|schedul/i },
      ],
      supportRoute: { issue: /case|attorney|support/i, status: /case|client|support/i, billing: BILL, other: /client|support/i },
      supportQuestion: `Happy to help. Is it about an update on your case, a document or deadline, a bill, or something else?`,
      pricingRule: `If asked about fees, explain that the attorney goes through fees at the consultation, and that many cases are taken on contingency where the firm says so. Never quote a number.`,
      agentRules: [`Never give legal advice or say whether they have a case; the attorney decides that.`],
      escalateTriggers: `has a court date or deadline imminent, is distressed, raises a billing dispute`,
      newWord: "a new matter",
    };
    case "education": return {
      ...generic, sells: false, role: "enrollment assistant",
      newNeeds: `asking about a program or course, booking ${an} ${term}, enrollment and start dates, or financial aid`,
      supportNeeds: `access to a course, an existing enrollment, a certificate or record, or a payment`,
      newSub: `Caller wants to learn about a program or enroll`,
      useCases: [
        { title: "Explore a program", collect: ["Consumer Name", "Program of Interest", "Consumer Email"], route: /admission|enroll|advis|new/i },
        { title: `Book ${an} ${f.bookingTerm || "Advising Session"}`, collect: ["Consumer Name", "Program of Interest", "{when}"], route: /advis|appointment|enroll|schedul/i },
        { title: "Group or employer training", collect: ["Consumer Name", "Group Size", "{when}"], route: /group|corporate|employer|sales/i },
      ],
      supportQuestion: `Happy to help. Is it about course access, your enrollment, a certificate or record, a payment, or something else?`,
      newWord: "enrollment",
    };
    case "funeral": return {
      ...generic, sells: false, role: "family care assistant",
      newNeeds: `arranging services after a loss, booking ${an} ${term}, planning ahead for themselves or a family member, or asking about cemetery or cremation options`,
      supportNeeds: `details of services already arranged, a question about a plan they hold, a bill, or a memorial or record`,
      newSub: `Caller needs to arrange services after a loss, or wants to plan ahead`,
      useCases: [
        { title: "Arrange services after a loss", collect: ["Consumer Name", "Relationship", "{where}"], route: /arrange|at.?need|family|new/i },
        { title: "Plan ahead", collect: ["Consumer Name", "Consumer Email", "{when}"], route: /pre.?need|plan|advance|consult/i },
        { title: `Book ${an} ${f.bookingTerm || "Arrangement Consultation"}`, collect: ["Consumer Name", "{where}", "{when}"], route: /consult|appointment|schedul|arrange/i },
      ],
      supportQuestion: `I'm here to help. Is it about services already arranged, a plan you hold, a bill, or something else?`,
      pricingRule: `If asked about cost, explain gently that a family advisor goes through every option and its cost with them. Never quote a number.`,
      agentRules: [`The caller may be grieving. Be gentle and unhurried, offer condolences once, and never use sales language.`],
      escalateTriggers: `is in distress, needs someone to come today`,
      newWord: "arrangements",
    };
    case "b2b": return {
      ...generic, role: "sales development assistant",
      newNeeds: `exploring ${name}'s solutions for their organization, booking ${an} ${term}, asking about pricing or fit, or a partnership enquiry`,
      supportNeeds: `an issue with a service they already use, a question about their contract or invoice, or reaching their account manager`,
      newSub: `Caller is evaluating ${name} for their organization`,
      useCases: [
        { title: `Book ${an} ${f.bookingTerm || "Demo"}`, collect: ["Consumer Name", "Company Name", "{when}"], route: /demo|consult|sales|new/i },
        { title: "Pricing or fit question", collect: ["Consumer Name", "Company Name", "Consumer Email"], route: /sales|new|business/i },
        { title: "Enterprise or partnership", collect: ["Consumer Name", "Company Name", "Company Size"], route: /enterprise|partner|strategic|key|sales/i },
      ],
      supportRoute: { issue: /support|account|service|success/i, status: /account|success|support/i, billing: BILL, other: SUPPORT },
      supportQuestion: `Happy to help. Is it about a service you use, your contract or invoice, reaching your account manager, or something else?`,
      newWord: "a new engagement",
    };
    default: return {
      ...generic,
      useCases: [...generic.useCases],
    };
  }
}
