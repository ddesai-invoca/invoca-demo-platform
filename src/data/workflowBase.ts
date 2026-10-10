import type { WorkflowTreeModel, TreeBranch, TreePath } from "../components/WorkflowTree";
import type { CustomerProfile } from "./schema";
import { INTENT_SALES, INTENT_SUPPORT, SUPPORT_LEAF, ZERO_TRIGGER, LEAF_QUALIFY, LEAF_ESCALATE,
  LEAF_INFORM } from "./workflowChrome";
import { SMS_TRIGGER, smsBranches, smsConfigFor } from "./smsTemplate";
import { voiceSpecFor, agentConfigOf } from "./voiceAgentSpec";
import { voiceCopy } from "./voiceCopy";
import { isProspect } from "./prospect";
import type { VoiceUseCase } from "./voiceUseCases";

/* =============================================================================
   workflowBase.ts — the BUILT-IN workflow tree, and the object its page registers
   -----------------------------------------------------------------------------
   ⚠️⚠️ **EXTRACTED FROM `AgentWorkflow.tsx` (10/9/2026) FOR THE REASON `workflowChrome.ts`
   AND `workflowIntents.ts` WERE: SOMETHING OTHER THAN THAT SCREEN NEEDS TO BUILD THIS, AND
   A SECOND COPY WOULD DRIFT.** The custom-prompt feature applies an SE's instruction to a
   demo right after it generates, and to edit a surface it has to seed the EXACT object that
   surface registers — `applyEdits` stores a full copy of the data it edited, so a base that
   is merely close would overwrite the diagram with a partial one and the page would render
   a tree with no branches. `src/data/demoSurfaces.ts` and `AgentWorkflow.tsx` therefore read
   ONE definition.

   ⚠️ NOTHING ABOUT THE VALUES CHANGED IN THE MOVE. `AgentWorkflow.tsx` imports both back and
   calls them exactly where it did; `npm run audit:ai` already BUILDS this tree and asserts
   its shape, so a regression here reddens rather than shipping.

   ⚠️ **BUILT-IN PAIR ONLY.** A created workflow (`emptyWorkflowTree`) and an authored extra
   (`extraTree`) are different shapes with different owners, and both already live in
   `workflowChrome.ts`. This file is the derived default and the page object around it.
   ============================================================================= */


/**
 * Use cases -> path nodes.
 *
 * ⚠️ **`collect` IS THE PILLS AND THE PROMPT'S COLLECT LIST, from ONE array.** The pills used
 * to come from `collectNames(actionKind)` — a table keyed by the ACTION — which was fine while
 * every branch collected the same two things and wrong the moment they differ: a cancellation
 * wants a confirmation number, not a ZIP. Reading both from the use case is what stops the
 * diagram advertising a field the agent never asks for.
 *
 * ⚠️ Returns `undefined` rather than `[]` for an empty list, so a leaf with no use cases is
 * byte-identical to one that never had the prop.
 */
/* ⚠️ THE ACTION IS A PARAMETER NOW (10/9/2026), because the two sides end differently: a
   sales use case routes the caller on (`Inform & Route`), and a support one is where the
   agent does the work (`Support & Escalate`). One hardcoded action gave every support answer
   the sales ending. */
function useCaseNodes(
  cases: VoiceUseCase[],
  tone: "green" | "orange",
  action: string = LEAF_INFORM,
): TreePath[] | undefined {
  if (!cases?.length) return undefined;
  return cases.map((u) => ({
    title: u.title,
    action,
    tone,
    actionKind: action === LEAF_ESCALATE ? ("escalate" as const) : undefined,
    chips: u.collect,
    ...(u.route ? { route: u.route } : {}),
  }));
}

/* PER-PROSPECT *SMS* SHAPE OVERRIDES, matched by prospect name.

   ⚠️ THIS TABLE SHRANK when the four node names were locked into the template above. Three
   of the five things that made Comfort Keepers' tree different turned out to be the
   PRODUCT's, not the prospect's — the trigger line, the two intent names and the support
   leaf title — so they moved into the template and every prospect gets them. What is left is
   genuinely this prospect's configuration:
     - the sales action is "Schedule Callback", with a PHONE icon, not "Schedule <bookingTerm>"
     - one chip, "Consumer Name", where the default carries two
   Keeping the whole tree here instead would have frozen a copy of the template that stops
   tracking it — the same drift the SMS brain note warns about. */
const SMS_SHAPE: { prospect: string; tree: () => Pick<WorkflowTreeModel, "triggeredBy" | "branches"> }[] = [
  {
    prospect: "comfort keepers",
    tree: () => ({
      triggeredBy: ZERO_TRIGGER,
      branches: [
        {
          title: INTENT_SALES, icon: "cart", locked: true,
          leaves: [{
            title: `All ${INTENT_SALES} Users`, action: "Schedule Callback",
            tone: "green", actionIcon: "phone", chips: ["Consumer Name"],
          }],
        },
        {
          title: INTENT_SUPPORT, icon: "headset", locked: true,
          leaves: [{
            title: SUPPORT_LEAF, action: "Support & Escalate",
            tone: "orange", warn: true,
          }],
        },
      ],
    }),
  },
];

/* PER-PROSPECT SHAPE OVERRIDES.

   National Van Lines routes a new move to two different teams, which used to be a
   separate 100-line component with its own canvas size and hand-placed connector
   coordinates (VOICE_SPLIT + VoiceFlowTreeSplit). It is now just a branch with two
   leaves, and the computed layout absorbs it — the same shape the AI can now
   produce for any prospect on request.

   Kept as a default rather than dropped, because it was a delivered change: an SE
   opening that demo should still find the tree they were shown. */
const SHAPE: Record<string, (c: ReturnType<typeof voiceCopy>) => TreeBranch[] | null> = {
  "national-van-lines": (c) => [
    {
      /* ⚠️ THE INTENT NAME IS THE TEMPLATE'S, EVEN HERE. This override exists for the
         two-team SPLIT, which is genuinely this prospect's configuration; the node it hangs
         off is the same locked "Sales Inquiry" every other account shows. It used to read
         "Book a Move", which is exactly the drift the SMS note warns about — an override
         that quietly keeps a copy of a template that has since changed. */
      title: INTENT_SALES, icon: "cart", locked: true,
      subtitle: "Caller wants to book a move and is not an existing customer",
      leaves: [
        /* No pills: these are user-group leaves, the row the rule above clears. The split
           itself is what this override exists for. */
        { title: "All Inter-State Users", action: "Route to Inter-State Move (Team A)", tone: "green" },
        { title: "All Local Move Users", action: "Route to Local Move (Team B)", tone: "green" },
      ],
    },
    {
      title: INTENT_SUPPORT, subtitle: c.supSub, icon: "headset", locked: true,
      /* ⚠️ THE SUPPORT PATH IS THE TEMPLATE'S, even in this override. Only the SALES branch
         differs for this prospect (two teams instead of one); this side was still carrying
         `All ${c.supQ} Users` / `Route to ${c.supQueue}` — a copy of the default from before
         the leaf became chrome, which is exactly the drift that shrank the Comfort Keepers
         override. An override should differ only where it genuinely differs. */
      leaves: [{ title: SUPPORT_LEAF, action: LEAF_ESCALATE, tone: "orange", locked: true }],
    },
  ],
};


export function deriveTree(
  profile: CustomerProfile,
  isSms: boolean,
  channelLabel: string,
): WorkflowTreeModel {
  const c = voiceCopy(profile);

  if (isSms) {
    const smsShaped = SMS_SHAPE.find((o) => isProspect(profile, o.prospect))?.tree();
    if (smsShaped) return { variant: "sms", startLabel: `${channelLabel} · classify intent`,
      ...smsShaped };
    /* ⚠️⚠️ **THE BUILT-IN SMS TREE IS THE MEASURED SIX-ROW TEMPLATE NOW (9/17/2026)**, asked
       for directly with thirteen captures of a real Greenix SMS workflow: "this is the workflow
       i want to replicate for all prospects." What it replaced was a three-row tree ending in
       `Schedule ${bookingTerm}` / Support & Escalate — which was itself measured, off an older
       capture, and is kept nowhere: the new shape IS this page now.

       ⚠️ **SCOPED TO THE BUILT-IN WORKFLOW, ON THE USER'S OWN CALL when asked.** The seven
       authored extra workflows (Orlando Health's five ER trees, Avi & Co - New, the generated
       quote-request ones) keep their own shapes, because those were authored for specific
       scenarios and flattening them onto one template would throw that away. They render
       through `extraTree`, which this does not touch.

       ⚠️ `geo: "smsV2"` is the measured geometry of the real page — 248px nodes on a 296
       column pitch and a 168 row pitch — and is opt-in for exactly the same reason: the extra
       workflows stay on `sms`, which is what they were signed off at. See `workflowRows.ts`. */
    return {
      variant: "sms",
      geo: "smsV2",
      triggeredBy: SMS_TRIGGER,
      startLabel: `${channelLabel} · classify intent`,
      /* Same chrome lock: the trigger line is the product's exact wording, so it was
         inconsistent for the AI to be able to rewrite it while the intents were refused. */
      chromeLocked: true,
      branches: smsBranches(profile),
    };
  }

  const shaped = SHAPE[profile.id]?.(c);
  const spec = voiceSpecFor(profile);
  return {
    variant: "voice",
    triggeredBy: "2 campaigns and 0 forms",
    startLabel: "Voice · classify intent",
    /* Trigger line and Conversation Start are the product's, not the prospect's. */
    chromeLocked: true,
    branches: shaped ?? [
      {
        /* ⚠️ THE VOICE INTENTS ARE THE SAME TWO WORDS THE SMS TEMPLATE USES, and locked for
           the same reason: the real product does not let a user rename them (confirmed
           8/25/2026). They USED to derive from each prospect's own routing queues, which is
           why Shady Blinds read "Design Consultation" / "Existing Order" and AutoNation
           "Test Drive" / "Service Appointment" on a screen that always shows these two.

           ⚠️ THE PROSPECT-SPECIFIC PART MOVED DOWN A ROW, IT DID NOT DISAPPEAR. The queue
           name now lives where it is genuinely configuration — the leaf title and its route
           action — so the diagram still names this prospect's own teams. Only the intent
           label is generic, because in the product it always is. */
        title: INTENT_SALES, subtitle: spec.intent.split("\n")[0], icon: "cart", locked: true,
        /* ⚠️ ONLY THE ROW BELOW THE USER GROUPS CARRIES PILLS (8/26/2026), and they are the
           drawer's own "What To Collect" rather than a second list that happens to look like
           it. They used to be the prospect's vocabulary — "Blinds", "Timeline", "Issue Type" —
           minted per node, so a node advertised collecting one thing while its drawer said
           another. `collectNames` reads the single table in `workflowDrawers`. */
        leaves: [{
          /* ⚠️ THE LEAF IS CHROME TOO (8/26/2026). It read `All ${c.newQ} Users` /
             `Route to ${c.newQueue}` — the prospect's own queue — where the real page always
             shows the user group named after the intent and one of a fixed set of actions.
             So the whole top of the tree down to and including this row is the product's, and
             only the CHIPS below it are configuration.

             ⚠️ CONSEQUENCE, AND IT IS REAL: the diagram no longer contains a destination the
             agent could name aloud. `buildVoiceSystem` therefore stopped reading a group label
             into the spoken handoff — see the note there. */
          title: `All ${INTENT_SALES} Users`,
          action: LEAF_QUALIFY,
          tone: "green",
          locked: true,
          /* ⚠️ QUALIFY ASKS A QUESTION AND ROUTES ON THE ANSWER, so its leaf has one child per
             answer. These titles ARE the Qualify drawer's answers: one list, two renderings,
             so the diagram and the drawer cannot disagree.

             ⚠️ **AS MANY BRANCHES AS THE PROSPECT NEEDS (8/27/2026).** This was a fixed PAIR,
             and the type enforced it — so "add a third use case" was impossible rather than
             merely absent. The row is configuration, not chrome; only the four nodes above it
             are the product's. */
          paths: useCaseNodes(spec.useCases.sales, "green"),
        }],
      },
      {
        title: INTENT_SUPPORT, subtitle: c.supSub, icon: "headset", locked: true,
        leaves: [{
          title: SUPPORT_LEAF,
          /* ⚠⚠ **A QUALIFY, BECAUSE IT BRANCHES — asked for directly (10/9/2026) and it is
             also the product's own rule, which this file states one row up: "ONLY A QUALIFY
             MAY NEST … the other four are terminal, so a child under one would be drawn in a
             row the agent can never reach." This node had four children and a TERMINAL
             action, so the diagram contradicted that rule on every prospect. Its answers are
             the support cases; each of THEM is the terminal `Support & Escalate`. */
          action: LEAF_QUALIFY,
          actionIcon: "callSplit",
          actionKind: "qualify",
          locked: true,
          /* ⚠️ **THE SUPPORT NODE BRANCHES TOO NOW, and this file used to say it must not** —
             "Support & Escalate does not branch; giving it paths would draw a fork the product
             does not have." That was wrong about the product and, more importantly, wrong about
             the demo: an existing customer rings to DO something (change it, cancel it, query a
             charge), each wanting a different reference number and a different team. With no
             branches the agent asked every support caller the same two questions and routed
             them all to one queue.

             ⚠️ A prospect whose spec defines none (Comfort Keepers) still renders NO paths, so
             its diagram is untouched. */
          paths: useCaseNodes(spec.useCases.support, "orange", LEAF_ESCALATE),
        }],
      },
    ],
  };
}

/**
 * The object the BUILT-IN workflow page registers as its AI scope.
 *
 * ⚠️⚠️ **THIS MUST STAY BYTE-IDENTICAL TO WHAT `AgentWorkflow.tsx` REGISTERS, WHICH IS
 * WHY THAT SCREEN CALLS THIS RATHER THAN KEEPING ITS OWN COPY.** `applyEdits` reads
 * `overrides[key] ?? base`, edits it, and stores the WHOLE result back as the override —
 * so seeding a base that is merely similar does not degrade gracefully, it REPLACES the
 * page's data with the partial one. A base missing `branches` renders a diagram with no
 * nodes, and nothing anywhere reports it. `audit:custom-prompt` asserts the two agree.
 *
 * ⚠️ **THE `agent` HALF IS VOICE-ONLY AND THE `sms` HALF IS SMS-ONLY**, exactly as on the
 * page: the voice tree's greeting, rules and routing steps are things the diagram cannot
 * draw, and the SMS template's questions and instructions are what its node drawers write.
 * Giving either channel the other's half is the duplicated-field trap behind the three
 * 8/27 voice bugs.
 */
export function builtInWorkflowBase(profile: CustomerProfile, isSms: boolean): Record<string, unknown> {
  const channelLabel = isSms ? "SMS" : "Voice";
  const baseAgent = isSms ? null : voiceSpecFor(profile);
  return {
    title: `${profile.customerName} - ${channelLabel} workflow`,
    ...deriveTree(profile, isSms, channelLabel),
    ...(baseAgent ? { agent: agentConfigOf(baseAgent) } : {}),
    ...(isSms ? { sms: smsConfigFor(profile) } : {}),
  };
}
