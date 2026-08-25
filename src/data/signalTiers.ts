import type { CustomerProfile } from "./schema";
import { isProspect, HEALTH_SPRING } from "./prospect";

/* =============================================================================
   Signal AI SILVER vs GOLD — two versions of one Conversation Intelligence report.
   -----------------------------------------------------------------------------
   Built 8/24/2026 for a Health Spring upsell call: they run Signal AI Silver today and the
   conversation is about moving them to Gold. The template is the prospect's own Conversation
   Intelligence report; the ONLY things that differ per tier are which signals fired, whether
   they are met or unmet, and what badges they carry.

   ⚠️⚠️ **VERSION 2, AND THE REASON FOR IT IS THE WHOLE RULE OF THIS REPO: THE REPLICA MAY NOT
   DO WHAT THE PRODUCT CANNOT.** V1 (commit a64c73f) also put a tier pill on the header, a
   sub-header, a fired-count, a caller-sentiment ribbon, a Signal AI Discovery panel, a
   "what reaches your systems" panel and a locked AI Summary tab into the rail. Every one of
   those was invented chrome — Invoca's real CI report has none of it — so a prospect who
   knows the product sees a screen that could not exist, and the demo stops being evidence.
   They were removed on request 8/24/2026. Anything added back here has to exist on the real
   report first.

   ⚠️ **THE ARGUMENT NOW LIVES IN THE SIGNAL LIST ALONE**, which is exactly where the product
   puts it: Silver shows 4 met and 3 UNMET, Gold shows 13 met with AI badges. The commentary
   that used to sit under each row moved to the COMMENTS TAB (see `comments` below) — a real
   tab on the real report, holding real free text anchored to a call time.

   ⚠️ **THE MISSES ARE ANCHORED IN REAL TURNS OF THEIR OWN CALL**, not the HCSC Medicare
   script the request arrived with. Health Spring's transcript is Diana Whitfield, new to
   Texas, no coverage, about $500 a month:

   | turn | what the caller actually said | why Silver misses it |
   |---|---|---|
   | 1:52 | "I'd like to move forward" | the phrase list has "sign me up" / "enroll me" / "I want to apply" |
   | 0:45 | "I'd like to stay around five hundred a month if I can" | the list has "too expensive" / "cheaper" / "what does it cost" |
   | 0:07 | "I don't have coverage yet" | the list has "uninsured" / "no insurance" / "lost my coverage" |

   That first row is the lead of the call. The consultation IS booked ninety seconds later, so
   Silver logs a real conversion as a non-conversion — and a missed signal raises no alert, it
   just produces a slightly lower number.

   ⚠️ **SILVER'S HITS ARE HONEST TOO, or the demo is a strawman.** Silver fires on
   "Consultation: Scheduled" — the AGENT says "schedule a consultation" at 1:59, which a phrase
   list genuinely catches — and on Prescription Coverage, because the word "prescriptions" is
   spoken twice. A tier comparison where the old product detects nothing is one a prospect
   stops believing.

   ⚠️ **SCOPED TO HEALTH SPRING.** `hasTierReports()` is false for every other prospect, so the
   two rows never appear on anyone else's My Reports and the routes refuse.
   ============================================================================= */

export type SignalTier = "silver" | "gold";

/** One row in the Analysis rail. `met: false` renders in the UNMET group. */
export interface TierSignal {
  name: string;
  /** "Keyword Spotting" | "Rules Based" | "AI" — Gold is the only tier that carries AI. */
  badges: string[];
  count: number;
  met: boolean;
}

/**
 * One entry on the Comments tab.
 *
 * ⚠️ **THIS IS THE TALK TRACK, PARKED SOMEWHERE THE PRODUCT ACTUALLY HAS.** The timing and the
 * phrase-list explanations used to print under each signal row, which no real Invoca report
 * does. A comment anchored to a call time is a real feature of this screen, so the same
 * argument now sits one tab away: invisible while the rail is on show, and there to read out
 * when a prospect asks why a signal did or did not fire.
 */
export interface TierComment {
  /** Call timecode the comment is anchored to, e.g. "1:52". */
  time: string;
  /** The signal it explains — the comment's subject line. */
  signal: string;
  text: string;
  /** True when it explains a MISS; renders with the muted treatment. */
  miss?: boolean;
}

export interface TierView {
  tier: SignalTier;
  signals: TierSignal[];
  comments: TierComment[];
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
  { name: "Consultation: Scheduled", badges: ["Keyword Spotting"], count: 1, met: true },
  { name: "Prescription Coverage Inquiry", badges: ["Keyword Spotting"], count: 2, met: true },
  { name: "Enrollment Intent", badges: ["Keyword Spotting"], count: 0, met: false },
  { name: "Price Sensitivity", badges: ["Keyword Spotting"], count: 0, met: false },
  { name: "Coverage Gap: Uninsured", badges: ["Keyword Spotting"], count: 0, met: false },
];

const SILVER_COMMENTS: TierComment[] = [
  { time: "1:52", signal: "Enrollment Intent", miss: true,
    text: `Caller: "I'd like to move forward." No phrase matched. The configured list holds "sign me up", "enroll me" and "I want to apply", and none of them were said. This is the lead of the call, and the consultation is booked ninety seconds later, so the call logs as a non-conversion.` },
  { time: "0:45", signal: "Price Sensitivity", miss: true,
    text: `Caller: "I'd like to stay around five hundred a month if I can." No phrase matched. The list holds "too expensive", "cheaper" and "what does it cost". A budget stated as a preference is still a budget.` },
  { time: "0:07", signal: "Coverage Gap: Uninsured", miss: true,
    text: `Caller: "I don't have coverage yet." No phrase matched. The list holds "uninsured", "no insurance" and "lost my coverage".` },
  { time: "1:59", signal: "Consultation: Scheduled",
    text: `Matched "schedule a consultation" — spoken by the AGENT, not the caller. Phrase spotting works here, and it is worth saying so out loud: the gap is intent, not detection in general.` },
];

/* -----------------------------------------------------------------------------
   GOLD — every signal fires, and the three badge types are all present.
   ⚠️ THE BADGE MIX IS THE POINT: Rules Based, Keyword Spotting AND AI on one rail. Gold does
   not replace the deterministic detections, it adds intent on top of them — so the QA and
   routing signals keep their original badges and the three misses come back as AI.
   -------------------------------------------------------------------------- */
const GOLD_SIGNALS: TierSignal[] = [
  { name: "(QA) Proper Greeting", badges: ["Keyword Spotting", "Rules Based"], count: 3, met: true },
  { name: "(QA) Proper Close", badges: ["Keyword Spotting"], count: 2, met: true },
  { name: "Answered by Agent", badges: ["Rules Based"], count: 0, met: true },
  { name: "Caller Type: New Member", badges: ["AI", "Rules Based"], count: 2, met: true },
  { name: "Coverage Gap: Uninsured", badges: ["AI"], count: 1, met: true },
  { name: "Price Sensitivity", badges: ["AI"], count: 1, met: true },
  { name: "Enrollment Intent", badges: ["AI"], count: 1, met: true },
  { name: "Consultation: Scheduled", badges: ["Keyword Spotting", "AI"], count: 3, met: true },
  { name: "Individual & Family Plan Interest", badges: ["AI"], count: 2, met: true },
  { name: "Dental & Vision Add-On Interest", badges: ["Keyword Spotting", "AI"], count: 2, met: true },
  { name: "Prescription Coverage Inquiry", badges: ["Keyword Spotting", "AI"], count: 2, met: true },
  { name: "Subsidy / Cost-Sharing Question", badges: ["AI"], count: 2, met: true },
  { name: "Contact Info Captured", badges: ["Rules Based"], count: 3, met: true },
];

const GOLD_COMMENTS: TierComment[] = [
  { time: "1:52", signal: "Enrollment Intent",
    text: `Caller: "I'd like to move forward." Read as intent rather than matched as a phrase, which is why it fires here and not on Silver. The consultation is booked ninety seconds later, so the conversion is credited to the call that produced it.` },
  { time: "0:45", signal: "Price Sensitivity",
    text: `Caller: "I'd like to stay around five hundred a month if I can." A budget stated as a preference is still a budget. No phrase on any list would have caught this wording.` },
  { time: "0:07", signal: "Coverage Gap: Uninsured",
    text: `Caller: "I don't have coverage yet." Detected from meaning; the words "uninsured" and "no insurance" never appear in the call.` },
  { time: "1:59", signal: "Consultation: Scheduled",
    text: `Fires on both tiers. Gold keeps the keyword detection and adds intent on top of it, which is why this row carries two badges rather than replacing one with the other.` },
  { time: "2:22", signal: "Contact Info Captured",
    text: `Rules based, unchanged between tiers. Worth pointing at when the question is "does Gold replace what we already have" — it does not.` },
];

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
  return tier === "silver"
    ? { tier, signals: SILVER_SIGNALS, comments: SILVER_COMMENTS }
    : { tier, signals: GOLD_SIGNALS, comments: GOLD_COMMENTS };
}
