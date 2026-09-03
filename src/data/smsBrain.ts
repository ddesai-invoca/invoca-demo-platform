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
  /**
   * Config an SE or Ask AI CHANGED, for a workflow whose own `systemPrompt` replaces the
   * default flow.
   *
   * ⚠️⚠️ **THIS EXISTS BECAUSE `customSystem` SWALLOWED EVERY EDIT ON SUCH A PAGE.**
   * `buildSystem` returns `customSystem + SMS_FORMAT_RULES` and never reaches the lines that
   * render the questions, the brand rules, the Q&A or the knowledge list — so on an extra
   * workflow's Preview Agent, "ask for their ZIP first" applied, reported success, and
   * changed nothing. Reported directly, 9/3/2026.
   *
   * ⚠️ **ONLY WHAT ACTUALLY DIFFERS FROM THE PROFILE GOES IN HERE.** Appending the prospect's
   * generic playbook questions to a nurture script nobody edited would CONTRADICT that
   * script, and "a self-contradicting prompt is worse than either rule" is a lesson this repo
   * has already paid for twice. Untouched config sends nothing and those workflows behave
   * exactly as they were signed off.
   */
  overrides?: { questions?: string[]; rules?: string[] };
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
  /* {name} is resolved at render by resolveGreeting(). Kept as a TOKEN in the
     stored text rather than a baked-in name so the greeting stays portable: the
     same demo re-opened against a different caller still addresses the right
     person, and an SE editing it can move the name around. */
  return `Hi {name}, I'm ${customerName}'s AI assistant. I can help you book ${aOrAn(booking)} ${booking}.${offerSentence} Would you like to get started?`;
}

/* THE ONE PLACE {name} IS RESOLVED.

   The caller comes from the Voice Screenpop, deliberately: that is a real person
   from elsewhere in this prospect's story, so the SMS thread and the screenpop
   name the same customer instead of inventing a second one.

   Both the phone and the Ask AI drawer call this, so the row in the drawer shows
   the exact text the phone sends. Two copies of this substitution would drift the
   moment one of them handled the fallback differently. */
export function resolveGreeting(text: string, profile: Profile): string {
  const first = (profile.reports.voiceScreenpop?.callerName ?? "").split(/\s+/)[0];
  return text.replace(/\{name\}/g, first || "there");
}

/** The `brain` POST body for /api/chat. `wf` is an extra workflow (e.g. a nurture
 *  playbook) whose systemPrompt REPLACES the default sales flow. */
/** Same-shape comparison, so a re-ordered list counts as a change and a re-render does not. */
function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * What the SE or Ask AI has changed, relative to the prospect's own profile.
 *
 * Computed from `profile.reports.agentConfig` (the base) against the effective config, which
 * is why this needs no extra argument: the raw config is already on the profile.
 */
function editedSlices(profile: Profile, ac: AgentConfig): SmsBrain["overrides"] {
  const raw = profile.reports.agentConfig as AgentConfig;
  const out: NonNullable<SmsBrain["overrides"]> = {};
  const q = ac?.smsPlaybook?.qualifyingQuestions;
  if (Array.isArray(q) && q.length && changed(q, raw?.smsPlaybook?.qualifyingQuestions)) out.questions = q.map(String);
  const r = ac?.brandConversationRules;
  if (Array.isArray(r) && r.length && changed(r, raw?.brandConversationRules)) out.rules = r.map(String);
  return out.questions || out.rules ? out : undefined;
}

export function buildSmsBrain(profile: Profile, ac: AgentConfig, wf?: ExtraWorkflow): SmsBrain {
  return {
    customSystem: wf?.systemPrompt,
    /* Precedence: an extra workflow's scripted line wins (it is the whole point of
       that workflow), then whatever the SE or the AI set, then the derived default.
       Always non-empty now, so the phone never improvises its own opener. */
    /* ⚠️⚠️ **AN EXPLICITLY SET GREETING WINS OVER THE WORKFLOW'S SCRIPTED LINE, AND THE OLD
       ORDER WAS A SILENT NO-OP (9/3/2026).** Reported directly: "in the ask AI feature i
       asked for a couple of changes, the AI said that they applied but none of them actually
       applied... the opening message still hasnt changed."

       `wf?.openingMessage` used to come FIRST, and it is read from the RAW profile — so on a
       Preview Agent opened for an extra workflow, an SE (or Ask AI) could set
       `smsPlaybook.greeting`, watch the drawer's row update, be told it applied, and hear the
       phone open with the old line forever. `smsPlaybook.greeting` is absent until somebody
       sets it (verified across the demos on disk: Avi & Co and Reyes Law both carry a
       workflow opener and NO stored greeting), so its mere PRESENCE means a human or the
       assistant put it there — which is exactly the thing that should win.

       Unedited, this is byte-identical to the old behaviour: no stored greeting, so the
       workflow's own opener is still what the agent says. */
    openingMessage: ac?.smsPlaybook?.greeting?.trim()
      || wf?.openingMessage
      || defaultGreeting(profile.customerName, ac?.smsPlaybook),
    agentLabel: wf?.label,
    customerName: profile.customerName,
    industry: profile.industry,
    rules: ac?.brandConversationRules ?? [],
    qaPairs: ac?.aiRecommendations?.find((r) => r.qaPairs?.length)?.qaPairs ?? [],
    knowledge: ac?.knowledgeSources?.map((k) => k.name) ?? [],
    playbook: ac?.smsPlaybook,
    /* Only when a custom flow would otherwise swallow them — everywhere else these already
       reach the prompt through `rules` and `playbook`, and sending them twice would have the
       agent read one list as an override of itself. */
    overrides: wf?.systemPrompt ? editedSlices(profile, ac) : undefined,
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
