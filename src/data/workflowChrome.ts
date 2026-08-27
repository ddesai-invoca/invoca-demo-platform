import type { WorkflowTreeModel, TreeLeaf } from "../components/WorkflowTree";

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
