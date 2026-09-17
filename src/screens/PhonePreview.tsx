import { useEffect, useRef, useState, useMemo } from "react";
import { useProfile } from "../data/ProfileContext";
import { useSmsCapture } from "../data/SmsCaptureContext";
import { usePageData } from "../components/GeneratedTiles";
import { useAiAssistant } from "../data/AiAssistantContext";
import { buildSmsBrain, resolveGreeting, smsWorkflowScopePath, SMS_WORKFLOW_SCOPE_PATH, type SmsWorkflowAgent } from "../data/smsBrain";
import { tollFreeNumber } from "../data/smsContactNumber";
import { smsWorkflowFlow } from "../data/workflowDrawers";
import { smsConfigFor, type SmsConfig } from "../data/smsTemplate";
import { QUESTIONS_PATH } from "../data/questionImport";
import type { SmsConversation, SmsTurn } from "../data/schema";
import { useAutoGrow } from "../data/useAutoGrow";
import { useExtraWorkflows, quoteForWorkflow, lsaLeadMessage } from "../data/quoteWorkflow";
import { useQuoteCaptures } from "../data/QuoteCaptureContext";

/* iPhone "Preview Agent" chat — modern iOS (dark mode) Messages mockup. The SE
   role-plays a customer texting in; the SMS agent replies live via /api/chat
   (fast Haiku model) using the profile's agent brain. Agent opens with a
   greeting, qualifies, then confirms a day/time by text.

   On close, the just-had chat is captured and prepended (via SmsCaptureContext)
   to the AI SMS Conversation Intelligence report — the demo's headline move. */

interface Msg { role: "user" | "assistant"; content: string; }



/* ---- capture helpers (client-side; Date/Math.random are fine here) -------- */
const HEX = "0123456789ABCDEF";
function hex(n: number): string { return Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join(""); }
function genId(): string { return `${hex(4)}-${hex(12)}`; }
function clock(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; }
function listTime(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${h}:${String(m).padStart(2, "0")} ${ap}`; }
function startTime(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${h}:${String(m).padStart(2, "0")} ${ap}`; }
function longDate(d: Date): string { return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }

/* Best-effort pull of a customer name from what they typed. */
function extractName(messages: Msg[]): { first: string; last: string; display: string } {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const match = m.content.match(/(?:my name is|it'?s|i'?m|this is)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
    if (match) {
      const first = match[1], last = match[2] || "";
      return { first, last, display: last ? `${first[0]} ${last}` : first };
    }
  }
  return { first: "—", last: "—", display: "SMS Lead" };
}

/* A stable identity for one preview session, so progressive upserts keep updating
   the SAME captured conversation record instead of piling up new ones. */
interface ConvBase { id: string; now: Date; callerId: string }
function newConvBase(): ConvBase {
  return { id: genId(), now: new Date(), callerId: `805-555-${String(1000 + Math.floor(Math.random() * 9000)).slice(0, 4)}` };
}

/* ⚠️⚠️ **`leadIn` IS IN THE REPORT AND NEVER ON THE PHONE, which is the whole point of passing
   it here rather than seeding it into `messages`.** Google's LSA lead payload arrives on the
   business's inbound channel, so the Interactions report shows it as the consumer's first
   message — but the consumer never sees it, and putting a notification about themselves into
   the iPhone mockup would break the one screen that has to stay a believable iMessage thread.
   The phone renders `messages`; the capture renders this in front of them. See
   `lsaLeadMessage`. */
function buildConversation(messages: Msg[], base: ConvBase, leadIn?: string): SmsConversation {
  const { id, now, callerId } = base;
  const turns: SmsTurn[] = messages.map((m, i) => ({
    speaker: m.role === "assistant" ? "agent" : "consumer",
    /* +1 when there is a lead-in, so its own timestamp stays the earliest in the thread. */
    time: clock(new Date(now.getTime() + (i + (leadIn ? 1 : 0)) * 60000)),
    text: m.content,
  }));
  const transcript: SmsTurn[] = leadIn
    ? [{ speaker: "consumer", time: clock(now), text: leadIn }, ...turns]
    : turns;
  const nm = extractName(messages);
  return {
    id,
    time: listTime(now),
    active: true,
    date: longDate(now),
    transcript,
    signals: [],
    /* ⚠️ The lead-in is only ever built from a submitted quote request, so its presence IS
       the marker — see `SmsConversation.lsa`. Absent (not `false`) otherwise, so a normal
       capture is byte-identical to what it was before this field existed. */
    ...(leadIn ? { lsa: true as const } : {}),
    smsInfo: {
      callRecordId: id,
      smsStartTime: startTime(now),
      destinationPhone: "877-936-2933",
      /* ⚠️ THE TRANSCRIPT'S LENGTH, NOT `messages`' — with an LSA lead-in the two differ, and
         an SMS Info card that disagrees with the transcript beside it is the kind of thing a
         prospect notices before we do. */
      totalMessages: String(transcript.length),
      source: "877-936-2933",
      promoNumberDescription: "SMS",
      smsEngaged: "Yes",
      smsOptIn: "Yes",
      smsOptOut: "No",
      sessionStatus: "Active",
      callerId,
      repeatCaller: "No",
      city: "Santa Barbara",
      region: "CA",
      phoneType: "Mobile",
      displayName: nm.display,
      firstName: nm.first,
      lastName: nm.last,
      gender: "—",
      destinationTimeZone: "Pacific Time (US & Canada)",
      finalCampaign: "Default: SMS Campaign",
      finalCampaignId: "9970305",
    },
  };
}

/* iOS status-bar glyphs (drawn to match the real ones). */
function CellularIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="#fff" aria-hidden="true">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}
function WifiIcon() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="#fff" aria-hidden="true">
      <path d="M8.5 2.1c2.6 0 5 1 6.8 2.7.2.2.2.5 0 .7l-.8.8c-.2.2-.5.2-.7 0A8 8 0 0 0 8.5 4a8 8 0 0 0-5.3 2c-.2.2-.5.2-.7 0l-.8-.8a.5.5 0 0 1 0-.7A9.7 9.7 0 0 1 8.5 2.1z" />
      <path d="M8.5 6c1.5 0 2.9.6 3.9 1.6.2.2.2.5 0 .7l-3.5 3.5a.5.5 0 0 1-.7 0L4.6 8.3a.5.5 0 0 1 0-.7A5.5 5.5 0 0 1 8.5 6z" />
    </svg>
  );
}
function BatteryIcon() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
      <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="#fff" strokeOpacity="0.4" />
      <rect x="2" y="2" width="18.5" height="9" rx="2" fill="#fff" />
      <path d="M24.5 4.2v4.6c.9-.4.9-4.2 0-4.6z" fill="#fff" fillOpacity="0.5" />
    </svg>
  );
}

/* `wf` is the extra-workflow slug from ?wf= (Preview Agent on a nurture
   workflow). When present its systemPrompt REPLACES the default SMS sales
   playbook — that's the whole point of a second SMS agent: same channel, a
   different job. Absent, nothing changes for any other prospect. */
/* The brain reads the EFFECTIVE agent config, not the raw profile: this page
   registers itself as the AI scope, so "ask for the ZIP code first" actually
   changes what the phone asks on the next message rather than being a note in a
   drawer. `title` gives the drawer a real scope label (agentConfig has none). */
function useBrain(wfSlug?: string | null) {
  const { profile, profileId } = useProfile();
  /* Includes any workflow created by an LSA quote request submitted during this demo,
     newest first — one definition, so a slug that lists here also resolves elsewhere. */
  const extraWfs = useExtraWorkflows(profile);
  const { effectiveData } = useAiAssistant();
  const base = useMemo(() => ({
    title: `Preview Agent — what the ${profile.customerName} SMS agent asks`,
    ...(profile.reports.agentConfig ?? {}),
  }), [profile.reports.agentConfig, profile.customerName]);
  /* Opt in to the drawer's question tools. This is the page whose whole purpose is
     what the agent asks, so it is the one place the paste / import / use-case
     controls belong. */
  const wf = wfSlug
    ? extraWfs.find((w) => w.slug === wfSlug)
    : undefined;
  /* ⚠️⚠️ **THE WORKFLOW PAGE'S OWN `agent` HALF, READ BACK ACROSS A TAB BOUNDARY (9/8/2026).**
     Ask AI on an SMS extra workflow page now configures that workflow's opener and its ordered
     flow (see `smsWorkflowAgentOf`), and Preview Agent opens in a SEPARATE TAB. Without this
     read the edit would live in a scope nothing here consults, and the phone would keep
     greeting with the authored line while the drawer reported success — the same cross-surface
     no-op fixed on 9/3, one page over.

     ⚠️ **`effectiveData` REGISTERS NOTHING**, so this cannot repoint this page's own scope (its
     sparkle still edits the agent's questions). Overrides are persisted to localStorage, which
     is what makes a value written in the other tab visible here at all; an UNEDITED workflow
     has no such key, `effectiveData` returns undefined, and `buildSmsBrain` falls back to the
     authored `openingMessage` and `playbookSteps` exactly as before. */
  const wfAgent = wf
    ? ((effectiveData(`${profileId}::${smsWorkflowScopePath(wf.slug)}`) as
        { agent?: SmsWorkflowAgent } | undefined)?.agent ?? null)
    : null;
  /* ⚠️ TELL THE DRAWER WHAT THIS AGENT ACTUALLY OPENS WITH. Without it the drawer falls back
     to a DERIVED default and shows an opening message this workflow never sends — which is
     what let Ask AI report a change to a line nobody would hear. Passed as scope metadata
     rather than folded into `base`, because the agent scope key is shared by every Preview
     Agent regardless of `?wf=` and seeding it would leak this opener into the others.

     ⚠️⚠️ **IT IS THE EFFECTIVE OPENER, NOT THE AUTHORED ONE, AND THE FIRST BUILD OF THIS GOT
     IT WRONG (9/8/2026).** Caught in the browser, not by a type: with the opener edited on the
     workflow page, the phone's first bubble read "Hi Michael, Orlando Health here…" while this
     drawer's OPENING MESSAGE row still showed "Hi Michael, this is Orlando Health…" — the
     drawer displaying a line the agent does not send, which is defect 3 of the 9/3 report
     reappearing through a new door. `wfAgent.greeting` is what `buildSmsBrain` resolves, so it
     is what the row has to show. */
  const ac = usePageData(base, {
    questionPath: QUESTIONS_PATH,
    /**
     * ⚠️⚠️ **ASK AI HERE CAN EDIT THE WORKFLOW ITSELF (9/17/2026), which is the other half of
     * "make the config bi directional".** Its edits land on the workflow's OWN scope, so they
     * redraw the diagram rather than storing a second copy of a question here.
     *
     * ⚠️ **THE TEXT FIELDS ONLY, DELIBERATELY NARROWER THAN THE TREE.** `sms` carries every
     * question, fallback, instruction and intent — so "ask about termites first" reaches the
     * node an SE would have typed it into. `branches` is NOT exposed: handing a second page
     * structural control of the tree means the model can change its DEPTH, and the six-row
     * geometry has no row to draw a seventh in, so nodes would be stored and never rendered —
     * the silent no-op this file keeps recording. Restructuring stays on the workflow page,
     * where the diagram is on screen while you do it.
     * ⚠️ Built-in workflow only: an extra workflow has no `sms` config of its own.
     */
    ...(!wf ? { linkKey: `${profileId}::${SMS_WORKFLOW_SCOPE_PATH}`, linkAs: "workflow" } : {}),
    greetingFallback: wfAgent?.greeting ?? wf?.openingMessage,
    /* ⚠️ An LSA quote workflow's opener beats a stored greeting on the phone, so it has to
       beat it in the drawer's row too — see `Scope.greetingWins`. */
    greetingWins: !!wf?.openingMessageWins,
  });
  /* Shape comes from data/smsBrain.ts, shared with the SMS workflow page's
     "Preview Workflow" chat drawer. Both are previews of ONE agent, so they must
     ask the same questions in the same order; two local copies of this object
     would drift on the first edit. What differs is only HOW each screen obtains
     the config — this one registers an AI scope (it is the page whose drawer edits
     the questions), the workflow drawer must not. See smsBrain.ts. */
  /**
   * ⚠️⚠️ **THE BUILT-IN WORKFLOW'S OWN CONFIG, READ THE SAME CROSS-PAGE WAY `wfAgent` IS
   * (9/17/2026).** Asked for directly: "if there are changes in the workflow, it also changes it
   * in actual preview agent or preview workflow." The mechanism was already here — this page has
   * read an EXTRA workflow's scope since 9/8 — and the built-in one simply was not being read,
   * so the whole six-row template was invisible to the phone.
   *
   * ⚠️ `effectiveData` REGISTERS NOTHING, so this cannot repoint this page's own scope; the
   * sparkle here still edits the agent's own fields. An unedited workflow has no override key
   * and this resolves to the template's base, which is what makes an edit — from Ask AI or from
   * a drawer — take effect the moment it lands, in either direction.
   * ⚠️ ONLY FOR THE BUILT-IN WORKFLOW (`!wf`): an extra workflow states its own flow in
   * `systemPrompt`/`playbookSteps`, and sending both would be two flows for one conversation.
   */
  const wfTree = !wf
    ? (effectiveData(`${profileId}::${SMS_WORKFLOW_SCOPE_PATH}`) as
        { branches?: unknown[]; sms?: unknown } | undefined)
    : undefined;
  const flow = useMemo(() => {
    if (!wfTree?.branches?.length) return null;
    const cfg = { ...smsConfigFor(profile), ...((wfTree.sms as object) ?? {}) } as SmsConfig;
    try {
      return smsWorkflowFlow(profile, wfTree as never, cfg);
    } catch {
      /* ⚠️ A STORED TREE FROM AN OLDER SHAPE MUST NOT TAKE THE PHONE DOWN. The agent falling
         back to its generated flow is a degraded demo; a thrown error inside `useBrain` is a
         blank preview, and this reads a scope another page owns. */
      return null;
    }
  }, [profile, wfTree]);

  return buildSmsBrain(profile, ac, wf, wfAgent, flow);
}

/* mode "modal" = the in-app overlay (legacy); mode "page" = a standalone browser
   tab (the Preview Agent button now opens this). onClose defaults to closing the
   tab (window.close) in page mode. Either way, the chat is captured to the SMS
   Conversation Intelligence report on ANY exit — the close/Done button AND a
   beforeunload guard (so closing the tab directly still saves the transcript). */
export function PhonePreview({ onClose, mode = "modal", wf }: {
  onClose?: () => void; mode?: "modal" | "page"; wf?: string | null;
}) {
  const { profile } = useProfile();
  const { upsertCaptured, patchCaptured } = useSmsCapture();
  const brain = useBrain(wf);
  /* An LSA quote workflow's thread opens with the payload Google posted to the business —
     see `lsaLeadMessage`. Undefined for every other workflow and for the built-in agent, so
     nothing else's capture changes shape.
     ⚠️ THE HOOK IS CALLED UNCONDITIONALLY and the slug is tested afterwards; `wf &&
     quoteForWorkflow(...)` around the hook call would make it conditional, which React
     forbids and which would break the moment the SE opened a different preview. */
  const quotes = useQuoteCaptures().capturedFor(profile.id);
  const quote = wf ? quoteForWorkflow(wf, quotes) : undefined;
  const leadIn = quote ? lsaLeadMessage(quote) : undefined;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(inputRef, input);
  const started = useRef(false);
  const baseRef = useRef<ConvBase | null>(null);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedForCount = useRef(0);
  /* Shown briefly after an AI change restarts the thread, so the chat vanishing
     reads as "it picked up your edit" rather than "it lost my conversation".
     Deliberately OUTSIDE the phone frame: the screen itself has to stay a
     believable iMessage mockup. */
  const [restarted, setRestarted] = useState(false);

  async function ask(history: Msg[]): Promise<string> {
    // Retry transient failures (server 5xx / rate-limit / "overloaded") with a
    // short backoff so a brief Anthropic blip recovers invisibly.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brain, messages: history }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok) return String(data.reply ?? "").replace(/\*\*|__|`/g, "") || "…";
        lastErr = new Error(data?.error || "Chat failed.");
        if (res.status < 500 && res.status !== 429) break;   // non-transient → stop retrying
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error("Network error. Please try again.");
      }
    }
    throw lastErr ?? new Error("Chat failed.");
  }

  /* WHAT THE AGENT ASKS, as a comparable string. The Ask AI drawer edits this
     page's config, and until now the phone kept whatever thread it opened with:
     you changed the questions and the conversation on screen was still running
     the old ones. Comparing a SERIALISED brain (not the object, which is rebuilt
     every render) restarts the conversation exactly when its substance changes and
     never on an unrelated re-render.

     The whole brain, not a hand-picked set of fields: the questions live under
     `playbook`, and my first attempt listed `brain.questions` / `goal` /
     `bookingType`, none of which exist at the top level. Every one read as
     undefined, so the signature was constant and the restart never fired. */
  const brainSig = useMemo(() => JSON.stringify(brain), [brain]);
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    /* First run is the initial open, which the mount effect below already does. */
    if (lastSig.current === null) { lastSig.current = brainSig; return; }
    if (lastSig.current === brainSig) return;
    lastSig.current = brainSig;

    /* A NEW conversation identity, so the chat that already happened stays in the
       SMS report as its own record instead of being overwritten by the restart. */
    baseRef.current = null;
    analyzedForCount.current = 0;
    started.current = false;
    setMessages([]);
    setInput("");
    setError(null);
    setRestarted(true);
    const t = setTimeout(() => setRestarted(false), 3200);
    return () => clearTimeout(t);
  }, [brainSig]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      /* An extra workflow can specify its opening text. Use it verbatim rather
         than asking the model to invent one: a nurture agent's first message is
         the scripted re-engagement line, and it needs to read identically every
         time an SE runs the demo. {name} takes the screenpop caller's first
         name so it's a real person from the rest of the story. */
      if (brain.openingMessage) {
        setMessages([{ role: "assistant", content: resolveGreeting(brain.openingMessage, profile) }]);
        return;
      }
      setBusy(true);
      try {
        setMessages([{ role: "assistant", content: await ask([]) }]);
      } catch (e: any) {
        setError(e?.message || "Couldn't start the conversation.");
      } finally {
        setBusy(false);
      }
    })();
    /* Re-runs after a restart clears `started`, which is what re-issues the
       greeting under the NEW config. */
  }, [messages.length === 0 ? brainSig : "open"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      setMessages([...next, { role: "assistant", content: await ask(next) }]);
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const hasText = input.trim().length > 0;

  /* Progressive capture: as soon as the SE has sent a message, upsert the
     conversation to the SMS report on EVERY turn (transcript appears live in the
     report tab via localStorage + cross-tab sync — no waiting for close), and
     debounce fast signal extraction so signals fill in while the tab is still
     open. Because this happens DURING the chat (not on close), nothing is lost
     when the tab is closed. */
  useEffect(() => {
    if (!messages.some((m) => m.role === "user")) return;
    if (!baseRef.current) baseRef.current = newConvBase();
    const conv = buildConversation(messages, baseRef.current, leadIn);
    upsertCaptured(profile.id, conv);

    if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    analyzeTimer.current = setTimeout(() => {
      if (analyzedForCount.current === messages.length) return; // no new turns since last analyze
      analyzedForCount.current = messages.length;
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: profile.customerName,
          bookingTerm: profile.bookingTerm,
          customerNoun: profile.customerNoun,
          transcript: conv.transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
        }),
      })
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d?.signals) && d.signals.length) patchCaptured(profile.id, conv.id, { signals: d.signals }); })
        .catch(() => { /* leave signals; report shows an analyzing note */ });
    }, 1200);
    return () => { if (analyzeTimer.current) clearTimeout(analyzeTimer.current); };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    if (onClose) onClose();
    else window.close(); // standalone tab (capture already happened progressively)
  }

  const phone = (
    <>
        <button className="phone-close" onClick={handleClose} aria-label="Close"><span className="material-icons">close</span></button>
        <div className="phone">
          <span className="phone-btn phone-btn-action" />
          <span className="phone-btn phone-btn-volup" />
          <span className="phone-btn phone-btn-voldown" />
          <span className="phone-btn phone-btn-power" />
          <div className="phone-screen">
            <div className="phone-island" />
            <div className="phone-statusbar">
              <span className="phone-time">9:41</span>
              <span className="phone-status-icons"><CellularIcon /><WifiIcon /><BatteryIcon /></span>
            </div>

            <div className="sms-header">
              <button className="sms-navbtn sms-back" aria-label="Back"><span className="material-icons">arrow_back_ios_new</span></button>
              <div className="sms-contact">
                <div className="sms-avatar"><span className="material-icons">person</span></div>
                <div className="sms-namepill">{tollFreeNumber(profile.id)}<span className="material-icons">chevron_right</span></div>
              </div>
              <span className="sms-navspacer" aria-hidden="true" />
            </div>

            <div className="sms-thread" ref={scrollRef}>
              <div className="sms-timestamp"><b>Today</b> 9:41 AM</div>
              {messages.map((m, i) => (
                <div key={i} className={"sms-bubble " + (m.role === "user" ? "out" : "in")}>{m.content}</div>
              ))}
              {busy && <div className="sms-bubble in sms-typing"><span></span><span></span><span></span></div>}
              {error && <div className="sms-error">{error}</div>}
            </div>

            <div className="sms-inputbar">
              <button className="sms-plus" aria-label="Attach"><span className="material-icons">add</span></button>
              <div className="sms-field">
                <textarea
                  ref={inputRef}
                  className="sms-input"
                  placeholder="Text Message · SMS"
                  value={input}
                  rows={1}
                  autoFocus
                  onChange={(e) => setInput(e.target.value)}
                  /* An `<input>` had no way to grow at all, so the field can only
                     grow by becoming a textarea — but a real iMessage compose box
                     still sends on plain Return rather than inserting a line
                     break, so Enter is prevented here and forwarded to send(). */
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
                />
                {hasText ? (
                  <button className="sms-send" onClick={send} disabled={busy} aria-label="Send"><span className="material-icons">arrow_upward</span></button>
                ) : (
                  <span className="material-icons sms-mic">mic</span>
                )}
              </div>
            </div>

            <div className="phone-home" />
          </div>
        </div>
        {/* Name the workflow being previewed, not just the customer — with two
            SMS agents "Reyes Law SMS agent" is ambiguous. */}
        <div className="phone-caption">
          {restarted && (
            <span className="phone-restart" role="status">
              <span className="material-icons">autorenew</span>
              Agent updated, conversation restarted
            </span>
          )}
          Live preview — {brain.agentLabel ?? `${profile.customerName} SMS agent`}
        </div>
    </>
  );

  if (mode === "page") {
    return (
      <div className="phone-page">
        <div className="phone-wrap">{phone}</div>
      </div>
    );
  }
  return (
    <div className="phone-overlay" onClick={handleClose}>
      <div className="phone-wrap" onClick={(e) => e.stopPropagation()}>{phone}</div>
    </div>
  );
}
