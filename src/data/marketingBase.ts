import { leadFormFacts } from "./leadForms";
import type { KpiGroup, DashboardView } from "./schema";

/* =============================================================================
   marketingBase.ts — the object the Marketing Performance dashboard registers
   -----------------------------------------------------------------------------
   ⚠️⚠️ **EXTRACTED FROM `MarketingDashboard.tsx` (10/9/2026) FOR THE REASON
   `workflowBase.ts` WAS: A SECOND READER NEEDS THIS EXACT OBJECT AND A COPY WOULD
   DRIFT.** The custom-prompt feature seeds a surface's base before applying an SE's
   instruction to it, and `applyEdits` stores a FULL copy of whatever it edited — so a
   base missing the derived `leadFormSummary` would not degrade, it would REPLACE the
   page's data with one that has no Lead Form card, and nothing would report it.

   ⚠️ NOTHING ABOUT THE VALUES CHANGED IN THE MOVE. The screen imports both back and
   folds them in exactly where it did.
   ============================================================================= */

/* ⚠️ LABELS ARE DATA, NOT LITERALS — see `usePageDataWithLabels`. A heading left as a
   literal is invisible to the assistant: it accepts "rename this to X", writes the edit,
   and the screen does not budge. Must stay a module-level constant so its identity is
   stable across renders. */
export const MARKETING_LABELS = {
  breakoutGraph: "Sales Call Breakout Graph",
  leadFormSummary: "Lead Form Performance Summary",
  leadFormCount: "Lead Form Count",
};
/* The LEAD FORM equivalent of "Call Performance Summary": same shape (a count, two
   percents, revenue) so the two tiles read as a pair, and every figure anchored in
   data the engine already produces (see data/leadForms.ts).

   The LABELS come from the call group's own tiles wherever possible — tile 3 is the
   prospect's conversion term ("Watch Sold (Percent)" for a watch dealer, "Policy
   Bound (Percent)" for an insurer) and tile 4 its revenue wording. Reading them off
   the neighbouring card keeps the pair consistent per prospect instead of hardcoding
   one vertical's vocabulary. */
export function deriveLeadFormGroup(
  profile: Parameters<typeof leadFormFacts>[0] & { reports: { marketingDashboard: { kpiGroups: KpiGroup[] } } },
  labels: { leadFormSummary: string; leadFormCount: string },
): KpiGroup | null {
  const facts = leadFormFacts(profile);
  if (!facts) return null;
  const callTiles = profile.reports.marketingDashboard.kpiGroups?.[0]?.tiles ?? [];
  const convLabel = callTiles[2]?.label ?? "Converted (Percent)";
  const revLabel = callTiles[3]?.label ?? "Total Revenue (Sale Amount)";
  return {
    title: labels.leadFormSummary,
    tiles: [
      { label: labels.leadFormCount, value: facts.count.toLocaleString("en-US") },
      ...(facts.engagement ? [facts.engagement] : []),
      { label: convLabel, value: `${Math.round(facts.conversionPct)}%` },
      { label: revLabel, value: `$${Math.round(facts.revenue).toLocaleString("en-US")}` },
    ],
  };
}
/**
 * The full object `MarketingDashboard` registers as its AI scope: the generated
 * slice, the derived Lead Form group folded in, and the labels.
 *
 * ⚠️ `usePageDataWithLabels(base, LABELS)` adds `labels` itself, so this mirrors the
 * merged shape — one definition of what that page's data IS, read by the screen and by
 * `demoSurfaces.ts`. `audit:custom-prompt` asserts the two agree.
 */
export function marketingBase(
  profile: Parameters<typeof deriveLeadFormGroup>[0] & { reports: { marketingDashboard: DashboardView } },
): DashboardView & { leadFormSummary: KpiGroup | null } {
  return {
    ...profile.reports.marketingDashboard,
    leadFormSummary: deriveLeadFormGroup(profile, MARKETING_LABELS),
  };
}
