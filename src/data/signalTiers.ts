/* ⚠️ **EXPLICIT `.ts` EXTENSIONS, because `engine/canary.ts` IMPORTS THIS FILE.** The engine
   project compiles with `module: nodenext`, which requires them; the app project allows them
   (`allowImportingTsExtensions`), so both resolve. `engine/core.ts` already imports
   `../src/data/schema.ts` the same way. Without this, adding the nightly tier check to the
   canary broke `tsc -p tsconfig.node.json` with five errors that read as type problems in
   THIS file rather than as a cross-project import. */
import type { CustomerProfile } from "./schema.ts";
import { isProspect, HEALTH_SPRING } from "./prospect.ts";

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
   puts it: Silver shows 4 met and 4 UNMET, Gold shows 13 met and only AI where Silver has nothing. The commentary
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
   | 1:31 | "Could I also add dental and vision?" | the list has "add-on" / "bundle" / "upgrade" |

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
  /* ⚠⚠ **A FOURTH MISS, asked for directly (10/9/2026): "for unmet signals have 4 high
     valuable signal that were unmet or missed because the exact phrase wasn't matched instead
     of just the 1 right now."** Three was not enough of an argument.
     It is grounded in this call like the other three: at 1:31 the caller asks "Could I also
     add dental and vision? I've been putting off an eye exam." That is a SECOND product line
     the caller raises, and the configured list holds "add-on", "bundle" and "upgrade" — none
     of which were said. The row's Gold twin is AI-only for exactly this reason. */
  { name: "Dental & Vision Add-On Interest", badges: ["Keyword Spotting"], count: 0, met: false },
];

const SILVER_COMMENTS: TierComment[] = [
  { time: "1:52", signal: "Enrollment Intent", miss: true,
    text: `Caller: "I'd like to move forward." No phrase matched. The configured list holds "sign me up", "enroll me" and "I want to apply", and none of them were said. This is the lead of the call, and the consultation is booked ninety seconds later, so the call logs as a non-conversion.` },
  { time: "0:45", signal: "Price Sensitivity", miss: true,
    text: `Caller: "I'd like to stay around five hundred a month if I can." No phrase matched. The list holds "too expensive", "cheaper" and "what does it cost". A budget stated as a preference is still a budget.` },
  { time: "0:07", signal: "Coverage Gap: Uninsured", miss: true,
    text: `Caller: "I don't have coverage yet." No phrase matched. The list holds "uninsured", "no insurance" and "lost my coverage".` },
  { time: "1:31", signal: "Dental & Vision Add-On Interest", miss: true,
    /* ⚠️ THE PHRASE LIST GETS ITS OWN SENTENCE, and that is not a style choice: `audit:tiers`
       reads the phrases out of `list holds ([^.]+)\.` and then fails the row if the quoted
       caller line contains one of them. A first draft went on to say `and the caller said
       "also add"` INSIDE that sentence, so "also add" was read as a configured phrase the
       caller demonstrably said — the check correctly calling the miss fake. */
    text: `Caller: "Could I also add dental and vision? I've been putting off an eye exam." No phrase matched. The list holds "add-on", "bundle" and "upgrade". What the caller actually said was "also add": a second product line the member asked for, on the call, and nobody is credited with it.` },
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
  /* ⚠️ AI ALONE, because Silver MISSES this row (see `SILVER_SIGNALS`): the caller says
     "Could I also add dental and vision?" and the configured list holds "add-on", "bundle"
     and "upgrade". A keyword badge here would claim a detection Silver's own rail denies. */
  { name: "Dental & Vision Add-On Interest", badges: ["AI"], count: 2, met: true },
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
  { time: "1:31", signal: "Dental & Vision Add-On Interest",
    text: `Caller: "Could I also add dental and vision?" Read as a second product line rather than matched as a phrase, which is why this row carries the AI badge ALONE — the configured list holds "add-on" and "bundle", so Silver has nothing to fire on.` },
  { time: "1:59", signal: "Consultation: Scheduled",
    text: `Fires on both tiers. Gold keeps the keyword detection and adds intent on top of it, which is why this row carries two badges rather than replacing one with the other.` },
  { time: "2:22", signal: "Contact Info Captured",
    text: `Rules based, unchanged between tiers. Worth pointing at when the question is "does Gold replace what we already have" — it does not.` },
];

/* =============================================================================
   EVERY PROSPECT GETS THE PAIR (8/27/2026) — derived from its own call
   -----------------------------------------------------------------------------
   Asked for directly: "do for all prospect and also for all prospect moving forward, of
   course reskinned for that prospect." Health Spring's hand-authored pair above is kept as
   its configured version; every other prospect's is DERIVED from the Conversation
   Intelligence report it already has — no engine phase and no schema slice, so all 13
   profiles on disk get it and a prospect generated next month does too.

   ⚠️⚠️ **THE MISSES HAVE TO BE REAL, AND THAT IS THE WHOLE DESIGN PROBLEM.** The demo's claim
   is "a keyword library did not fire on this call, and AI did." Inventing three misses per
   prospect would be trivial and worthless: an SE reads the caller's actual words off the
   transcript beside the rail, and a phrase the caller demonstrably DID say cannot be a miss.
   So each candidate is tested against the transcript, both ways:

     1. a CONCEPT is located in the caller's own turns by the SIDEWAYS phrasings real callers
        use ("what does that run", "can we hold that reservation", "do you also offer storage");
     2. that turn is then checked against the PHRASES a hand-maintained library would hold
        ("what does it cost", "price", "budget", plus the prospect's own booking term).
        Contains one -> Silver legitimately CATCHES it and it renders as a met row.
        Contains none -> a genuine MISS, quoted verbatim on the Comments tab.

   ⚠️ **SO THE NUMBER OF MISSES VARIES PER PROSPECT, and that is the honest outcome rather
   than a gap.** Measured across all 13: Roto-Rooter 5, four prospects 4, three 3, five 2, and
   **Marriott exactly 1** — its caller says "budget", "reservation" and "enroll me" out loud,
   so that call really is well covered by keywords. Five prospects also carry honest Silver
   HITS. A tier comparison where the old product detects nothing is one a prospect stops
   believing, which this file already says about Health Spring.

   ⚠️ **`hasTierReports` FAILS CLOSED.** No CI report, no transcript, or no genuine miss means
   no rows and a route that refuses — never an invented Silver list.

   ⚠️ **TWO ATTRIBUTION RULES, both found by reading the output across every profile:**
   • Scan ALL the turns and PREFER an uncaught one. Taking the first match declared "Silver
     catches this" for Continuing Life on an early turn while a later turn said the same thing
     in words no list holds.
   • A "late" concept may not land on the OPENING turn. Preferring a miss pulled Key-Whitman's
     booking intent onto "I'm interested in getting LASIK. I've worn glasses forever" — the
     first thing said, and a motivation rather than a decision to proceed.
   ============================================================================= */

interface Concept {
  key: string;
  /** Re-skinned per prospect: the intent row is named from its own booking term. */
  name: (bookingTerm: string) => string;
  /** How a real caller phrases it — deliberately NOT the words a library would hold. */
  soft: RegExp[];
  /** What a hand-maintained keyword library holds. Printed in the comment. */
  hard: string[];
  /** Scan from the END of the call: a decision to proceed happens after the discussion. */
  late?: boolean;
}

/* =============================================================================
   THE CONCEPTS ARE SALES-VALUE SIGNALS (revised 8/27/2026)
   -----------------------------------------------------------------------------
   Reported against Aptive: "I don't like the unmet signals, they don't show a strong missed
   value. Let's do sales related signals, like pricing, competitors, and anything else that
   may show the value that they missed out on with just phrase spotting."

   The first set included **Unmet Need Stated** and **Add-On Interest**, and the criticism is
   right: "this caller has a need" is what EVERY inbound call has, so missing it costs nothing
   an executive would fund. Each concept now names revenue that walked out of the call
   undetected:

   | signal | what missing it costs |
   |---|---|
   | Price Sensitivity | you cannot see which leads are lost on cost |
   | Competitor Comparison | competitive losses are invisible in the call data |
   | `<booking>` Intent | a caller who said yes is logged as a non-conversion |
   | Upsell Opportunity | expansion revenue nobody attributed to the call |
   | Urgency Expressed | hot leads are not prioritised or routed differently |
   | Contract Objection | the objection nobody is coached on |
   | Decision Maker Absent | the deal risk that explains the follow-up nobody made |

   ⚠️ **"Add-On Interest" BECAME "Upsell Opportunity" — the same detection, named for the
   money.** Aptive's caller asks "What about mosquitoes? Our backyard was terrible last
   summer" and the agent parks it for a spring quote: that is a second service line raised by
   the customer and never counted. The row is identical; the name is what makes the point.
   ============================================================================= */
const CONCEPTS: Concept[] = [
  { key: "price", name: () => "Price Sensitivity",
    soft: [/what does .{0,26}run/i, /how much .{0,30}run/i, /run me/i, /usually run/i, /in my range/i,
           /spend a fortune/i, /a month if i can/i, /stay (under|around)/i, /what would that look like/i,
           /out of pocket/i, /monthly fee/i, /just for me/i, /keep it (reasonable|manageable)/i,
           /without breaking/i, /ballpark/i, /what am i looking at/i,
           /* ⚠️ WIDENED 10/9/2026 — see the note above this array. Each of these is a caller
              asking about or constraining MONEY in words a hand-maintained list does not hold. */
           /\$\s?\d/, /\d+\s*(dollars|bucks)/i, /\d+\s*(a|per)\s*(month|year|week|visit)/i,
           /how much (do|would|does|are|will|might|can)/i,
           /what (do|would|does|will) (you|that|it|this) (charge|cost|run)/i,
           /what'?s (the|that) damage/i, /up ?front/i, /down payment/i, /deposit/i,
           /payment plan/i, /financ(e|ing)/i, /per (unit|room|person|visit|line|vehicle|head)/i,
           /looking to spend/i, /don'?t want to spend/i, /what kind of (money|numbers)/i,
           /is that (negotiable|flexible)/i, /comes? to\b.{0,12}\d/i,
           /* ⚠️ ROUND 2, READ OFF REAL TRANSCRIPTS rather than guessed: "what does the
              consultation and the imaging run" (the old gap was {0,26} characters, and that
              clause is 31), "money's a little tight right now", "trying to keep this
              manageable", "won't break the bank", "about how much am I looking at total". */
           /what does .{0,70}\brun\b/i, /money'?s? .{0,14}tight/i,
           /keep (it|this|things|costs?) (manageable|reasonable|down|low)/i,
           /break the bank/i, /how much am i looking at/i, /tight (budget|right now)/i,
           /not looking to spend/i, /within (my|our) means/i,],
    hard: ["too expensive", "cheaper", "what does it cost", "price", "pricing", "discount", "budget",
           "afford", "how much is", "cost"] },
  { key: "competitor", name: () => "Competitor Comparison",
    soft: [/different from the/i, /i keep seeing/i, /hadn'?t thought about/i, /shopping around/i,
           /other (companies|places|providers|dealers|guys)/i, /compared to/i, /a couple of quotes/i,
           /someone else (quoted|said|told)/i, /the (last|previous) (company|place|guy)/i,
           /we were with/i, /down the street/i, /online said/i,
           /* ⚠️ WIDENED 10/9/2026 */
           /another (company|provider|vendor|agency|firm|shop|dealer|clinic|place|option)/i,
           /our current (provider|vendor|company|carrier|agency|service|plan)/i,
           /we (currently|already) (use|have|work with|go through)/i,
           /been (using|with) (them|someone|another)/i, /quotes? from/i,
           /looking at (a few|a couple|other|two|three)/i,
           /talked to (a few|a couple|some|another|one other)/i,
           /narrowed (it|them) down/i, /second opinion/i,
           /switch(ing)? (from|providers|companies|over)/i,
           /the (other|previous|current) (provider|vendor|carrier|service)/i,
           /who else (do|does|is)/i, /weighing (a|our|my|the)/i,
           /* ⚠️ ROUND 2: "they quoted me a lot more", "compare the HECM and the HomeSafe
              options side by side", "I called an orthopedic place over on the other side of
              town first". */
           /quoted me/i, /side by side/i, /other side of town/i,
           /compare (the|these|those|it|them)/i, /checked? with (a|another|one)/i,],
    hard: ["competitor", "versus", "better than", "another company", "somewhere else"] },
  { key: "intent", name: (b) => `${b} Intent`, late: true,
    soft: [/can we (set|hold|do)/i, /what'?s the next step/i, /come try it out/i, /come out (today|tomorrow)/i,
           /let'?s (do|include)/i, /really need to see/i, /how do i set that up/i, /want to get moving/i,
           /move forward/i, /yes,? please/i, /can i do all of that/i, /wanted to see about/i,
           /getting rid of them/i, /can someone come out/i, /i'?d like to get started/i, /sign us up/i,
           /* ⚠️ WIDENED 10/9/2026 */
           /let'?s (get|set|go ahead)/i, /(i'?m|we'?re) ready/i, /when can (you|someone|we|i)/i,
           /what'?s your (availability|earliest|soonest)/i, /how soon can/i,
           /put (me|us) (down|on)/i, /go ahead and/i, /that works for (me|us)/i,
           /i'?ll take it/i, /where do (i|we) (sign|start)/i, /count (me|us) in/i,
           /sounds good,? (let|can|when|i|we|so)/i, /sign (me|us) up/i,
           /do that today/i, /get (me|us) (on|in)/i, /make that happen/i,
           /* ⚠️⚠️ ROUND 2, AND THIS IS THE ONE THAT WAS COSTING THE MOST. Every one of these
              calls ends in a booking, and almost none of them says "book" — the caller agrees
              to a slot instead: "Thursday at 10 works", "Thursday morning works best for me",
              "Let me lock that in", "the Pro Plan is probably the right call", "Shield Gold
              plus the pool add-on is the direction I want to go". A library keyed on "book" /
              "schedule" / "appointment" catches none of them, which is exactly the point. */
           /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tomorrow)\b.{0,34}\bworks?\b/i,
           /lock (that|it|this) in/i, /the right call/i, /direction i want/i,
           /that would be great/i, /^sounds good/i, /i'?m in\b/i,
           /(that|this) works (great|well|best|for)/i, /let'?s lock/i,],
    hard: ["book", "schedul", "reserve", "sign me up", "enroll", "appointment", "consultation",
           "test drive", "quote", "estimate"] },
  { key: "upsell", name: () => "Upsell Opportunity",
    /* ⚠️ `/how does .* work/` WAS HERE AND IS NOT AN UPSELL. It matched Aptive's "How does that
       work exactly? Is it just one visit?" — a clarifying question about the plan being bought
       — and because non-late concepts scan earliest-first it beat the real upsell moment four
       turns later: "What about mosquitoes? Our backyard was terrible last summer", which is a
       SECOND service line the caller raises and the agent parks for a spring quote. */
    soft: [/come with any/i, /can they .{0,24}too/i, /do i earn/i, /could i also add/i,
           /could i finance/i, /putting them together/i, /down the line/i, /is that worth it/i,
           /anything else i should/i, /do you also (offer|do|handle)/i, /does it cover/i,
           /what about .{0,30}\?/i, /while you'?re (here|out)/i,
           /* ⚠️ WIDENED 10/9/2026 — a caller raising a SECOND product or service line. */
           /do you (also|guys) (do|offer|handle|cover|sell|have)/i, /can (you|i|we) also/i,
           /what about/i, /also (need|interested|want)/i, /on top of/i,
           /second (one|unit|room|vehicle|property|line|location)/i,
           /while (you'?re|we'?re|someone'?s)/i, /throw in/i, /anything else/i,
           /is that (included|extra|separate)/i, /add (that|it|them|another)/i,
           /both (rooms|units|cars|properties|locations)/i, /the rest of/i,
           /* ⚠️ ROUND 2: "We've also got some spider webs ... that I'd love handled too",
              "Do you also deal with rodents?", "I also have a small pool ... Is that something
              you can cover?", "could you check my alignment too while I'm there?" */
           /do you also (deal|work|take care)/i, /(i|we)'?(ve)? ?also (got|have)/i,
           /handled too/i, /\btoo while/i, /while i'?m (there|in)/i,
           /something you can (cover|do|handle)/i, /check my .{0,24}\btoo\b/i,
           /add(ing)? (dental|vision|the|a|an)/i,
           /* ⚠️ ROUND 3: "I was also curious about the rose gold meteorite version. Do you
              have that too?", "Phone calls too? A lot of our leads call in", "Given our home
              value, is there anything with a higher limit?" — a caller reaching for a second
              product or a bigger one, in words no add-on keyword list holds. */
           /\btoo\?/i, /also curious/i, /anything with a (higher|bigger|larger|better)/i,
           /\bhigher (limit|tier|level|coverage)/i, /also (looking at|interested in|wondering)/i,],
    hard: ["add-on", "add on", "bundle", "upgrade", "warranty", "package", "extra", "upsell"] },
  { key: "urgency", name: () => "Urgency Expressed",
    soft: [/today or tomorrow/i, /this afternoon/i, /this week/i, /before we close/i, /right away/i,
           /got a little time/i, /slow for a while/i, /it'?s time for/i, /sooner the better/i,
           /won'?t be ready/i, /couple of weeks/i, /couple weeks/i, /getting worse/i,
           /can'?t wait (much|another)/i, /before (the|next) /i,
           /* ⚠️ WIDENED 10/9/2026 */
           /tomorrow/i, /this (weekend|month|morning)/i,
           /need (it|this|someone|somebody) (today|tomorrow|now|quick|fast)/i,
           /pretty (soon|quickly)/i, /time.?sensitive/i, /deadline/i, /running out/i,
           /(gotten|getting) (worse|bad)/i, /out of (hand|control)/i, /no time/i],
    hard: ["urgent", "emergency", "asap", "as soon as possible", "right now", "immediately"] },
  { key: "contract", name: () => "Contract Objection",
    soft: [/locked in/i, /lock us in/i, /tied (in|down)/i, /cancel any ?time/i, /get out of it/i,
           /how long am i committing/i, /month to month/i, /no commitment/i, /if it doesn'?t work out/i,
           /walk away/i,
           /* ⚠️ WIDENED 10/9/2026 */
           /locked? (in|into)/i, /long.?term/i, /obligat/i, /stuck (with|in|into)/i,
           /trial period/i, /how long (is|does|am|are) (the|i|we|it)/i,
           /get out early/i, /change my mind/i, /not performing/i, /if it'?s not working/i,
           /without (a|any) penalty/i, /sign anything/i],
    hard: ["contract", "commitment", "cancellation fee", "terms"] },
  { key: "decider", name: () => "Decision Maker Absent",
    soft: [/talk to my (wife|husband|partner|spouse)/i, /run it by/i, /check with my/i,
           /both of us/i, /my (wife|husband|partner) handles/i, /discuss it with/i,
           /not the one who decides/i,
           /* ⚠️ WIDENED 10/9/2026 */
           /talk to my (boss|manager|family|team|son|daughter|mother|father|mom|dad)/i,
           /(need|have|want) to (ask|talk to|check with|run this by)/i,
           /we'?ll (talk|discuss|decide|think)/i,
           /my (wife|husband|partner|boss|son|daughter) (will|would|needs|has)/i,
           /family decision/i, /not just my/i, /the two of us/i, /loop in/i,
           /* ⚠️ ROUND 3: "I want to run the numbers by my husband first" — the old
              `/run it by/` wanted the literal word "it". */
           /run (it|the numbers|this|that|them|those) by/i,
           /my (ceo|boss|manager|director|partner) (wants|needs|has|would)/i,],
    hard: ["decision maker", "authorized", "approval"] },
];

/**
 * Every phrase the concept lists treat as "a keyword library would hold this".
 *
 * ⚠️ **EXPORTED SO `scripts/enrich-ci-sales.ts` CANNOT DRIFT FROM THE DERIVATION.** That script
 * writes new caller turns into a transcript, and its first version policed its own shorter
 * list — so it happily produced "How is your PRICING stacking up compared to theirs?", a line
 * this file then classifies as CAUGHT rather than a miss. The enrichment would have been
 * quietly writing turns the report discounts. One list, two readers: the same reason
 * `voiceCopy` and `isProspect` moved out of the screens that first needed them.
 */
export const CONCEPT_HARD_PHRASES: string[] = [...new Set(CONCEPTS.flatMap((c) => c.hard))];

/** Stems of the prospect's own booking term — any library keyed on it holds these. */
function bookWords(bookingTerm: string): string[] {
  return bookingTerm.split(/[^A-Za-z]+/).filter((w) => w.length >= 4)
    .map((w) => w.toLowerCase().replace(/(ation|ment|ing|e)$/, ""));
}

interface FoundConcept {
  name: string;
  time: string;
  text: string;
  /** "miss" = no configured phrase matched; "caught" = Silver legitimately fires. */
  verdict: "miss" | "caught";
  phrases: string[];
}

type Turn = { speaker?: string; time: string; text: string };

function findConcepts(transcript: Turn[], bookingTerm: string): FoundConcept[] {
  const caller = transcript.filter((t) => t?.speaker !== "agent" && (t?.text ?? "").trim());
  const used = new Set<string>();
  const out: FoundConcept[] = [];
  for (const c of CONCEPTS) {
    const scan = c.late ? [...caller].reverse() : caller;
    /* ⚠⚠ **ONE TURN MAY SERVE TWO SIGNALS, AND REFUSING THAT WAS COSTING REAL MISSES
       (10/9/2026).** `used` was a hard exclusion, so the FIRST concept in value order to match
       a turn claimed it and every later concept that only matched the same turn found nothing.
       Measured on Denver Health: its caller says "my wife handles our calendar, is there any
       morning slot this week?" — one sentence carrying both a decision-maker and a timing ask.
       Urgency (rank 5) claimed it, so `Decision Maker Absent` (rank 7) reported NOT FOUND and
       the prospect showed a single unmet row.
       ⚠️ A real signal engine fires every signal an utterance satisfies, so sharing a turn is
       what the product does. `used` survives as a PREFERENCE rather than a veto: an unused
       turn always wins, and a shared one is used only when it is the only evidence there is —
       which keeps the Comments tab varied wherever the transcript allows it. */
    const all = scan.filter((t) => c.soft.some((r) => r.test(t.text)));
    const hits = all.some((t) => !used.has(t.time)) ? all.filter((t) => !used.has(t.time)) : all;
    if (!hits.length) continue;
    const hard = c.key === "intent" ? [...c.hard, ...bookWords(bookingTerm)] : c.hard;
    let missed = hits.find((t) => !hard.some((h) => t.text.toLowerCase().includes(h)));
    if (c.late && missed) {
      const i = caller.findIndex((t) => t.time === missed!.time);
      const later = hits.find((t) => caller.findIndex((x) => x.time === t.time) > caller.length * 0.4);
      if (i >= 0 && i < caller.length * 0.4 && later && later.time !== missed.time) missed = undefined;
    }
    const turn = missed ?? hits[0];
    used.add(turn.time);
    out.push({ name: c.name(bookingTerm), time: turn.time, text: turn.text.trim(),
      verdict: missed ? "miss" : "caught", phrases: hard.slice(0, 3) });
  }
  return out;
}

/** Rows a rules engine produces regardless of tier — they are not phrase lists at all. */
const DETERMINISTIC = /^(\(QA\)|Answered by Agent|Business Hours|Contact Info|Caller Type)/;
/**
 * The two rows a SHORT library still has: the QA greeting and the answered/routing rule.
 *
 * ⚠️ These are the ones Health Spring's hand-authored Silver keeps; it drops (QA) Proper
 * Close, Caller Type and Contact Info Captured. The claim is not that a rules engine cannot
 * do those — it is that this account's Silver library is small.
 */
const SILVER_LIBRARY = /^(\(QA\) Proper Greeting|Answered by Agent)$/;
/** The conversion row, which Silver catches off the AGENT's own scheduling phrase. */
const CONVERSION = /:\s*Scheduled$/i;

/**
 * The turn where the AGENT actually says the scheduling phrase.
 *
 * ⚠️ **THIS WAS `transcript[length - 2]`, AND IT ANCHORED THE CONVERSION COMMENT TO
 * "Thanks again, goodbye."** The comment explains that Silver matched the agent's scheduling
 * phrase, so pointing it at the farewell is the sort of small contradiction a prospect reads
 * straight off the transcript beside it. Found by looking at the rendered Comments tab.
 */
function schedulingTurn(transcript: Turn[]): Turn | undefined {
  /* ⚠️ **VERBS ONLY — the booking term itself is in the GREETING.** Including its stems
     anchored Marriott at 0:00, because "Thank you for calling Marriott Bonvoy *reservations*"
     contains "reservat". A scheduling phrase is a verb, and the turn that carries one is the
     turn Silver's keyword actually fired on. */
  /* ⚠️ "book" AS A STEM, not "book you"/"book a": Marriott's conversion turn is "I have
     BOOKED your ocean-view suite", and the narrower forms skipped it onto an earlier "set up
     a profile for you" — a Bonvoy profile, not a booking. */
  const verbs = ["schedul", "book", "set up", "set you up", "next step",
    "get that on the calendar", "get you in", "reserved"];
  const agent = transcript.filter((t) => t?.speaker === "agent");
  /* Search from the END: the offer to schedule comes late, and an early "we can book that
     for you" recap is not what closed the call. */
  return [...agent].reverse().find((t) => verbs.some((w) => t.text.toLowerCase().includes(w)))
    ?? agent[agent.length - 1];
}

/** One quoted line, trimmed for a comment. */
function quote(text: string): string {
  const t = text.length > 150 ? `${text.slice(0, 147)}...` : text;
  return `"${t}"`;
}

function derive(profile: CustomerProfile, tier: SignalTier): TierView | null {
  const ci = profile.reports.conversationIntelligence;
  const own = ci?.signals ?? [];
  const transcript = (ci?.transcript ?? []) as Turn[];
  if (!own.length || !transcript.length) return null;
  const book = profile.bookingTerm || "Appointment";
  const found = findConcepts(transcript, book);
  const misses = found.filter((f) => f.verdict === "miss");
  /* No genuine miss means no story. Fail closed rather than invent one. */
  if (!misses.length) return null;

  const det = own.filter((s) => DETERMINISTIC.test(s.name));
  const conv = own.find((s) => CONVERSION.test(s.name));
  const interest = own.filter((s) => !DETERMINISTIC.test(s.name) && s !== conv);
  const badges = (s: { badges?: string[] }) => (s.badges?.length ? s.badges : ["Keyword Spotting"]);

  if (tier === "silver") {
    const signals: TierSignal[] = [
      /* ⚠️⚠️ **SILVER IS DELIBERATELY SHORT, AND A FIRST PASS LOST THAT.** Including every
         deterministic row plus two interest rows produced Silver 12 against Gold 13 — a rail
         that reads as "two nearly identical reports" and throws away the point the signed-off
         Health Spring version makes at 7 against 13. A hand-maintained phrase library holds a
         FEW lists, because every entry is a plan year of upkeep, and its length is itself the
         thing being sold against.

         So Silver keeps exactly what Health Spring's own hand-authored Silver keeps: the QA
         greeting, the answered/routing rule, the conversion phrase, ONE product list, and then
         the intent rows it misses. Everything else is what Gold adds. Named explicitly rather
         than sliced by position, because the signal ORDER is the generator's and a slice would
         silently pick different rows for a prospect whose report is ordered differently. */
      ...det.filter((s) => SILVER_LIBRARY.test(s.name))
        .map((s) => ({ name: s.name, badges: badges(s), count: s.count ?? 0, met: true })),
      ...(conv ? [{ name: conv.name, badges: badges(conv), count: conv.count ?? 1, met: true }] : []),
      ...interest.slice(0, 1).map((s) => ({ name: s.name, badges: badges(s), count: s.count ?? 1, met: true })),
      ...found.filter((f) => f.verdict === "caught")
        .map((f) => ({ name: f.name, badges: ["Keyword Spotting"], count: 1, met: true })),
      ...misses.map((f) => ({ name: f.name, badges: ["Keyword Spotting"], count: 0, met: false })),
    ];
    const comments: TierComment[] = [
      ...misses.map((f) => ({ time: f.time, signal: f.name, miss: true,
        text: `Caller: ${quote(f.text)} No phrase matched. The configured list holds `
          + `${f.phrases.map((x) => `"${x}"`).join(", ")}, and none of them were said.` })),
      ...(conv ? [{ time: schedulingTurn(transcript)?.time ?? "0:00", signal: conv.name,
        text: `Matched on the AGENT's own scheduling phrase rather than anything the caller said. `
          + `Phrase spotting works here, and it is worth saying so out loud: the gap is intent, `
          + `not detection in general.` }] : []),
      /* ⚠️ **EVERY MISS GETS A COMMENT — the cap used to be 5 and it silently dropped one.**
         It was set to match Health Spring's hand-authored 4, which was fine while three misses
         was the most anyone had; with the sales-value concepts Goosehead and Mattress Firm hit
         SIX, and `audit:tiers` caught the sixth unmet row having no talk track behind it. An
         unexplained row is the one an SE gets asked about. */
    ].slice(0, 8);
    return { tier, signals, comments };
  }

  const signals: TierSignal[] = [
    ...det.map((s) => ({ name: s.name, badges: badges(s), count: s.count ?? 0, met: true })),
    ...(conv ? [{ name: conv.name, badges: [...badges(conv), "AI"], count: conv.count ?? 1, met: true }] : []),
    /* ⚠⚠ **A ROW CARRIES "Keyword Spotting" ONLY IF SILVER ACTUALLY HAS IT (10/9/2026).**
       Reported directly against the bottom of this rail: *"remove the keyword spotting tag for
       the bottom half because that signal was caught by AI and not a keyword spotting or a
       rule."* Right, and the old code could not tell the difference — it stamped
       `[...badges(s), "AI"]` on EVERY interest row, so rows like "Pest Intent: Ants & Spiders"
       and "Competitor Mention" claimed a keyword detection on a screen where Silver does not
       list them at all. A badge that says a phrase list found it, next to a Silver rail that
       never shows the row, is the two screens contradicting each other.
       ⚠️ **THE RULE IS THE SILVER RAIL, not a position in the array.** Silver's short library
       keeps exactly ONE interest row (see the Silver branch above), so that row genuinely
       fires on both tiers and keeps both badges — which is the "Gold adds, it does not
       replace" point this file has always made, and there is a comment on the tab saying so.
       Everything past it exists only because AI read it, so it is AI and nothing else.
       ⚠️ **THE DETERMINISTIC ROWS ARE NOT TOUCHED.** A QA phrase check and a routing rule are
       not AI on any tier; `(QA) Proper Close` is absent from Silver because this account's
       library is small, not because a rules engine cannot do it. */
    ...interest.map((s, i) => ({ name: s.name,
      badges: i === 0 ? [...badges(s), "AI"] : ["AI"],
      count: s.count ?? 1, met: true })),
    ...found.map((f) => ({ name: f.name,
      badges: f.verdict === "caught" ? ["Keyword Spotting", "AI"] : ["AI"], count: 1, met: true })),
  ];
  const comments: TierComment[] = [
    /* ⚠️ **"Read as INTENT" WAS WRONG FOR MOST OF THESE ROWS**, and the fix matters more now
       that there are four or five of them rather than one: a contract objection and an upsell
       are not intent, so the same sentence was mislabelling two thirds of the tab. It also now
       names the BADGE, which is the half of the 10/9 request about reflecting the Gold rail in
       the comments — an SE asked "why does this row say AI and that one say both?" can read the
       answer off the row's own comment. */
    ...misses.map((f) => ({ time: f.time, signal: f.name,
      text: `Caller: ${quote(f.text)} Read from what the caller MEANT rather than matched as a `
        + `phrase, which is why it fires here and not on Silver — and why this row carries the `
        + `AI badge alone, with no keyword or rule behind it.` })),
    ...(conv ? [{ time: schedulingTurn(transcript)?.time ?? "0:00", signal: conv.name,
      text: `Fires on both tiers. Gold keeps the keyword detection and adds intent on top of it, `
        + `which is why this row carries two badges rather than replacing one with the other.` }] : []),
    ...(det.length ? [{ time: "0:00", signal: det[0].name,
      text: `Rules based, unchanged between tiers. Worth pointing at when the question is `
        + `"does Gold replace what we already have" — it does not.` }] : []),
    /* ⚠️ THE TALK TRACK FOR THE BADGE SPLIT. An SE gets asked why some rows say AI and some
       say both, and the answer is the whole argument: both means the phrase list found it too,
       AI alone means this row exists only because of Gold. */
    ...(interest.length > 1 ? [{ time: "0:00", signal: interest[1].name,
      text: `Carries the AI badge alone, and so does every row below it: these are not on the `
        + `Silver rail at all, because no configured phrase list contains them. Where a row `
        + `shows BOTH badges the keyword still fired and Gold added intent on top of it — `
        + `which is the difference between adding detection and replacing it.` }] : []),
  ].slice(0, 8);
  return { tier, signals, comments };
}

/**
 * True when this prospect has the Silver / Gold pair.
 *
 * ⚠️ **EVERY PROSPECT WITH A CI REPORT AND AT LEAST ONE GENUINE MISS**, which as of 8/27/2026
 * is all 13 on disk. It used to be Health Spring alone. The gate is the MISS, not the name:
 * without one there is nothing to compare and the rows do not appear.
 */
export function hasTierReports(p: CustomerProfile): boolean {
  if (isProspect(p, HEALTH_SPRING)) return true;
  return derive(p, "silver") !== null;
}

/**
 * The tier view for a prospect, or null when this prospect does not have these reports.
 *
 * ⚠️ **A CONFIGURED PAIR BEATS THE DERIVED ONE**, the same precedent `voiceSpecFor` sets: the
 * hand-authored Health Spring lists are the words a human wrote for a specific upsell call, so
 * they win. Everyone else derives from their own transcript.
 */
export function tierView(profile: CustomerProfile, tier: SignalTier): TierView | null {
  if (isProspect(profile, HEALTH_SPRING)) {
    return tier === "silver"
      ? { tier, signals: SILVER_SIGNALS, comments: SILVER_COMMENTS }
      : { tier, signals: GOLD_SIGNALS, comments: GOLD_COMMENTS };
  }
  return derive(profile, tier);
}
