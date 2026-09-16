import type { CustomerProfile } from "./schema";

/* =============================================================================
   The dashboards' Marketing Source list names the channels this demo can SHOW
   -----------------------------------------------------------------------------
   Asked for directly, from a Marketing Source breakdown: *"can you replace Youtube and
   facebook in the marketing source is all the dashboards and replace it Google LSA and
   ChatGPT."* The reason it is the right change: this platform now demos a **Google Local
   Services ad** and a **ChatGPT sponsored ad**, and neither channel appeared anywhere in the
   attribution data an SE opens straight afterwards.

   ⚠️⚠️ **DONE AT LOAD, NOT AS A DATA MIGRATION, AND THAT IS THE WHOLE REASON IT WORKS.**
   Measured: 145 profiles carry these values on disk, and the shared library on the server
   holds ~234 more that no local edit can reach. This is the same call `withoutAgentQaSignals`
   already records — "changing the prompts alone would have fixed nothing an SE could see" —
   so the rename happens as a profile enters the app and every screen is correct by
   construction, including live demos nobody is going to regenerate. `engine/core.ts` asks for
   the new names too, so a prospect generated from now on is born right and this becomes a
   no-op for it.

   ⚠️⚠️ **SCOPED STRUCTURALLY, BECAUSE A STRING REPLACE WOULD HAVE BEEN BADLY WRONG.** Measured
   across those 145 profiles, "Facebook" and "YouTube" appear **370 times as a Marketing MEDIUM
   and 366 times inside a landing-page URL** (`utm_source=facebook`) against 97 in a source
   breakdown. A medium legitimately IS "Facebook"; a rename there would be nonsense. So this
   walks to the exact positions that mean Marketing Source and nothing else:
     • `marketingDashboard.breakdowns[]` and `aiAgentConversion.breakdowns[]` whose
       `dimensionColumn` is Marketing Source -> `rows[].name`
     • `opsDashboard.marketingSections[]` whose table's FIRST COLUMN is Marketing Source ->
       `table.rows[].cells[0]` and the section chart's `bars[].name`
   `dimensionColumn` is the identifier rather than the title, because it is the field that
   states what the column MEANS — the same reason the Location Comparison dashboard finds its
   columns by header instead of by index.

   ⚠️⚠️ **`digitalInsights` IS DELIBERATELY NOT TOUCHED, and this was measured rather than
   assumed.** The Digital Journey report prints **Marketing Source, Marketing Medium and the
   Full Landing Page URL in ONE VISIBLE ROW**, and on a Facebook source row all three say so
   (medium "Facebook" on 37 of 38, `utm_source=facebook` on the same 37). Renaming only the
   source would print `Google LSA | Facebook | …utm_source=facebook` on one line — exactly the
   contradiction this repo already records twice. Moving the whole tuple means inventing utm
   conventions for ChatGPT that nothing in the demo emits, which is a decision to be asked for,
   not taken here. It costs less than it looks: the two slices already use **different source
   vocabularies** (Aptive's dashboard reads Google / Bing / Direct / Facebook / YouTube while
   its journey rows read Organic / Paid Search / Social Media), so they were never aligned and
   this introduces no new drift.

   ⚠️ **EXACT VALUES ONLY — compounds are left alone.** A source row reading "Paid Social
   (Facebook/Instagram)" or "Facebook / Instagram" is a COMBINED social channel, and calling it
   "Google LSA" would be wrong rather than merely renamed. Measured: 8 such rows across the
   library, against 94 standalone ones.

   ⚠️ **FACEBOOK -> GOOGLE LSA, WHICH IS NOT THE ORDER THE REQUEST LISTED THEM IN.** Taken
   positionally it would be YouTube -> Google LSA, and the measurement argues the other way:
   **Facebook appears in 86 profiles' source breakdowns and YouTube in 16**, so mapping
   Facebook to Google LSA is what actually puts the channel we just built a screen for in front
   of most prospects. One line to flip if that is wrong.

   ⚠️ **RENAME ONLY, NEVER AN INSERT.** A breakdown's rows are a partition whose metrics sum to
   the prospect's own call total, and this file's arithmetic rule is that columns a prospect can
   add up have to add up. Relabelling a row preserves every sum by construction; adding one
   would not. **Consequence, stated: 55 of 145 profiles carry neither value and so gain
   neither name.**
   ============================================================================= */

/** Exact (case-insensitive) source values we rewrite, and what they become. */
const RENAME: Record<string, string> = {
  facebook: "Google LSA",
  youtube: "ChatGPT",
};

/** The new name for a source value, or null to leave it exactly as it is. */
export function renamedSource(value: string): string | null {
  return RENAME[value.trim().toLowerCase()] ?? null;
}

/** Is this column the Marketing Source one? Tolerant of wording, never matches Medium. */
function isSourceColumn(label: string | undefined): boolean {
  const s = (label ?? "").toLowerCase();
  return s.includes("source") && !s.includes("medium");
}

function mapRow<T extends { name: string }>(row: T): T {
  const next = renamedSource(row.name);
  return next ? { ...row, name: next } : row;
}

/**
 * Rename the Marketing Source values on a profile's DASHBOARDS. Pure: returns a new profile
 * when something changed and the SAME object when nothing did, so an untouched prospect keeps
 * its referential identity and nothing re-renders for free.
 */
export function renameMarketingSources(profile: CustomerProfile): CustomerProfile {
  let touched = false;
  const r = profile.reports;

  const doBreakdowns = <B extends { dimensionColumn: string; title: string; rows: { name: string }[] }>(bds: B[]): B[] =>
    bds.map((bd) => {
      if (!isSourceColumn(bd.dimensionColumn) && !isSourceColumn(bd.title)) return bd;
      const rows = bd.rows.map(mapRow);
      if (rows.every((row, i) => row === bd.rows[i])) return bd;
      touched = true;
      return { ...bd, rows };
    });

  const md = r.marketingDashboard
    ? { ...r.marketingDashboard, breakdowns: doBreakdowns(r.marketingDashboard.breakdowns) }
    : r.marketingDashboard;

  const aac = r.aiAgentConversion
    ? { ...r.aiAgentConversion, breakdowns: doBreakdowns(r.aiAgentConversion.breakdowns) }
    : r.aiAgentConversion;

  /* The ops dashboard's sections carry no title, so the table's own first column is what
     says which dimension the section is about — and the chart beside it plots the same rows,
     so the two have to move together or the bar chart and the table disagree on screen. */
  const ops = r.opsDashboard
    ? {
      ...r.opsDashboard,
      marketingSections: r.opsDashboard.marketingSections.map((sec) => {
        if (!isSourceColumn(sec.table.columns[0])) return sec;
        const rows = sec.table.rows.map((row) => {
          const next = row.cells.length ? renamedSource(row.cells[0]) : null;
          return next ? { ...row, cells: [next, ...row.cells.slice(1)] } : row;
        });
        const bars = sec.chart.bars.map(mapRow);
        const same = rows.every((row, i) => row === sec.table.rows[i])
          && bars.every((b, i) => b === sec.chart.bars[i]);
        if (same) return sec;
        touched = true;
        return { ...sec, table: { ...sec.table, rows }, chart: { ...sec.chart, bars } };
      }),
    }
    : r.opsDashboard;

  if (!touched) return profile;
  return { ...profile, reports: { ...r, marketingDashboard: md, aiAgentConversion: aac, opsDashboard: ops } };
}
