/* =============================================================================
   aiAgentLabels — the AI Agent Conversion dashboard's OWN wording.
   -----------------------------------------------------------------------------
   Asked for on that dashboard only (9/29/2026): "Call Outcome Summary" ->
   "Interaction Outcome Summary", and the "Call Count" column -> "Count".

   ⚠️⚠️ **NOT A DATA EDIT, BECAUSE BOTH STRINGS ARE SHARED.** Measured: "Call Outcome
   Summary" sits in `marketingDashboard` AND `aiAgentConversion` on every profile, and
   "Call Count" is one of the few canonical platform labels this repo deliberately
   keeps verbatim across the Marketing, Ops, Location Comparison, Franchise and
   Insights screens. Rewriting the JSON would rename it on all of them — the "a change
   for one screen stays on that screen" rule. Renaming at render is scoped by
   construction.

   ⚠️⚠️ **AND IT IS APPLIED TO THE BASE, NEVER AFTER THE MERGE.** `useDashboardData`
   lays the Ask AI override layer on top of what it is given; relabelling afterwards
   would overwrite an SE's own edit and the drawer would report success while the
   column snapped back — the silent no-op this repo records repeatedly. Passing the
   renamed object IN makes the new wording the BASE that an override can still
   replace, the same shape as the SMS pricing clamp in `agentDefaults.ts`.

   ⚠️ It lives here rather than in the screen so the audit can CALL it: that screen
   imports `useProfile`, which reaches `profiles.ts` and its Vite-only
   `import.meta.glob`, so node cannot import it and a helper stranded there could only
   ever be grepped. Same reason `workflowChrome.ts` and `workflowRows.ts` exist.
   ============================================================================= */
import type { CustomerProfile } from "./schema";

type AacView = CustomerProfile["reports"]["aiAgentConversion"];

const OUTCOME = /\bCall Outcome Summary\b/;
const CALL_COUNT = "Call Count";

/**
 * ⚠️ Returns the SAME OBJECT when there is nothing to change, so a profile that never
 * carried these strings costs no re-render.
 */
export function interactionLabels(d: AacView): AacView {
  if (!d?.breakdowns?.some((b) => OUTCOME.test(b.tableTitle ?? "") || b.metricColumns?.includes(CALL_COUNT))) return d;
  return {
    ...d,
    breakdowns: d.breakdowns.map((b) => ({
      ...b,
      ...(b.tableTitle && OUTCOME.test(b.tableTitle)
        ? { tableTitle: b.tableTitle.replace(OUTCOME, "Interaction Outcome Summary") }
        : {}),
      ...(b.metricColumns?.includes(CALL_COUNT)
        ? { metricColumns: b.metricColumns.map((c) => (c === CALL_COUNT ? "Count" : c)) }
        : {}),
    })),
  };
}
