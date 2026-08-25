/* =============================================================================
   "Is this profile that prospect?" — one implementation, several callers.
   -----------------------------------------------------------------------------
   Some delivered changes are scoped to a single prospect: Comfort Keepers' SMS workflow tree
   (AgentWorkflow) and its AI Conversion by Franchise dashboard (ManageDashboards +
   FranchiseAiDashboard) so far.

   ⚠️ MATCH ON THE NAME, NOT A HARDCODED ID. The prospects that get these overrides are demos
   in the shared LIBRARY, not profiles on disk, so their ids were minted from whatever the SE
   typed — `comfort-keepers`, `comfort-keepers-home-care`, or a name with a city on the end.
   Keying an override off a guessed id **fails silently**: the screen renders the default, or
   the dashboard never appears, and nobody knows why. Checking the customer NAME and the id
   both survives that.

   ⚠️ ONE COPY, because a second would drift. This started life inside AgentWorkflow.tsx and
   moved here the moment the dashboard needed the same test — two matchers would eventually
   disagree about which prospect is which, and the symptom would be a screen appearing for one
   feature and not the other.
   ============================================================================= */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * True when this profile IS the named prospect, whatever slug its demo was saved under.
 *
 * Substring on a NORMALISED name, so "Comfort Keepers of Santa Barbara" matches
 * "comfort keepers" while "Comfort Inn" does not.
 */
export function isProspect(
  p: { id: string; customerName: string },
  name: string,
): boolean {
  const target = norm(name);
  return norm(p.customerName).includes(target) || norm(p.id).includes(target);
}

/** The prospect the franchise AI dashboard was built for. */
export const COMFORT_KEEPERS = "comfort keepers";

/** The prospect the Signal AI Silver / Gold report pair was built for. */
export const HEALTH_SPRING = "health spring";
