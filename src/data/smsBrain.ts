/* =============================================================================
   smsBrain.ts — ONE definition of what the SMS agent knows
   -----------------------------------------------------------------------------
   Two screens now test the same SMS agent:

     • Preview Agent          (/agent-studio/agent/preview) — the iPhone mockup
     • Preview Workflow       (the chat drawer on the SMS workflow page)

   They MUST ask the same questions, in the same order, with the same rules —
   they are previews of ONE agent, and an SE who tunes the questions on one screen
   and sees different behaviour on the other has been shown a lie. Two copies of
   this object would drift on the first edit, so the shape lives here and both
   callers build from it.

   The AGENT CONFIG is passed IN rather than read from the profile, because the
   two callers must obtain it differently and only one of them may register an AI
   scope:

     • PhonePreview calls usePageData(...) — it IS the page whose AI drawer edits
       the agent's questions, so registering is correct there.
     • The workflow drawer must NOT register: the workflow page has already
       registered its DIAGRAM as the editable scope, and a second registration on
       the same page would silently repoint that page's sparkle at the agent
       config instead of the tree. It reads the Preview Agent page's EFFECTIVE
       config via effectiveData(...) instead — so questions edited over there
       still apply here, which is the behaviour you want from two views of one
       agent.
   ============================================================================= */

import type { CustomerProfile, AgentConfigView } from "./schema";

type Profile = CustomerProfile;
/* PARTIAL on purpose. `agentConfig` is optional on the profile, so PhonePreview's
   base object is built with `...(profile.reports.agentConfig ?? {})` and every
   field arrives optional; the workflow drawer's `effectiveData()` is looser still
   (it returns whatever the AI layer stored). Every field below is read
   defensively, so accepting a partial is honest rather than a cast. */
type AgentConfig = Partial<AgentConfigView> | undefined | null;
type ExtraWorkflow = NonNullable<Profile["reports"]["extraWorkflows"]>[number];

export interface SmsBrain {
  customSystem?: string;
  openingMessage?: string;
  agentLabel?: string;
  customerName: string;
  industry: string;
  rules: string[];
  qaPairs: { question: string; answer: string }[];
  knowledge: string[];
  playbook: AgentConfigView["smsPlaybook"] | undefined;
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

/* THE AGENT'S OPENING MESSAGE, when nothing has set one.

   Derived, not generated: every profile already on disk predates the `greeting`
   field, and an engine phase to add one would mean regenerating all of them. The
   playbook already carries prospect-specific prose we can lean on, so this reads
   as that business rather than as a template.

   The `offer` is dropped in VERBATIM as its own sentence rather than folded into
   one. Splicing it mid-sentence needs the first letter lowercased, which is fine
   for "Save with..." and wrong for "72 Hour Sale..." or a brand name; a separate
   sentence needs no case surgery and cannot mangle anyone's offer.

   Side effect worth knowing: the opening line is now the SAME on every run. It
   used to be improvised by the model each time the tab opened, so an SE could not
   rehearse against it. */
export function defaultGreeting(customerName: string, playbook: AgentConfigView["smsPlaybook"] | undefined): string {
  const booking = playbook?.bookingType?.trim() || "appointment";
  const offer = playbook?.offer?.trim() ?? "";
  const offerSentence = offer ? ` ${/[.!?]$/.test(offer) ? offer : offer + "."}` : "";
  return `Hi, I'm ${customerName}'s AI assistant. I can help you book ${aOrAn(booking)} ${booking}.${offerSentence} Would you like to get started?`;
}

/** The `brain` POST body for /api/chat. `wf` is an extra workflow (e.g. a nurture
 *  playbook) whose systemPrompt REPLACES the default sales flow. */
export function buildSmsBrain(profile: Profile, ac: AgentConfig, wf?: ExtraWorkflow): SmsBrain {
  return {
    customSystem: wf?.systemPrompt,
    /* Precedence: an extra workflow's scripted line wins (it is the whole point of
       that workflow), then whatever the SE or the AI set, then the derived default.
       Always non-empty now, so the phone never improvises its own opener. */
    openingMessage: wf?.openingMessage
      || ac?.smsPlaybook?.greeting?.trim()
      || defaultGreeting(profile.customerName, ac?.smsPlaybook),
    agentLabel: wf?.label,
    customerName: profile.customerName,
    industry: profile.industry,
    rules: ac?.brandConversationRules ?? [],
    qaPairs: ac?.aiRecommendations?.find((r) => r.qaPairs?.length)?.qaPairs ?? [],
    knowledge: ac?.knowledgeSources?.map((k) => k.name) ?? [],
    playbook: ac?.smsPlaybook,
  };
}

/** The scope key whose AI edits define the SMS agent's questions. Both previews
 *  point at the Preview Agent page, so an edit made there governs both. */
export const SMS_AGENT_SCOPE_PATH = "/agent-studio/agent/preview";

/* Shared /api/chat call with the same transient-failure backoff both previews
   need, and the same markdown strip (the model occasionally emits ** or ` and a
   text message never contains those). */
export async function askSmsAgent(brain: SmsBrain, history: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain, messages: history }),
      });
      const data = await res.json().catch(() => ({}) as any);
      if (res.ok) return String(data.reply ?? "").replace(/\*\*|__|`/g, "") || "…";
      lastErr = new Error(data?.error || "Chat failed.");
      if (res.status < 500 && res.status !== 429) break;   // non-transient → stop
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error("Network error. Please try again.");
    }
  }
  throw lastErr ?? new Error("Chat failed.");
}
