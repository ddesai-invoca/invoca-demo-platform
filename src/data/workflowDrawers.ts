import type { WorkflowTreeModel } from "../components/WorkflowTree";
import type { CustomerProfile } from "./schema";
import { voiceSpecFor, specWithConfig, DEFAULT_ESCALATE_HANDLING, DEFAULT_SUPPORT_INTENT, type VoiceAgentConfig } from "./voiceAgentSpec";
import { collectFor, collectPool, type SmsCollectKey, type SmsConfig, type SmsQualifyNode } from "./smsTemplate";

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

/**
 * THE PRODUCT'S FIVE ACTIONS, in the order the Action dropdown lists them.
 *
 * ⚠️⚠️ MEASURED 9/17/2026 from five captures of ONE drawer with the combobox switched between
 * them (`reference/agent-workflow/sms-action-*.html`) — so each action's SHAPE is read off the
 * real thing rather than inferred from its name, and they differ more than the names suggest.
 * ⚠️ THE OPTION LIST AND ITS ORDER COME FROM A SCREENSHOT, NOT THE CAPTURES: every one of the
 * five has `aria-expanded=false`, so the open listbox never serialised. Same provenance split
 * the Create Workflow channel combobox already records.
 */
export type ActionKind = "callback" | "qualify" | "inform" | "informRoute" | "escalate";
/**
 * The three the VOICE captures measured — the kinds voice has its OWN copy for.
 *
 * ⚠️ THE VOICE COPY IS NOT THE SMS COPY; four strings differ, see the tables below.
 *
 * ⚠️⚠️ **THE ROUTING KIND IS `informRoute` ON VOICE, AND IT USED TO BE `inform` (9/21/2026).**
 * The voice captures label that action **"Inform & Route"** — the same words SMS gives
 * `informRoute` — so while voice called it `inform`, the picker rendered TWO options reading
 * "Inform & Route" (voice's `inform` and SMS's `informRoute`), the open list marked the wrong
 * one selected, and picking it wrote a DIFFERENT kind from the one already set. Measured in
 * the browser on a real use case. Naming the kind after what the product calls it makes all
 * five labels distinct on both channels, and the node text is unchanged either way because
 * both resolve to "Inform & Route".
 *
 * ⚠️ **VOICE OFFERS ALL FIVE ACTIONS NOW**, asked for directly ("the dropdowns should have all
 * the actions"). Three carry the measured voice copy; `callback` and the plain `inform` fall
 * back to the SMS wording, which is Invoca's own product copy for those actions — just
 * measured on the SMS page, since no voice capture shows either. Flagged rather than invented.
 */
export type VoiceActionKind = "qualify" | "informRoute" | "escalate";
const VOICE_KINDS: VoiceActionKind[] = ["qualify", "informRoute", "escalate"];
export const isVoiceKind = (k: ActionKind): k is VoiceActionKind =>
  (VOICE_KINDS as ActionKind[]).includes(k);

export interface TriggerDrawer {
  kind: "trigger";
  title: "Triggered by";
  /** The bold line. The real one counts campaigns, forms AND inbound SMS. */
  summary: string;
  /* ⚠️ THE SMS DRAWER LISTS WHAT IS ACTUALLY WIRED, under the count: one row per form and one
     for the inbound number ("Form: Voice to SMS Not Serviceable", "Inbound SMS: +1..."). The
     voice capture has none, so this is optional and the voice drawer is unchanged. */
  rows?: string[];
  /** Three links on SMS (campaigns / forms / promo numbers), two on voice. Measured. */
  links?: string[];
}

export interface IntentDrawer {
  kind: "intent";
  title: "Intent Details";
  name: string;
  /** "What does this intent look like?" */
  looksLike: string;
  /** ⚠️ CAN BE EMPTY, and the real Need Support capture IS: three blank rule rows. */
  rules: string[];
  /**
   * ⚠️ **BOTH CHANNELS NOW (9/21/2026).** This said "SMS only; absent on voice, which keeps the
   * read-only shells" — and the voice intent drawer really was five read-only boxes, measured
   * in the browser, on the one screen where the words it shows ARE the agent's prompt.
   */
  edits?: DrawerEdits;
  channel?: "sms" | "voice";
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
  /** Voice only. An SMS inform drawer has no phone row at all — see the table above. */
  phone?: string;
  /** The destination label, on the two actions that have one. */
  destinationPrompt?: string;
  /** Its own value and placeholder — a text input, not a picker. See the note on the table. */
  destination?: string;
  destinationPlaceholder?: string;
  /** The chosen signal, and what this prospect has to choose from. */
  signal?: string;
  signalChoices?: string[];
  collect?: CollectField[];
  /** Every info field this prospect can add, for the Add Info Field picker. */
  infoChoices?: CollectField[];
  /**
   * The instruction box writes back as an ARRAY of lines, not a string.
   *
   * ⚠️ The voice routing steps live in `agent.informSteps`, which IS a list. Sent as a string
   * that is an array -> string TYPE FLIP, which `editGuard` refuses — so the edit would be
   * lost. Opt-in, so the SMS drawers (whose handling really is one string) are unchanged.
   */
  handlingList?: boolean;
  /** Shown when the instruction box is empty, which for the shared routing steps is usual. */
  handlingPlaceholder?: string;
  edits?: DrawerEdits;
  channel?: "sms" | "voice";
  /* ⚠️ THE ANSWERS' OWN NODES, so Apply can rewrite a title without destroying the node around
     it — its action, its icon, its chips and its own children. Without this, renaming one answer
     would flatten the branch underneath it. */
  segmentNodes?: Record<string, unknown>[];
  /**
   * Where this node itself lives, so changing its ACTION can rewrite the node.
   *
   * ⚠️⚠️ IT WRITES THE CONTAINING ARRAY, WHICH IS THE ONE WRITE SHAPE ALREADY PROVEN HERE.
   * `edits.segments` has written `…paths` as a whole array of NODES since this drawer shipped,
   * so reusing it costs no new risk — where a per-field path like `…paths.2.action` would sit
   * one level deeper than anything the stored override is known to contain, and `setByPath`
   * refuses a missing intermediate key SILENTLY (the bug that ate `sms.extra.*` this morning).
   * Spreading the old node also keeps its title, its children and its lock by construction.
   */
  actionSlot?: { path: string; index: number; nodes: Record<string, unknown>[] };
  /**
   * The destination is the NODE'S OWN `route`, written through `actionSlot`.
   *
   * ⚠️⚠️ **VOICE ONLY, AND IT IS WHY THE VOICE DESTINATION IS NOT A FLAT `extra__` KEY.** A
   * voice use case already carries its destination: `route` is what the card renders as
   * "Route to Billing" AND what `treeToVoicePaths` hands the prompt as the route's `team`.
   * Storing a second copy beside it is the two-sources-of-truth failure this file records for
   * the pills — the drawer would say one desk and the card and the agent another. So the
   * destination row writes `route` on the node, through the same containing-array write the
   * action and the chips already use. SMS keeps its flat key, because an SMS destination is a
   * URL or a phone number that nothing else on the diagram draws.
   */
  destinationOnNode?: boolean;
  /** The phone row is editable when it has a home; read-only otherwise. */
  phonePlaceholder?: string;
}

/**
 * Where each editable field writes back, as a dot-path into the page's registered object.
 *
 * ⚠️ **WITHOUT THIS, APPLY IS A LIE.** The drawer has no idea what scope it is in; the builder
 * does. Carrying the paths on the drawer keeps the component dumb and means a field that has no
 * home simply has no path and renders read-only, rather than accepting a keystroke that goes
 * nowhere. Absent entirely on the voice drawers, which stay read-only.
 */
export interface DrawerEdits {
  question?: string;
  fallback?: string;
  /** Two of the three fields that were inert placeholders until 9/17/2026. The third, the
      collect list, writes through `actionSlot` because it IS the node's own `chips`. */
  destination?: string;
  signal?: string;
  /** The Answers/Segments list — a path to the TREE's own child nodes, not a copy of them. */
  segments?: string;
  handling?: string;
  looksLike?: string;
  rules?: string;
  /** The voice transfer number. SMS has no phone row at all. */
  phone?: string;
}

export type NodeDrawer = TriggerDrawer | IntentDrawer | ActionDrawer;

/* =============================================================================
   THE SMS PAGE'S OWN COPY — measured 9/17/2026 off twelve captures of a real SMS workflow
   (`reference/agent-workflow/sms-drawer-*.html`), each saved with one drawer open.

   ⚠️⚠️ **IT IS NOT THE VOICE COPY, AND THAT IS WHY THESE TABLES EXIST.** The SMS drawers were
   switched off on this diagram until now partly because nobody had captured them; the
   assumption was that the three shells would carry the same words. Four of them do not:

     | | voice (measured 8/26) | SMS (measured 9/17) |
     |---|---|---|
     | inform description | "The agent will answer the caller's question and transfer them to the right queue when routing is needed." | **"Provide information to the caller."** |
     | inform prompt | "How should the agent inform and route callers?" | **"How should the agent inform users?"** |
     | escalate description | "...escalate by transferring to the queue configured below." | **"...escalate based on the rules and destination configured below."** |
     | qualify description | "...answers, and your agent will route each user based on..." | **"...answers — your agent will route each user based on..."** |

   ⚠️ **AND AN SMS INFORM DRAWER HAS NO PHONE FIELD AT ALL.** The voice one asks "What phone
   number should the agent transfer callers to?"; the SMS one goes straight from the instruction
   box to Signal and What To Collect. The SMS ESCALATE drawer does have a destination — "Where
   should the agent escalate unresolved users?" — but it is an empty combobox in the capture, not
   a number. So `phone` is left undefined on every SMS drawer and the row is omitted.
   ============================================================================= */

/* ⚠️ THE ACTION COMBOBOX READS "Inform" ON SMS, not "Inform & Route" — and this was nearly
   missed because SingleFile writes UNQUOTED attributes, so `value=Inform` does not match a
   `value="..."` search and the field read as empty. Same trap this repo already records for the
   Aptive form capture and the insights SVG. */
export const SMS_ACTION_LABEL: Record<ActionKind, string> = {
  callback: "Schedule Callback",
  qualify: "Qualify",
  inform: "Inform",
  informRoute: "Inform & Route",
  escalate: "Support & Escalate",
};
/** The order the dropdown lists them in — from the screenshot, see the note on `ActionKind`. */
export const SMS_ACTION_OPTIONS: ActionKind[] =
  ["callback", "qualify", "inform", "informRoute", "escalate"];
export const SMS_ACTION_DESCRIPTION: Record<ActionKind, string> = {
  callback: "Your agent will find a time and send the user a priority number to call back during business hours. This carries over all digital attribution from the initial text engagement (and the call that originally triggered the SMS).",
  qualify: "Your agent will ask a specific question to determine which path a user should take. Define the question and the possible answers — your agent will route each user based on how they respond.",
  inform: "Provide information to the caller.",
  informRoute: "The agent will answer the users' question and guide them to the right next step — a link, phone number, or resource.",
  escalate: "The agent will try to resolve the user's issue using your knowledge base. If it can't, it will escalate based on the rules and destination configured below.",
};
/**
 * ⚠️⚠️ `callback` IS ABSENT ON PURPOSE AND THE TYPE SAYS SO: the Schedule Callback drawer has
 * NO free-text box at all — Description, then its fixed Signal, then What To Collect. A
 * `Record<ActionKind, string>` here would have forced a prompt label to be invented for it.
 */
export const SMS_ACTION_PROMPT: Record<Exclude<ActionKind, "callback">, string> = {
  qualify: "What question do you want the AI Agent to ask in order to qualify?",
  inform: "How should the agent inform users?",
  informRoute: "How should the agent inform and route users?",
  escalate: "How should the agent handle escalation requests?",
};
/**
 * The destination row, which only TWO of the five have — and they word it differently.
 * ⚠️ `inform` has no destination row at all, which is what separates it from `informRoute`.
 */
export const SMS_ESCALATE_DESTINATION = "Where should the agent escalate unresolved users?";
/**
 * The voice destination row's label.
 *
 * ⚠️ **NOT MEASURED — no voice drawer capture survives in `reference/`, which is why the voice
 * drawers had no destination row at all until 9/21/2026.** The ROW is not invented: the card
 * plainly reads "Route to Billing", so the node has a destination and the drawer was the only
 * place that did not show it. The WORDING is ours, phrased as the product phrases the two SMS
 * ones. Replace it if a capture of a voice Inform & Route drawer ever turns up.
 */
export const VOICE_ROUTE_DESTINATION = "Which team should the agent route callers to?";
export const SMS_ROUTE_DESTINATION = "Where should the agent send users?";
export const SMS_DESTINATION_PROMPT: Partial<Record<ActionKind, string>> = {
  informRoute: SMS_ROUTE_DESTINATION,
  escalate: SMS_ESCALATE_DESTINATION,
};
/**
 * ⚠️⚠️ **THE DESTINATION IS A TEXT INPUT, AND THIS CORRECTS A CONTROL WE HAD INVENTED.** The note
 * in CLAUDE.md said the SMS escalate drawer offers "an empty combobox", and we rendered
 * `Select a destination...`. The markup says otherwise in BOTH the original capture and the
 * five Action ones: `<input name=destination type=text>` carrying these placeholders, disabled
 * in the configured captures and enabled in the switched ones. A URL or a phone number is
 * exactly what you would type rather than pick, so the input is also the reading that makes
 * sense of the placeholder.
 */
export const SMS_DESTINATION_PLACEHOLDER: Partial<Record<ActionKind, string>> = {
  informRoute: "e.g. https://yourwebsite.com/signup or +1-800-555-0100",
  escalate: "e.g. https://yourwebsite.com/support or +1-800-555-0100",
};

/**
 * The two option lists the captures do NOT contain — both autocompletes were closed when saved
 * (`signal-select`, `addInfoField-select`), so their contents come from the PROSPECT, which is
 * how everything else on this page is derived.
 *
 * ⚠️ SIGNALS ARE THE PROSPECT'S OWN, off the Signal Manager screen's list, so a signal offered
 * here is one that account actually has. A prospect with no `signalManager` slice offers none
 * rather than an invented set.
 */
export const signalOptions = (p: CustomerProfile): string[] =>
  (p.reports.signalManager?.signals ?? []).map((s) => s.name);

/**
 * ⚠️ THE INFO FIELDS ARE THE SMS POOL, PLUS `Consumer Name` — which is not in the pool (that
 * splits first and last) but IS what the Schedule Callback capture shows seeded, with its own
 * help text. Deduped by name, so a field already on a node always has a help line to render.
 */
export function infoFieldOptions(p: CustomerProfile): CollectField[] {
  const pool = Object.values(collectPool(p)).map((f) => ({ name: f.name, help: f.help }));
  const all = [CONSUMER_NAME, ...pool];
  return all.filter((f, i) => all.findIndex((x) => x.name === f.name) === i);
}
/**
 * ⚠️⚠️ SCHEDULE CALLBACK'S SIGNAL IS A FIXED CHIP, NOT A PICKER. Measured: a filled MUI info
 * chip reading this, with the label "Signal" and **no "(optional)"** — where all four other
 * actions render `Signal (optional)` above an empty "Select a signal..." combobox. That action
 * always fires this one signal, so there is nothing to choose.
 */
export const SMS_CALLBACK_SIGNAL = "SMS Scheduled Callback";

/**
 * The node fields each action writes, so a card's ACTION TEXT and its drawer's label are one
 * value rather than two that can drift (the defect fixed earlier today).
 *
 * ⚠️⚠️ THE TINTS ARE TITAN TOKENS, AND THE SYSTEM IS `hue` + ITS OWN `-100` INK — confirmed
 * against the capture's own variables: Qualify purple-20 `#d0c1f2` / purple-100 `#440066`,
 * Inform blue-50 `#2666f9` / blue-100 `#11228c`, Escalate orange-50 `#ff7045` / orange-100
 * `#b33b00`. So the two new ones are DERIVED from the same palette rather than invented:
 * Inform & Route teal-40 `#33e5c9` (which is exactly the value the Create Workflow capture
 * measured for that action, independently) and Schedule Callback green-50 `#2cbf58`.
 * ⚠️ NO CAPTURE SHOWS A NODE CARRYING EITHER NEW ACTION — the dropdown was never applied in any
 * of the five — so the hues are read off the palette, not off such a card. Replace them if a
 * capture ever shows one.
 */
export const NODE_ACTION: Record<ActionKind, {
  actionIcon: "phone" | "callSplit" | "info" | "altRoute" | "headsetMic";
  tone: "green" | "orange" | "blue" | "grey";
}> = {
  callback: { actionIcon: "phone", tone: "green" },
  qualify: { actionIcon: "callSplit", tone: "blue" },
  inform: { actionIcon: "info", tone: "blue" },
  informRoute: { actionIcon: "altRoute", tone: "green" },
  escalate: { actionIcon: "headsetMic", tone: "orange" },
};
/** Everything a node carries for an action, built from ONE source per field. */
export const nodeActionFields = (k: ActionKind) => ({
  action: SMS_ACTION_LABEL[k], actionKind: k, ...NODE_ACTION[k],
});

/** Invoca's own copy for each action, verbatim from the three Action captures. */
export const ACTION_LABEL: Record<VoiceActionKind, string> = {
  qualify: "Qualify",
  informRoute: "Inform & Route",
  escalate: "Support & Escalate",
};
export const ACTION_DESCRIPTION: Record<VoiceActionKind, string> = {
  qualify: "Your agent will ask a specific question to determine which path a user should take. Define the question and the possible answers, and your agent will route each user based on how they respond.",
  informRoute: "The agent will answer the caller's question and transfer them to the right queue when routing is needed.",
  escalate: "The agent will try to resolve the caller's issue using your knowledge base. If it can't, it will escalate by transferring to the queue configured below.",
};
/** The label above the free-text box changes with the action. Measured on all three. */
export const ACTION_PROMPT: Record<VoiceActionKind, string> = {
  qualify: "What question do you want the AI Agent to ask in order to qualify?",
  informRoute: "How should the agent inform and route callers?",
  escalate: "How should the agent handle escalation requests?",
};
/**
 * The copy for one action on one channel, in ONE place.
 *
 * ⚠️ THE DRAWER MUST NOT INDEX THE VOICE TABLES WITH AN SMS-ONLY KIND. A voice tree only ever
 * carries the three voice kinds (`deriveTree` builds it from `voiceCopy`), so the fallback here
 * is unreachable today — it exists so that a node which somehow carried one would render the SMS
 * copy rather than `undefined`, which is what would put "undefined" on screen mid-demo.
 */
export function actionCopy(channel: "sms" | "voice", k: ActionKind): {
  label: string; description: string; prompt: string | null;
} {
  if (channel === "voice" && isVoiceKind(k)) {
    return { label: ACTION_LABEL[k], description: ACTION_DESCRIPTION[k], prompt: ACTION_PROMPT[k] };
  }
  return {
    label: SMS_ACTION_LABEL[k],
    description: SMS_ACTION_DESCRIPTION[k],
    prompt: k === "callback" ? null : SMS_ACTION_PROMPT[k],
  };
}

export const PHONE_PROMPT: Record<"informRoute" | "escalate", string> = {
  informRoute: "What phone number should the agent transfer callers to?",
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
  /* ⚠️ MEASURED: switching the action to Schedule Callback seeds What To Collect with exactly
     Consumer Name, where switching to the other three leaves it EMPTY. */
  callback: [CONSUMER_NAME],
  qualify: [],
  inform: [CONSUMER_ZIP, CONSUMER_NAME],
  informRoute: [CONSUMER_ZIP, CONSUMER_NAME],
  escalate: [CONSUMER_NAME],
};
/**
 * What What-To-Collect holds straight after the action is SWITCHED — which is not the same
 * question as `COLLECT_FOR`.
 *
 * ⚠️⚠️ MEASURED, AND IT IS A RESET. The same node, same Inform action, showed **eleven** collect
 * fields when its drawer was opened fresh and **zero** once the combobox had been switched — so
 * changing the action clears that action's configuration rather than carrying the old one over.
 * `COLLECT_FOR` is what OUR TEMPLATE configures per action (it drives the pills the diagram
 * draws); this is the product's own default for a just-changed action. Conflating the two would
 * make a switch to Inform silently inherit the template's zip+name list.
 */
export const collectOnSwitch = (k: ActionKind): CollectField[] =>
  (k === "callback" ? [CONSUMER_NAME] : []);

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
/**
 * The voice drawers' per-node fields that have no slot of their own.
 *
 * ⚠️ FLAT ON `agent`, which the voice page always registers, for the same reason the SMS ones
 * are flat on `sms`: `setByPath` refuses a path whose intermediate key is missing, so one level
 * under a key that always exists is the only reliable target.
 * ⚠️ The SIGNAL is display-only configuration on both channels — it reaches no prompt, exactly
 * as on SMS. What must never be stored per node is anything the agent actually reads, or the
 * drawer would show an edit the call ignores.
 */
const voiceExtraEdits = (nodeId: string) => ({
  signal: `agent.extra__${nodeId}__signal`,
  /* ⚠️ THE TRANSFER NUMBER HAS A HOME NOW (9/21/2026). It was `demoPhone(areaCodeOf(profile))`
     rendered into a READ-ONLY input — a field on screen that no edit could reach, on a drawer
     whose every other row had just been made editable. It is per node because the captures
     show it per action drawer, and it reaches the prompt through `treeToVoicePaths`. */
  phone: `agent.extra__${nodeId}__phone`,
});
const vx = (tree: WorkflowTreeModel, nodeId: string, f: string) =>
  (tree as WorkflowTreeModel & { agent?: Record<string, unknown> })
    .agent?.[`extra__${nodeId}__${f}`];

/**
 * The editable half of a voice Inform & Route drawer.
 *
 * ⚠️⚠️ **THE ROUTING STEPS ARE ONE SHARED FLOW, NOT PER-NODE TEXT, AND THE WRITE HAS TO SAY SO.**
 * Every use case renders `spec.informSteps` — there is one call flow, and each use case follows
 * it. So an edit goes to `agent.informSteps`, which is where the PROMPT reads it from; storing a
 * per-node copy would show beautifully in the drawer and change nothing the agent says. The
 * visible consequence, stated rather than discovered: editing the instruction on one use case
 * changes it on all of them, because it is one flow.
 * ⚠️ `handlingList` tells the drawer to write it back as the ARRAY that field is. Sent as a
 * string it is an array -> string type flip, which `editGuard` refuses — loudly, at least, but
 * the edit would still be lost.
 */
function voiceInformEdits(
  tree: WorkflowTreeModel,
  nodeId: string,
  profile: Profile,
  node: Record<string, unknown> | undefined,
) {
  /* ⚠️⚠️ **PER NODE, FALLING BACK TO THE SHARED FLOW — AND THE SHARED-ONLY VERSION WAS A REAL
     PARITY GAP (9/21/2026).** Every use case wrote `agent.informSteps`, which is ONE list, so
     editing the instruction on "Billing question" silently rewrote it on "Ready to book now"
     too. That was recorded as a stated consequence rather than a bug, and it is the one thing
     SMS does per node that voice did not — on SMS each inform leaf has its own text.
     The node's own instruction wins when it has one; otherwise the shared routing steps show,
     exactly as before. So an agent nobody has edited is byte-identical, and the first edit to
     a use case stops being an edit to all of them. */
  const own = String(vx(tree, nodeId, "handling") ?? "");
  return {
    edits: { handling: `agent.extra__${nodeId}__handling`, ...voiceExtraEdits(nodeId) },
    /* The spread sits LAST at every call site, so this wins over the shared routing steps
       exactly when this node has an instruction of its own. */
    ...(own ? { handling: own } : {}),
    /* ⚠️⚠️ **UNSET IS THE NORM HERE, AND A BARE EMPTY BOX READS AS BROKEN.** `informSteps` is
       only the service-area gate, so a prospect that serves everywhere has none — measured, 10
       of the 15 profiles on disk. Reported as "all the fields are empty" against the last row.
       A placeholder says the field is unconfigured rather than missing, and names what belongs
       in it, which is what every SMS drawer already does. */
    handlingPlaceholder:
      "e.g. 1. Ask for their ZIP code and confirm you serve the area.  2. Ask for their full name.",
    actionSlot: actionSlotFor(tree, nodeId),
    /* ⚠️ THE DESTINATION IS THE CARD'S OWN "Route to ..." — see `destinationOnNode`. */
    destinationPrompt: VOICE_ROUTE_DESTINATION,
    destination: String(node?.route ?? ""),
    destinationPlaceholder: "e.g. Billing, or New Customer Sales",
    destinationOnNode: true as const,
    phone: String(vx(tree, nodeId, "phone") ?? demoPhone(areaCodeOf(profile))),
    phonePlaceholder: "e.g. +1-800-555-0100",
    signal: String(vx(tree, nodeId, "signal") ?? ""),
    signalChoices: signalOptions(profile),
    infoChoices: infoFieldOptions(profile),
  };
}

/**
 * A node's collect list, read off the node itself.
 *
 * ⚠️ THE CHIPS THE DIAGRAM DRAWS ARE THE LIST — so the drawer, the diagram and the prompt all
 * read one value. Falls back to the action's table only for a node that carries none, which is
 * what the support leaf does.
 */
function nodeCollect(profile: Profile, node: Record<string, unknown> | undefined, act: ActionKind): CollectField[] {
  const chips = Array.isArray(node?.chips) ? (node!.chips as string[]) : undefined;
  if (!chips?.length) return COLLECT_FOR[act];
  const opts = infoFieldOptions(profile);
  return chips.map((n) => ({ name: n, help: opts.find((o) => o.name === n)?.help ?? "" }));
}

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
    /* ⚠️⚠️ **BOTH INTENT DRAWERS ARE EDITABLE NOW (9/21/2026), AND THEY WERE THE LAST
       READ-ONLY SURFACE ON THIS PAGE.** Measured in the browser: five textareas, every one
       `readOnly`, with a live "Add" button below them that wrote nothing. Every field here
       already had a home the PROMPT reads — `agent.intent` is the sales intent's own
       description (and the node's subtitle is `spec.intent.split("\n")[0]`, so one edit moves
       the drawer, the card and the call together) and `agent.rules` is the conversation-rules
       list `buildVoiceSystem` renders. So this was a missing pair of paths, not a missing
       feature. */
    if (isSales) {
      return { kind: "intent", title: "Intent Details", name: b.title,
        looksLike: spec.intent, rules: spec.rules, channel: "voice",
        edits: { looksLike: "agent.intent", rules: "agent.rules" } };
    }
    return {
      kind: "intent", title: "Intent Details", name: b.title,
      channel: "voice",
      /* ⚠️ THE SUPPORT INTENT NEEDED ITS OWN HOMES, because it never had any: its description
         was a LITERAL in this file and its rules were a hardcoded `[]`. Making the boxes
         editable without somewhere to write is the dead-control failure this repo keeps
         paying for, so `agent.supportIntent` / `agent.supportRules` exist and the prompt
         renders them. Unset, both resolve to exactly what was hardcoded here. */
      edits: { looksLike: "agent.supportIntent", rules: "agent.supportRules" },
      looksLike: spec.supportIntent ?? DEFAULT_SUPPORT_INTENT,
      /* ⚠️ THE SUPPORT INTENT SHIPS WITH NO RULES, rather than inventing support policy
         nobody configured. The DRAWER renders that as the product's own empty state ("No
         conversation rules defined yet"); an earlier note here said three blank rows, which
         was a capture of someone having pressed Add three times rather than the default. */
      rules: spec.supportRules ?? [],
    };
  }

  const leaf = nodeId.match(/^leaf-(\d+)-(\d+)$/);
  if (leaf) {
    const b = tree.branches[Number(leaf[1])];
    const l = b?.leaves[Number(leaf[2])];
    if (!l) return null;
    /* ⚠️⚠️ **THE NODE'S OWN KIND WINS, AND RE-DERIVING IT FROM THE TEXT WAS THE SMS BUG
       THROUGH THE VOICE DOOR (9/21/2026).** This read the action STRING and could only ever
       answer escalate / qualify / inform — so once the picker could switch a voice leaf to
       Schedule Callback or Inform & Route, the node drew the new action and its drawer
       REOPENED on the old one. `kindOfNode` reads `actionKind` first and falls back to the
       wording, which is the same single source `smsDrawerFor` was fixed to use. */
    const action: ActionKind =
      kindOfNode(l as unknown as Record<string, unknown>) ?? "informRoute";
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
        segmentNodes: (l.paths ?? []) as unknown as Record<string, unknown>[],
        fallback: spec.qualifyFallback,
        channel: "voice",
        /* ⚠️⚠️ EACH FIELD TO ITS REAL HOME, and these two already have one: `agent.*` is what
           the page registers beside the tree and what `specWithConfig` merges back into the
           spec, so an edit here reaches the actual CALL — the same path Ask AI has written
           since 8/27. A per-node copy would show in the drawer and change nothing spoken. */
        edits: {
          question: "agent.qualifyQuestion",
          fallback: "agent.qualifyFallback",
          segments: `branches.${leaf[1]}.leaves.${leaf[2]}.paths`,
          ...voiceExtraEdits(nodeId),
        },
        actionSlot: actionSlotFor(tree, nodeId),
        signal: String(vx(tree, nodeId, "signal") ?? ""),
        signalChoices: signalOptions(profile),
        infoChoices: infoFieldOptions(profile),
      };
    }
    if (action === "escalate") {
      return {
        kind: "action", title: "Action", action,
        /* ⚠️ THE ESCALATION INSTRUCTION NOW HAS A REAL HOME (`agent.escalateHandling`) AND
           REACHES THE PROMPT. It was a literal in this file — so before this, the drawer was
           already showing the agent a sentence nobody had told it, and making the field
           editable without a home would have turned that into a dead control. Unset, it
           resolves to the same wording, so an untouched agent is byte-identical. */
        handling: spec.escalateHandling ?? DEFAULT_ESCALATE_HANDLING,
        /* ⚠️ THE ESCALATION INSTRUCTION STAYS SHARED, and that is correct rather than an
           oversight: there is exactly ONE support leaf on a voice tree, so `agent.escalateHandling`
           is already per node. The use cases below Inform & Route are the many, which is why
           those got their own key and this did not. */
        phone: String(vx(tree, nodeId, "phone") ?? demoPhone(areaCodeOf(profile))),
        phonePlaceholder: "e.g. +1-800-555-0100",
        collect: nodeCollect(profile, l as unknown as Record<string, unknown>, "escalate"),
        channel: "voice",
        edits: { handling: "agent.escalateHandling", ...voiceExtraEdits(nodeId) },
        actionSlot: actionSlotFor(tree, nodeId),
        destinationPrompt: VOICE_ROUTE_DESTINATION,
        destination: String((l as unknown as Record<string, unknown>).route ?? ""),
        destinationPlaceholder: "e.g. Tier 2 Support",
        destinationOnNode: true as const,
        signal: String(vx(tree, nodeId, "signal") ?? ""),
        signalChoices: signalOptions(profile),
        infoChoices: infoFieldOptions(profile),
      };
    }
    if (spec) {
      return { kind: "action", title: "Action", action,
        handling: spec.informSteps.join("\n"),
        collect: nodeCollect(profile, l as unknown as Record<string, unknown>, "informRoute"),
        channel: "voice",
        ...voiceInformEdits(tree, nodeId, profile, l as unknown as Record<string, unknown>) };
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
  /* A path node opens its OWN action — Inform & Route only for the ones that carry it.
     ⚠️ IT REUSES THE LEAF BRANCH BELOW rather than repeating the body, so a change to the
     routing steps or the collected fields lands on both. */
  const pathId = nodeId.match(/^path-(\d+)-(\d+)-(\d+)$/);
  if (pathId) {
    const pth = tree.branches[Number(pathId[1])]?.leaves[Number(pathId[2])]?.paths?.[Number(pathId[3])];
    if (!pth) return null;
    /* ⚠️⚠️ **THE NODE'S OWN KIND WINS, AND HARDCODING IT HERE WAS THE SMS BUG A THIRD TIME
       (9/21/2026).** Reported against a use case switched to Qualify: the card drew **Qualify**
       and its drawer REOPENED on **Inform & Route**, with inform's instruction, phone and
       Consumer Zip / Consumer Name — the diagram and the drawer describing the same node
       differently, which is the one failure this whole feature exists to prevent. Both returns
       below said `action: "informRoute"` outright, so the picker could never show anything else
       however the node was configured. `smsDrawerFor` was fixed exactly this way on 9/17 and the
       LEAF branch above on 9/21; this is the same `kindOfNode` single source, three rows down. */
    const action: ActionKind =
      kindOfNode(pth as unknown as Record<string, unknown>) ?? "informRoute";
    if (action === "qualify") {
      /* ⚠️ ITS ANSWERS ARE ITS OWN CHILD NODES — the row the diagram already draws below a path
         — and the question and fallback live in the per-node `extra__` keys, because the spec
         has `qualifyQuestion` for the LEAF's question only and no slot for a use case an SE
         turned into one. Writing them to the shared key would retitle the leaf's question. */
      const kids = (pth.paths ?? []) as unknown as Record<string, unknown>[];
      return {
        kind: "action", title: "Action", action,
        question: String(vx(tree, nodeId, "question") ?? ""),
        segments: kids.map((k) => String(k?.title ?? "")),
        segmentNodes: kids,
        fallback: String(vx(tree, nodeId, "fallback") ?? ""),
        channel: "voice",
        edits: {
          question: `agent.extra__${nodeId}__question`,
          fallback: `agent.extra__${nodeId}__fallback`,
          segments: `branches.${pathId[1]}.leaves.${pathId[2]}.paths.${pathId[3]}.paths`,
          ...voiceExtraEdits(nodeId),
        },
        actionSlot: actionSlotFor(tree, nodeId),
        signal: String(vx(tree, nodeId, "signal") ?? ""),
        signalChoices: signalOptions(profile),
        infoChoices: infoFieldOptions(profile),
      };
    }
    if (spec) {
      return { kind: "action", title: "Action", action,
        handling: spec.informSteps.join("\n"),
        /* ⚠️⚠️ **THIS USE CASE'S OWN FIELDS, NOT A GENERIC TABLE.** Reported directly against
           the last row: the node drew "Consumer Name, Service Address, Timeline" while its
           drawer listed `COLLECT_FOR.inform` — Consumer Zip, Consumer Name — so the diagram
           and the drawer described the same node differently, which is the failure this file
           records for the pills already. The node's chips ARE its collect list, and they are
           what `treeToVoicePaths` hands the prompt, so reading them here makes all three agree. */
        collect: nodeCollect(profile, pth as unknown as Record<string, unknown>, action),
        channel: "voice",
        ...voiceInformEdits(tree, nodeId, profile, pth as unknown as Record<string, unknown>) };
    }
    return {
      kind: "action", title: "Action", action,
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

/* =============================================================================
   THE BUILT-IN SMS WORKFLOW'S DRAWERS
   -----------------------------------------------------------------------------
   ⚠️ **A SEPARATE BUILDER, NOT A BRANCH INSIDE `drawerFor`.** That function derives everything
   from a VoiceAgentSpec — a greeting, routing steps, a ZIP allow-list — none of which an SMS
   workflow has. Threading a channel flag through it would mean every one of its branches
   growing an `if`, on a function whose whole job is voice. The two share the drawer TYPES and
   the component, which is where sharing actually pays.

   ⚠️ **THE NODE IDS ARE POSITIONAL, AND THE TABLES BELOW SAY SO OUT LOUD.** The template's
   shape is fixed (one sales intent, one user group, two segments, two leaves each), so
   `path-0-0-1` unambiguously means "the existing-customer side". An id outside these tables —
   which is what an SE adding a third answer produces — falls through to an UNCONFIGURED drawer
   with empty fields rather than borrowing another node's copy. Honest, and it is also what the
   product shows for a segment nobody has configured yet.
   ============================================================================= */

/** Which Qualify node each clickable id is, and where its answers live in the tree. */
const SMS_QUALIFY: Record<string, { key: SmsQualifyNode; segments: string }> = {
  "leaf-0-0": { key: "root", segments: "branches.0.leaves.0.paths" },
  "path-0-0-0": { key: "newSide", segments: "branches.0.leaves.0.paths.0.paths" },
  "path-0-0-1": { key: "existingSide", segments: "branches.0.leaves.0.paths.1.paths" },
};
/** Which Inform leaf each clickable id is. */
const SMS_INFORM: Record<string, { key: keyof SmsConfig["inform"]; collect: SmsCollectKey }> = {
  "sub-0-0-0-0": { key: "serviceableYes", collect: "serviceableYes" },
  "sub-0-0-0-1": { key: "serviceableNo", collect: "serviceableNo" },
  "sub-0-0-1-0": { key: "foundYes", collect: "foundYes" },
  "sub-0-0-1-1": { key: "foundNo", collect: "foundNo" },
};

/** Walk a dot-path (arrays included) into the effective tree. ONE definition, several readers. */
function readPath(tree: WorkflowTreeModel, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc == null) return acc;
    const rec = acc as Record<string, unknown>;
    return Array.isArray(rec) ? rec[Number(k)] : rec[k];
  }, tree as unknown);
}

/**
 * Where a node sits in its own containing array, derived from its positional id.
 *
 * ⚠️⚠️ **EVERY ACTION NODE GETS ONE, INCLUDING THE LOCKED CHROME LEAVES (9/17/2026).** Asked for
 * directly, with both locked drawers selected: *"you need to add the drop and the screen to any
 * action context drawer… and make sure all those fields in the drawer is editable as well."*
 * The first build refused a `locked` node on the strength of the standing rule that the four
 * chrome boxes cannot be edited — but that rule is about their **NAMES**, which is what was
 * actually reported back in August ("those can't be change / edit" against the box titles), and
 * `editGuard` still refuses `.title` and `.subtitle` on them. Their ACTION is configuration, and
 * on this instruction it is the SE's to change.
 * ⚠️ **CONSEQUENCE, STATED: `editGuard.LOCKED_KEYS` COVERS `.action` AND CANNOT SEE THIS WRITE**,
 * because it matches a path ending in `.action` while this writes the containing ARRAY. So the
 * lock on a locked leaf's action is now only as strong as this function — the titles are still
 * guarded in the guard itself, where they belong.
 */
/** The node a positional id names, for any of the three rows that carry one. */
function nodeAt(tree: WorkflowTreeModel, nodeId: string): Record<string, unknown> | undefined {
  const leaf = nodeId.match(/^leaf-(\d+)-(\d+)$/);
  if (leaf) {
    return tree.branches[Number(leaf[1])]?.leaves?.[Number(leaf[2])] as
      unknown as Record<string, unknown> | undefined;
  }
  const seg = nodeId.match(/^(?:path|sub)-(\d+)-(\d+)-(\d+)(?:-(\d+))?$/);
  if (!seg) return undefined;
  const [, b, l, pi, si] = seg;
  const base = tree.branches[Number(b)]?.leaves?.[Number(l)]?.paths;
  const n = si != null ? base?.[Number(pi)]?.paths?.[Number(si)] : base?.[Number(pi)];
  return n as unknown as Record<string, unknown> | undefined;
}

/**
 * The action a node is actually set to.
 *
 * ⚠️⚠️ **THE NODE IS THE ONLY SOURCE, AND THE TABLES BELOW MUST NOT SHADOW IT.** Caught in the
 * browser the first time the picker applied: `sub-0-0-0-0` is listed in `SMS_INFORM`, whose fast
 * path hardcoded `action: "inform"` — so a node switched to Schedule Callback drew correctly and
 * REOPENED AS INFORM. That is the same two-sources-of-truth defect as this morning's, through a
 * different door, and the tables are the door. They now supply only WHERE THE TEXT LIVES, and
 * only while the action they were written for is still the one set.
 */
function kindOfNode(node: Record<string, unknown> | undefined): ActionKind | undefined {
  if (!node) return undefined;
  const k = node.actionKind as ActionKind | undefined;
  if (k) return k;
  const a = String(node.action ?? "");
  /* ⚠️ ORDER MATTERS: "Inform & Route" contains "inform". */
  return /qualify/i.test(a) ? "qualify"
    : /escalate/i.test(a) ? "escalate"
    : /callback/i.test(a) ? "callback"
    : /route/i.test(a) ? "informRoute" : "inform";
}

function actionSlotFor(tree: WorkflowTreeModel, nodeId: string):
  { path: string; index: number; nodes: Record<string, unknown>[] } | undefined {
  const leaf = nodeId.match(/^leaf-(\d+)-(\d+)$/);
  const seg = nodeId.match(/^(?:path|sub)-(\d+)-(\d+)-(\d+)(?:-(\d+))?$/);
  let path: string | undefined;
  let index = -1;
  if (leaf) { path = `branches.${leaf[1]}.leaves`; index = Number(leaf[2]); }
  else if (seg) {
    const [, b, l, pi, si] = seg;
    path = si != null
      ? `branches.${b}.leaves.${l}.paths.${pi}.paths`
      : `branches.${b}.leaves.${l}.paths`;
    index = Number(si ?? pi);
  }
  if (!path) return undefined;
  const arr = readPath(tree, path);
  if (!Array.isArray(arr)) return undefined;
  const node = arr[index] as Record<string, unknown> | undefined;
  if (!node) return undefined;
  return { path, index, nodes: arr as Record<string, unknown>[] };
}

/* =============================================================================
   THE WORKFLOW AS THE AGENT'S FLOW (9/17/2026)
   -----------------------------------------------------------------------------
   Asked for directly: *"can we make the config bi directional, so if there are changes in the
   workflow, it also changes it in actual preview agent or preview workflow."*

   ⚠️⚠️ **MEASURED FIRST: THE BUILT-IN SMS WORKFLOW REACHED THE AGENT NOWHERE.** `buildSmsBrain`
   reads `agentConfig`, an extra workflow's own prompt and (for an extra workflow) its `wfAgent`
   half — so every one of the six-row template's configured fields was invisible to the phone:
   three qualify questions, four inform instructions, the escalation text, both intents'
   looks-like and rules, every node's collect chips, the destination and the signal. An SE could
   configure the whole diagram and the preview would ignore all of it.
   ⚠️ **THE VOICE PAGE ALREADY WORKS THIS WAY**, which is the pattern being mirrored: its call
   reads the WORKFLOW page's scope (`treeScopeKey`) and merges `effTree.agent` into the spec, so
   an edit there already changes the call.

   ⚠️⚠️ **IT IS DERIVED THROUGH `smsDrawerFor`, NOT BY A SECOND WALK OF THE CONFIG.** That
   function already knows where every node's text lives — the template's tables for the eight it
   configures, the flat `extra__` keys for anything switched or added — and getting that wrong in
   a second place is how the agent ends up told something different from what the drawer shows.
   So the agent is told, by construction, exactly what an SE reads in the drawer.
   ============================================================================= */

/** One node of the configured flow, as the agent is told about it. */
export interface SmsFlowNode {
  title: string;
  action: string;
  question?: string;
  fallback?: string;
  instruction?: string;
  destination?: string;
  signal?: string;
  collect?: string[];
  answers?: SmsFlowNode[];
}
export interface SmsWorkflowFlow {
  intents: { title: string; looksLike: string; rules: string[]; flow: SmsFlowNode[] }[];
}

/**
 * The built-in SMS workflow's own configuration, shaped for the prompt.
 *
 * ⚠️ Returns null for a tree that is not the six-row template (an authored extra workflow, a
 * created one, or the voice tree), so nothing else on the platform changes.
 */
export function smsWorkflowFlow(
  profile: CustomerProfile,
  tree: WorkflowTreeModel,
  cfg: SmsConfig,
): SmsWorkflowFlow | null {
  if (tree.variant !== "sms" || !tree.branches?.length) return null;
  const at = (id: string): SmsFlowNode | null => {
    const node = nodeAt(tree, id);
    if (!node) return null;
    const d = smsDrawerFor(profile, tree, id, cfg);
    if (d?.kind !== "action") return null;
    const kids = Array.isArray(node.paths) ? (node.paths as unknown[]) : [];
    const answers = kids
      .map((_, i) => at(`${id.startsWith("leaf") ? "path" : "sub"}-${id.split("-").slice(1).join("-")}-${i}`))
      .filter((x): x is SmsFlowNode => !!x);
    return {
      title: String(node.title ?? ""),
      action: SMS_ACTION_LABEL[d.action],
      ...(d.question ? { question: d.question } : {}),
      ...(d.fallback ? { fallback: d.fallback } : {}),
      ...(d.handling ? { instruction: d.handling } : {}),
      ...(d.destination ? { destination: d.destination } : {}),
      ...(d.signal ? { signal: d.signal } : {}),
      ...(d.collect?.length ? { collect: d.collect.map((f) => f.name) } : {}),
      ...(answers.length ? { answers } : {}),
    };
  };
  const intents = tree.branches.map((b, bi) => {
    const side = bi === 0 ? "sales" : "support";
    const it = cfg.intents[side as "sales" | "support"];
    const flow = (b.leaves ?? [])
      .map((_, li) => at(`leaf-${bi}-${li}`))
      .filter((x): x is SmsFlowNode => !!x);
    return { title: String(b.title ?? ""), looksLike: it?.looksLike ?? "", rules: it?.rules ?? [], flow };
  });
  return intents.some((i) => i.flow.length) ? { intents } : null;
}

export function smsDrawerFor(
  profile: CustomerProfile,
  tree: WorkflowTreeModel,
  nodeId: string,
  cfg: SmsConfig,
): NodeDrawer | null {
  const ch = "sms" as const;

  if (nodeId === "trigger") {
    /* ⚠️ THE ROWS AND THE THIRD LINK ARE THE CAPTURE'S. Its two forms are named after what
       hands off to this workflow, which for us is the voice agent's two dead ends — the same
       two the Orlando Health work already models — and the inbound number uses the reserved
       555 exchange on the prospect's own area code rather than the capture's real one. */
    const area = (profile.reports.voiceScreenpop?.callerPhone ?? "").match(/(\d{3})/)?.[1] ?? "805";
    return {
      kind: "trigger", title: "Triggered by", summary: tree.triggeredBy,
      rows: [
        "Form: Voice to SMS Not Serviceable",
        "Form: Voice to SMS No CRM Match",
        `Inbound SMS: +1${area}5550142`,
      ],
      links: ["Go to campaigns", "Go to forms", "Go to promo numbers"],
    };
  }

  const bi = nodeId.startsWith("intent-") ? Number(nodeId.slice(7)) : -1;
  if (bi >= 0) {
    const b = tree.branches[bi];
    if (!b) return null;
    const side = bi === 0 ? "sales" : "support";
    const it = cfg.intents[side];
    return {
      kind: "intent", title: "Intent Details", name: b.title,
      looksLike: it.looksLike, rules: it.rules, channel: ch,
      edits: { looksLike: `sms.intents.${side}.looksLike`, rules: `sms.intents.${side}.rules` },
    };
  }

  /* Resolved once, and it outranks every table below. */
  const selfNode = nodeAt(tree, nodeId);
  const selfKind = kindOfNode(selfNode);

  /**
   * ⚠️⚠️ THE THREE FIELDS THAT USED TO BE DEAD PLACEHOLDERS, keyed per node and computed ONCE so
   * that every branch below gets them — the template's four nodes, the two locked chrome leaves
   * and anything an SE adds. All three use the FLAT `extra__` keys rather than a slot inside
   * `sms.qualify`/`sms.inform`: those tables have no room for a node they never created, and a
   * nested path is the silent no-op `setByPath` produces when an intermediate key is missing.
   */
  const xt = (f: string) => `sms.extra__${nodeId}__${f}`;
  const xv = (f: string) => cfg[`extra__${nodeId}__${f}`];
  const extraEdits = { destination: xt("destination"), signal: xt("signal") };
  /**
   * ⚠️⚠️ **THE COLLECT LIST IS THE NODE'S OWN `chips`, NOT A SECOND COPY IN THE CONFIG — and the
   * first build got this wrong in exactly the way this file already warns about.** Stored under
   * an `extra__…__collect` key, an SE could add a field in the drawer and the DIAGRAM'S PILLS
   * would not move: two sources for one fact, "a node advertising collecting one thing while its
   * drawer's What To Collect said another". `chips` is already what the diagram draws, already
   * exempt from the array-length rule, and now also what the drawer reads and writes — one
   * value, through the same `actionSlot` array write the action itself uses.
   */
  const nodeChips = Array.isArray(selfNode?.chips) ? (selfNode!.chips as string[]) : undefined;
  const extraFields = (kind: ActionKind, fallbackCollect: CollectField[]) => {
    const names = nodeChips;
    const opts = infoFieldOptions(profile);
    const help = (n: string) => opts.find((o) => o.name === n)?.help ?? "";
    return {
      ...(SMS_DESTINATION_PROMPT[kind]
        ? { destinationPrompt: SMS_DESTINATION_PROMPT[kind],
            destination: String(xv("destination") ?? ""),
            destinationPlaceholder: SMS_DESTINATION_PLACEHOLDER[kind] }
        : {}),
      signal: String(xv("signal") ?? ""),
      signalChoices: signalOptions(profile),
      infoChoices: opts,
      /* A stored list wins; otherwise the template's own configured fields. */
      collect: names ? names.map((n) => ({ name: n, help: help(n) })) : fallbackCollect,
    };
  };

  const q = SMS_QUALIFY[nodeId];
  if (q && selfKind === "qualify") {
    /* ⚠️ THE ANSWERS COME FROM THE TREE, ALWAYS — the same rule `drawerFor` settled on 8/27.
       The tree handed in here is the page's EFFECTIVE object, so it already carries anything
       Ask AI or a previous Apply changed; a second list would disagree the first time either
       was touched. */
    const at = readPath(tree, q.segments);
    const nodes = Array.isArray(at) ? (at as Record<string, unknown>[]) : [];
    const segments = nodes.map((x) => String(x?.title ?? ""));
    return {
      kind: "action", title: "Action", action: "qualify", channel: ch,
      question: cfg.qualify[q.key].question,
      segments,
      fallback: cfg.qualify[q.key].fallback,
      segmentNodes: nodes,
      edits: {
        question: `sms.qualify.${q.key}.question`,
        fallback: `sms.qualify.${q.key}.fallback`,
        segments: q.segments,
        /* Carried even though a Qualify renders neither, so switching the action to one that
           DOES have them finds somewhere to write without rebuilding the drawer. */
        ...extraEdits,
      },
      actionSlot: actionSlotFor(tree, nodeId),
      ...extraFields("qualify", []),
    };
  }

  const inf = SMS_INFORM[nodeId];
  if (inf && selfKind === "inform") {
    return {
      kind: "action", title: "Action", action: "inform", channel: ch,
      handling: cfg.inform[inf.key],
      /* ⚠️ NO `phone`: an SMS inform drawer has no phone row — measured on all four. */
      edits: { handling: `sms.inform.${inf.key}`, ...extraEdits },
      actionSlot: actionSlotFor(tree, nodeId),
      ...extraFields("inform", collectFor(profile, inf.collect)),
    };
  }

  /* The support user group. The only escalate node this template has. */
  if (nodeId === "leaf-1-0" && selfKind === "escalate") {
    return {
      kind: "action", title: "Action", action: "escalate", channel: ch,
      handling: cfg.escalate,
      edits: { handling: "sms.escalate", ...extraEdits },
      actionSlot: actionSlotFor(tree, nodeId),
      ...extraFields("escalate", []),
    };
  }

  /* ⚠️⚠️ **AN ADDED SEGMENT'S DRAWER DESCRIBES THE NODE'S OWN ACTION (9/17/2026).** Reported:
     "the Action in this example [is] Qualify, it should match the action in the context drawer."
     Measured before the fix — every one of the eight template nodes agreed, and both SE-added
     ones read **Qualify on the node and Inform in the drawer**, because this branch hardcoded
     `action: "inform"` for any id the two tables above do not list. That is the diagram and the
     drawer disagreeing about the same node, which is the failure this whole feature exists to
     prevent and which CLAUDE.md records four times over.

     The node itself is the single source: `actionKind` if it carries one (the template and
     `repairSmsSegments` both set it), else its own action wording. */
  /* ⚠️ ALSO REACHED BY A TEMPLATE NODE WHOSE ACTION WAS CHANGED, not only by an added one — the
     tables above now stand down when the node no longer carries the action they were written
     for, and this is where such a node lands. Its text then lives in the flat `extra__` keys,
     which is right: `sms.inform.serviceableYes` is the wrong slot for a Schedule Callback,
     which has no instruction text at all. */
  const idx = nodeId.match(/^(path|sub|leaf)-(\d+)-(\d+)(?:-(\d+))?(?:-(\d+))?$/);
  if (idx) {
    const kindWord = idx[1];
    const node = selfNode;
    const act = selfKind;
    if (!node || !act) return null;
    const [b, l, pi] = kindWord === "leaf"
      ? [idx[2], idx[3], undefined]
      : [idx[2], idx[3], idx[4]];
    /* ⚠️ THE TEXT FIELDS ARE KEYED ON THE NODE ID, because the template has no slot for a
       segment it never created. Without somewhere to write, the drawer would render a disabled
       empty box with no explanation — "worse than an absent one", which this repo already paid
       for once on the SMS custom-greeting control. */
    const at = (f: string) => `sms.extra__${nodeId}__${f}`;
    /* ⚠️⚠️ **`?? {}` BECAUSE A SAVED OVERRIDE CAN PREDATE THIS FIELD, and without it the first
       click on an added segment threw `Cannot read properties of undefined` — which the error
       boundary then answered by tearing down the whole diagram, so EVERY node stopped opening,
       not just that one. Any demo with an SMS override saved before `extra` existed would have
       hit it. The same class of bug `usePageDataWithLabels` records: "an override saved before a
       label key existed falls back to the default instead of rendering undefined." */
    const val = (f: string) => cfg[`extra__${nodeId}__${f}`];
    if (act === "qualify") {
      /* ⚠️ ITS ANSWERS ARE ITS OWN CHILD NODES, and the path to them is derivable from the id —
         so `Add` works on a segment an SE added just as it does on the template's own. A SUB
         node gets none: it is the last row the diagram draws, so a child would be stored and
         never rendered, which is the silent no-op this file keeps warning about. */
      /* A `leaf` keeps its own `paths`; a `path` gets `…paths.P.paths`; a `sub` gets none,
         because it is the last row the diagram draws. */
      const segPath = kindWord === "leaf" ? `branches.${b}.leaves.${l}.paths`
        : kindWord === "path" ? `branches.${b}.leaves.${l}.paths.${pi}.paths`
        : undefined;
      const kids = (node.paths ?? []) as unknown as Record<string, unknown>[];
      return {
        kind: "action", title: "Action", action: "qualify", channel: ch,
        question: String(val("question") ?? ""),
        segments: kids.map((k) => String(k?.title ?? "")),
        segmentNodes: kids,
        fallback: String(val("fallback") ?? ""),
        edits: { question: at("question"), fallback: at("fallback"),
          ...(segPath ? { segments: segPath } : {}), ...extraEdits },
        actionSlot: actionSlotFor(tree, nodeId),
        ...extraFields("qualify", []),
      };
    }
    return {
      kind: "action", title: "Action", action: act, channel: ch,
      handling: String(val("handling") ?? ""),
      actionSlot: actionSlotFor(tree, nodeId),
      ...extraFields(act, collectOnSwitch(act)),
      edits: { handling: at("handling"), ...extraEdits },
    };
  }

  /* Conversation Start opens nothing, exactly as on the voice page. */
  return null;
}
