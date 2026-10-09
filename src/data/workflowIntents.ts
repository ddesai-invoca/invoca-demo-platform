/* =============================================================================
   workflowIntents.ts — the two locked intent names, and nothing else
   =============================================================================

   ⚠️⚠️ **EXTRACTED FROM `workflowChrome.ts` SO THE ENGINE CAN READ THEM (10/9/2026), and
   the reason is the one this repo has already paid for twice.** `engine/chat.ts` needs to
   know whether a path is the SUPPORT path — it renders that one differently, because the
   generic "hand off to whichever fits" wording contradicts SUPPORT LOOKUP. Matching the
   literal `"Need Support"` in the engine would be a second definition of a name the chrome
   owns, and renaming the box would silently drop the support path back onto the wrong
   wording with nothing failing.

   But `workflowChrome.ts` cannot be imported from `engine/`: it takes its types from
   `../components/WorkflowTree`, a **.tsx**, and the node project compiles with
   `module: nodenext` and no `--jsx`. Measured both ways — extensionless resolves to `any`
   and reddens three implicit-any errors, and the explicit `.tsx` fails outright with
   "'--jsx' is not set". Exactly the wall `src/data/replicaPages.ts` hit, and the fix is the
   same one: lift the DOM-free part into its own module and re-export it, so no existing
   importer changes. `leadFields.ts`, `replicaRegistry.ts` and `prospect.ts` are all here
   for this reason.

   ⚠️ **NOTHING ELSE BELONGS IN THIS FILE.** Add a type from `WorkflowTree` and the engine
   can no longer import it, which is the whole thing it exists to allow.
   ============================================================================= */

/** The two intent boxes the product always draws, and which an SE cannot rename. */
export const INTENT_SALES = "Sales Inquiry";
export const INTENT_SUPPORT = "Need Support";
