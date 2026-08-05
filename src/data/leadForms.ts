/* =============================================================================
   leadForms.ts — the prospect's lead-form figures, from ONE place
   -----------------------------------------------------------------------------
   Two screens now show lead-form performance (the Marketing Performance
   dashboard's "Lead Form Performance Summary" tile and the Location Comparison
   scorecard), so the anchors live here. Two copies would drift, and these have to
   agree: a Lead Form Count of 1,247 on one dashboard and 1,240 on another is the
   kind of thing a prospect spots.

   ⚠️ NOTHING HERE IS INVENTED. Every figure is read out of data the engine already
   generates, because a fabricated form count sitting beside real call counts is
   worse than no lead-form tile at all:

     count        aiMessagingImpact.aiLeadEngagement → "Form Submits"
     engagement   the same card's engagement-rate tile
     conversion   aiAgentConversion's "LEAD FORM (Conversions)" cards, blended and
                  WEIGHTED BY REVENUE (a straight mean of 24/28/31% would let the
                  smallest cohort pull the headline number around)
     revenue      the sum of those same cards' revenue tiles

   Returns null when the anchors are absent, and every caller then omits its
   lead-form UI rather than showing a plausible-looking zero.
   ============================================================================= */

const num = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

type Tile = { label: string; value: string };

interface ProfileLike {
  reports: {
    aiMessagingImpact?: unknown;
    aiAgentConversion?: unknown;
    marketingDashboard?: unknown;
  };
}

export interface LeadFormFacts {
  /** Form Submits for the month. */
  count: number;
  /** The engagement-rate tile from the same card, label included so the UI can
   *  show the prospect's own wording rather than an invented one. */
  engagement: Tile | null;
  /** Revenue-weighted conversion rate across the LEAD FORM cohorts, in percent. */
  conversionPct: number;
  /** Total revenue attributed to lead forms. */
  revenue: number;
}

export function leadFormFacts(p: ProfileLike): LeadFormFacts | null {
  const aim = p.reports.aiMessagingImpact as
    { aiLeadEngagement?: { tiles?: Tile[] } } | undefined;
  const tiles = aim?.aiLeadEngagement?.tiles ?? [];
  const count = num(tiles.find((t) => /form submit/i.test(t.label))?.value);
  const engagement = tiles.find((t) => /engagement rate/i.test(t.label)) ?? null;

  const aac = p.reports.aiAgentConversion as
    { conversionCards?: { title?: string; tiles?: Tile[] }[] } | undefined;
  const cards = (aac?.conversionCards ?? []).filter((c) => /lead form/i.test(c.title ?? ""));

  let revenue = 0, weighted = 0;
  for (const c of cards) {
    const rev = num(c.tiles?.find((t) => /revenue/i.test(t.label))?.value);
    const conv = num(c.tiles?.find((t) => /percent/i.test(t.label))?.value);
    revenue += rev;
    weighted += rev * conv;
  }
  const conversionPct = revenue ? weighted / revenue : 0;

  return count > 0 && revenue > 0 ? { count, engagement, conversionPct, revenue } : null;
}

/** Distribute a whole into shares that sum EXACTLY back to it. Rounding each share
 *  independently loses or gains a few units, and "1,246 of 1,247 forms" in a demo is
 *  exactly what someone totals up. The remainder goes to the largest share. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map(() => 0);
  const out = weights.map((w) => Math.round((w / sum) * total));
  const drift = total - out.reduce((s, v) => s + v, 0);
  if (drift !== 0) out[weights.indexOf(Math.max(...weights))] += drift;
  return out;
}
