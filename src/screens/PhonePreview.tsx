import { useEffect, useRef, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { useSmsCapture } from "../data/SmsCaptureContext";
import type { SmsConversation, SmsTurn } from "../data/schema";

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

function buildConversation(messages: Msg[], base: ConvBase): SmsConversation {
  const { id, now, callerId } = base;
  const transcript: SmsTurn[] = messages.map((m, i) => ({
    speaker: m.role === "assistant" ? "agent" : "consumer",
    time: clock(new Date(now.getTime() + i * 60000)),
    text: m.content,
  }));
  const nm = extractName(messages);
  return {
    id,
    time: listTime(now),
    active: true,
    date: longDate(now),
    transcript,
    signals: [],
    smsInfo: {
      callRecordId: id,
      smsStartTime: startTime(now),
      destinationPhone: "877-936-2933",
      totalMessages: String(messages.length),
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

function useBrain() {
  const { profile } = useProfile();
  const ac = profile.reports.agentConfig;
  return {
    customerName: profile.customerName,
    industry: profile.industry,
    rules: ac?.brandConversationRules ?? [],
    qaPairs: ac?.aiRecommendations?.find((r) => r.qaPairs?.length)?.qaPairs ?? [],
    knowledge: ac?.knowledgeSources?.map((k) => k.name) ?? [],
    playbook: ac?.smsPlaybook,
  };
}

/* mode "modal" = the in-app overlay (legacy); mode "page" = a standalone browser
   tab (the Preview Agent button now opens this). onClose defaults to closing the
   tab (window.close) in page mode. Either way, the chat is captured to the SMS
   Conversation Intelligence report on ANY exit — the close/Done button AND a
   beforeunload guard (so closing the tab directly still saves the transcript). */
export function PhonePreview({ onClose, mode = "modal" }: { onClose?: () => void; mode?: "modal" | "page" }) {
  const { profile } = useProfile();
  const { upsertCaptured, patchCaptured } = useSmsCapture();
  const brain = useBrain();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const baseRef = useRef<ConvBase | null>(null);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedForCount = useRef(0);

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

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      setBusy(true);
      try {
        setMessages([{ role: "assistant", content: await ask([]) }]);
      } catch (e: any) {
        setError(e?.message || "Couldn't start the conversation.");
      } finally {
        setBusy(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const conv = buildConversation(messages, baseRef.current);
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
                <div className="sms-namepill">{profile.customerName}<span className="material-icons">chevron_right</span></div>
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
                <input
                  className="sms-input"
                  placeholder="Text Message · SMS"
                  value={input}
                  autoFocus
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
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
        <div className="phone-caption">Live preview — {profile.customerName} SMS agent</div>
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
