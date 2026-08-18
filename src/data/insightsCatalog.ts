import type { CustomerProfile } from "./schema";

/* =============================================================================
   insightsCatalog — the two option catalogues behind every Insights & Analytics
   tile template, plus the per-template field specs.
   -----------------------------------------------------------------------------
   Captured from the LIVE authenticated account (8/18/2026), Add Tile > each
   template's Configuration drawer, by opening every dropdown and reading its
   listbox. Two catalogues, not one:

     DIMENSIONS  250 options — what you GROUP BY   (Category, Categories)
     MEASURES    121 options — what you COUNT      (Attribute, Measure,
                                                    Measure Left/Right, Size (Rank))

   THE SPLIT IS THE WHOLE POINT. Reading only the first dropdown suggested a single
   121-item list, and templating every field from it would have offered measures where
   Pie Chart wants a dimension. The counts were checked per field (121 vs 250) rather
   than inferred from the field's name.

   RE-SKINNING. The live lists are one account's vocabulary: healthcare, so they say
   "Caller Type: New Patients", "Insurance Type: Medicare", "Specialty", "Facility".
   Everything here is stored with {TOKENS} and resolved per prospect, so a tire
   retailer sees "Caller Type: New Customers", "Payment Type", "Product Category" and
   "Store". A blinds company must never be offered "Medicare".

   WHY THESE LISTS ARE SHORTER THAN 250/121 (231/109 universal). The live counts are
   NOT all platform fields: a chunk of them are that account's OWN custom signals --
   "GEDC Scorecard", "Health Plan Enrollment Complete", "Prescription Refill",
   "Same Day Treatment", "Show Genre", "Streaming Service", "RTR_Destination". Copying
   those into a universal list would put a healthcare scorecard in front of a tire
   retailer. So the universal core holds only what every Invoca account has, and each
   prospect's own signals are folded in from its profile (ownSignals below). Totals
   therefore land near the live counts WITHOUT importing another account's vocabulary,
   which is the correct trade rather than a shortfall.
   ============================================================================= */

/* ---- the industry vocabulary each prospect resolves the tokens with ---------
   Derived from fields the profile already has, so no new generation phase and no
   new schema. Keyword-matched on `industry` with a neutral default, because the
   wrong specific word ("Facility" for a retailer) is worse than a general one. */
export interface Vocab {
  booking: string;     // Service Appointment | Consultation | Estimate
  customer: string;    // Customer | Patient | Member | Guest
  location: string;    // Store | Facility | Branch | Showroom | Location
  category: string;    // Product Category | Service Type | Specialty
  payment: string;     // Payment Type | Insurance Type | Finance Type
}

export function vocabFor(profile: CustomerProfile): Vocab {
  const ind = (profile.industry || "").toLowerCase();
  const has = (...w: string[]) => w.some((x) => ind.includes(x));
  const location =
    has("health", "medical", "clinic", "hospital", "dental", "care") ? "Facility"
    : has("retail", "tire", "store", "mattress", "shop") ? "Store"
    : has("home service", "plumb", "hvac", "roof", "restoration", "clean") ? "Branch"
    : has("blind", "window", "furnish", "design", "showroom") ? "Showroom"
    : has("senior", "living", "resort", "community") ? "Community"
    : "Location";
  const category =
    has("health", "medical", "clinic", "hospital", "dental") ? "Specialty"
    : has("retail", "tire", "store", "mattress", "blind", "window") ? "Product Category"
    : has("legal", "law", "insur", "financ", "advisor") ? "Practice Area"
    : "Service Type";
  const payment =
    has("health", "medical", "clinic", "hospital", "dental", "care") ? "Insurance Type"
    : has("legal", "law", "financ", "advisor", "mortgage") ? "Finance Type"
    : "Payment Type";
  return {
    booking: profile.bookingTerm || "Appointment",
    customer: profile.customerNoun || "Customer",
    location, category, payment,
  };
}

const resolve = (s: string, v: Vocab) =>
  s.replace(/\{BOOKING\}/g, v.booking)
   .replace(/\{CUSTOMER\}/g, v.customer)
   .replace(/\{CUSTOMERS\}/g, v.customer + "s")
   .replace(/\{LOCATION\}/g, v.location)
   .replace(/\{CATEGORY\}/g, v.category)
   .replace(/\{PAYMENT\}/g, v.payment);

/* ---- MEASURES (121 on the live account) ------------------------------------
   Verbatim, with the account-specific words tokenised. Order is the live order:
   the drawer does not sort alphabetically and an SE comparing side by side notices. */
const MEASURES_RAW: string[] = [
  "Advertiser Fees", "Earned", "Publisher Volume Ranking", "Publisher Commissions Ranking",
  "Publisher Conversion Rate Ranking", "Paid", "Agent Handle Time", "Agent Monolog",
  "Agent Talk Time", "Call Count", "Fees", "Revenue (Sale Amount)", "Caller Talk Time",
  "Connected Duration (seconds)", "Duration (seconds)", "IVR Duration (seconds)",
  "Overtalk Time", "Recording", "Silence Time", "Total Messages",
  "(Compliance) Call Recording", "(QA) Commitment to Help", "(QA) Proper Close",
  "(QA) Proper Greeting", "Account Verification / Set - Up", "Agent In-Call Behaviors",
  "Agent Post Call Behaviors", "AI Contained", "Answered", "Answered by Agent",
  "Answered by AI Messaging Agent", "Answered By AI Voice Agent", "Answered by Office",
  "{BOOKING} Schedule (Phrase)", "{BOOKING} Scheduled (AI)", "{BOOKING} Scheduled (Studio)",
  "{BOOKING}: Canceled", "{BOOKING}: Discussed", "{BOOKING}: Rescheduled",
  "{BOOKING}: Scheduled", "Ask for Assistance", "BASE SKILLS", "Base Skills Excellence",
  "Base Skills Need Reviewed", "Billing", "Business Hours: During", "Business Hours: Outside",
  "Call Not Answered", "Caller Placed on Hold", "Caller Type: Existing {CUSTOMER}",
  "Caller Type: New {CUSTOMERS}", "Sentiment Score", "Capture Address (Scorecard)",
  "Capture Email Address (Scorecard)", "Capture Full Name (Scorecard)",
  "Capture {PAYMENT} (Scorecard)", "Capture Phone Number (Scorecard)",
  "CCM: Dead Air", "CCM: Overtalk", "Closed Won", "Competitive Mention",
  "Conversion Likely (Industry)", "Difficulty Scheduling", "Duration: gt 1-minute",
  "Evaluated", "Financing Options Discussed", "Frustrated Caller", "General Info",
  "High Intent Lead", "Hold Time", "Inquiry Type: Billing and Payments",
  "Inquiry Type: Careers", "Inquiry Type: Hours and Directions", "Inquiry Type: Referral",
  "{PAYMENT} - Request/Verification", "Interaction", "Introduction",
  "Introduction/Review of Services Offered", "Lead Captured via SMS Agent",
  "Lead Converted", "New {BOOKING}", "Opt In", "Phone Ettiquette", "Problem Resolution",
  "Real {BOOKING} Scheduled", "Referral", "Repeat Caller", "Reviewed", "Run-Scorecard",
  "SMS Agent Offered", "SMS Callback", "SMS Engaged", "SMS Scheduled Callback",
  "Transfer to Live Agent", "Voice AI Agent Engaged", "Voice AI Agent Opt In", "Voice Mail",
  "AI Agent Answer Offset (Seconds)", "AI Agent Handle Time (Seconds)", "Interaction Count",
  "Transfer",
];

/* ---- DIMENSIONS (250 on the live account) ---------------------------------- */
const DIMENSIONS_RAW: string[] = [
  "Address (Reported)", "Address 2 (Reported)", "Final Campaign",
  "Advertiser Campaign ID (Invoca ID)", "Advertiser Campaign ID", "Advertiser Campaign",
  "Advertiser ID", "Advertiser ID (From Network)", "Advertiser", "Publisher Campaign ID",
  "Publisher ID", "Original Publisher ID (From Network)", "Original Publisher",
  "Best Location Latitude", "Best Location Longitude", "Call Direction",
  "Avg Call Duration", "Total Call Duration", "Signal Names", "Call Segment Path",
  "Call Result", "Source", "Caller ID", "Cell Phone (Reported)", "City",
  "Avg Connect Duration", "Total Connect Duration", "Country (Reported)",
  "Call Record ID", "Destination Phone Number", "During Hours", "AdWords Ad",
  "AdWords Ad Group", "AdWords Ad Group ID", "AdWords Ad ID", "AdWords Keyword Match Type",
  "AdWords Campaign", "AdWords Campaign ID", "AdWords Keywords", "AdWords Keywords ID",
  "Email Address (Reported)", "External Call Unique ID", "End of Call Reason",
  "Home Phone (Reported)", "Avg IVR Duration", "Total IVR Duration", "Total KeyPresses",
  "Media Type", "Phone Type", "Name (Reported)", "SMS Opt-In", "City (Reported)",
  "Promo Number Description", "Recorded", "Region (Invoca)", "Repeat Caller (Invoca)",
  "Signal Name", "SMS Message", "SMS Delivery Status", "SMS Opt-Out",
  "Call Start Time (Destination)", "State or Province (Reported)", "Type",
  "Verified Zip Code", "Zip Code (Reported)", "(Compliance) Call Recording (T/F)",
  "(QA) Commitment to Help (T/F)", "(QA) Proper Close (T/F)", "(QA) Proper Greeting (T/F)",
  "Agent", "AI Contained (T/F)", "AI Agent ID", "AI Agent Segment", "Fee",
  "Answered (T/F)", "Answered by Agent (T/F)", "Answered by AI Messaging Agent (T/F)",
  "Answered By AI Voice Agent (T/F)", "{BOOKING} Schedule (Phrase) (T/F)",
  "{BOOKING} Scheduled (AI) (T/F)", "{BOOKING} Scheduled (Studio) (T/F)",
  "{BOOKING}: Canceled (T/F)", "{BOOKING}: Discussed (T/F)",
  "{BOOKING}: Rescheduled (T/F)", "{BOOKING}: Scheduled (T/F)", "{BOOKING} Action",
  "{BOOKING} Scheduled", "{BOOKING} Status", "Area", "Audience Demographic",
  "Base Skills Excellence (T/F)", "Base Skills Need Reviewed (T/F)", "Billing (T/F)",
  "Billing Reason", "Business Hours: During (T/F)", "Business Hours: Outside (T/F)",
  "Call Not Answered (T/F)", "Callback Number", "Caller Placed on Hold (T/F)",
  "Caller Type: Existing {CUSTOMER} (T/F)", "Caller Type: New {CUSTOMERS} (T/F)",
  "Calling Page", "Call Intent", "Call Outcome", "Sentiment", "Call Type",
  "Capture Address (Scorecard) (T/F)", "Capture Email Address (Scorecard) (T/F)",
  "Capture Full Name (Scorecard) (T/F)", "Capture {PAYMENT} (Scorecard) (T/F)",
  "Capture Phone Number (Scorecard) (T/F)", "CCM: Dead Air (T/F)", "CCM: Overtalk (T/F)",
  "Masked Caller ID", "Closed Won (T/F)", "Competitive Mention (T/F)", "Consumer Name",
  "Consumer Zip", "Conversion Likely (Industry) (T/F)", "Converting URL",
  "Google Ads Customer ID", "Demo", "(Destination) Phone Number", "Destination Time Zone",
  "Difficulty Scheduling (T/F)", "Division", "Duration: gt 1-minute (T/F)",
  "(End) of Call Reason", "Evaluated (T/F)", "Evaluated By", "Existing {BOOKING} Time",
  "{LOCATION}", "{LOCATION} Address", "{LOCATION} City", "{LOCATION} Phone",
  "{LOCATION} State", "{LOCATION} Type", "{LOCATION} Website", "{LOCATION} Zip",
  "First Interaction Type", "Frustrated Caller (T/F)", "Google GBRAID", "Google Click ID",
  "SA360", "General Info (T/F)", "Geo Location", "Google Analytics Client ID",
  "Handled By", "High Intent Lead (T/F)", "Inquiry Type: Billing and Payments (T/F)",
  "Inquiry Type: Careers (T/F)", "Inquiry Type: Hours and Directions (T/F)",
  "Inquiry Type: Referral (T/F)", "{PAYMENT}", "{PAYMENT} Carrier", "Interaction (T/F)",
  "Interaction ID", "Interaction Type", "Detected Destination", "Invoca Unique ID",
  "IP Address", "(IVR) Keypresses", "Full Landing Page URL", "Website Language",
  "Lead Captured via SMS Agent (T/F)", "Lead Converted (T/F)", "Lead Score",
  "Line of Business", "Adobe Experience Cloud ID", "Meeting", "Member ID",
  "Microsoft Ads Click ID", "Network", "New {BOOKING} (T/F)", "Not Completed Reason",
  "Opt In (T/F)", "Priority Routing Phone Number", "{CUSTOMER} Email",
  "{CUSTOMER} First Name", "{CUSTOMER} Last Name", "{CUSTOMER} Type", "Piwik Visitor ID",
  "Placement", "Postal", "Preferred Day or Time", "Province",
  "Real {BOOKING} Scheduled (T/F)", "Reason for Call", "Referral (T/F)", "Region",
  "Repeat Caller (T/F)", "(Repeat) Caller", "Revenue", "Reviewed (T/F)", "Reviewed By",
  "Rollout Phase", "Run-Scorecard (T/F)", "SMS Agent Offered (T/F)", "SMS Callback (T/F)",
  "SMS Engaged (T/F)", "SMS Scheduled Callback (T/F)", "SMS Scheduled Callback Datetime",
  "SMS Session Status", "{CATEGORY}", "{CATEGORY} Needed", "Territory",
  "Transfer to Live Agent (T/F)", "User Agent", "Marketing Campaign", "Marketing Medium",
  "Marketing Source", "Marketing Search Terms", "Voice AI Agent Engaged (T/F)",
  "Voice AI Agent Opt In (T/F)", "Voice Mail (T/F)", "AI Agent Name",
  "AI Agent Qualification Status", "AI Agent Summary", "Google WBRAID", "Website Journey",
  "Global Transcript Search", "Interaction Count (T/F)", "Transfer (T/F)",
];

/* ---- the catalogue for one prospect ---------------------------------------- */

export interface Catalog { dimensions: string[]; measures: string[] }

/* Universal fields resolved to this prospect's vocabulary, THEN the prospect's own
   generated signals folded in. The signals are the part that genuinely differs per
   account on the live site ("Tire Purchase Intent", "Alignment Service Interest"), and
   they already exist in the profile — so they are read, not invented. */
export function buildCatalog(profile: CustomerProfile): Catalog {
  const v = vocabFor(profile);
  const own = ownSignals(profile);
  const measures = dedupe([...MEASURES_RAW.map((m) => resolve(m, v)), ...own]);
  const dimensions = dedupe([
    ...DIMENSIONS_RAW.map((d) => resolve(d, v)),
    ...own.map((s) => `${s} (T/F)`),          // every signal is also a group-by flag
  ]);
  return { dimensions, measures };
}

function ownSignals(profile: CustomerProfile): string[] {
  const r = profile.reports as Partial<CustomerProfile["reports"]>;
  const out: string[] = [];
  for (const c of r.digitalInsights?.signalColumns ?? []) if (c?.label) out.push(c.label);
  for (const s of r.conversationIntelligence?.signals ?? []) if (s?.name) out.push(s.name);
  return dedupe(out);
}

const dedupe = (a: string[]) => [...new Set(a.filter(Boolean))];

/* ---- per-template field specs ---------------------------------------------
   Captured field by field. `kind` decides WHICH catalogue the control offers, and
   getting it from the live option counts (121 vs 250) rather than from the label is
   what stops Pie Chart's Category offering measures. */
export type FieldKind = "measure" | "dimension";
export interface TemplateField { label: string; kind: FieldKind; repeatable?: boolean; optional?: boolean }
export interface TemplateSpec {
  /* "drawer" = the 500px Configuration panel; "columns" = the full-page column
     picker the three Reports use. Two different screens, one picker. */
  surface: "drawer" | "columns";
  dataFields: TemplateField[];
  chartOptions?: string[];          // checkbox labels under CHART DISPLAY OPTIONS
}

export const TEMPLATE_SPECS: Record<string, TemplateSpec> = {
  "Single Line Chart Over Time": {
    surface: "drawer",
    dataFields: [{ label: "Attribute", kind: "measure" }],
    chartOptions: ["Show regression line"],
  },
  "Multi-Line Chart Over Time": {
    surface: "drawer",
    dataFields: [{ label: "Attributes", kind: "measure", repeatable: true }],
    chartOptions: ["Show regression line"],
  },
  "Pie Chart": {
    surface: "drawer",
    dataFields: [{ label: "Category", kind: "dimension" }, { label: "Size (Rank)", kind: "measure" }],
  },
  "Stacked Bar": {
    surface: "drawer",
    dataFields: [{ label: "Category", kind: "dimension" }, { label: "Size (Rank)", kind: "measure" }],
  },
  "Dual Y-Axis": {
    surface: "drawer",
    dataFields: [
      { label: "Measure (Left Side)", kind: "measure" },
      { label: "Measure (Right Side)", kind: "measure" },
    ],
  },
  "Geo Heatmap": { surface: "drawer", dataFields: [{ label: "Measure", kind: "measure" }] },
  "KPI":         { surface: "drawer", dataFields: [{ label: "Measure", kind: "measure" }] },
  "Metric":      { surface: "drawer", dataFields: [{ label: "Measure", kind: "measure" }] },
  "Calls by Hour": {
    surface: "drawer",
    dataFields: [
      { label: "Attribute", kind: "measure" },
      { label: "Categories", kind: "dimension", repeatable: true, optional: true },
    ],
    chartOptions: ["Show heatmap", "Display all summaries"],
  },
  "Calls by Day of Week": {
    surface: "drawer",
    dataFields: [
      { label: "Attribute", kind: "measure" },
      { label: "Categories", kind: "dimension", repeatable: true, optional: true },
    ],
    chartOptions: ["Show heatmap", "Display all summaries"],
  },
  /* The three Reports do NOT open the drawer. They navigate to a full page titled
     "New Tile - <name>" with "Choose Your Columns": 20 accordion groups over ~371
     checkboxes, a search box, Select/Deselect All globally and per group, and a
     "Reorder columns" sidebar. Same column universe as the dimensions catalogue. */
  "Details Report":      { surface: "columns", dataFields: [] },
  "Summary Report":      { surface: "columns", dataFields: [] },
  "Transactions Report": { surface: "columns", dataFields: [] },
};

/* The live column picker's accordion groups, in order. */
export const COLUMN_GROUPS = [
  "Conversion Reporting Details", "Payout Details", "Advertiser Campaign Details",
  "Advertiser Details", "Publisher Details", "Invoca Data", "Contact Center Metrics",
  "Call Details", "IVR Details", "Signal Details", "Adwords Details",
  "External Call Details", "SMS Details", "Signals", "Scores", "Categories",
  "Voice AI Details", "Short Text Fields", "Long Text Fields", "Sentiment",
] as const;
