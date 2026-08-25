import type { CustomerProfile } from "./schema";
import { isProspect, HEALTH_SPRING } from "./prospect";

/* =============================================================================
   Signal AI SILVER vs GOLD — two versions of one Conversation Intelligence report.
   -----------------------------------------------------------------------------
   Built 8/24/2026 for a Health Spring upsell call: they run Signal AI Silver today and the
   conversation is about moving them to Gold. The template is the prospect's own Conversation
   Intelligence report; what changes per tier is WHICH SIGNALS FIRE, WHAT BADGES they carry,
   and which Gold-only panels exist at all.

   ⚠️ **THE WHOLE ARGUMENT IS THE MISS, AND IT IS ANCHORED IN REAL TURNS OF THEIR OWN CALL.**
   Silver matches phrases; Gold reads intent. So the demo only lands if the misses are ones a
   prospect can verify by reading the transcript sitting next to the rail:

   | turn | what the caller actually said | why Silver misses it |
   |---|---|---|
   | 1:52 | "I'd like to move forward but I have questions about the deductible and subsidies" | the phrase list has "sign me up" / "enroll me" / "I want to apply" — none were said |
   | 0:45 | "I'd like to stay around five hundred a month if I can" | the list has "too expensive" / "cheaper" / "what does it cost" — none were said |
   | 0:07 | "I don't have coverage yet" | the list has "uninsured" / "no insurance" / "lost my coverage" |

   That first row is the lead of the call. The consultation IS booked ninety seconds later, so
   Silver logs a real conversion as a non-conversion — and a missed signal raises no alert, it
   just produces a slightly lower number. Nobody would ever know.

   ⚠️ **SILVER'S HITS ARE HONEST TOO, or the demo is a strawman.** Silver fires on
   "Consultation: Scheduled" — the AGENT says "schedule a consultation" at 1:59, which a phrase
   list genuinely catches — and on Prescription Coverage, because the word "prescriptions" is
   spoken twice. A tier comparison where the old product detects nothing is one a prospect
   stops believing. What Gold adds is the intent that was never said in matching words.

   ⚠️ **SCOPED TO HEALTH SPRING.** `tierReports()` returns nothing for every other prospect, so
   the two rows never appear on anyone else's My Reports and the routes refuse. To open this up
   later, widen that one function — the tier content below is per-prospect data, not a template.
   ============================================================================= */

export type SignalTier = "silver" | "gold";

/** One row in the Analysis rail. `met: false` renders in the UNMET group. */
export interface TierSignal {
  name: string;
  /** "Keyword Spotting" | "Rules Based" | "AI" — Gold is the only tier that carries AI. */
  badges: string[];
  count: number;
  met: boolean;
  /** Shown under an UNMET signal: the phrases the engine was looking for and did not hear. */
  missNote?: string;
  /** Shown under a MET signal on the Gold rail: the turn the intent was read from. */
  hitNote?: string;
}

export interface DownstreamRow {
  system: string;
  value: string;
  /** "good" prints in blue as a win, "bad" in red as the loss, undefined is neutral. */
  tone?: "good" | "bad";
}

export interface TierView {
  tier: SignalTier;
  label: string;              // "Signal AI Silver"
  /** One line under the title explaining what this engine can do. */
  blurb: string;
  signals: TierSignal[];
  /** Gold only — the sentiment ribbon. Empty on Silver, which cannot produce one. */
  sentiment: { slots: ("pos" | "neu" | "neg")[]; label: string } | null;
  /** Gold only — Discovery themes across the prospect's volume. */
  themes: { label: string; pct: number }[] | null;
  /** Gold only — whether the AI Summary tab has anything in it. */
  hasAiSummary: boolean;
  downstream: DownstreamRow[];
}

/* -----------------------------------------------------------------------------
   SILVER — a short list, phrase-matched, and it misses the conversion.
   ⚠️ DELIBERATELY SMALL (7 rows against Gold's 13). Silver is a phrase library somebody
   maintains by hand, so a long list is itself the thing being sold against: every entry is a
   plan year of upkeep. Four met, three unmet.
   -------------------------------------------------------------------------- */
const SILVER_SIGNALS: TierSignal[] = [
  { name: "(QA) Proper Greeting", badges: ["Keyword Spotting", "Rules Based"], count: 3, met: true },
  { name: "Answered by Agent", badges: ["Rules Based"], count: 0, met: true },
  { name: "Consultation: Scheduled", badges: ["Keyword Spotting"], count: 1, met: true,
    hitNote: `Matched "schedule a consultation" at 1:59 — spoken by the AGENT, not the caller.` },
  { name: "Prescription Coverage Inquiry", badges: ["Keyword Spotting"], count: 2, met: true },
  { name: "Enrollment Intent", badges: ["Keyword Spotting"], count: 0, met: false,
    missNote: `1:52 "I'd like to move forward." The list has "sign me up", "enroll me", "I want to apply". None were said.` },
  { name: "Price Sensitivity", badges: ["Keyword Spotting"], count: 0, met: false,
    missNote: `0:45 "I'd like to stay around five hundred a month if I can." The list has "too expensive", "cheaper", "what does it cost".` },
  { name: "Coverage Gap: Uninsured", badges: ["Keyword Spotting"], count: 0, met: false,
    missNote: `0:07 "I don't have coverage yet." The list has "uninsured", "no insurance", "lost my coverage".` },
];

/* -----------------------------------------------------------------------------
   GOLD — every signal fires, and the three badge types are all present.
   ⚠️ THE BADGE MIX IS THE POINT: Rules Based, Keyword Spotting AND AI on one rail. Gold does
   not replace the deterministic detections, it adds intent on top of them — so the QA and
   routing signals keep their original badges and the misses come back as AI.
   -------------------------------------------------------------------------- */
const GOLD_SIGNALS: TierSignal[] = [
  { name: "(QA) Proper Greeting", badges: ["Keyword Spotting", "Rules Based"], count: 3, met: true },
  { name: "(QA) Proper Close", badges: ["Keyword Spotting"], count: 2, met: true },
  { name: "Answered by Agent", badges: ["Rules Based"], count: 0, met: true },
  { name: "Caller Type: New Member", badges: ["AI", "Rules Based"], count: 2, met: true },
  { name: "Coverage Gap: Uninsured", badges: ["AI"], count: 1, met: true,
    hitNote: `0:07 "I don't have coverage yet." Read as intent, not matched as a phrase.` },
  { name: "Price Sensitivity", badges: ["AI"], count: 1, met: true,
    hitNote: `0:45 A budget stated as a preference is still a budget.` },
  { name: "Enrollment Intent", badges: ["AI"], count: 1, met: true,
    hitNote: `1:52 "I'd like to move forward." The lead of the call, and the consultation follows 90 seconds later.` },
  { name: "Consultation: Scheduled", badges: ["Keyword Spotting", "AI"], count: 3, met: true },
  { name: "Individual & Family Plan Interest", badges: ["AI"], count: 2, met: true },
  { name: "Dental & Vision Add-On Interest", badges: ["Keyword Spotting", "AI"], count: 2, met: true },
  { name: "Prescription Coverage Inquiry", badges: ["Keyword Spotting", "AI"], count: 2, met: true },
  { name: "Subsidy / Cost-Sharing Question", badges: ["AI"], count: 2, met: true },
  { name: "Contact Info Captured", badges: ["Rules Based"], count: 3, met: true },
];

/* The sentiment ribbon reads the call's own shape: neutral discovery, a positive close once
   the plan fits and the consultation is booked. Gold only — Silver has no sentiment model at
   all, which is why its ribbon is absent rather than flat. */
const GOLD_SENTIMENT: ("pos" | "neu" | "neg")[] = [
  "neu", "neu", "neu", "neu", "neu", "neu", "neu", "neu",
  "pos", "pos", "pos", "pos", "pos", "pos", "pos", "pos",
];

/* ⚠️ DISCOVERY IS ACROSS THEIR VOLUME, NOT THIS CALL — the heading says so on screen. These
   are themes nobody wrote a signal for, which is the argument: you cannot phrase-match a
   question you did not know callers were asking. */
const GOLD_THEMES: { label: string; pct: number }[] = [
  { label: "Deductible and subsidy eligibility confusion", pct: 31 },
  { label: "Relocated to state, no coverage in place", pct: 24 },
  { label: "Specialist access without referrals", pct: 19 },
  { label: "Dental and vision asked for as an add-on", pct: 16 },
  { label: "Monthly premium stated as a hard ceiling", pct: 12 },
];

/* -----------------------------------------------------------------------------
   DOWNSTREAM — where the miss actually costs money.
   ⚠️ THIS IS THE MARKETING ARGUMENT AND IT IS THE REASON THE PANEL EXISTS. Silver posts no
   conversion, so Smart Bidding optimises against an understated count and bids DOWN the exact
   campaigns producing consultations. Same call, opposite signal to the algorithm.
   -------------------------------------------------------------------------- */
const SILVER_DOWNSTREAM: DownstreamRow[] = [
  { system: "Salesforce", value: "Lead created, status Prospect" },
  { system: "Conversion", value: "Not flagged, no phrase matched", tone: "bad" },
  { system: "Google Ads", value: "No conversion sent", tone: "bad" },
  { system: "Adobe", value: "Call logged, no intent segment" },
];

const GOLD_DOWNSTREAM: DownstreamRow[] = [
  { system: "Salesforce", value: "Lead + Enrollment Intent + Consultation Booked", tone: "good" },
  { system: "Conversion", value: "Enrollment Intent, consultation booked", tone: "good" },
  { system: "Google Ads", value: "Conversion posted to Smart Bidding", tone: "good" },
  { system: "Adobe", value: "Suppression audience + open-enrollment intent segment", tone: "good" },
];

const VIEWS: Record<SignalTier, Omit<TierView, "tier">> = {
  silver: {
    label: "Signal AI Silver",
    blurb: "Matches the exact words and phrases on your list. Nothing else counts.",
    signals: SILVER_SIGNALS,
    sentiment: null,
    themes: null,
    hasAiSummary: false,
    downstream: SILVER_DOWNSTREAM,
  },
  gold: {
    label: "Signal AI Gold",
    blurb: "Reads meaning from the whole conversation, however the caller phrases it.",
    signals: GOLD_SIGNALS,
    sentiment: { slots: GOLD_SENTIMENT, label: "Positive · plan fit confirmed" },
    themes: GOLD_THEMES,
    hasAiSummary: true,
    downstream: GOLD_DOWNSTREAM,
  },
};

/** True when this prospect has the Silver / Gold pair of reports. */
export function hasTierReports(p: { id: string; customerName: string }): boolean {
  return isProspect(p, HEALTH_SPRING);
}

/**
 * The tier view for a prospect, or null when this prospect does not have these reports.
 *
 * ⚠️ Returns null rather than falling back to a generic pair: an invented Silver list on an
 * account that does not run Silver would put words in a prospect's mouth, and the signal
 * names above are Health Spring's own.
 */
export function tierView(profile: CustomerProfile, tier: SignalTier): TierView | null {
  if (!hasTierReports(profile)) return null;
  return { tier, ...VIEWS[tier] };
}

/** Counts for the header strip: how many of the engine's own signals fired. */
export function tierScore(v: TierView): { met: number; total: number } {
  return { met: v.signals.filter((s) => s.met).length, total: v.signals.length };
}
