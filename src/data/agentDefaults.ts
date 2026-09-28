import type { CustomerProfile } from "./schema";

/* =============================================================================
   agentDefaults.ts — product defaults that overrule what the engine decided
   -----------------------------------------------------------------------------
   Asked for directly: *"in the default sms agent, never give any pricing, unless
   the user uses the ask ai feature to change but dont do it from the beginning"*.

   ⚠️⚠️ **MEASURED FIRST: 110 OF 179 PROFILES ON DISK SAID THE AGENT MAY QUOTE A
   PRICE**, including Key-Whitman Eye Center and Marriott — verticals where a
   price quoted over SMS is questionable on its own terms. `engine/core.ts` asks
   the model to judge this per prospect (`providesEstimate`), and the judgement is
   reasonable in isolation; the product decision is that the DEFAULT should be no
   pricing regardless, and an SE turns it on deliberately.

   ⚠️⚠️ **CLAMPED ON THE BASE, NOT ON THE EFFECTIVE CONFIG — that is the whole
   reason this is a separate step rather than a line in the prompt builder.** The
   Ask AI override layer is merged ON TOP of the profile, so forcing the flag
   false after the merge would also kill an SE's deliberate change and the drawer
   would report success while the agent kept refusing. Forcing it false HERE makes
   the base a plain "no", which an override can then raise — exactly the
   "unless the user uses the ask ai feature" half of the request.

   ⚠️ **NOT A DATA MIGRATION, AND DELIBERATELY SO.** Applied at READ time, the same
   place and for the same reason as `renameMarketingSources`: 110 profiles are on
   disk and ~450 more live only in the shared library, so editing files would fix
   neither the team's demos nor anything already open in a browser. The stored
   record keeps whatever the engine wrote; the app simply stops acting on it.

   ⚠️ **THE ENGINE PROMPT IS LEFT ALONE.** `providesEstimate` still means what it
   always meant and is still generated, so nothing about the prompt or the schema
   changes and the field stays available if this policy is ever relaxed. Changing
   the prompt instead would fix only prospects generated from today.
   ============================================================================= */

/**
 * The built-in SMS agent never offers a price unless somebody asks it to.
 *
 * Returns the SAME OBJECT when there is nothing to change, so this costs no
 * re-render for the 69 profiles that already said no.
 */
export function withoutDefaultPricing(p: CustomerProfile): CustomerProfile {
  const pb = p.reports?.agentConfig?.smsPlaybook;
  if (!pb || pb.providesEstimate !== true) return p;
  return {
    ...p,
    reports: {
      ...p.reports,
      agentConfig: {
        ...p.reports.agentConfig!,
        smsPlaybook: { ...pb, providesEstimate: false },
      },
    },
  };
}
