import type { WorkflowTreeModel, TreeLeaf, TreePath } from "../components/WorkflowTree";
import type { ExtraWorkflow } from "./schema";

/* =============================================================================
   workflowChrome.ts — the node names the PRODUCT owns, and the empty workflow
   -----------------------------------------------------------------------------
   ⚠️ **THESE MOVED OUT OF `AgentWorkflow.tsx` (8/27/2026) SO NODE CAN IMPORT THEM.** That
   screen imports `useProfile`, which reaches `profiles.ts` and its `import.meta.glob` — a
   Vite-only builtin — so `npm run audit:ai` could not import anything from it and its checks
   were forced to grep the source instead of running it. This file has no Vite dependency, so
   the empty tree can be BUILT and READ by the audit. That distinction has already mattered
   twice here: a grep passed against `if (false && CHROME_KEYS.has(path))`, and another
   matched a conversation RULE rather than the imperative it was written for.

   Nothing about the values changed in the move.
   ============================================================================= */

/* ⚠️ RENAMED FROM SMS_* BECAUSE BOTH CHANNELS USE THEM NOW (8/26/2026). The voice tree's
   intents were the prospect's own queue names until the user confirmed the real Voice page
   shows these same two words; leaving them called INTENT_SALES on a voice tree reads as a bug and
   invites someone to "fix" it back.

   ⚠️⚠️ **`ZERO_TRIGGER` WAS `SMS_TRIGGER`, AND IT IS NOT SMS-SPECIFIC (8/27/2026).** Two
   captures of a VOICE workflow in the same account both carry this line — the configured
   one as "1 Campaign, 0 Forms, and 0 Inbound SMS", singular at one — so the product names
   all three trigger kinds whatever the channel, and pluralises on the count. A second
   constant was written for the empty tree before that was noticed, with a byte-identical
   value; **one field copying another is the common cause of three separate silent bugs
   recorded in CLAUDE.md**, so there is ONE constant and both callers use it.

   ⚠️ **THE CONFIGURED VOICE TREE STILL SAYS "2 campaigns and 0 forms"** from an older
   capture, and is deliberately left alone: correcting it would reword a screen nobody asked
   about. Raised with the user instead. */
export const ZERO_TRIGGER = "0 Campaigns, 0 Forms, and 0 Inbound SMS";
export const INTENT_SALES = "Sales Inquiry";
export const INTENT_SUPPORT = "Need Support";
/** The support leaf is "All Support Users", NOT "All Need Support Users". */
export const SUPPORT_LEAF = "All Support Users";

/* =============================================================================
   What **Create Workflow** actually builds
   -----------------------------------------------------------------------------
   Measured 8/27/2026 off a capture taken immediately after creating one (workflow 550 of
   agent 169), so this is the product's own empty state rather than a guess:

   | node | authored |
   |---|---|
   | Triggered by | **"0 Campaigns, 0 Forms, and 0 Inbound SMS"**, 248 x 90 |
   | Conversation Start | `<channel> · classify intent`, 248 x 66, ground `#D4E0FE` |
   | Sales Inquiry / Need Support | title ONLY — **no caller-intent subtitle**, 248 x 46 |
   | All Sales Inquiry / Support Users | title + **"+ Add action"**, 248 x 72, no chips |

   Node width is 193.75 at the React Flow viewport's own 0.78125 scale, i.e. the **248px**
   our voice tree already draws — so the geometry needed no change, only the contents.

   ⚠️ **THE INTENT NODES CARRY NO SUBTITLE, which is the whole difference from a configured
   workflow.** Handing them `spec.intent` would describe a caller the SE has not described
   yet, on a diagram whose entire point is that nothing is configured.

   ⚠️ **THE USER-GROUP LEAVES CARRY NO ACTION AND NO PILLS.** A configured one reads
   "Qualify" with its collected fields; an empty one offers "+ Add action". Pills here would
   advertise collecting things the agent was never told to collect — the exact
   diagram-disagrees-with-the-agent bug this file records on 11 of 12 prospects.

   ⚠️ **THE TRIGGER LINE IS THE SMS-WORDED ONE, ON A VOICE WORKFLOW, AND THAT IS MEASURED.**
   Both captures of this account read `<n> Campaign(s), 0 Forms, and 0 Inbound SMS` on a
   VOICE workflow — the configured one says "1 Campaign", singular. Our own voice tree says
   "2 campaigns and 0 forms" from an older capture, and it is deliberately NOT touched here:
   changing it would reword a screen nobody asked about. Flagged for the user instead.

   ⚠️ **`chromeLocked` and every `locked` flag stay on.** These four names are the product's
   in an empty workflow exactly as they are in a configured one, so the AI must be REFUSED
   rather than allowed to rename them — the silent-no-op trap the SMS lock documents.
   ============================================================================= */
export function emptyWorkflowTree(channelLabel: string): WorkflowTreeModel {
  const userLeaf = (title: string): TreeLeaf => ({
    title,
    /* Nothing configured, so there is no action text to draw — `addAction` renders the
       product's blue affordance in its place. `action` stays a required field on the
       model, so it is the empty string rather than a placeholder somebody might read. */
    action: "",
    addAction: true,
    /* ⚠️⚠️ **NO TONE, AND THAT IS MEASURED: A NODE IS TINTED BY ITS ACTION.** Both captures
       together give the system — a configured leaf takes its action's hue at 8% with a
       matching 1px border and a 5px LEFT edge (Qualify lilac `#D0C1F2`, Inform & Route teal
       `#33E5C9`, Support & Escalate orange `#FF7045`), while an EMPTY leaf is plain WHITE
       with 1px `#E7E9EB` and a GREY 5px left edge. With no action there is no hue, so
       tinting these green and orange would colour them by a route nobody has configured.
       (Our configured tree's own green/orange tints come from an earlier capture of a
       different page and are deliberately left alone — flagged for the user instead.) */
    locked: true,
  });
  return {
    variant: "voice",
    triggeredBy: ZERO_TRIGGER,
    startLabel: `${channelLabel} · classify intent`,
    chromeLocked: true,
    branches: [
      {
        title: INTENT_SALES, icon: "cart", locked: true,
        leaves: [userLeaf(`All ${INTENT_SALES} Users`)],
      },
      {
        title: INTENT_SUPPORT, icon: "headset", locked: true,
        leaves: [userLeaf(SUPPORT_LEAF)],
      },
    ],
  };
}

/**
 * What the agent says first on an empty workflow.
 *
 * ⚠️ **HOUSE STYLE, and no invented human name.** `deriveVoiceSpec` opens "Hi, thanks for
 * calling <name>. I'm here to help. <question>" — this is the same shape with the open
 * question the user asked for. It introduces the agent as the AI assistant rather than
 * giving it a first name: the configured specs only have names where an SE typed one.
 */
export function emptyWorkflowGreeting(customerName: string): string {
  return `Hi, thanks for calling ${customerName}. I'm ${customerName}'s AI assistant. `
    + `How can I help you today?`;
}

/* =============================================================================
   The three DEFAULT LEAF ACTIONS, and the EXTRA-WORKFLOW tree
   -----------------------------------------------------------------------------
   ⚠️ **MOVED HERE FROM `AgentWorkflow.tsx` (9/8/2026), for the reason at the top of this
   file.** That screen cannot be imported by node, so `npm run audit:ai`'s extra-workflow
   checks were reduced to GREPPING its source for `title: INTENT_SALES` and counting
   `locked: true` occurrences. This file has no Vite dependency, so the audit can now BUILD
   Orlando Health's five real trees and run the real `isLockedEdit` against them — and this
   file already records why that distinction matters: "a grep passed against
   `if (false && CHROME_KEYS.has(path))`".

   Nothing about the values or the logic changed in the move. The one edit is the signature:
   it took `ReturnType<typeof useProfile>[...]` to reach the workflow type, which is a hook
   round-trip for something the schema exports directly.
   ============================================================================= */

/* The two leaf ACTIONS the product defaults to. Not the prospect's queue: "Route to <queue>"
   was ours, and the real page shows one of a fixed set of agent behaviours here. */
/* ---- the five actions, and how a node's colour is decided ------------------
   ⚠️⚠️ **ONE RESOLVER, BECAUSE THERE WERE TWO AND THEY DISAGREED.** The DRAWER
   resolved a node's action (a private `kindOfNode` in `workflowDrawers.ts`) while
   the RENDERER read `node.actionKind` directly and fell back to a neutral card. So
   a node carrying only an `action` STRING — which is every voice node and every
   authored extra workflow — opened the right drawer and rendered with no colour at
   all. Both now call this.

   ⚠️ **IT LIVES HERE** so `engine/` and the audits can import it: this module is
   already the DOM-free home of the chrome constants, for exactly that reason. */
export type ActionKind = "callback" | "qualify" | "inform" | "informRoute" | "escalate";

/** The five the product offers, in the dropdown's own order. */
export const ACTION_KINDS: ActionKind[] = ["callback", "qualify", "inform", "informRoute", "escalate"];

/**
 * Which of the five an action is. `actionKind` wins when set; otherwise the action
 * TEXT decides, because authored and generated workflows write prose ("Book
 * Appointment", "Refer to Primary Care") rather than picking from the five.
 *
 * ⚠️⚠️ **THE ORDER IS LOAD-BEARING AND EVERY LINE OF IT IS DECIDED BY REAL DATA.**
 * Measured across the demos and seeds on disk, these are the strings that exist:
 *   - `escalate` is tested before `route`, or "Warm Hand-off" and "Transfer
 *     Registration" would read as routing rather than as handing a person over.
 *   - `route` is tested before `callback`, and that one case settles the order:
 *     **"Refer to Scheduling" contains BOTH "refer" and "schedul"**. It is a
 *     referral to a team, so routing must win — while "Schedule Appointment",
 *     which carries no routing word, still lands on callback.
 *   - `inform` is the FALLBACK rather than a keyword, because it is the generic
 *     action; "Answer & Nurture", "Confirm & Update" and "Stay Available" are all
 *     informing and share no word.
 * ⚠️ `911` and `hand to` are in the escalate set for Orlando Health's ER flows,
 * where "Hand to a Person or 911" and "Return to the ER or 911" are the urgent
 * hand-offs. Add a keyword only against a real action string, not a guess.
 */
export function actionKindOf(node: { action?: string; actionKind?: ActionKind } | undefined): ActionKind | undefined {
  if (!node) return undefined;
  if (node.actionKind) return node.actionKind;
  const a = String(node.action ?? "");
  if (!a.trim()) return undefined;
  if (/qualify/i.test(a)) return "qualify";
  if (/escalate|hand[- ]?off|\bhand to\b|911|transfer/i.test(a)) return "escalate";
  if (/\broute\b|routing|\brefer\b|referral|refer to/i.test(a)) return "informRoute";
  if (/callback|\bbook\b|booking|schedul/i.test(a)) return "callback";
  return "inform";
}

export const LEAF_QUALIFY = "Qualify";
export const LEAF_ESCALATE = "Support & Escalate";
export const LEAF_INFORM = "Inform & Route";

/* An extra workflow (Reyes Law's SMS nurture, Avi & Co's speed-to-lead) carries its branches
   as data; this maps them onto the same model so there is one renderer rather than two.
   -----------------------------------------------------------------------------------------
   ⚠️⚠️ **THE FOUR CHROME BOXES ARE LOCKED HERE TOO, AND THIS USED TO SKIP THEM (9/2/2026).**
   Reported directly: *"just like the voice tree the 'Sales Inquiry, Need support, all sales
   inquiry users and All support users' box are locked, those can't be change / edit. we can
   only do branches below that."*

   It used to draw each authored branch as its own TOP-LEVEL intent node with a `${title}
   Users` leaf under it — so a new workflow rendered four intent nodes where the product always
   shows exactly two, and neither those nodes nor their leaves were locked. This file's own SMS
   note had recorded the opposite as a deliberate exception ("EXTRA agent workflows keep their
   own authored branch names, because a nurture flow's node is not 'Sales Inquiry'"), and that
   exception was wrong: the intents and the user groups are product chrome on EVERY SMS
   workflow, and what a nurture or speed-to-lead flow actually contributes is the USE CASES on
   the row beneath them — which is the same shape the voice tree settled on.

   ⚠️ CONSEQUENCE, STATED: this restructures Reyes Law's nurture diagram too. Its branches now
   sit under the two locked leaves rather than being intent nodes themselves. That is not
   collateral damage from someone else's fix — it is the same product rule, and its old tree
   was drawing chrome the product does not have.

   ⚠️ `chromeLocked` IS DELIBERATELY NOT SET. The two flags cover different things: per-node
   `locked` refuses the four titles the user named, `chromeLocked` additionally freezes
   `triggeredBy` and `startLabel`. An authored extra workflow's trigger line is real
   configuration ("New inbound lead, web form and missed call" is what fires it, and the Agent
   Studio table renders that same field under its own "Triggered By" column), and `editGuard`'s
   note already sanctions exactly this: "an authored extra workflow that wants its own trigger
   line simply does not set it." */
export function extraTree(wf: ExtraWorkflow): WorkflowTreeModel {
  /* A branch with no `intent` is a sales-side use case, which is what every authored one was
     before the field existed. */
  /* ⚠️ `route` IS CARRIED ONLY ON A VOICE WORKFLOW — see the note on
     `WorkflowBranch.route`. The renderer draws `Route to <route>` INSTEAD OF the
     action, which is right for a spoken transfer and would silently blank an SMS
     workflow's authored actions. Gating it here rather than trusting whoever
     authors the data makes that rule structural. */
  const spoken = /voice/i.test(wf.channel ?? "");
  const asPath = (b: (typeof wf.branches)[number]): TreePath => ({
    title: b.title,
    action: b.action,
    tone: b.tone,
    chips: b.chips,
    ...(spoken && b.route?.trim() ? { route: b.route.trim() } : {}),
  });
  const sales = wf.branches.filter((b) => b.intent !== "support").map(asPath);
  const support = wf.branches.filter((b) => b.intent === "support").map(asPath);

  return {
    variant: "sms",
    triggeredBy: wf.triggeredBy ?? "1 Campaign",
    startLabel: wf.startLabel,
    branches: [
      {
        title: INTENT_SALES, icon: "cart", locked: true,
        leaves: [{
          title: `All ${INTENT_SALES} Users`,
          action: LEAF_QUALIFY,
          tone: "green",
          locked: true,
          ...(sales.length ? { paths: sales } : {}),
        }],
      },
      {
        title: INTENT_SUPPORT, icon: "headset", locked: true,
        leaves: [{
          title: SUPPORT_LEAF,
          action: LEAF_ESCALATE,
          tone: "orange",
          locked: true,
          /* A workflow with no support-side use case renders the leaf as a terminal, exactly
             as Comfort Keepers' voice tree does. */
          ...(support.length ? { paths: support } : {}),
        }],
      },
    ],
  };
}
