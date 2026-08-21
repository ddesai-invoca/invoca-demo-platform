import type { CustomerProfile } from "./schema";

/* The rows behind a chart click — what Invoca calls "interactions".

   Clicking a bar, a trend dot or a donut slice on a saved Insights dashboard opens
   a right-hand drawer listing the individual interactions that make up that
   number. Measured off the real drawer (network 2160, SingleFile capture
   "Insights & Analytics drawer", 8/5/2026): a header reading "<tile name>" and
   "814 interactions", then a scrolling list of fixed-height cards, each with a
   coloured type badge, an id, an AI summary (usually absent), and a duration.

   DERIVED, not generated. The summaries are the prospect's OWN Call Review
   summaries, so the drawer says the same things the Call Review screen does, and
   every prospect already on disk gets this drawer with no engine phase and no
   schema slice. Everything else (ids, the CALL/SMS/LEAD mix, durations) is a pure
   function of a seed, so an SE revisiting a demo sees the identical list. */

export type InteractionKind = "call" | "sms" | "lead";

export interface Interaction {
  kind: InteractionKind;
  id: string;               // "018F-31355FE94682"
  date: string;             // "2026-04-01"
  summary: string | null;   // null renders "No AI Summary available."
  duration: string;         // "1m 41s"
}

/* The real drawer virtualises 800+ cards. Rendering that many DOM nodes to show
   the top of a list nobody scrolls to the bottom of is pure cost, so the list is
   capped — the header still reports the TRUE metric value, which is the number
   the viewer actually reads. */
const MAX_CARDS = 30;

/* FNV-1a plus a final mixing step. The avalanche matters: consecutive indices are
   the only difference between seeds here, and a non-mixing hash (h*31+c) would
   produce ids and durations that march in lockstep down the list. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return Math.abs(h);
}

/* Invoca ids in the capture are 4 hex, a dash, then 12 hex, uppercase:
   "018F-31355FE94682". Two hashes, since one 32-bit value cannot fill 16 nibbles. */
function interactionId(seed: string): string {
  const a = hash(`${seed}|a`).toString(16).toUpperCase().padStart(8, "0");
  const b = hash(`${seed}|b`).toString(16).toUpperCase().padStart(8, "0");
  return `${a.slice(0, 4)}-${(a.slice(4) + b).slice(0, 12)}`;
}

/* The CALL / SMS / LEAD mix depends on the METRIC that was clicked, which is what
   the real drawer shows: the capture's call-count drawer is 813 calls and one SMS,
   while a second drawer on a different metric opens on a LEAD followed by three
   SMS rows. A call metric is therefore nearly all calls; anything else is a
   genuine mix of the three channels Invoca records. */
function kindFor(metric: string, r: number): InteractionKind {
  const callish = /\bcall\b|answered/i.test(metric) && !/lead|form|messag|sms/i.test(metric);
  if (callish) return r < 0.9 ? "call" : r < 0.97 ? "sms" : "lead";
  if (/lead|form/i.test(metric)) return r < 0.72 ? "lead" : r < 0.9 ? "call" : "sms";
  if (/sms|messag|text/i.test(metric)) return r < 0.74 ? "sms" : r < 0.94 ? "call" : "lead";
  return r < 0.55 ? "call" : r < 0.8 ? "sms" : "lead";
}

/* mm/dd/yyyy -> yyyy-mm-dd, the format the drawer cards use. Left alone if it is
   already ISO or unparseable, so a bad date shows as itself rather than "NaN". */
export function isoDate(d: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : d.trim();
}

export function buildInteractions(
  profile: CustomerProfile,
  { metric, count, date, pinFirst }: {
    metric: string; count: number; date: string;
    /* Replace the top card with the prospect's OWN call-detail record, so the card that
       opens a detail page shows the same id, duration and summary that page does. Without
       this the drawer would advertise a call the detail screen has never heard of. Set on
       every drawer now that the top call always links — see DrawerRequest.topCallHref. */
    pinFirst?: boolean;
  },
): Interaction[] {
  /* The prospect's own AI summaries. Every generated profile carries 15 of them;
     if a profile somehow has none, every card reads "No AI Summary available." —
     which is what 800 of the 814 real cards read anyway, so the drawer still looks
     right rather than filling up with invented text. */
  const summaries = (profile.reports.callReview?.calls ?? [])
    .map((c) => c.summary).filter((s): s is string => !!s && s.length > 20);
  const durations = (profile.reports.callReview?.calls ?? [])
    .map((c) => c.duration).filter((d): d is string => !!d);

  const n = Math.max(0, Math.min(MAX_CARDS, Math.round(count)));
  const base = `${profile.id}|${metric}|${date}`;

  /* Summaries are handed out ROUND-ROBIN from a hashed starting point rather than
     picked by hash per card. Picking independently collided: the first render put the
     identical "caller named Karen Bishop" summary on two adjacent cards, which reads as
     generated far more loudly than a missing summary does. A rotating cursor cannot
     repeat until all 15 are spent. */
  let cursor = hash(base) % (summaries.length || 1);

  const rows = Array.from({ length: n }, (_, i) => {
    const h = hash(`${base}|${i}`);
    const kind = kindFor(metric, (h % 1000) / 1000);

    /* SMS and lead-form interactions have no talk time — the capture shows
       "0m 0s" on both. Calls rotate the prospect's real durations, except for a
       third of them that get a short one: the real list is full of 0m 3s and
       0m 19s rows (rings that went nowhere), and a drawer where every call runs
       two to three minutes reads as a fabrication. */
    let duration = "0m 0s";
    if (kind === "call") {
      const short = (h >>> 7) % 3 === 0;
      duration = short
        ? `0m ${(h >>> 11) % 55}s`
        : durations[(h >>> 5) % (durations.length || 1)] ?? "1m 24s";
    }

    /* Summaries are the exception, not the rule, matching the capture. */
    const hasSummary = kind === "call" && summaries.length > 0 && (h >>> 13) % 5 < 2;

    return {
      kind,
      id: interactionId(`${base}|${i}`),
      date: isoDate(date),
      summary: hasSummary ? summaries[cursor++ % summaries.length] ?? null : null,
      duration,
    };
  });

  /* The real drawer comes back sorted by id ascending (018F, 05B5, 05BF, 07BD,
     0C85 ...), so the list is sorted rather than left in hash order. */
  rows.sort((a, b) => a.id.localeCompare(b.id));

  /* REPLACES the top row rather than inserting one, so the count of cards and the ids
     stay unique. Done after the sort, since the pinned call has to be the top card
     whatever its id would have sorted to. */
  const cd = profile.reports.callDetail;
  if (pinFirst && cd && rows.length) {
    rows[0] = {
      kind: "call",
      id: cd.callId,
      date: isoDate(date),
      summary: cd.aiSummary || null,
      duration: cd.duration,
    };
  }

  return rows;
}
