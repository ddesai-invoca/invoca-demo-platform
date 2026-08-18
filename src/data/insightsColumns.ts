import type { CustomerProfile } from "./schema";
import { vocabFor } from "./insightsCatalog";

/* =============================================================================
   insightsColumns — the Report column picker's groups and columns, MEASURED.
   -----------------------------------------------------------------------------
   Extracted from saved captures of all three live Report builders (8/18/2026) by
   walking their accordions in the DOM. This replaces the keyword rules that used to
   infer grouping, which were wrong in ways only the real data shows:

     • Signals pairs EVERY signal with its "(T/F)" variant — 150 entries, not 75.
       A keyword rule counting one form each gave 47.
     • Contact Center Metrics is ONLY the six talk-time measures. Durations live in
       IVR Details, which is not where you would guess.
     • Categories holds Agent, Facility, Specialty, Division, Line of Business and
       the marketing fields. A rule had put Agent under Contact Center Metrics.
     • Invoca Data is two columns (Original Publisher, Call Direction).

   THE THREE REPORTS ARE DIFFERENT, which the first build missed entirely:

     Details       20 groups, 371 columns, sidebar: Reorder columns
     Summary       11 groups, 121 columns — the MEASURES only — sidebar: Group By
                   AND Reorder columns, because a summary aggregates
     Transactions  21 groups, 404 columns = Details + RingPool Details (22) plus
                   extra Call Details and IVR columns

   OUR TOTALS RUN BELOW THAT ACCOUNT'S and that is correct, not a gap to close. Almost
   all of the difference is the Signals group: the captured account has 75 configured
   signals (150 entries with their T/F twins) while a prospect has however many its own
   profile generated — Shady Blinds has 11. Scores is the same story (that account has
   ten account-specific scorecards on top of the ten generic ones). Three groups also
   carry a few more aggregatable columns here than live shows (Payout 5 v 4, IVR 10 v 3):
   left as is deliberately, since every one of them is genuinely summable and a shorter
   list would be a guess at which ones that account chose to expose.

   Prospect words are tokenised the same way as insightsCatalog: {BOOKING},
   {CUSTOMER}, {LOCATION}, {CATEGORY}, {PAYMENT}. The Signals group is NOT hard-coded
   — it is built from the prospect's own generated signals, paired with (T/F) exactly
   as the live page pairs them.
   ============================================================================= */

/* One line per group: "Group\tCol~Col~Col". Kept in the captured order, which is the
   order the accordions render in, and stored as text rather than 400 array literals so
   the capture stays legible and diffable against a future re-capture. */
const TABLE = `
Conversion Reporting Details	Address (Reported)~Address 2 (Reported)~Revenue (Sale Amount)~Cell Phone (Reported)~Country (Reported)~Email Address (Reported)~Home Phone (Reported)~Name (Reported)~City (Reported)~State or Province (Reported)~Zip Code (Reported)
Payout Details	Advertiser Fees~Earned~Paid~Fees~Call Result~Margin
Advertiser Campaign Details	Final Campaign~Advertiser Campaign ID (Invoca ID)~Advertiser Campaign ID~Advertiser Campaign
Advertiser Details	Advertiser ID (From Network)~Advertiser~Matching Advertiser Payin Policies
Publisher Details	Publisher Volume Ranking~Publisher Campaign ID~Publisher Commissions Ranking~Publisher Conversion Rate Ranking~Publisher ID~Original Publisher ID (From Network)~Matching Publisher Payout Policies
Invoca Data	Original Publisher~Call Direction
Contact Center Metrics	Agent Handle Time~Agent Monolog~Agent Talk Time~Caller Talk Time~Overtalk Time~Silence Time
Call Details	Call Record ID~Transaction ID~Best Location Latitude~Best Location Longitude~Call Count~Call Segment Path~Source~Caller ID~City~Corrected At~Destination Phone Number~During Hours~End of Call Reason~Media Type~Phone Type~Number Pool Number Type~Order ID~Payin Conditions~Payout Conditions~Promo Number Description~Qualified Regions~Recorded~Recording~Region (Invoca)~Repeat Caller (Invoca)~Call Start Time~Call Start Time (Destination)~Transaction Count~Type~Transfer Type~Verified Zip Code~Promo Number ID
IVR Details	Avg Call Duration~Total Call Duration~Connected Duration (seconds)~Avg Connect Duration~Total Connect Duration~Duration (seconds)~IVR Duration (seconds)~Avg IVR Duration~Total IVR Duration~Key 1~Key 2~Key 3~Key 4~Total KeyPresses
Signal Details	Signal Names~Signal Name
Adwords Details	AdWords Ad~AdWords Ad Group~AdWords Ad Group ID~AdWords Ad ID~AdWords Keyword Match Type~AdWords Campaign~AdWords Campaign ID~AdWords Keywords~AdWords Keywords ID
RingPool Details	Pool Param 1 Name~Pool Param 2 Name~Pool Param 3 Name~Pool Param 4 Name~Pool Param 5 Name~Pool Param 6 Name~Pool Param 7 Name~Pool Param 8 Name~Pool Param 9 Name~Pool Param 10 Name~Pool Param 10 Value~Pool Param 1 Value~Pool Param 2 Value~Pool Param 3 Value~Pool Param 4 Value~Pool Param 5 Value~Pool Param 6 Value~Pool Param 7 Value~Pool Param 8 Value~Pool Param 9 Value~Traffic Source~Search Type
External Call Details	External Call Unique ID
SMS Details	SMS Opt-In~SMS Message~SMS Delivery Status~SMS Opt-Out~Total Messages
Scores	Agent In-Call Behaviors~Agent Post Call Behaviors~Answered by Office~Ask for Assistance~BASE SKILLS~Hold Time~Introduction~Introduction/Review of Services Offered~Phone Ettiquette~Problem Resolution
Categories	Agent~Call Type~Division~Evaluated By~{LOCATION}~Line of Business~Reviewed By~{CATEGORY}~Marketing Campaign~Marketing Medium~Marketing Source~Marketing Search Terms
Voice AI Details	AI Agent ID~AI Agent Segment~Answered By AI Voice Agent~Answered By AI Voice Agent (T/F)~Voice AI Agent Engaged~Voice AI Agent Engaged (T/F)~Voice AI Agent Opt In~Voice AI Agent Opt In (T/F)~AI Agent Answer Offset (Seconds)~AI Agent Handle Time (Seconds)~AI Agent Name~AI Agent Qualification Status~AI Agent Summary
Short Text Fields	Fee~{BOOKING} Action~{BOOKING} Scheduled~{BOOKING} Status~Area~Audience Demographic~Billing Reason~Callback Number~Call Intent~Call Outcome~Masked Caller ID~Consumer Name~Consumer Zip~Converting URL~Google Ads Customer ID~Demo~(Destination) Phone Number~Destination Time Zone~(End) of Call Reason~Existing {BOOKING} Time~{LOCATION} Address~{LOCATION} City~{LOCATION} Phone~{LOCATION} State~{LOCATION} Type~{LOCATION} Zip~First Interaction Type~Google GBRAID~Google Click ID~SA360~Geo Location~Google Analytics Client ID~Handled By~{PAYMENT} Carrier~Interaction ID~Interaction Type~Detected Destination~Invoca Unique ID~IP Address~(IVR) Keypresses~Website Language~Lead Score~Adobe Experience Cloud ID~Meeting~Member ID~Microsoft Ads Click ID~Network~Not Completed Reason~Priority Routing Phone Number~{CUSTOMER} Email~{CUSTOMER} First Name~{CUSTOMER} Last Name~{CUSTOMER} Type~Piwik Visitor ID~Placement~Postal~Preferred Day or Time~Province~Reason for Call~Region~(Repeat) Caller~Revenue~Rollout Phase~SMS Scheduled Callback Datetime~SMS Session Status~{CATEGORY} Needed~Territory~User Agent~Google WBRAID
Long Text Fields	Calling Page~{LOCATION} Website~Full Landing Page URL~Website Journey
Sentiment	Sentiment Score~Sentiment
`.trim();

export interface ColumnGroup { name: string; columns: string[] }

/* Groups that only the Transactions builder shows. */
const TRANSACTIONS_ONLY = new Set(["RingPool Details"]);

/* The Summary builder shows MEASURES only, in these groups and this order. */
const SUMMARY_GROUPS = [
  "Payout Details", "Publisher Details", "Contact Center Metrics", "Call Details",
  "Conversion Reporting Details", "IVR Details", "SMS Details", "Signals", "Scores",
  "Voice AI Details", "Sentiment",
];

/* A column is a MEASURE when a summary could aggregate it: money, time, counts,
   scores and signal tallies. Everything else is a dimension you slice by.

   ⚠️ A BOOLEAN FLAG IS A MEASURE IN A SUMMARY, which is not obvious and is why the
   Summary builder came out two groups short at first. Live Summary shows Signals with
   75 columns and Voice AI with 5 — the signal names and "Answered By AI Voice Agent",
   "Voice AI Agent Engaged", "Voice AI Agent Opt In". None of those read as a metric,
   but a summary COUNTS them: how many calls hit this signal. The tell is structural
   rather than lexical — every one of them has a "<name> (T/F)" twin in its own group,
   which is exactly what a countable flag looks like. `countableFlags()` below finds
   them from the group's own contents, so it works for a prospect's generated signals
   without naming any of them. Filtering on words alone dropped both groups entirely. */
function countableFlags(columns: string[]): Set<string> {
  const tf = new Set(columns.filter((c) => c.endsWith(" (T/F)")).map((c) => c.slice(0, -6)));
  return new Set(columns.filter((c) => tf.has(c)));
}

function isMeasure(col: string): boolean {
  return /fees?$|^earned$|^paid$|margin|ranking|revenue|handle time|monolog|talk time|overtalk|silence|duration|keypresses|^call count$|transaction count|hold time|total messages|score|\(seconds\)|^interaction count$/i
    .test(col) || /^(BASE SKILLS|Introduction|Problem Resolution|Phone Ettiquette|Ask for Assistance|Answered by Office|Agent In-Call Behaviors|Agent Post Call Behaviors|Introduction\/Review of Services Offered)$/.test(col);
}

const resolveTokens = (s: string, p: CustomerProfile) => {
  const v = vocabFor(p);
  return s.replace(/\{BOOKING\}/g, v.booking).replace(/\{CUSTOMER\}/g, v.customer)
    .replace(/\{LOCATION\}/g, v.location).replace(/\{CATEGORY\}/g, v.category)
    .replace(/\{PAYMENT\}/g, v.payment);
};

/* The prospect's OWN signals, each paired with its (T/F) twin exactly as the live
   Signals accordion pairs them — that pairing is why the live count is double. */
function signalsGroup(profile: CustomerProfile): string[] {
  const r = profile.reports as Partial<CustomerProfile["reports"]>;
  const names = [...new Set([
    ...(r.digitalInsights?.signalColumns ?? []).map((c) => c?.label).filter(Boolean) as string[],
    ...(r.conversationIntelligence?.signals ?? []).map((s) => s?.name).filter(Boolean) as string[],
  ])];
  return names.flatMap((n) => [n, `${n} (T/F)`]);
}

export type ReportKind = "details-report" | "summary-report" | "transactions-report";

export function columnGroupsFor(profile: CustomerProfile, kind: ReportKind): ColumnGroup[] {
  const parsed: ColumnGroup[] = TABLE.split("\n").map((line) => {
    const [name, cols] = line.split("\t");
    return { name, columns: cols.split("~").map((c) => resolveTokens(c, profile)) };
  });
  /* Signals is inserted at its captured position — after SMS Details, before Scores. */
  const withSignals: ColumnGroup[] = [];
  for (const g of parsed) {
    if (g.name === "Scores") withSignals.push({ name: "Signals", columns: signalsGroup(profile) });
    withSignals.push(g);
  }

  if (kind === "summary-report") {
    /* Measures only, and only the groups the Summary builder shows. */
    return SUMMARY_GROUPS
      .map((n) => withSignals.find((g) => g.name === n))
      .filter((g): g is ColumnGroup => !!g)
      .map((g) => {
        const flags = countableFlags(g.columns);
        return { name: g.name, columns: g.columns.filter((c) => flags.has(c) || isMeasure(c)) };
      })
      .filter((g) => g.columns.length > 0);
  }
  return withSignals
    .filter((g) => kind === "transactions-report" || !TRANSACTIONS_ONLY.has(g.name))
    .filter((g) => g.columns.length > 0);
}

/* What the Reorder sidebar starts with, and whether a Group By control appears —
   both measured per report. */
export function sidebarFor(kind: ReportKind): { groupBy: boolean; seeded: string[] } {
  if (kind === "summary-report") return { groupBy: true, seeded: [] };
  if (kind === "transactions-report") return { groupBy: false, seeded: ["Call Record ID", "Transaction ID"] };
  return { groupBy: false, seeded: ["Call Record ID"] };
}
