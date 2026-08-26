import type { WorkflowTreeModel } from "../components/WorkflowTree";

/* =============================================================================
   workflowDrawers.ts — what each node of the flow diagram opens
   -----------------------------------------------------------------------------
   Clicking a node in the Agent Workflow diagram slides in a right drawer. There are
   THREE shells, measured off six SingleFile captures of the real page (8/26/2026),
   each saved with one drawer open:

     "Triggered by"    -> read-only: a bold count line, two links, a single Close
     "Intent Details"  -> the intent's description + a list of conversation rules
     "Action"          -> the leaf's action, with a body that differs per ACTION TYPE

   ⚠️ **THESE CAPTURES DID SERIALISE THEIR EMOTION CSS** (91-108 rules each), unlike the
   Agent Management capture the call screen came from — so unusually for this feature every
   value in `app.css` is a real computed style rather than a screenshot reading.

   ⚠️ **THE CONTENT IS RE-SKINNED, THE LABELS ARE NOT.** Every field label, the action names
   and the descriptions are Invoca's product copy, identical in every account. What the
   prospect owns is the intent descriptions, the conversation rules, the qualifying question
   and its segments, and the transfer number. Reproducing the capture's Comfort Keepers
   home-care rules for a blinds company is the exact failure the re-skin rule exists for.

   ⚠️ **THE TRANSFER NUMBER USES THE RESERVED 555 EXCHANGE** with the prospect's own area
   code, the same call `GoogleSearch` already makes: it reads local and cannot ring a real
   business. The capture's own +18007381560 is Comfort Keepers' real switchboard.
   ============================================================================= */

/** One row of the "What To Collect" list: a chip plus the italic line under it. */
export interface CollectField {
  name: string;
  help: string;
}

export type ActionKind = "qualify" | "inform" | "escalate";

export interface TriggerDrawer {
  kind: "trigger";
  title: "Triggered by";
  /** The bold line. The real one counts campaigns, forms AND inbound SMS. */
  summary: string;
}

export interface IntentDrawer {
  kind: "intent";
  title: "Intent Details";
  name: string;
  /** "What does this intent look like?" */
  looksLike: string;
  /** ⚠️ CAN BE EMPTY, and the real Need Support capture IS: three blank rule rows. */
  rules: string[];
}

export interface ActionDrawer {
  kind: "action";
  title: "Action";
  action: ActionKind;
  /* qualify */
  question?: string;
  segments?: string[];
  fallback?: string;
  /* inform / escalate */
  handling?: string;
  phone?: string;
  collect?: CollectField[];
}

export type NodeDrawer = TriggerDrawer | IntentDrawer | ActionDrawer;

/** Invoca's own copy for each action, verbatim from the three Action captures. */
export const ACTION_LABEL: Record<ActionKind, string> = {
  qualify: "Qualify",
  inform: "Inform & Route",
  escalate: "Support & Escalate",
};
export const ACTION_DESCRIPTION: Record<ActionKind, string> = {
  qualify: "Your agent will ask a specific question to determine which path a user should take. Define the question and the possible answers, and your agent will route each user based on how they respond.",
  inform: "The agent will answer the caller's question and transfer them to the right queue when routing is needed.",
  escalate: "The agent will try to resolve the caller's issue using your knowledge base. If it can't, it will escalate by transferring to the queue configured below.",
};
/** The label above the free-text box changes with the action. Measured on all three. */
export const ACTION_PROMPT: Record<ActionKind, string> = {
  qualify: "What question do you want the AI Agent to ask in order to qualify?",
  inform: "How should the agent inform and route callers?",
  escalate: "How should the agent handle escalation requests?",
};
export const PHONE_PROMPT: Record<"inform" | "escalate", string> = {
  inform: "What phone number should the agent transfer callers to?",
  escalate: "What phone number should unresolved callers be transferred to?",
};

/** The two info fields the captures show, with Invoca's own italic descriptions. */
const CONSUMER_ZIP: CollectField = { name: "Consumer Zip", help: "The consumer's 5 digit zip code" };
const CONSUMER_NAME: CollectField = { name: "Consumer Name", help: "The full name of the consumer." };

/**
 * A demo transfer number for this prospect.
 *
 * ⚠️ 555 IS RESERVED FOR FICTION. Real area code so it reads local, `555` so it cannot
 * connect — the same rule the Google Search ad's call extension follows.
 */
function demoPhone(areaCode: string): string {
  return `+1${areaCode}5550142`;
}

type Profile = {
  id: string;
  customerName: string;
  industry: string;
  bookingTerm: string;
  customerNoun?: string;
  reports: {
    agentConfig?: { serviceArea?: string; brandConversationRules?: string[] } | undefined;
    voiceScreenpop?: { callerPhone?: string } | undefined;
  };
};

/** Pull an area code out of whatever number the profile already shows, else a default. */
function areaCodeOf(p: Profile): string {
  const m = (p.reports.voiceScreenpop?.callerPhone ?? "").match(/(\d{3})/);
  return m ? m[1] : "805";
}

/**
 * The drawer for a node, derived from the prospect and the tree it is rendering.
 *
 * ⚠️ **DERIVED, NOT GENERATED.** No schema slice and no engine phase, so every demo already
 * on disk gets these drawers and generation time is unchanged — the same call
 * `LocationComparisonDashboard` and the workflow tree itself already make. The intent
 * descriptions and rules are built from `agentConfig`'s own brand rules and service area, so
 * a drawer cannot contradict what the Preview Agent screen says about the same agent.
 */
export function drawerFor(
  profile: Profile,
  tree: WorkflowTreeModel,
  nodeId: string,
): NodeDrawer | null {
  const noun = (profile.customerNoun ?? "customer").toLowerCase();
  const booking = profile.bookingTerm.toLowerCase();
  const area = profile.reports.agentConfig?.serviceArea?.trim();
  const rules = profile.reports.agentConfig?.brandConversationRules ?? [];

  if (nodeId === "trigger") {
    /* ⚠️ The bold line is the drawer's own wording and counts all THREE sources, where the
       node under the diagram shows the shorter per-channel summary. Both are the product's. */
    const m = tree.triggeredBy.match(/(\d+)\s*campaign/i);
    const campaigns = m ? m[1] : "0";
    return { kind: "trigger", title: "Triggered by",
      summary: `${campaigns} Campaigns, 0 Forms, and 0 Inbound SMS` };
  }

  const bi = nodeId.startsWith("intent-") ? Number(nodeId.slice(7)) : -1;
  if (bi >= 0) {
    const b = tree.branches[bi];
    if (!b) return null;
    const isSales = bi === 0;
    return {
      kind: "intent", title: "Intent Details", name: b.title,
      looksLike: isSales
        ? `${b.subtitle ?? `The caller is reaching out about ${profile.customerName}'s services`}. Treat them as a prospective ${noun} and find out what they need before routing.`
        : `Contacts seeking help with an existing product or service, such as troubleshooting, billing questions, or account changes.`,
      /* ⚠️ THE SUPPORT INTENT SHIPS WITH NO RULES, and that is measured: the real Need
         Support capture has three EMPTY rule rows. The drawer renders blanks for it rather
         than inventing support policy nobody configured. */
      rules: isSales
        ? [
            ...(area ? [`When asking for the caller's zip code, explain that it is used to connect them with their local ${profile.customerName} office.`] : []),
            `As soon as this intent is recognized, find out what the caller needs so the conversation can proceed down the correct path.`,
            `If asked about cost or pricing, do not provide specific numbers. Acknowledge that pricing varies and let the caller know the local team will cover exact pricing.`,
            ...rules.slice(0, 3),
          ]
        : [],
    };
  }

  const leaf = nodeId.match(/^leaf-(\d+)-(\d+)$/);
  if (leaf) {
    const b = tree.branches[Number(leaf[1])];
    const l = b?.leaves[Number(leaf[2])];
    if (!l) return null;
    const action: ActionKind = /escalate/i.test(l.action) ? "escalate"
      : /qualify/i.test(l.action) ? "qualify" : "inform";
    if (action === "qualify") {
      return {
        kind: "action", title: "Action", action,
        question: `Are you looking to book ${/^[aeiou]/i.test(booking) ? "an" : "a"} ${booking}, or do you need help with something already in progress?`,
        segments: [`Looking to book ${/^[aeiou]/i.test(booking) ? "an" : "a"} ${booking}`, `Needs help with an existing ${noun} request`],
        fallback: `I want to make sure I connect you with the right team. Are you looking to book ${/^[aeiou]/i.test(booking) ? "an" : "a"} ${booking}, or do you need help with something already in progress?`,
      };
    }
    if (action === "escalate") {
      return {
        kind: "action", title: "Action", action,
        handling: `Do not attempt to resolve the caller's question. Immediately let the caller know you're connecting them with a member of the support team, then transfer the call.`,
        phone: demoPhone(areaCodeOf(profile)),
        collect: [CONSUMER_NAME],
      };
    }
    return {
      kind: "action", title: "Action", action,
      handling: [
        `1. Ask the caller for their zip code and capture it.`,
        area ? `2. Check the zip code against our current service area: ${area}.` : `2. Confirm the caller is in a serviceable area.`,
        `3. If the caller is outside the service area, politely inform them that we do not yet serve their area and end the call.`,
        `4. If the caller is inside the service area, ask for their full name and capture it.`,
        `5. Do not route the call without a captured full name.`,
      ].join("\n"),
      phone: demoPhone(areaCodeOf(profile)),
      collect: [CONSUMER_ZIP, CONSUMER_NAME],
    };
  }
  /* Conversation Start opens nothing — the real page has no drawer for it. */
  return null;
}
