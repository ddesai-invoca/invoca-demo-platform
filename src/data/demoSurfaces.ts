import type { CustomerProfile } from "./schema";
import { builtInWorkflowBase } from "./workflowBase";
import { marketingBase } from "./marketingBase";
import { interactionLabels } from "./aiAgentLabels";

/* =============================================================================
   demoSurfaces.ts — the screens a custom prompt can reach, and the EXACT data each
   one registers
   -----------------------------------------------------------------------------
   Asked for 10/9/2026: *"allow this custom prompt to drop down a text box where the
   user can write exactly what they want the demo to generate once they hit Launch
   Demo… allow them to do anything they want with the demo"* — because an SE was
   fixing every generated demo screen by screen with Ask AI afterwards.

   ⚠️⚠️ **THE STEER AND THE APPLY PASS ARE TWO DIFFERENT MECHANISMS, AND THIS FILE IS
   THE SECOND ONE.** `engine/genContext.ts` already reaches all 20 generation phases and
   deliberately caps itself at WORDING and CONTENT: its own note records that letting a
   prompt fight the template produces "a self-contradicting prompt, worse than either
   rule". That is right, and it is also why a steer alone could never satisfy this
   request — a different dashboard, an extra workflow branch or a reworded report is the
   OVERRIDE layer, which is exactly what Ask AI writes into. So after a demo generates we
   run the same edit machinery, per surface, with the SE's own instruction.

   ⚠️⚠️ **`base` MUST BE BYTE-IDENTICAL TO WHAT THE SCREEN REGISTERS, AND THAT IS THE ONE
   RULE THIS FILE EXISTS TO HOLD.** `applyEdits` reads `overrides[key] ?? base`, edits it,
   and stores the WHOLE result back as the override. So a base that is merely close does
   NOT degrade gracefully — it REPLACES the page's data with the near-miss, and the screen
   renders the gap with nothing anywhere reporting it. Two screens fold derived values into
   what they register, so both were EXTRACTED rather than copied:
     • `/dashboards/marketing`        -> `marketingBase`      (the Lead Form group + labels)
     • the two built-in workflows     -> `builtInWorkflowBase` (the tree + agent/sms halves)
   `audit:custom-prompt` asserts every surface here still matches its screen.

   ⚠️ **ONLY SURFACES WHOSE BASE IS PROVABLY EXACT ARE LISTED.** A screen that builds its
   scope out of local component state cannot be seeded from the profile alone, and guessing
   is the failure above. Adding one means extracting its base the way those two were, not
   approximating it here.

   ⚠️ **`when` IS A GATE, NOT A FILTER ON EMPTINESS.** A prospect genuinely without a slice
   (no Call Review, no Signal Manager) must not be offered that surface, or the planner
   writes an instruction for a screen that renders an empty state.
   ============================================================================= */

export interface DemoSurface {
  /** Stable id the plan refers to. Never renamed: a stored plan names these. */
  id: string;
  /** What an SE calls this screen. */
  label: string;
  /** The route, which is also half of the AI scope key (`<demoId>::<path>`). */
  path: string;
  /** One line telling the planner what can be changed here. */
  what: string;
  /** Is this surface present on this prospect at all? */
  when: (p: CustomerProfile) => boolean;
  /** The object the screen registers. See the warning above. */
  base: (p: CustomerProfile) => unknown;
}

const r = (p: CustomerProfile) => p.reports as Record<string, unknown>;
const has = (key: string) => (p: CustomerProfile) => !!r(p)[key];

export const SURFACES: DemoSurface[] = [
  {
    id: "sms-agent",
    label: "SMS agent (Preview Agent)",
    path: "/agent-studio/agent/preview",
    what: "What the SMS agent SAYS: its opening message, the qualifying questions it asks and their order, the brand conversation rules it follows, its offer, and whether it may quote a price.",
    when: has("agentConfig"),
    /* Exactly what PhonePreview registers. */
    base: (p) => ({
      title: `Preview Agent — what the ${p.customerName} SMS agent asks`,
      ...(p.reports.agentConfig ?? {}),
    }),
  },
  {
    id: "sms-workflow",
    label: "SMS workflow diagram",
    path: "/agent-studio/agent/workflow/sms",
    what: "The SMS workflow TREE: its branches and the answers under them, what each node collects, each node's action, and the instruction text behind every node's drawer.",
    when: () => true,
    base: (p) => builtInWorkflowBase(p, true),
  },
  {
    id: "voice-workflow",
    label: "Voice agent and its workflow",
    path: "/agent-studio/agent/workflow/voice",
    what: "The VOICE agent: its greeting, conversation rules, service-area steps and routing, plus the voice workflow tree's branches, use cases and what each collects.",
    when: () => true,
    base: (p) => builtInWorkflowBase(p, false),
  },
  {
    id: "agent-config",
    label: "Agent settings",
    path: "/agent-studio/agent",
    what: "The agent's brand conversation rules, knowledge sources and AI recommendations.",
    when: has("agentConfig"),
    base: (p) => p.reports.agentConfig,
  },
  {
    id: "marketing",
    label: "Marketing Performance dashboard",
    path: "/dashboards/marketing",
    what: "The demo's landing dashboard: KPI tiles and their labels, the Source / Medium / Campaign / Search Term / Product Category / Region breakdowns and their numbers, and the charts.",
    when: () => true,
    base: (p) => marketingBase(p as never),
  },
  {
    id: "marketing-ops",
    label: "Marketing & Operations dashboard",
    path: "/dashboards/marketing-ops",
    what: "Operations KPIs, the per-location handling table and the call-outcome breakdowns.",
    when: has("opsDashboard"),
    base: (p) => r(p).opsDashboard,
  },
  {
    id: "ai-agent-conversion",
    label: "AI Agent Conversion dashboard",
    path: "/dashboards/ai-agent-conversion",
    what: "The Lead Form and Voice Agent conversion cards, their chips and tiles, and the channel breakdowns.",
    when: has("aiAgentConversion"),
    base: (p) => interactionLabels(r(p).aiAgentConversion as never),
  },
  {
    id: "ai-messaging-impact",
    label: "AI Messaging Impact dashboard",
    path: "/dashboards/ai-messaging-impact",
    what: "Human vs AI messaging comparison: engagement, appointment performance, the trend chart and the common-topics chart.",
    when: has("aiMessagingImpact"),
    base: (p) => r(p).aiMessagingImpact,
  },
  {
    id: "quality-management",
    label: "Quality Management dashboard",
    path: "/dashboards/quality-management",
    what: "Agent quality scores, the agent tables and the trending charts.",
    when: has("qualityManagement"),
    base: (p) => r(p).qualityManagement,
  },
  {
    id: "qm-instant-insights",
    label: "QM Instant Insights dashboard",
    path: "/dashboards/qm-instant-insights",
    what: "Essential contact-centre metrics, answer-rate trend and the evaluation rollup.",
    when: has("qmInstantInsights"),
    base: (p) => r(p).qmInstantInsights,
  },
  {
    id: "digital-insights",
    label: "Digital Journey & Call Attribution report",
    path: "/reports/digital-insights",
    what: "The attribution table: its dimension columns, the signal columns, and every interaction row.",
    when: has("digitalInsights"),
    base: (p) => r(p).digitalInsights,
  },
  {
    id: "conversation-intelligence",
    label: "Conversation Intelligence report",
    path: "/reports/conversation-intelligence",
    what: "The analysed call: its transcript, the signals it fired, the call scoring and the AI summary.",
    when: has("conversationIntelligence"),
    base: (p) => r(p).conversationIntelligence,
  },
  {
    id: "sms-ci",
    label: "AI SMS Conversation Intelligence report",
    path: "/reports/sms-conversation-intelligence",
    what: "The SMS conversations this report lists, their transcripts and the signals extracted from them.",
    when: has("smsConversationIntelligence"),
    base: (p) => r(p).smsConversationIntelligence,
  },
  {
    id: "voice-ci",
    label: "AI Voice Conversation Intelligence report",
    path: "/reports/voice-conversation-intelligence",
    what: "The voice calls this report lists, their transcripts and the signals extracted from them.",
    when: has("voiceConversationIntelligence"),
    base: (p) => r(p).voiceConversationIntelligence,
  },
  {
    id: "call-review",
    label: "Call Review",
    path: "/call-review",
    what: "The list of recent calls: each one's summary, score, duration and whether it converted.",
    when: has("callReview"),
    base: (p) => r(p).callReview,
  },
  {
    id: "call-detail",
    label: "Call Detail",
    path: "/call-review/detail",
    what: "One call in full: its transcript, scorecard, signals and AI summary.",
    when: has("callDetail"),
    base: (p) => r(p).callDetail,
  },
  {
    id: "signal",
    label: "Signal (Manage Signals)",
    path: "/signal",
    what: "The prospect's configured signals: their names, types, rules and status.",
    when: has("signalManager"),
    base: (p) => r(p).signalManager,
  },
];

export const surfaceById = (id: string): DemoSurface | undefined =>
  SURFACES.find((s) => s.id === id);

/** The surfaces a given prospect actually has, which is what the planner is shown. */
export const surfacesFor = (p: CustomerProfile): DemoSurface[] =>
  SURFACES.filter((s) => s.when(p));

/** The scope key `applyEdits` writes under. ONE definition — the apply pass writes it
 *  and `AiAssistantContext`'s sync slices on the `<demoId>::` prefix to PATCH it. */
export const surfaceKey = (demoId: string, path: string): string => `${demoId}::${path}`;
