import type { WorkflowTreeModel } from "../components/WorkflowTree";
import type { VoicePath } from "../../engine/chat";
import { collectNames } from "./workflowDrawers";

/* =============================================================================
   voicePaths.ts — the workflow diagram, as the voice agent's routing logic
   -----------------------------------------------------------------------------
   Turns the tree an SE can see and edit into the paths `buildVoiceSystem` renders into
   the system prompt, so **the diagram IS the call's logic** rather than a picture of it.

   ⚠️ **WHY THIS EXISTS.** The tree and the prompt used to be derived separately from
   `voiceRoutingDemo.queues` — the same source, two models. So an Ask AI edit that added a
   branch, renamed a team or changed what a leaf collects redrew the diagram and left the
   agent behaving exactly as before: a silent no-op on the surface the feature was built
   for. Now there is one model with two renderings, and both directions the SE expects
   work without any syncing:
     • edit the diagram  -> the prompt is rebuilt   -> the agent follows the new logic
     • "ask for the ZIP" -> that leaf's chips change -> the chip shows ON the diagram

   ⚠️ **WHAT THE DIAGRAM DOES AND DOES NOT OWN.** The tree carries paths, teams and what
   to collect. It does NOT carry brand rules, the service area or knowledge — those are
   not shaped like a flow and stay in `agentConfig`. Keeping that line clean is what stops
   this from turning into a second, competing config.

   ⚠️ **THE MAPPING IS THE PRODUCT'S OWN, not an invention:**
     branch title    -> the intent the caller has
     branch subtitle -> how to recognise it
     leaf title      -> which team it hands off to
     leaf action     -> what the agent does there
     leaf chips      -> the data to gather first, i.e. the questions to ask
   ============================================================================= */

/** Which action a leaf is performing, from the words the product puts on it. */
function actionKindOf(action: string): "qualify" | "inform" | "escalate" {
  return /escalate/i.test(action) ? "escalate" : /qualify/i.test(action) ? "qualify" : "inform";
}

/** The scope key the voice workflow page registers its diagram under. */
export const VOICE_WORKFLOW_SCOPE_PATH = "/agent-studio/agent/workflow/voice";

/**
 * Convert a workflow tree into the routing paths the voice prompt renders.
 *
 * ⚠️ **TOTAL BY CONSTRUCTION.** The tree is user-editable through Ask AI, which is allowed
 * to change the LENGTH of `branches`, `leaves` and `chips` (see `editGuard`'s
 * LENGTH_IS_CONTENT). So this must survive any shape: a branch with no leaves is dropped
 * rather than emitting a path that routes nowhere, blank titles are dropped, and an empty
 * result returns `[]` so the prompt falls back to its original hardcoded flow instead of
 * printing an empty CALL FLOW for the model to improvise around.
 */
export function treeToVoicePaths(tree: WorkflowTreeModel | undefined | null): VoicePath[] {
  const branches = tree?.branches ?? [];
  const paths: VoicePath[] = [];
  for (const b of branches) {
    const intent = (b?.title ?? "").trim();
    if (!intent) continue;
    /* ⚠️ A LEAF WITH PATHS CONTRIBUTES ITS PATHS, NOT ITSELF (8/26/2026). The diagram grew a
       fourth row: a Qualify leaf now has one child per answer. Reading only the leaves would
       have left an SE editing a path, watching the diagram redraw, and hearing the agent
       behave exactly as before — the precise silent no-op deriving the prompt from the tree
       was built to close, reappearing one row further down. */
    const routes = (b.leaves ?? [])
      .flatMap((l) => (l?.paths?.length
        ? l.paths.map((pth) => ({
            /* ⚠️ **THE PATH'S OWN DESTINATION IS THE TEAM (8/27/2026), falling back to the
               leaf's group.** The leaf title became locked chrome ("All Sales Inquiry Users"),
               and this file's own note recorded the consequence: the tree stopped carrying a
               destination the agent could name aloud, so `buildVoiceSystem` stopped naming
               one. A use case is where the routing decision actually happens, so that is where
               the team belongs. The fallback keeps Comfort Keepers — whose SE named no teams —
               behaving exactly as before. */
            team: ((pth?.route ?? "").trim() || (l.title ?? "").trim()),
            need: (pth?.title ?? "").trim(),
            action: (pth?.action ?? "").trim() || "route them",
            collect: (pth?.chips ?? []).map((c) => (c ?? "").trim()).filter(Boolean),
          }))
        : [{
            team: (l?.title ?? "").trim(),
            action: (l?.action ?? "").trim() || "route them",
            /* ⚠️ THE ACTION SAYS WHAT TO COLLECT, NOT THE NODE'S PILLS. This read `l.chips`,
               which was fine while every leaf carried some — and the moment the user-group row
               stopped carrying pills (they belong to the row below it) that would have quietly
               left the support path with nothing to collect: the diagram changes, the drawer
               still says "Consumer Name", and the agent stops asking. Same table the pills and
               the drawer read, keyed by action. */
            collect: (l?.chips?.length
              ? l.chips
              : collectNames(actionKindOf(l?.action ?? ""))).map((c) => (c ?? "").trim()).filter(Boolean),
          }]))
      .filter((r) => r.team);
    if (!routes.length) continue;   // a branch that routes nowhere is not a path
    const recognise = (b.subtitle ?? "").trim();
    paths.push({ intent, ...(recognise ? { recognise } : {}), routes });
  }
  return paths;
}
