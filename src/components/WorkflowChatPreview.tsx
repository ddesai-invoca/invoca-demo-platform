import { useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { buildSmsBrain, askSmsAgent, resolveGreeting, SMS_AGENT_SCOPE_PATH } from "../data/smsBrain";
import type { AgentConfigView } from "../data/schema";

/* =============================================================================
   WorkflowChatPreview — the "Preview Workflow" chat drawer on an SMS workflow
   -----------------------------------------------------------------------------
   Matched to the real Invoca page (network 1847, /ai_agents/edit/25/workflow/114)
   from a SingleFile capture. It is an EMBEDDED CHAT WIDGET, not a platform
   component, so its own stylesheet is the source of truth and its values are
   measured, not guessed:

     panel        400px wide (.cloud { width: 400px })
     header       50px tall, bg rgb(231,233,235), text rgb(21,36,62), top radius 6px
     host bubble  white bg, rgb(21,36,62), radius 6px, 16px, 8px/16px padding,
                  8px from a 40px round avatar, row margin-right 50px
     guest bubble bg rgb(231,233,235), same text/radius, right-aligned,
                  row margin-left 50px
     input        textarea min-height 56px / max 128px, 16px, resize:none,
                  placeholder "Type your question"
     footer       "Last Updated: <date>", 13px, rgb(48,50,53), centred
     avatar       a speech bubble in #2c3951 with a sparkle

   ⚠️ IT TESTS THE SAME AGENT AS THE PREVIEW AGENT SCREEN. Both build their brain
   from buildSmsBrain(), so the questions, order and rules are identical by
   construction — an SE who tunes the questions on the iPhone screen and then opens
   this drawer must not be shown a different agent.

   ⚠️ IT MUST NOT CALL usePageData. The workflow page has ALREADY registered its
   DIAGRAM as the AI scope, and registerScope is last-write-wins, so a second
   registration here would silently repoint that page's sparkle from the tree to
   the agent config — breaking the "add a branch" feature with no visible cause.
   It reads the Preview Agent page's EFFECTIVE config through effectiveData()
   instead, which registers nothing and still picks up edits made over there.

   ⚠️ It deliberately does NOT capture to the SMS Conversation Intelligence report.
   The iPhone Preview Agent does that, and it is the demo's headline move; a second
   capture source would file the same conversation twice. This drawer is a test
   bench, not a demo beat.
   ============================================================================= */

interface Msg { role: "user" | "assistant"; content: string; }

/* The real widget's bot avatar, decoded from the capture: a speech bubble in
   #2c3951. Their sparkle glyph is a single 900-character path; this redraws it as
   a four-point star, which is indistinguishable at 40px. */
function BotAvatar() {
  return (
    <span className="wcp-avatar" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 20 19" fill="none">
        <path fill="#2c3951" d="M13.4971 0C17.0911 0.00406195 20.0017 2.92056 19.999 6.51465V9.85938C19.9951 13.4488 17.0865 16.3582 13.4971 16.3623H8.74121L0.183594 18.79L3.34277 15.5332C1.27845 14.3862 -0.00114649 12.2092 0 9.84766V6.50195C0.00413828 2.91275 2.91275 0.00413921 6.50195 0H13.4971Z" />
        <path fill="#fff" d="M10 4.1c.35 1.55 1.02 2.22 2.57 2.57-1.55.35-2.22 1.02-2.57 2.57-.35-1.55-1.02-2.22-2.57-2.57C8.98 6.32 9.65 5.65 10 4.1Z" />
        <path fill="#fff" d="M13.1 9.0c.2.9.58 1.28 1.48 1.48-.9.2-1.28.58-1.48 1.48-.2-.9-.58-1.28-1.48-1.48.9-.2 1.28-.58 1.48-1.48Z" />
      </svg>
    </span>
  );
}

function RefreshIcon() {
  /* The capture's tabler-refresh, stroke #15243e, 24px, stroke-width 2. */
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15243e"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </svg>
  );
}

export function WorkflowChatPreview({ workflowName, wfSlug, onClose }: {
  workflowName: string;
  wfSlug?: string | null;
  onClose: () => void;
}) {
  const { profile, profileId } = useProfile();
  const { effectiveData } = useAiAssistant();

  /* The SMS agent's questions live under the PREVIEW AGENT page's scope, so an
     edit made there governs this drawer too. Falls back to the profile's own
     config when that page has never been opened (nothing registered, no
     override). Never registers a scope — see the header note. */
  const agentConfig = useMemo(() => {
    const edited = effectiveData(`${profileId}::${SMS_AGENT_SCOPE_PATH}`) as
      (AgentConfigView & { title?: string }) | undefined;
    return (edited ?? profile.reports.agentConfig) as AgentConfigView | undefined;
  }, [effectiveData, profileId, profile.reports.agentConfig]);

  const wf = wfSlug
    ? (profile.reports.extraWorkflows ?? []).find((w) => w.slug === wfSlug)
    : undefined;
  const brain = useMemo(() => buildSmsBrain(profile, agentConfig, wf), [profile, agentConfig, wf]);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /* Guards the opening greeting against StrictMode's double-effect, and lets the
     reset button deliberately re-run it. */
  const greeted = useRef(false);
  const [resetKey, setResetKey] = useState(0);
  /* Brief, above the composer. Same reasoning as the iPhone preview: a thread that
     vanishes silently reads as a lost conversation rather than a picked-up edit. */
  const [restarted, setRestarted] = useState(false);

  /* RESTART WHEN THE AGENT CHANGES. The greeting effect deliberately does not
     depend on `brain` (that would re-greet on every render), so this compares a
     serialised copy instead and restarts only when the substance moves: the
     questions, the greeting, the rules. Without it an SE could edit the questions
     from this very drawer and watch the chat carry on asking the old ones. */
  const brainSig = useMemo(() => JSON.stringify(brain), [brain]);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === null) { lastSig.current = brainSig; return; }
    if (lastSig.current === brainSig) return;
    lastSig.current = brainSig;
    setMessages([]); setInput(""); setError(null); setBusy(false);
    greeted.current = false;
    setResetKey((k) => k + 1);
    setRestarted(true);
    const t = setTimeout(() => setRestarted(false), 3200);
    return () => clearTimeout(t);
  }, [brainSig]);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    (async () => {
      /* An extra workflow scripts its own opening line — a nurture agent's first
         message has to read identically every time an SE runs the demo. */
      if (brain.openingMessage) {
        setMessages([{ role: "assistant", content: resolveGreeting(brain.openingMessage, profile) }]);
        return;
      }
      setBusy(true);
      try { setMessages([{ role: "assistant", content: await askSmsAgent(brain, []) }]); }
      catch (e: any) { setError(e?.message ?? "Chat failed."); }
      finally { setBusy(false); }
    })();
    // brain is intentionally not a dep: re-greeting on every config change would
    // wipe a conversation in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try { setMessages([...next, { role: "assistant", content: await askSmsAgent(brain, next) }]); }
    catch (e: any) { setError(e?.message ?? "Chat failed."); }
    finally { setBusy(false); }
  }

  function reset() {
    setMessages([]); setInput(""); setError(null); setBusy(false);
    greeted.current = false;
    setResetKey((k) => k + 1);
  }

  /* The real widget shows a plain date. Locale-formatted so it reads naturally,
     and computed at render because it is chrome, not demo data. */
  const lastUpdated = new Date().toLocaleDateString("en-US");

  return (
    <div className="wcp-drawer" role="dialog" aria-modal="false"
      aria-label={`Preview Workflow ${workflowName}`}>
      <div className="wcp-head">
        <span className="wcp-title">Preview Workflow - {workflowName} (Draft)</span>
        <button className="wcp-icon" onClick={reset} title="Reset Chat" aria-label="Reset chat">
          <RefreshIcon />
        </button>
        <button className="wcp-icon" onClick={onClose} title="Close" aria-label="Close preview">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#15243e" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      <div className="wcp-view" ref={scrollRef}>
        {messages.map((m, i) => m.role === "assistant" ? (
          <div className="wcp-row wcp-row-host" key={i}>
            <BotAvatar />
            <span className="wcp-bubble wcp-host">{m.content}</span>
          </div>
        ) : (
          <div className="wcp-row wcp-row-guest" key={i}>
            <span className="wcp-bubble wcp-guest">{m.content}</span>
          </div>
        ))}
        {busy && (
          <div className="wcp-row wcp-row-host">
            <BotAvatar />
            <span className="wcp-bubble wcp-host wcp-typing" aria-label="Agent is typing">
              <i /><i /><i />
            </span>
          </div>
        )}
        {error && <div className="wcp-error">{error}</div>}
      </div>

      {restarted && (
        <div className="wcp-restart" role="status">
          <RefreshIcon />
          Agent updated, chat restarted
        </div>
      )}

      <div className="wcp-input">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            /* Enter sends, Shift+Enter is a newline — the widget's behaviour, and
               what anyone typing in a chat box expects. */
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="Type your question"
          rows={1}
        />
        <button className="wcp-send" onClick={() => void send()} disabled={!input.trim() || busy}
          aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 512 512" aria-hidden="true">
            <path fill="currentColor" d="M16.1 260.2a24 24 0 000 43.6L172 376l53.9 116.4a24 24 0 0043.6 0l58-124.9a24.6 24.6 0 000-20.6l-58-124.9-.2-.4L16.1 260.2z" opacity="0" />
            <path fill="currentColor" d="M476.6 227.1 44.9 34.3a24 24 0 00-32.8 28.3l50.2 156.3a16 16 0 0013.2 11l219 30.1-219 30.1a16 16 0 00-13.2 11L12.1 457.4a24 24 0 0032.8 28.3l431.7-192.8a32 32 0 000-58.8z" />
          </svg>
        </button>
      </div>

      <div className="wcp-foot">Last Updated: {lastUpdated}</div>
    </div>
  );
}
