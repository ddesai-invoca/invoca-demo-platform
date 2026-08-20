import type { CustomerProfile } from "./schema";

/* =============================================================================
   insightsMeasures — what KIND of thing each measure is, and how it behaves.
   -----------------------------------------------------------------------------
   Every Insights tile asks the same three questions about the attribute an SE picked,
   and before this they were all answered "it's a count":

     1. Is a weekly series a PARTITION of a monthly total, or a LEVEL per week?
     2. How does a value print — 6,083 / $6,083 / 71% / 4:04 / 82?
     3. Does the axis title say "Total" or "Average"?

   Getting (1) wrong is not cosmetic. Apportioning a conversion RATE across five weeks
   produced 13, 19, 21, 24, 23 "summing to" 100, which says the rate was 13% in week one.
   A rate has a level each week; only additive things partition.

   ⚠️ FAMILY ORDER MATTERS, and three real measures prove it:
     - "Publisher Commissions Ranking" contains "commission" -> money by a naive rule,
       but it is a RANK.
     - "Publisher Conversion Rate Ranking" contains "rate" -> percent by a naive rule,
       but it is also a RANK.
     - "Duration: gt 1-minute" contains "duration" -> a duration by a naive rule, but it
       is a COUNT of calls over a threshold.
   So rank is tested before money and percent, and the `X: gt Y` threshold shape is
   tested before duration. Classifying by name shape (rather than listing 108 measures)
   is what makes this survive the next generated prospect, whose measures do not exist
   yet.
   ============================================================================= */

export type MeasureKind =
  | "count"      // calls, signals, messages — additive
  | "money"      // revenue, fees, margin — additive
  | "flag"       // a (T/F) signal counted across calls — additive
  | "percent"    // a rate; each period has its own level
  | "duration"   // seconds per call, averaged
  | "score"      // a 0-100 quality score, averaged
  | "rank";      // a position, averaged

/* Only where a family rule would be wrong. Kept deliberately short: a long list here
   means the families are miscut and the next prospect's measures will be misread. */
const OVERRIDES: Array<[RegExp, MeasureKind]> = [
  /* "…: gt 1-minute" counts the calls past a threshold. */
  [/:\s*(gt|lt|gte|lte|>=|<=|>|<)\s/i, "count"],
  /* Invoca's scorecard line items ("(QA) Proper Greeting", "BASE SKILLS", "Introduction",
     "Problem Resolution") are counted as calls where the signal was MET, the same way
     every other signal in this app behaves. Only a name literally ending in "Score" is
     treated as a score. */
  [/^\(qa\)|^base skills|^introduction|^problem resolution|^phone ettiquette|^ask for assistance|behaviors$/i, "count"],
];

const FAMILIES: Array<[RegExp, MeasureKind]> = [
  [/\(t\/f\)\s*$/i, "flag"],
  [/\brank(ing)?\b/i, "rank"],
  [/\(seconds?\)|\bduration\b|handle time|talk time|monolog|silence|overtalk|hold time|dead air|offset|\baht\b/i, "duration"],
  [/revenue|sale amount|\bfees?\b|\bearned\b|\bpaid\b|\bmargin\b|payout|commission|\bcost\b|\bprice\b|\bspend\b/i, "money"],
  [/\brate\b|percent|%|\bratio\b/i, "percent"],
  [/\bscore\b/i, "score"],
];

export function kindOf(measure: string): MeasureKind {
  for (const [re, k] of OVERRIDES) if (re.test(measure)) return k;
  for (const [re, k] of FAMILIES) if (re.test(measure)) return k;
  return "count";
}

/** Additive kinds partition a total; the rest carry a level per period. */
export const isAdditive = (k: MeasureKind): boolean =>
  k === "count" || k === "money" || k === "flag";

/**
 * The word in front of the axis title. The capture reads "Total Call Count" because a
 * count genuinely is additive; "Total Agent Handle Time" would be a nonsense figure.
 */
export const aggregationWord = (k: MeasureKind): string =>
  isAdditive(k) ? "Total" : "Average";

/**
 * The axis title. ⚠️ Does not double the word: the measure "Total Messages" was coming
 * out as "Total Total Messages", and a measure already named "Average …" would read the
 * same way.
 */
export const axisTitleFor = (measure: string): string => {
  const word = aggregationWord(kindOf(measure));
  return new RegExp(`^(total|average|avg)\\b`, "i").test(measure) ? measure : `${word} ${measure}`;
};

/* ---------------------------------------------------------------------------
   Formatting
   --------------------------------------------------------------------------- */

const mmss = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A single value, as a KPI tile or a tooltip prints it. */
export function formatMeasure(v: number, kind: MeasureKind): string {
  if (!isFinite(v)) return "";
  switch (kind) {
    case "money": return `$${Math.round(v).toLocaleString("en-US")}`;
    case "percent": return `${+v.toFixed(1)}%`;
    case "duration": return mmss(v);
    case "score": return String(Math.round(v));
    case "rank": return `#${Math.round(v)}`;
    default: return Math.round(v).toLocaleString("en-US");
  }
}

/**
 * An AXIS TICK, which is compact — the measured y axis reads 0, 1K … 8K. Money keeps its
 * `$` and percent its `%`, because an axis of bare numbers under a title that says
 * "Total Revenue" is exactly the ambiguity a prospect asks about.
 */
export function formatTick(v: number, kind: MeasureKind): string {
  const compact = (n: number): string => {
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${+(n / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}K`;
    return String(+n.toFixed(1));
  };
  switch (kind) {
    case "money": return `$${compact(v)}`;
    case "percent": return `${+v.toFixed(0)}%`;
    case "duration": return mmss(v);
    case "rank": return `#${Math.round(v)}`;
    default: return compact(v);
  }
}

/* ---------------------------------------------------------------------------
   Magnitude — where a measure's numbers come from
   --------------------------------------------------------------------------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

type Reports = CustomerProfile["reports"] & Record<string, unknown>;

function callTotal(profile: CustomerProfile): number {
  const r = profile.reports as Reports;
  const bd = r.marketingDashboard?.breakdowns?.find((b) => /by source/i.test(b.title));
  const rows = bd?.rows ?? [];
  const n = rows.reduce((s, row) => s + (Number(String(row.metrics?.[0] ?? "").replace(/[^\d.]/g, "")) || 0), 0);
  return n > 0 ? n : 24000;
}

export interface Magnitude {
  kind: MeasureKind;
  /** For an additive measure: the total to partition over the window. */
  total: number;
  /** For a non-additive measure: the typical level a period sits at. */
  level: number;
}

/**
 * How big this measure's numbers are for THIS prospect.
 *
 * Additive measures scale off the prospect's own call volume, so a tile never
 * contradicts the dashboards beside it. Non-additive ones get a LEVEL in the band their
 * kind actually occupies — a rate near the prospect's real answer or booking rate where
 * the name says which, otherwise a seeded value inside a believable range. Seeded off
 * the profile AND the measure name, so the same measure reads the same in every tile,
 * every question and every session.
 */
export function magnitudeOf(profile: CustomerProfile, measure: string): Magnitude {
  const kind = kindOf(measure);
  const calls = callTotal(profile);
  const seed = hash(profile.id + "::" + measure);
  const pick = (lo: number, hi: number) => lo + (seed % Math.max(1, Math.round((hi - lo) * 10))) / 10;

  switch (kind) {
    case "money": {
      /* Revenue is the prospect's own; the other money measures are fractions of it,
         because "Margin" printing the same figure as "Revenue" is the kind of thing a
         CFO in the room notices. */
      const revenue = calls * 780;
      const base = /revenue|sale amount/i.test(measure) ? 1
        : /margin/i.test(measure) ? 0.22
        : /earned|paid/i.test(measure) ? 0.35
        : 0.12;
      /* ⚠️ A SEEDED SPREAD, or same-family measures print the SAME figure: "Earned" and
         "Paid" both came out $2,636,798, and "Fees" matched "Advertiser Fees" to the
         dollar. Two differently-named money columns showing one number is the same
         problem the Margin guard exists for. Revenue itself is left exact, since it has
         to agree with the dashboards. */
      const spread = base === 1 ? 1 : 0.85 + ((seed >>> 5) % 30) / 100;
      return { kind, total: Math.round(revenue * base * spread), level: 0 };
    }
    case "percent": {
      const level = /answer/i.test(measure) ? pick(62, 88)
        : /convert|conversion|book|schedul/i.test(measure) ? pick(18, 44)
        : /opt.?in|contain/i.test(measure) ? pick(30, 70)
        : pick(35, 80);
      return { kind, total: 0, level: +level.toFixed(1) };
    }
    case "duration": {
      /* Whole-call durations run minutes; the in-call slivers (monologue, silence,
         overtalk, dead air) are tens of seconds, and giving them the same band is what
         made "Agent Monolog" read like a call length. */
      const sliver = /monolog|silence|overtalk|dead air|hold|offset|\bivr\b/i.test(measure);
      return { kind, total: 0, level: Math.round(sliver ? pick(14, 75) : pick(150, 420)) };
    }
    case "score": return { kind, total: 0, level: Math.round(pick(58, 94)) };
    case "rank": return { kind, total: 0, level: Math.round(pick(1, 12)) };
    case "flag":
    case "count":
    default: {
      /* A signal is met on a fraction of calls; the call count itself is the whole. */
      const share = /^call count$|^interaction count$|^interaction$/i.test(measure) ? 1 : pick(0.18, 0.72);
      return { kind, total: Math.max(1, Math.round(calls * share)), level: 0 };
    }
  }
}
