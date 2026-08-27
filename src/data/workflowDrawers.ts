import type { WorkflowTreeModel } from "../components/WorkflowTree";
import type { CustomerProfile } from "./schema";
import { voiceSpecFor, specWithConfig, type VoiceAgentConfig } from "./voiceAgentSpec";

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
 * What each action collects. **ONE TABLE, THREE READERS.**
 *
 * ⚠️ THE DIAGRAM'S PILLS ARE THIS LIST, not a copy of it. They used to be the prospect's own
 * vocabulary — "Blinds", "Timeline", "Issue Type" — invented per node and matching nothing, so
 * a node advertised collecting one thing while its drawer's "What To Collect" said another.
 * `AgentWorkflow` now labels the pills from here and this drawer lists the same entries, so the
 * two cannot disagree.
 *
 * ⚠️ AND THE PROMPT READS IT TOO. `treeToVoicePaths` used to take a leaf's chips as the things
 * to collect; emptying the chips would have silently stopped the agent asking for anything on
 * the support path. Keyed by ACTION rather than by node, because what gets collected is a
 * property of what the agent is doing there.
 *
 * ⚠️ Qualify collects NOTHING: it asks a question and routes on the answer. Giving it fields
 * would put pills on a node the product draws without any.
 */
export const COLLECT_FOR: Record<ActionKind, CollectField[]> = {
  qualify: [],
  inform: [CONSUMER_ZIP, CONSUMER_NAME],
  escalate: [CONSUMER_NAME],
};
/** Just the labels, for the diagram's pills. */
export const collectNames = (a: ActionKind): string[] => COLLECT_FOR[a].map((f) => f.name);

/**
 * A demo transfer number for this prospect.
 *
 * ⚠️ 555 IS RESERVED FOR FICTION. Real area code so it reads local, `555` so it cannot
 * connect — the same rule the Google Search ad's call extension follows.
 */
function demoPhone(areaCode: string): string {
  return `+1${areaCode}5550142`;
}

/* ⚠️ THE FULL PROFILE, NOT A STRUCTURAL SUBSET (8/27/2026). This was a hand-written shape
   listing only the fields the drawers read, which is tidy right up to the moment a helper it
   calls needs one more: `voiceSpecFor` derives from the prospect's routing queues and
   marketing breakdowns, and a narrowed type cannot be passed to it. Widening beats bolting
   another three fields on every time, and the real type is the one every other screen uses. */
type Profile = CustomerProfile;

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
  /* ⚠️ THE DRAWER SHOWS WHAT THE AGENT WILL ACTUALLY DO. The tree handed in is the page's
     EFFECTIVE object, so its `agent` slice carries any Ask AI edits; reading the base spec
     here would leave the drawer describing a greeting and a set of rules the agent no longer
     uses, which is the same two-surfaces-disagreeing bug in a quieter place. */
  const spec = specWithConfig(voiceSpecFor(profile),
    (tree as WorkflowTreeModel & { agent?: VoiceAgentConfig }).agent);
  const area = profile.reports.agentConfig?.serviceArea?.trim();

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
    /* ⚠️ THE SPEC WINS ON THE SALES INTENT. Where an SE has configured this agent's own words,
       showing a derived paraphrase beside them would be the drawer contradicting the prompt. */
    /* ⚠️ THE SALES INTENT ALWAYS COMES FROM THE SPEC NOW (8/27/2026). This used to be
       `isSales && spec`, with a second derived rule list right here for everyone else — two
       places building the same sentences, and only one of them ever reached the agent, which
       is why 11 of 12 prospects showed a "Consumer Name" pill and never asked for a name.
       `deriveVoiceSpec` absorbed that list verbatim, so the drawer and the spoken prompt now
       render ONE rule set. Do not reintroduce a fallback here. */
    if (isSales) {
      return { kind: "intent", title: "Intent Details", name: b.title,
        looksLike: spec.intent, rules: spec.rules };
    }
    return {
      kind: "intent", title: "Intent Details", name: b.title,
      looksLike: `Contacts seeking help with an existing product or service, such as troubleshooting, billing questions, or account changes.`,
      /* ⚠️ THE SUPPORT INTENT SHIPS WITH NO RULES, rather than inventing support policy
         nobody configured. The DRAWER renders that as the product's own empty state ("No
         conversation rules defined yet"); an earlier note here said three blank rows, which
         was a capture of someone having pressed Add three times rather than the default. */
      rules: [],
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
      /* ⚠️ **THE ANSWERS COME FROM THE LEAF'S PATH NODES, ALWAYS (8/27/2026).** This used to
         prefer `spec.segments` whenever a spec existed and read the tree only as a fallback —
         and the note in the fallback branch already argued the right way round: the diagram
         draws these as nodes on the row below, so two derivations disagree the first time
         anybody edits one. The tree handed in here is the page's EFFECTIVE object, so it also
         carries Ask AI's edits, which the spec does not. The question and the reprompt still
         come from the spec, because neither is drawn anywhere. */
      const answers = (l.paths ?? []).map((x) => x.title).filter(Boolean);
      return {
        kind: "action", title: "Action", action,
        question: spec.qualifyQuestion,
        segments: answers,
        fallback: spec.qualifyFallback,
      };
    }
    if (action === "escalate") {
      return {
        kind: "action", title: "Action", action,
        handling: `Do not attempt to resolve the caller's question. Immediately let the caller know you're connecting them with a member of the support team, then transfer the call.`,
        phone: demoPhone(areaCodeOf(profile)),
        collect: COLLECT_FOR.escalate,
      };
    }
    if (spec) {
      return { kind: "action", title: "Action", action,
        handling: spec.informSteps.join("\n"),
        phone: demoPhone(areaCodeOf(profile)), collect: COLLECT_FOR.inform };
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
      collect: COLLECT_FOR.inform,
    };
  }
  /* A path node opens the Inform & Route action, which is what every captured path shows.
     ⚠️ IT REUSES THE LEAF BRANCH BELOW rather than repeating the body, so a change to the
     routing steps or the collected fields lands on both. */
  const pathId = nodeId.match(/^path-(\d+)-(\d+)-(\d+)$/);
  if (pathId) {
    const pth = tree.branches[Number(pathId[1])]?.leaves[Number(pathId[2])]?.paths?.[Number(pathId[3])];
    if (!pth) return null;
    if (spec) {
      return { kind: "action", title: "Action", action: "inform",
        handling: spec.informSteps.join("\n"),
        phone: demoPhone(areaCodeOf(profile)), collect: COLLECT_FOR.inform };
    }
    return {
      kind: "action", title: "Action", action: "inform",
      handling: [
        `1. Ask the caller for their zip code and capture it.`,
        area ? `2. Check the zip code against our current service area: ${area}.` : `2. Confirm the caller is in a serviceable area.`,
        `3. If the caller is outside the service area, politely inform them that we do not yet serve their area and end the call.`,
        `4. If the caller is inside the service area, ask for their full name and capture it.`,
        `5. This path handles "${pth.title}", so keep the conversation on that need and do not re-ask what they are calling about.`,
        `6. Do not route the call without a captured full name.`,
      ].join("\n"),
      phone: demoPhone(areaCodeOf(profile)),
      collect: COLLECT_FOR.inform,
    };
  }

  /* Conversation Start opens nothing — the real page has no drawer for it. */
  return null;
}
