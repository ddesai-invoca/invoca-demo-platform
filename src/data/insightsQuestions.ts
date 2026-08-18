import type { CustomerProfile } from "./schema";
import { buildCatalog, vocabFor } from "./insightsCatalog";

/* =============================================================================
   insightsQuestions — what "Build With AI" can be asked, and how a question
   becomes a tile.
   -----------------------------------------------------------------------------
   THE RESOLVER RETURNS A TEMPLATE CHOICE, NOT A DRAWING. It answers with
   `{ template, name, measures, dimensions }` and hands that to `buildTile`, the
   same function the Configuration drawer uses. So an AI-built tile is byte-for-byte
   the same shape as a hand-built one, which is the standing architecture's rule:
   new tiles are produced by editing the TEMPLATES, not by inventing a look per
   answer. It also means every AI tile inherits the measured ThoughtSpot geometry
   for free, and there is no second renderer to keep in sync.

   IT IS DETERMINISTIC AND LOCAL — no model call. Two reasons, both precedent in
   this repo. First, `parseQuestionList` already established that sending text the
   user typed through Haiku just to be echoed back invites paraphrase and drift.
   Second, and more important here, the standing architecture says a number must
   never change once shown: asking the same question twice, or building a tile from
   an answer, has to agree. A per-answer model call returning 34% and then 41% is
   the exact failure that rules out. `buildTile` seeds off the profile id plus the
   choice, so the same question always yields the same tile.

   ⚠️ EVERY QUESTION IS TOKENISED. The examples came from a healthcare account and
   name Facility, Specialty, Medicare and Insurance Type. Shipping those verbatim
   would put "Medicare Status" on a blinds company's dashboard, which the standing
   architecture calls out by name. {BOOKING}/{LOCATION}/{CATEGORY}/{PAYMENT}/
   {CUSTOMER} resolve per prospect through `vocabFor`, the same mechanism the column
   catalogue uses.
   ============================================================================= */

export interface TileChoices {
  template: string;
  name: string;
  measures: string[];
  dimensions: string[];
}

export interface QuestionCategory { label: string; icon: string; questions: string[] }

/* The catalogue an SE can browse or type from. Kept as prose questions rather than
   as pre-built specs so the resolver is exercised by the examples too: if a listed
   question stops resolving, the list is the regression test. */
export const QUESTION_CATALOG: QuestionCategory[] = [
  { label: "Volume & Traffic", icon: "insert_chart", questions: [
    "Total Call Count",
    "Total Interactions",
    "Call Count by Marketing Medium",
    "Call Count by Marketing Source",
    "Call Count by Marketing Campaign",
    "Call Volume Over Time",
  ]},
  { label: "Answer & Handling", icon: "phone_in_talk", questions: [
    "Total Answered by Agent",
    "Calls Not Answered",
    "Answered by AI Voice Agent",
    "Answered by AI Messaging Agent",
    "Answer Rate",
    "AI vs Human Answer Breakdown",
    "AI Containment Rate Over Time",
    "AI Escalation Rate by AI Agent",
    "AI Handle Time vs Agent Handle Time by {LOCATION}",
    "AI Opt In Rate by Marketing Medium",
  ]},
  { label: "{BOOKING}s", icon: "event_available", questions: [
    "{BOOKING}s Scheduled",
    "{BOOKING}s Discussed",
    "New {BOOKING}s",
    "{BOOKING} Conversion Rate",
    "{BOOKING}s Scheduled by {LOCATION}",
    "{BOOKING}s Scheduled by {CATEGORY}",
    "{BOOKING} Conversion Funnel by {LOCATION}",
    "{BOOKING} Scheduling Rate by Marketing Campaign",
    "{BOOKING} Cancellation Rate by {LOCATION}",
    "Discussion to Booking Gap by {CATEGORY}",
  ]},
  { label: "Revenue & Leads", icon: "payments", questions: [
    "Total Revenue",
    "High Intent Leads",
    "Leads Converted",
    "Revenue by Marketing Campaign",
    "Revenue by {LOCATION}",
    "High Intent Lead to Conversion Rate by Marketing Source",
    "Month over Month Revenue Growth",
    "Revenue per Call by {LOCATION}",
  ]},
  { label: "{CATEGORY} & Segments", icon: "category", questions: [
    "Call Count by Call Intent",
    "{PAYMENT} Breakdown",
    "{PAYMENT} Mix by {LOCATION}",
    "Call Count by {CATEGORY}",
    "Call Intent Distribution by {CATEGORY}",
    "Repeat Caller vs New Caller Conversion Rate",
  ]},
  { label: "Quality & Performance", icon: "verified", questions: [
    "Average Call Duration",
    "Answer Rate Trend",
    "Sentiment Score Trend by {LOCATION}",
    "Top Agents by {BOOKING} Conversion Rate",
    "Agent Monolog Rate by Agent",
    "Not Completed Reason Breakdown",
    "Call Volume vs Answer Rate Over Time",
  ]},
];

const resolveTokens = (s: string, p: CustomerProfile) => {
  const v = vocabFor(p);
  return s.replace(/\{BOOKING\}/g, v.booking).replace(/\{CUSTOMER\}/g, v.customer)
    .replace(/\{LOCATION\}/g, v.location).replace(/\{CATEGORY\}/g, v.category)
    .replace(/\{PAYMENT\}/g, v.payment);
};

/**
 * The catalogue with this prospect's own vocabulary substituted in, FILTERED to the
 * questions this prospect's data can actually answer.
 *
 * ⚠️ The filter is the point, not tidiness. The example list came from a mature
 * healthcare account and includes measures a smaller one simply does not have — "AI
 * Containment Rate" resolves there and not on Shady Blinds. Offering a chip that
 * answers "I could not match that" is worse than not offering it, because the SE
 * clicked something we put in front of them. It also keeps the list honest as a
 * regression test: every question shown is one that resolves.
 */
export const questionsFor = (p: CustomerProfile): QuestionCategory[] =>
  QUESTION_CATALOG
    .map((c) => ({
      ...c,
      label: resolveTokens(c.label, p),
      questions: c.questions
        .map((q) => resolveTokens(q, p))
        .filter((q) => resolveQuestion(p, q) !== null),
    }))
    .filter((c) => c.questions.length > 0);

/* ---------------------------------------------------------------------------
   Matching a phrase to the prospect's own measures and dimensions
   --------------------------------------------------------------------------- */

const RATE = /\b(rate|percent|percentage|%|ratio|share of|conversion)\b/i;

const STOP = new Set(["the", "by", "of", "and", "vs", "versus", "per", "over", "a", "an",
  "in", "for", "to", "total", "show", "me", "what", "is", "are", "how", "many", "much",
  "chart", "tile", "graph", "count", "top", "best", "worst", "bottom", "ranked", "ranking",
  /* aggregations describe HOW to read a measure, not which one it is */
  "avg", "average", "mean", "median", "sum",
  /* "volume" is a way of SAYING count, not a metric anyone has: dropping it lets
     "Call Volume Over Time" reach the measure named Call Count. */
  "volume"]);

/* Words that appear in dozens of measure names and so cannot identify one on their own.
   The rule is NOT "reject an all-generic overlap" — that was the first version and it
   refused "Total Call Count", whose only significant word is the generic "call", against
   the measure literally named Call Count. The rule is: if the question named something
   SPECIFIC and the match does not contain it, refuse. "Appointment Conversion Rate"
   names "appointment", which "Publisher Conversion Rate Ranking" lacks, so the shared
   {conversion, rate} is an artefact of Invoca's naming rather than an answer — and Shady
   Blinds has no appointment measure at all, so declining is correct there. */
const GENERIC = new Set(["conversion", "rate", "percent", "ratio", "score", "time",
  "call", "interaction", "agent", "ai", "new"].map((w) => stemOf(w)));

/* A light stem, applied to BOTH sides so the forms meet in the middle: drop a trailing
   "s", then "ed", then "e". "Calls" -> "call" reaches "Call Count"; "Answer" and
   "Answered" both reach "answer"; "Schedule" and "Scheduled" both reach "schedul".
   Plurals alone were not enough — "Answer Rate" could not find the measure "Answered",
   which is why three catalogue questions declined against an account that has it. */
function stemOf(w: string): string {
  let x = w;
  if (x.length > 3 && x.endsWith("s")) x = x.slice(0, -1);
  if (x.length > 3 && x.endsWith("ed")) x = x.slice(0, -2);
  if (x.length > 3 && x.endsWith("e")) x = x.slice(0, -1);
  return x;
}

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map(stemOf);

/* The same, minus anything inside parentheses. ThoughtSpot measure names carry
   parenthetical QUALIFIERS — "(Sale Amount)", "(Seconds)", "(Invoca)", "(T/F)" — which
   are not part of what the metric is called. Counting them in the denominator made
   "Total Revenue" score 0.41 against "Revenue (Sale Amount)" and fall under the bar. */
const coreWords = (s: string) => words(s.replace(/\([^)]*\)/g, " "));

/**
 * Best catalogue entry for a phrase, scored on shared significant words.
 * Returns null rather than a weak guess.
 *
 * ⚠️ THE SCORE NEEDS A COVERAGE TEST, NOT JUST OVERLAP. Scoring on shared letters
 * alone made "Answer Rate" match "AI Agent Answer Offset (Seconds)" and
 * "Appointment Conversion Rate" match "Publisher Conversion Rate Ranking" — one
 * shared word out of four is enough to win when nothing better exists, and the
 * result is a tile confidently labelled with a metric nobody asked for. A match now
 * has to cover most of what the QUESTION asked for AND a fair share of the option's
 * own words, so a long unrelated measure cannot win on a single common token.
 */
function bestMatch(phrase: string, options: string[]): string | null {
  const want = new Set(words(phrase));
  if (!want.size) return null;
  const wantSpecific = [...want].filter((w) => !GENERIC.has(w));
  let best: string | null = null;
  let bestCover = 0;

  for (const o of options) {
    const have = coreWords(o);
    if (!have.length) continue;
    const haveLen = have.reduce((n, w) => n + w.length, 0);
    let hit = 0;
    const overlap: string[] = [];
    for (const w of have) if (want.has(w)) { hit += w.length; overlap.push(w); }
    if (!hit) continue;
    /* If the question named a distinctive word, the match has to contain one of them. */
    if (wantSpecific.length && !overlap.some((w) => wantSpecific.includes(w))) continue;
    /* ⚠️ COVERAGE IS MEASURED ON THE OPTION, NOT ON THE QUESTION. Requiring the
       question to be well covered looked equivalent and was not: a question carries
       words no measure name contains ("volume", "avg", "channel", "hour"), so that
       test rejected "Call Volume Over Time" and "Avg Call Duration" outright — 15 of
       47 catalogue questions started declining. Scoring how much of the OPTION the
       question accounts for keeps those working while still refusing a long
       unrelated measure that shares one incidental token: "Answer Rate" explains
       only "answer" out of "AI Agent Answer Offset Seconds", which is well under
       the bar. */
    const cover = hit / haveLen;
    if (cover < 0.45) continue;
    if (cover > bestCover || (cover === bestCover && best !== null && o.length < best.length)) {
      best = o; bestCover = cover;
    }
  }
  return best;
}

/** Measures whose name carries the rate itself, tried before the bare noun. */
function rateMatch(phrase: string, options: string[]): string | null {
  if (!RATE.test(phrase)) return null;
  const direct = bestMatch(phrase, options.filter((o) => /rate|percent|%/i.test(o)));
  if (direct) return direct;
  /* "Answer Rate" with no rate measure in the account: match the underlying thing
     being rated ("answer" -> "Answered by Agent") and let the tile express the rate. */
  const base = phrase.replace(/\b(rate|percent|percentage|%|ratio)\b/gi, " ").trim();
  return base ? bestMatch(base, options) : null;
}

/* ---------------------------------------------------------------------------
   Question -> template
   --------------------------------------------------------------------------- */

const TIME = /\b(over time|trend|trending|by month|monthly|by week|weekly|daily|rolling|month over month|mo m|growth)\b/i;
const BREAKDOWN = /\b(breakdown|distribution|mix|split|share|composition)\b/i;
const RANKED = /\b(top|best|worst|bottom|ranked|ranking|leaderboard|per call)\b/i;
const FUNNEL = /\b(funnel|stage|stages)\b/i;
const DUAL = /\b(dual|two axis|and answer rate|vs\.? .*over time)\b/i;
const COMPARE = /\b(vs|versus|compared to|comparison|side by side)\b/i;
const HOUR = /\bby hour\b|\bhour of day\b/i;
const DOW = /\bday of week\b|\bby day\b/i;
const GEO = /\b(geo|map|region|state|territory|location)\b.*\b(heat|map)\b|\bgeo heatmap\b/i;

/**
 * Turn a typed question into a template choice. `null` means "we could not map it",
 * and the drawer says so plainly rather than producing a tile that answers a
 * different question — the same "refused, not confused" distinction the assistant
 * drawer already draws.
 */
export function resolveQuestion(profile: CustomerProfile, question: string): TileChoices | null {
  const q = question.trim();
  if (q.length < 3) return null;
  const cat = buildCatalog(profile);

  /* "X by Y" splits the measure from the dimension. Everything before the LAST
     " by " is the measure phrase, so "Revenue by Insurance Type and Medium" still
     finds its dimension. */
  const byIdx = q.toLowerCase().lastIndexOf(" by ");
  const measurePhrase = byIdx > 0 ? q.slice(0, byIdx) : q;
  const dimPhrase = byIdx > 0 ? q.slice(byIdx + 4) : "";

  const dimension = dimPhrase ? bestMatch(dimPhrase, cat.dimensions) : null;

  /* ⚠️ NO BLANKET "Call Count" FALLBACK. It used to sit here, and it turned every
     unmatched question into a confident Call Count tile: "Appointments by Facility"
     on a blinds account (which has Consultations and Showrooms, not those) produced
     a Call Count metric, and so did "purple monkey dishwasher". A tile that answers
     a question nobody asked is the worst outcome available, because it looks right.
     The count is used ONLY when the question resolved a DIMENSION and named no
     measure of its own, which is the real "Not Completed Reason Breakdown" case. */
  let measure = rateMatch(measurePhrase, cat.measures) ?? bestMatch(measurePhrase, cat.measures);
  let impliedDim: string | null = null;
  if (!measure) {
    /* "Not Completed Reason Breakdown" and "Payment Type Breakdown" name a DIMENSION and
       no measure: the question is "how do the calls split across this". So look the phrase
       up as a dimension and count by it, which is what the pie template already does. */
    impliedDim = bestMatch(measurePhrase, cat.dimensions);
    if (impliedDim) measure = bestMatch("Call Count", cat.measures) ?? cat.measures[0];
  }
  if (!measure && dimension) measure = bestMatch("Call Count", cat.measures) ?? cat.measures[0];
  if (!measure) return null;

  /* A comparison names two measures: "AI Handle Time vs Agent Handle Time". */
  let second: string | null = null;
  if (COMPARE.test(q)) {
    const parts = q.split(/\s+(?:vs\.?|versus|compared to)\s+/i);
    if (parts.length > 1) {
      const a = bestMatch(parts[0], cat.measures);
      const b = bestMatch(parts[1].replace(/\s+by\s+.*$/i, ""), cat.measures);
      if (a && b && a !== b) second = b;
    }
  }

  const name = q.replace(/\s+/g, " ");
  const dims = dimension ? [dimension] : impliedDim ? [impliedDim] : [];

  /* Order matters: the most specific shape wins. "Calls by Hour" is a time question
     AND a by-dimension question, and it has its own template. */
  if (HOUR.test(q)) return { template: "Calls by Hour", name, measures: [measure], dimensions: dims };
  if (DOW.test(q)) return { template: "Calls by Day of Week", name, measures: [measure], dimensions: dims };
  if (GEO.test(q)) return { template: "Geo Heatmap", name, measures: [measure], dimensions: dims };
  if (FUNNEL.test(q)) return { template: "Stacked Bar", name, measures: [measure], dimensions: dims };

  if (TIME.test(q)) {
    if (DUAL.test(q) || (second && RATE.test(q))) {
      return { template: "Dual Y-Axis", name, measures: [measure, second ?? measure], dimensions: dims };
    }
    return {
      template: second ? "Multi-Line Chart Over Time" : "Single Line Chart Over Time",
      name, measures: second ? [measure, second] : [measure], dimensions: dims,
    };
  }

  if (BREAKDOWN.test(q) && !dimension) {
    /* A breakdown with no named dimension is a share-of-whole question, which is
       what the pie template is for. */
    return { template: "Pie Chart", name, measures: [measure], dimensions: dims };
  }

  if (dimension) {
    /* Two measures against one dimension stack; one measure is a plain column. */
    return {
      template: "Stacked Bar", name,
      measures: second ? [measure, second] : [measure], dimensions: [dimension],
    };
  }

  if (BREAKDOWN.test(q)) return { template: "Pie Chart", name, measures: [measure], dimensions: dims };

  /* A bare measure with no dimension and no time is a single number. RATE gets the
     KPI treatment (number plus its change) because a rate is only interesting
     against a previous period; RANKED without a dimension has nothing to rank, so
     it also falls back to the number. */
  if (RATE.test(q) || RANKED.test(q)) {
    return { template: "KPI", name, measures: [measure], dimensions: dims };
  }
  return { template: "Metric", name, measures: [measure], dimensions: dims };
}

/** A one-line account of what the resolver decided, shown in the drawer so the SE
    can see WHY they got the tile they got rather than guessing. */
export function explainChoice(c: TileChoices): string {
  const what = c.measures.join(" and ");
  const where = c.dimensions.length ? ` by ${c.dimensions[0]}` : "";
  return `${c.template}: ${what}${where}`;
}
