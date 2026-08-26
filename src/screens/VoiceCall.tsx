import { useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { useVoiceCapture } from "../data/VoiceCaptureContext";
import { VoiceCallUI } from "../components/VoiceCallUI";
import { useAiAssistant } from "../data/AiAssistantContext";
import { SMS_AGENT_SCOPE_PATH } from "../data/smsBrain";
import { treeToVoicePaths, VOICE_WORKFLOW_SCOPE_PATH } from "../data/voicePaths";
import { voiceSpecFor } from "../data/voiceAgentSpec";
import type { WorkflowTreeModel } from "../components/WorkflowTree";
import type { VoiceConversation, VoiceTurn } from "../data/schema";

/* =============================================================================
   VoiceCall — the live Voice-agent phone-call experience
   -----------------------------------------------------------------------------
   Opened from the Voice workflow's "Preview Workflow" drawer → Start Call. Mirrors
   the SMS Preview Agent, but as a real-time spoken call:

     ears   →  browser SpeechRecognition (STT), live interim results
     brain  →  Claude Haiku via /api/chat with { voice: true } (same playbook)
     mouth  →  premium TTS via /api/tts (Deepgram/ElevenLabs), browser voice fallback
     turn-taking → strictly turn-based. The agent ALWAYS finishes its turn before
                we listen; the caller talking does NOT interrupt it (barge-in is
                off — see ALLOW_BARGE_IN). Web Audio VAD stays on only to drive the
                mic meter while listening.

   Turn state machine: connecting → speaking → listening → thinking → speaking …
   On End Call (or drawer close mid-call), the just-had call is captured and
   PREPENDED to the AI Voice Conversation Intelligence report (via
   VoiceCaptureContext), with signals extracted by /api/analyze — the voice
   sibling of the SMS Preview Agent → SMS report flow. A "type instead" fallback
   keeps it usable when the mic is blocked/unsupported (and lets us verify in the
   preview pane, which has no microphone). */

interface Msg { role: "user" | "assistant"; content: string; }
type Phase = "connecting" | "listening" | "thinking" | "speaking";

/* Voice-agent setting: when false, the caller talking NEVER interrupts the agent
   — it always finishes its turn before we listen. Flip to true to allow talk-over
   (barge-in). */
const ALLOW_BARGE_IN = false;

/* Barge-in tuning (only used when ALLOW_BARGE_IN is true). RMS is on a 0..1 scale
   of the echo-cancelled mic stream, so the agent's own voice is largely removed
   and only the caller trips these. */
const VAD_THRESHOLD = 0.075;  // energy above which the caller is "talking"
const VAD_FRAMES = 4;         // consecutive frames required to trigger barge-in
const METER_MAX = 0.25;       // RMS mapped to a full meter

/* The agent's brain: the same brand rules + Q&A + knowledge + playbook the SMS
   Preview Agent uses, re-skinned per prospect at generation time. */
export function useBrain() {
  const { profile, profileId } = useProfile();
  const { effectiveData, registerBase } = useAiAssistant();

  /* ⚠️⚠️ **THE VOICE CALL USED TO READ THE RAW PROFILE, SO EVERY AI EDIT WAS A SILENT
     NO-OP HERE.** The SMS phone reads the effective config through `usePageData` and the
     SMS workflow drawer through `effectiveData`; this was the one surface of the three
     still reading `profile.reports.agentConfig` directly. An SE who used Ask AI to change
     the agent's rules, greeting or questions got a success message and a call that behaved
     exactly as before — the failure mode this repo keeps re-learning.

     ⚠️ **`effectiveData`, NEVER `usePageData`.** The workflow page has already registered
     its DIAGRAM as the AI scope and `registerScope` is last-write-wins, so calling
     `usePageData` here would silently repoint that page's sparkle from the tree to the
     agent config and kill "add a branch" with no visible cause. Same reason
     `WorkflowChatPreview` uses this pattern.

     ⚠️ The scope is the PREVIEW AGENT page's, because `agentConfig` is one object shared by
     both channels — so an edit made there governs the spoken call too, and the two agents
     cannot disagree about their own rules. */
  const agentKey = `${profileId}::${SMS_AGENT_SCOPE_PATH}`;
  /* `applyEdits` refuses a key with no base, so an SE who starts a call without ever opening
     the Preview Agent tab would make edits that did nothing. This fills the base WITHOUT
     making it the active scope. */
  useEffect(() => { registerBase(agentKey, profile.reports.agentConfig); },
    [agentKey, profile.reports.agentConfig, registerBase]);

  const ac = useMemo(
    () => (effectiveData(agentKey) as typeof profile.reports.agentConfig | undefined)
      ?? profile.reports.agentConfig,
    [effectiveData, agentKey, profile.reports.agentConfig],
  );

  /* ⚠️ THE DIAGRAM IS THE CALL'S LOGIC. Read the workflow page's EFFECTIVE tree — the same
     object its sparkle edits — and hand it to the prompt as routing paths, so an SE who
     adds a branch or changes what a leaf collects hears the agent follow it on the next
     call. Read, never registered: `usePageData` here would repoint that page's own sparkle
     away from the tree, which is the trap `WorkflowChatPreview` documents.

     Absent a tree (a call started somewhere with no diagram) this is empty and the prompt
     falls back to its original hardcoded flow. */
  const treeKey = `${profileId}::${VOICE_WORKFLOW_SCOPE_PATH}`;
  const spec = voiceSpecFor(profile);
  const voicePaths = useMemo(
    () => treeToVoicePaths(effectiveData(treeKey) as WorkflowTreeModel | undefined),
    [effectiveData, treeKey],
  );
  return {
    customerName: profile.customerName,
    industry: profile.industry,
    rules: ac?.brandConversationRules ?? [],
    qaPairs: ac?.aiRecommendations?.find((r) => r.qaPairs?.length)?.qaPairs ?? [],
    knowledge: ac?.knowledgeSources?.map((k) => k.name) ?? [],
    playbook: ac?.smsPlaybook,
    serviceArea: ac?.serviceArea,
    voicePaths,
    /* ⚠️ THE SPEC REACHES THE LIVE CALL, which is the whole point of it. Without these three
       the diagram and the drawers would show this prospect's configuration while the agent on
       the phone used the generic derived flow — the two-surfaces-disagreeing failure this
       repo keeps hitting, in its most visible form: a prospect hears the wrong greeting. */
    serviceZips: spec?.serviceZips,
    outOfAreaScript: spec?.outOfAreaScript,
    voiceGreeting: spec?.greeting,
    voiceRules: spec?.rules,
    /* Per-prospect routing for the voice prompt. Same source the workflow
       diagram uses (voiceRoutingDemo.queues), so the spoken call and the
       diagram name the same teams. Without this the prompt fell back to
       hardcoded retail language and asked every caller, including a hospital's,
       for an order number. */
    voiceRouting: (() => {
      const q = profile.reports.voiceRoutingDemo?.queues ?? [];
      if (!q.length) return undefined;
      const name = (i: number) => q[i]?.name;
      return {
        newQueue: name(0) ?? "the new enquiries team",
        supportQueue: name(1) ?? "the support team",
        generalQueue: name(2),
        bookingTerm: profile.bookingTerm,
        products: profile.reports.marketingDashboard.breakdowns
          .find((b) => /Product Category/i.test(b.title))?.rows.map((x) => x.name),
        who: /patient/i.test(name(1) ?? "") ? "patient"
          : /resident/i.test(name(1) ?? "") ? "resident" : "customer",
      };
    })(),
  };
}

/* Pick the most natural-sounding en-US voice the browser offers. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_)?US/i.test(v.lang) || /^en/i.test(v.lang));
  const pool = en.length ? en : voices;
  const prefer = ["Google US English", "Samantha", "Ava", "Allison", "Serena", "Microsoft Aria", "Microsoft Jenny", "Karen", "Moira"];
  for (const name of prefer) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
    if (hit) return hit;
  }
  return pool[0];
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---- capture helpers (client-side; Date/Math.random are fine here) --------
   Builds the VoiceConversation record captured into the AI Voice Conversation
   Intelligence report when the call ends. Mirrors PhonePreview's SMS capture. */
const HEX = "0123456789ABCDEF";
function hex(n: number): string { return Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join(""); }
function genId(): string { return `${hex(4)}-${hex(12)}`; }
function clock(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; }
function listTime(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${h}:${String(m).padStart(2, "0")} ${ap}`; }
function startTime(d: Date): string { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${h}:${String(m).padStart(2, "0")} ${ap}`; }
function longDate(d: Date): string { return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }

/* Best-effort pull of a caller name from what they said. */
function extractName(messages: Msg[]): { first: string; last: string; display: string } {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const match = m.content.match(/(?:my name is|it'?s|i'?m|this is)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
    if (match) {
      const first = match[1], last = match[2] || "";
      return { first, last, display: last ? `${first[0]} ${last}` : first };
    }
  }
  return { first: "—", last: "—", display: "Voice Lead" };
}

export function buildVoiceConversation(messages: Msg[], durationSecs: number): VoiceConversation {
  const now = new Date();
  const id = genId();
  const transcript: VoiceTurn[] = messages.map((m, i) => ({
    speaker: m.role === "assistant" ? "agent" : "consumer",
    time: clock(new Date(now.getTime() + i * 12000)),
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
    voiceInfo: {
      callRecordId: id,
      callStartTime: startTime(now),
      duration: mmss(durationSecs),
      destinationPhone: "877-936-2933",
      source: "805-336-1120",
      promoNumberDescription: "Voice — Paid Search",
      connectionStatus: "Connected",
      callerId: `805-555-${String(1000 + Math.floor(Math.random() * 9000)).slice(0, 4)}`,
      repeatCaller: "No",
      city: "Santa Barbara",
      region: "CA",
      phoneType: "Mobile",
      displayName: nm.display,
      firstName: nm.first,
      lastName: nm.last,
      gender: "—",
      destinationTimeZone: "Pacific Time (US & Canada)",
      finalCampaign: "Default: Voice Campaign",
      finalCampaignId: "9970118",
    },
  };
}

export function VoiceCall({ onEnd }: { onEnd: () => void }) {
  const { profile } = useProfile();
  const { addCaptured, patchCaptured } = useVoiceCapture();
  const brain = useBrain();

  const [phase, setPhase] = useState<Phase>("connecting");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [showType, setShowType] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs — the live call plumbing lives outside React state so async callbacks
  // (STT/TTS/VAD) always see current values and never fight the render cycle.
  const aliveRef = useRef(true);
  const phaseRef = useRef<Phase>("connecting");
  const messagesRef = useRef<Msg[]>([]);
  const mutedRef = useRef(false);
  const micDeniedRef = useRef(false);
  const recogRef = useRef<any>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);   // premium TTS playback
  const rafRef = useRef<number | null>(null);
  const vadCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);           // mirrors `elapsed` for the capture record
  const capturedRef = useRef(false);      // capture the call at most once
  const meterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  /* ---- brain call --------------------------------------------------------- */
  async function ask(history: Msg[]): Promise<string> {
    // Retry transient failures (server 5xx / rate-limit / "overloaded") with a
    // short backoff so a brief Anthropic blip recovers invisibly mid-call.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brain, messages: history, voice: true }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (res.ok) return String(data.reply ?? "").replace(/\*\*|__|`/g, "") || "…";
        lastErr = new Error(data?.error || "Call failed.");
        if (res.status < 500 && res.status !== 429) break;   // non-transient → stop retrying
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error("Network error. Please try again.");
      }
    }
    throw lastErr ?? new Error("Call failed.");
  }

  /* ---- speech recognition (one clean turn at a time) ---------------------- */
  function stopRecognition() {
    const r = recogRef.current;
    if (r) { try { r.onresult = null; r.onend = null; r.onerror = null; r.abort(); } catch { /* ignore */ } }
    recogRef.current = null;
  }

  function startListening() {
    if (!aliveRef.current) return;
    setInterim("");
    if (mutedRef.current || micDeniedRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setUnsupported(true); return; }   // no STT → caller types instead

    stopRecognition();
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = "";

    r.onresult = (e: any) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (aliveRef.current) setInterim((finalText + " " + interimText).trim());
    };
    r.onerror = (e: any) => {
      const err = e?.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        micDeniedRef.current = true; setMicDenied(true);
      }
      // Other errors (no-speech, network, aborted) fall through to onend, which
      // decides whether to keep listening.
    };
    r.onend = () => {
      if (!aliveRef.current) return;
      const said = finalText.trim();
      if (said) { handleUserUtterance(said); return; }
      // Silence with no words: keep the line open unless we've been muted/denied.
      if (phaseRef.current === "listening" && !mutedRef.current && !micDeniedRef.current) {
        setTimeout(() => { if (aliveRef.current && phaseRef.current === "listening") startListening(); }, 250);
      }
    };

    try { r.start(); recogRef.current = r; } catch { /* start races are harmless */ }
  }

  /* ---- text to speech ----------------------------------------------------- */
  // End of a spoken turn → hand the floor back to the caller. A no-op if barge-in
  // or typed input already moved us out of the speaking phase.
  function advanceAfterSpeak() {
    if (aliveRef.current && phaseRef.current === "speaking") { setPhaseBoth("listening"); startListening(); }
  }

  // Stop whatever is currently speaking (premium audio and/or browser voice).
  function stopSpeaking() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    const a = audioRef.current;
    if (a) {
      try {
        a.onended = null; a.onerror = null; a.pause();
        if (a.src) { URL.revokeObjectURL(a.src); a.removeAttribute("src"); }
      } catch { /* ignore */ }
    }
  }

  // Fallback voice — the browser's built-in speech, used only when the premium
  // /api/tts is unavailable (no ELEVENLABS_API_KEY, or an error) so we're never silent.
  function speakBrowser(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) { advanceAfterSpeak(); return; }
    try { synth.cancel(); synth.resume(); } catch { /* ignore */ }
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.03; u.pitch = 1; u.lang = "en-US";
    u.onend = advanceAfterSpeak;
    u.onerror = advanceAfterSpeak;
    try { synth.speak(u); } catch { advanceAfterSpeak(); }
  }

  // Speak a reply with the premium human voice (ElevenLabs via /api/tts), falling
  // back to the browser voice if that's not configured/available.
  async function speak(text: string) {
    if (!aliveRef.current) return;
    setPhaseBoth("speaking");
    setInterim("");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!aliveRef.current || phaseRef.current !== "speaking") return;  // barged/typed mid-fetch
      if (!res.ok) { speakBrowser(text); return; }                       // no key / error → fallback
      const buf = await res.arrayBuffer();
      if (!aliveRef.current || phaseRef.current !== "speaking") return;
      const a = audioRef.current;
      if (!a) { speakBrowser(text); return; }
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      a.onended = () => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } advanceAfterSpeak(); };
      a.onerror = () => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } advanceAfterSpeak(); };
      a.src = url;
      try { await a.play(); }
      catch { try { URL.revokeObjectURL(url); } catch { /* ignore */ } speakBrowser(text); }  // autoplay blocked
    } catch {
      if (aliveRef.current && phaseRef.current === "speaking") speakBrowser(text);
    }
  }

  /* Caller talked over the agent → cut the agent off and listen. */
  function interrupt() {
    if (phaseRef.current !== "speaking") return;
    setPhaseBoth("listening");
    stopSpeaking();
    startListening();
  }

  /* ---- one caller turn → agent reply ------------------------------------- */
  async function handleUserUtterance(text: string) {
    const said = text.trim();
    if (!said || !aliveRef.current) return;
    setPhaseBoth("thinking");               // set first: guards the TTS onend
    stopSpeaking();
    stopRecognition();
    setInterim("");
    setError(null);

    const next = [...messagesRef.current, { role: "user" as const, content: said }];
    messagesRef.current = next;
    setMessages(next);
    try {
      const reply = await ask(next);
      if (!aliveRef.current) return;
      const after = [...next, { role: "assistant" as const, content: reply }];
      messagesRef.current = after;
      setMessages(after);
      speak(reply);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setError(e?.message || "Something went wrong on the call.");
      setPhaseBoth("listening");
      startListening();
    }
  }

  /* ---- mic + voice-activity detection (drives barge-in and the meter) ----- */
  function runVad() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!aliveRef.current) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      // Meter is driven straight through the DOM (no per-frame React renders).
      meterRef.current?.style.setProperty("--vc-level", String(Math.min(1, rms / METER_MAX)));
      // Barge-in (off by default): only cut the agent off if talk-over is enabled.
      if (ALLOW_BARGE_IN && phaseRef.current === "speaking" && !mutedRef.current) {
        if (rms > VAD_THRESHOLD) { vadCountRef.current++; if (vadCountRef.current >= VAD_FRAMES) { vadCountRef.current = 0; interrupt(); } }
        else vadCountRef.current = 0;
      } else vadCountRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function setupMic() {
    if (!navigator.mediaDevices?.getUserMedia) { micDeniedRef.current = true; setMicDenied(true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!aliveRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      micStreamRef.current = stream;
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      try { await ctx.resume(); } catch { /* ignore */ }
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = analyser;
      runVad();
    } catch {
      micDeniedRef.current = true;
      if (aliveRef.current) setMicDenied(true);
    }
  }

  /* ---- lifecycle ---------------------------------------------------------- */
  useEffect(() => {
    aliveRef.current = true;           // reset (StrictMode re-runs this effect)
    phaseRef.current = "connecting";
    messagesRef.current = [];
    capturedRef.current = false;
    elapsedRef.current = 0;
    audioRef.current = new Audio();    // reused for each premium-TTS utterance

    // Load a natural voice for the browser fallback (may arrive asynchronously).
    const synth = window.speechSynthesis;
    if (synth) {
      voiceRef.current = pickVoice(synth.getVoices());
      synth.onvoiceschanged = () => { voiceRef.current = pickVoice(synth.getVoices()); };
    }

    // Call timer.
    timerRef.current = setInterval(() => { if (aliveRef.current) { elapsedRef.current += 1; setElapsed(elapsedRef.current); } }, 1000);

    setupMic();

    // Agent opens the call.
    (async () => {
      try {
        const reply = await ask([]);
        if (!aliveRef.current) return;
        const after = [{ role: "assistant" as const, content: reply }];
        messagesRef.current = after;
        setMessages(after);
        speak(reply);
      } catch (e: any) {
        if (!aliveRef.current) return;
        setError(e?.message || "Couldn't start the call.");
        setPhaseBoth("listening");
        startListening();
      }
    })();

    return () => {
      captureCall();   // capture on drawer close mid-call (guarded; no-op if already captured or empty)
      aliveRef.current = false;
      stopSpeaking();
      try { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; } catch { /* ignore */ }
      stopRecognition();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => { /* ignore */ });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim, phase]);

  /* ---- controls ----------------------------------------------------------- */
  function toggleMute() {
    const m = !mutedRef.current;
    mutedRef.current = m; setMuted(m);
    if (m) stopRecognition();
    else if (phaseRef.current === "listening") startListening();
  }

  /* Capture the finished call into the AI Voice Conversation Intelligence report:
     prepend the transcript + call info, then extract signals via /api/analyze.
     Guarded so a call is logged at most once (End Call and unmount both call it). */
  function captureCall() {
    if (capturedRef.current) return;
    const msgs = messagesRef.current;
    if (!msgs.some((m) => m.role === "user")) return;   // nothing real happened
    capturedRef.current = true;
    const conv = buildVoiceConversation(msgs, elapsedRef.current);
    addCaptured(profile.id, conv);
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: profile.customerName,
        bookingTerm: profile.bookingTerm,
        customerNoun: profile.customerNoun,
        channel: "voice",
        transcript: conv.transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.signals) && d.signals.length) patchCaptured(profile.id, conv.id, { signals: d.signals }); })
      .catch(() => { /* leave signals empty; report shows an analyzing note */ });
  }

  function endCall() {
    captureCall();
    aliveRef.current = false;
    stopSpeaking();
    stopRecognition();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => { /* ignore */ });
    onEnd();
  }

  function submitTyped() {
    const t = typed.trim();
    if (!t || phaseRef.current === "thinking") return;
    setTyped("");
    handleUserUtterance(t);   // also cancels any in-flight TTS (barge-in by text)
  }

  /* ⚠️ NO STATUS LINE ANY MORE. `statusText` ("Connecting… / Speaking… / Listening…") drove
     the old phone-screen header, and the real drawer has no such line — so it went with the
     markup rather than being left computing a string nobody renders. The visualiser now
     carries that information: dots at rest, bars while the call is live. */
  const micNote = (micDenied || unsupported)
    ? `${unsupported ? "Live voice needs Chrome." : "Microphone unavailable."} Type below to talk to the agent.`
    : null;

  const canType = micDenied || unsupported || showType;

  /* ⚠️ THE INLINE COPY OF THE CALL SCREEN IS GONE (8/26/2026). It existed because this file
     was carrying live demos and the duplication was scheduled for deletion with it; that
     stopped being the right trade the moment the screen was REDESIGNED, since this engine is
     the FALLBACK and therefore what the live site serves until LiveKit is deployed. Leaving
     the old markup here would have shipped the new drawer to nobody. */
  return (
    <VoiceCallUI
      customerName={profile.customerName}
      phase={phase}
      elapsed={mmss(elapsed)}
      muted={muted}
      lines={messages.map((m) => ({ role: m.role, content: m.content }))}
      interim={phase === "listening" ? interim : ""}
      error={error}
      scrollRef={scrollRef}
      meterRef={meterRef}
      canType={canType}
      showTypeToggle={showType}
      typed={typed}
      onTyped={setTyped}
      onSubmitTyped={submitTyped}
      onToggleType={() => setShowType((v) => !v)}
      micNote={micNote}
      controlsDisabled={micDenied || unsupported}
      onToggleMute={toggleMute}
      onEnd={endCall}
    />
  );
}
