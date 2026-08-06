import type { CustomerProfile } from "./schema";

/* The Details Report (Insights & Analytics -> Details Report): one flat, very wide row per
   call, with a UNIQUE COUNT footer under every column.

   ⚠️ WHAT THE CAPTURE ACTUALLY GAVE US. The table is ThoughtSpot-rendered at runtime, so the
   SingleFile capture (8/6/2026, network 2160, dashboard 4f3a7106) serialised only SEVEN
   header cells and the "Showing 1,000 of many rows" line — no body, no footer. The remaining
   five visible columns come off the screenshot, and the report scrolls further right than the
   screenshot reaches, so columns 13+ are UNKNOWN. Those five are named from column headers
   already verified elsewhere in this repo (the Digital Journey & Call Attribution report and
   the Marketing dashboards), not invented. If a wider screenshot ever turns up, add the real
   ones here rather than guessing further.

   DERIVED, no engine phase: marketing values come from reports.marketingDashboard's Medium
   and Source breakdowns, so a medium in this report is a medium the other screens show. */

export interface DetailsColumn {
  key: string;
  label: string;
  /* The footer under this column: a distinct-value count, or the date span for the time
     column (which is what the real report shows there). */
  footer: "unique" | "period";
  /* Right-align numeric-ish columns, as the real grid does. */
  numeric?: boolean;
  wide?: boolean;
}

/* Invoca's own platform vocabulary — media types, the {Null}/{Empty} placeholders and the
   "(T/F)" suffix are product features, not this prospect's words, so they stay verbatim (the
   same reason "Marketing Source" and "UNIQUE COUNT" are never re-skinned). */
const MEDIA_TYPES = [
  "Online: Search", "Online: Search", "Online: Search",
  "Online: Other", "Online: Other",
  "Online: Content / Review Site",
  "Pooling",
];
/* A call that arrived on a pooled number or off a review site has no campaign behind it, so
   its marketing columns come back {Null}. That is exactly the pattern in the screenshot —
   every Pooling and Content/Review Site row is {Null} across Medium and Source while the
   Online: Search and Online: Other rows carry real values — and it is worth reproducing,
   because a details report where every row is perfectly attributed is not a real one. */
const UNATTRIBUTED = new Set(["Pooling", "Online: Content / Review Site"]);

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return Math.abs(h);
}
const hex = (seed: string, n: number) =>
  hash(seed).toString(16).toUpperCase().padStart(8, "0").repeat(2).slice(0, n);

/* How many rows the grid renders. The real one says "Showing 1,000 of many rows" and
   virtualises; 1,000 x 17 columns is 17,000 live cells here, which makes scrolling stutter on
   a projector. So it renders 200 and SAYS 200 — claiming 1,000 while showing 200 is the kind
   of thing a prospect who scrolls to the bottom catches. */
const SHOWN = 200;

/* How far back the unfiltered report reaches. The capture's footer starts 07/01/2024
   against an August 2026 capture, so a little over two years. */
const DAYS_BACK = 760;

export function detailsReportFacts(profile: CustomerProfile) {
  const md = profile.reports.marketingDashboard;
  const pick = (re: RegExp) => md.breakdowns.find((b) => re.test(b.title))?.rows.map((r) => r.name) ?? [];
  const mediums = pick(/Medium/i);
  const sources = pick(/Source/i);
  const campaigns = pick(/Campaign/i);
  const terms = pick(/Search Term/i);
  const booking = profile.bookingTerm || "Appointment";

  const columns: DetailsColumn[] = [
    { key: "id", label: "Call Record ID", footer: "unique" },
    { key: "caller", label: "Caller ID", footer: "unique" },
    { key: "repeat", label: "Repeat Caller (Invoca)", footer: "unique" },
    { key: "start", label: "Call Start Time", footer: "period" },
    { key: "media", label: "Media Type", footer: "unique", wide: true },
    { key: "source", label: "Source", footer: "unique" },
    { key: "dest", label: "Destination Phone Number", footer: "unique" },
    { key: "notAnswered", label: "Call Not Answered (T/F)", footer: "unique", numeric: true },
    { key: "discussed", label: `${booking}: Discussed (T/F)`, footer: "unique", numeric: true },
    { key: "scheduled", label: `${booking}: Scheduled (T/F)`, footer: "unique", numeric: true },
    { key: "medium", label: "Marketing Medium", footer: "unique" },
    { key: "mktSource", label: "Marketing Source", footer: "unique" },
    /* ---- named from headers verified on OTHER screens, not from this capture ---- */
    { key: "campaign", label: "Marketing Campaign", footer: "unique", wide: true },
    { key: "term", label: "Marketing Search Term", footer: "unique", wide: true },
    { key: "landing", label: "Landing Page URL", footer: "unique", wide: true },
    { key: "duration", label: "Total Duration", footer: "unique", numeric: true },
    { key: "revenue", label: "Revenue (Sale Amount)", footer: "unique", numeric: true },
  ];

  /* THE FILTER IS UNSET on this report ("Call Start Time (Select)"), so it spans all history
     rather than the one month the dashboards use — the capture's own footer reads a period
     starting 07/01/2024. The window is anchored to the end of the profile's range so the
     report ends where the rest of the demo does. */
  const end = new Date(String(md.dateRange ?? "").split("-")[1]?.trim() || "2026-01-31");
  const endMs = isNaN(+end) ? Date.parse("2026-01-31") : +end;
  const startMs = endMs - DAYS_BACK * 86400000;

  /* A pool of callers SMALLER than the row count, so a caller can appear more than once and
     "Repeat Caller" can be a fact rather than a coin flip: it is Yes exactly when this
     caller id has already appeared above. The real report's ratio is 13,664 unique callers
     to 40,614 records, so the pool is a third of the rows. */
  const callerPool = Array.from({ length: Math.max(2, Math.round(SHOWN * 0.34)) }, (_, i) =>
    `+1${String(2000000000 + (hash(`${profile.id}|caller|${i}`) % 799999999)).slice(0, 10)}`);
  /* Promo numbers, formatted the way the capture's Source column is (877-447-1755). */
  const promoPool = Array.from({ length: 24 }, (_, i) => {
    const h = hash(`${profile.id}|promo|${i}`);
    const area = [877, 833, 800, 866, 727, 830, 855, 844][i % 8]!;
    return `${area}-${String(100 + (h % 900))}-${String(1000 + (h % 9000))}`;
  });

  const seen = new Set<string>();
  /* Each row carries its own timestamp alongside the formatted string. The footer's TIME
     PERIOD needs the EARLIEST and LATEST call, and min/max over the formatted text is wrong:
     "MM/DD/YYYY" does not sort chronologically as a string, so "01/02/2024" compares before
     "12/06/2023" and the period came out backwards and far too narrow. */
  const built = Array.from({ length: SHOWN }, (_, i) => {
    const h = hash(`${profile.id}|row|${i}`);
    const media = MEDIA_TYPES[h % MEDIA_TYPES.length]!;
    const attributed = !UNATTRIBUTED.has(media);
    const caller = callerPool[(h >>> 3) % callerPool.length]!;

    /* ⚠️ Spread by DAY and second-of-day separately, never `hash % (endMs - startMs)`. That
       span is 65 billion ms and a shifted 32-bit hash tops out around 134 million, so the
       modulo was a no-op: all 200 rows landed inside the same 1.5 days and the footer's TIME
       PERIOD read as a single afternoon. */
    const at = new Date(startMs + ((h >>> 5) % DAYS_BACK) * 86400000 + ((h >>> 15) % 86400) * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${pad(at.getMonth() + 1)}/${pad(at.getDate())}/${at.getFullYear()} `
      + `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;

    /* An unattributed call is often one Invoca never scored, so its signal columns come back
       {Null} rather than 0 — again the screenshot's pattern, not a flourish. */
    const scored = attributed || (h >>> 9) % 3 !== 0;
    const tf = (bit: number) => (scored ? String(bit) : "{Null}");
    const answered = (h >>> 11) % 5 !== 0;
    const discussed = answered && (h >>> 13) % 3 !== 0;
    const scheduled = discussed && (h >>> 17) % 5 < 2;

    const secs = answered ? 45 + ((h >>> 7) % 400) : 0;

    const row = {
      id: `${hex(`${profile.id}|id|${i}`, 4)}-${hex(`${profile.id}|id2|${i}`, 12)}`,
      caller,
      /* filled in below, once the rows are in time order */
      repeat: "",
      start,
      media,
      source: promoPool[(h >>> 19) % promoPool.length]!,
      /* Mostly {Empty} in the capture, with the occasional routed destination. */
      dest: (h >>> 21) % 8 === 0
        ? `+1800${String(1000000 + (h % 8999999))}` : "{Empty}",
      notAnswered: tf(answered ? 0 : 1),
      discussed: tf(discussed ? 1 : 0),
      scheduled: scheduled ? "1" : "0",
      medium: attributed ? mediums[(h >>> 23) % (mediums.length || 1)] ?? "{Null}" : "{Null}",
      mktSource: attributed ? sources[(h >>> 25) % (sources.length || 1)] ?? "{Null}" : "{Null}",
      campaign: attributed ? campaigns[(h >>> 2) % (campaigns.length || 1)] ?? "{Null}" : "{Null}",
      term: attributed ? terms[(h >>> 4) % (terms.length || 1)] ?? "{Null}" : "{Null}",
      landing: attributed ? profile.websiteUrl : "{Null}",
      duration: secs ? `00:${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}` : "00:00:00",
      revenue: scheduled ? `$${(300 + ((h >>> 6) % 4200)).toLocaleString("en-US")}.00` : "$0.00",
    } as Record<string, string>;
    return { row, ms: +at };
  });

  /* ⚠️ "Repeat Caller (Invoca)" means this caller has called BEFORE, so it has to be decided
     walking FORWARD in time — not in generation order, which is hash order and unrelated to
     when the calls happened. Deciding it during generation and then sorting for display left
     a caller's oldest call flagged as a repeat and a later one flagged as their first.
     So: sort oldest-first, mark each caller's first call No and the rest Yes, then reverse for
     display. Reading newest-first, most rows for a returning caller correctly say Yes. */
  built.sort((a, b) => a.ms - b.ms);
  for (const b of built) {
    const c = b.row.caller!;
    b.row.repeat = b.row.notAnswered === "{Null}" ? "{Null}" : (seen.has(c) ? "Yes" : "No");
    seen.add(c);
  }

  /* Newest first, which is the order a details report is read in. */
  built.reverse();
  const rows = built.map((b) => b.row);
  const fmt = (ms: number) => built.find((b) => b.ms === ms)!.row.start;
  const period = `${fmt(Math.min(...built.map((b) => b.ms)))} - ${fmt(Math.max(...built.map((b) => b.ms)))}`;

  /* THE FOOTER describes the WHOLE dataset, not the 200 rows on screen — which is what the
     real one does (40,614 unique call record ids under a 1,000-row page) and is consistent as
     long as the caption says "of many rows". The low-cardinality columns are counted from the
     rendered rows, since for those the page and the dataset genuinely agree. */
  const totalRows = md.breakdowns
    .find((b) => /Source/i.test(b.title))?.rows
    .reduce((s, r) => s + (Number(String(r.metrics[0] ?? "0").replace(/[^\d]/g, "")) || 0), 0) ?? SHOWN;

  const distinct = (key: string) => new Set(rows.map((r) => r[key])).size;
  const footer: Record<string, string> = {
    id: totalRows.toLocaleString("en-US"),
    caller: Math.round(totalRows * 0.34).toLocaleString("en-US"),
    repeat: String(distinct("repeat")),
    start: period,
    media: String(distinct("media")),
    source: String(distinct("source")),
    dest: String(distinct("dest")),
    notAnswered: String(distinct("notAnswered")),
    discussed: String(distinct("discussed")),
    scheduled: String(distinct("scheduled")),
    medium: String(distinct("medium")),
    mktSource: String(distinct("mktSource")),
    campaign: String(distinct("campaign")),
    term: String(distinct("term")),
    landing: String(distinct("landing")),
    duration: Math.round(totalRows * 0.72).toLocaleString("en-US"),
    revenue: Math.round(totalRows * 0.18).toLocaleString("en-US"),
  };

  return { columns, rows, footer, shown: rows.length, totalRows };
}
