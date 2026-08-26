import { useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { useVoiceCapture } from "../data/VoiceCaptureContext";
/* ⚠️ BOTH HELPERS ARE IMPORTED FROM THE OLD ENGINE, NOT COPIED. The brain and the
   captured-conversation shape must be IDENTICAL across the two engines, or a call
   captured through LiveKit would look different in the Voice CI report from one
   captured the old way. Same one-definition rule `smsBrain.ts` already enforces. */
import { useBrain, buildVoiceConversation } from "./VoiceCall";
import { useLiveKitVoice } from "../data/liveKitVoice";
import { VoiceCallUI, type VcLine, type VcPhase } from "../components/VoiceCallUI";

/* =============================================================================
   VoiceCallLive — the Voice-agent call, driven by LiveKit
   -----------------------------------------------------------------------------
   The streaming replacement for `VoiceCall.tsx`'s engine. The SCREEN is the same
   component both render (`VoiceCallUI`), so the signed-off call UI has one copy and
   cannot drift between the two.

   Why it exists at all, measured before the switch: the old pipeline waited for the
   WHOLE Haiku reply (1.0-1.2s) and then the WHOLE MP3 (3.0-3.6s) before playing a
   sample, so the agent took about 4.5-6s to say anything. Nothing streamed.

   ⚠️ **THE OLD ENGINE IS STILL THERE AND STILL WORKS.** `VoicePreviewIllustration`
   picks this one only when `/api/livekit-token` answers, so an unconfigured
   environment — or a LiveKit outage mid-demo — falls back rather than failing. Delete
   `VoiceCall.tsx` only once this has been through real demos.

   ⚠️ **THE CAPTURE INTO THE VOICE CI REPORT IS PRESERVED**, because that is the
   demo's headline move: ending a call prepends it to the AI Voice Conversation
   Intelligence report. Same `buildVoiceConversation` + `/api/analyze` path the old
   engine used, so a call captured through LiveKit is indistinguishable in the report.
   ============================================================================= */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function VoiceCallLive({ onEnd }: { onEnd: () => void }) {
  const { profile } = useProfile();
  const { addCaptured, patchCaptured } = useVoiceCapture();
  /* The EFFECTIVE agent config, via the old engine's own hook — so an edit made on the
     Preview Agent page reaches this call exactly as it reached that one. */
  const brain = useBrain();

  const lk = useLiveKitVoice();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef(0);
  const capturedRef = useRef(false);
  const turnsRef = useRef<VcLine[]>([]);

  /* ---- start the call, and tear it down in the SAME effect ----
     ⚠️⚠️ **A `startedRef` GUARD HERE IS A BUG, AND IT COST A DEBUGGING SESSION.** The first
     version skipped the body on the second mount so the call would "only start once".
     StrictMode double-invokes in dev — mount, cleanup, mount — so what actually happened was:
     run 1 connected and started the timer, cleanup cleared that timer AND hung up the room
     mid-connect, and run 2 returned early before creating either again. The screen sat on
     "Connecting…" at 0:00 forever with no error, which reads exactly like a broken network.
     Start and stop belong in ONE effect with no guard: StrictMode then connects, tears down
     and reconnects cleanly, and production mounts once. */
  useEffect(() => {
    void lk.connect({ brain, profileId: profile.id });
    const t = setInterval(() => { elapsedRef.current += 1; setElapsed(elapsedRef.current); }, 1000);
    return () => {
      clearInterval(t);
      captureCall();   // closing the drawer mid-call must still file it in the CI report
      lk.hangUp();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- the transcript, in the shape the UI and the capture both expect ---- */
  const lines: VcLine[] = useMemo(
    () => lk.turns.map((t: { speaker: "agent" | "consumer"; text: string }) => ({ role: t.speaker === "agent" ? "assistant" : "user" as const, content: t.text })),
    [lk.turns],
  );
  turnsRef.current = lines;

  /* Keep the captions pinned to the newest line, as the old engine did. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, lk.phase]);

  /* ⚠️ THE METER IS WRITTEN AS A CSS VARIABLE ON AN ANIMATION FRAME, NEVER AS STATE.
     A 60fps level in React state re-renders the whole call screen sixty times a second
     and the pulse ring stutters — the old engine's `--vc-level` decision, kept. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = meterRef.current;
      if (el) el.style.setProperty("--vc-level", String(lk.levelRef.current ?? 0));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lk.levelRef]);

  /* ---- capture into the Voice CI report, at most once ---- */
  function captureCall() {
    if (capturedRef.current) return;
    const msgs = turnsRef.current;
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
      .catch(() => { /* leave signals empty; the report shows an analyzing note */ });
  }

  function endCall() {
    captureCall();
    /* Immediate: the SE pressed End, so there is no remount coming and the agent must stop
       talking now. The effect cleanup below deliberately does NOT pass this — that one has
       to leave the grace window open for StrictMode's remount. */
    lk.hangUp(true);
    onEnd();
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    lk.setMuted(m);
  }

  const phase: VcPhase = lk.phase === "idle" ? "connecting" : lk.phase;

  return (
    <VoiceCallUI
      customerName={profile.customerName}
      phase={phase}
      elapsed={mmss(elapsed)}
      muted={muted}
      lines={lines}
      error={lk.error}
      scrollRef={scrollRef}
      meterRef={meterRef}
      /* No keyboard fallback on this engine: a LiveKit call needs a working mic by
         definition, so a "type instead" bar would offer a path that cannot work. */
      canType={false}
      micNote={lk.error ? "Voice service unavailable. End the call and try again." : null}
      onToggleMute={toggleMute}
      onEnd={endCall}
    />
  );
}
