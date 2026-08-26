import { useCallback, useEffect, useRef, useState } from "react";
/* ⚠️⚠️ **`livekit-client` IS LOADED ON DEMAND, AND THE MEASUREMENT IS WHY.** Imported at
   the top of this module it put the single bundle from 2,166,613 to 2,661,260 bytes —
   **+124 KB gzipped, 576 -> 700** — carried by every screen in the app, for a library only
   the Voice call ever touches. Leaflet's +43 KB was already a deliberate decision; this is
   three times that.

   Loading it inside `connect()` is safe HERE in a way that code-splitting the app generally
   is not: the service-worker note in CLAUDE.md warns that a cached shell could ask for a
   lazy chunk it never cached, which white-screens a demo. That cannot bite this one — a
   LiveKit call needs the network by definition, so there is no offline case to protect. The
   chunk is fetched by the same click that starts the call.

   Types are imported type-only below; those are erased at build and cost nothing. */
import type {
  LocalAudioTrack, Participant, RemoteTrack, Room, TranscriptionSegment,
} from "livekit-client";

/* =============================================================================
   liveKitVoice.ts — the streaming engine behind the live Voice-agent call
   -----------------------------------------------------------------------------
   Replaces the request/response pipeline `VoiceCall.tsx` used to drive itself:
   browser SpeechRecognition -> POST /api/chat -> POST /api/tts -> play an MP3.
   MEASURED on the dev server before the switch: 1.0-1.2s for the WHOLE Haiku reply,
   then 3.0-3.6s for the WHOLE MP3, then playback — about 4.5-6s of silence before the
   agent spoke, because every stage waited for all of the one before it. Deepgram was
   never the problem; nothing streamed. Here the agent runs server-side (agent/voiceAgent.js)
   and speaks on its first sentence.

   ⚠️ **THIS OWNS THE ENGINE, NOT THE UI.** `VoiceCall.tsx` keeps its avatar, pulse
   rings, timer, captions, mic meter, Mute/Keypad/End controls and the capture into the
   Voice CI report. This hook returns the same three things that component already
   reasons about — a phase, a list of turns, and a 0..1 input level — so the screen did
   not have to be rebuilt around a new vendor.

   ⚠️ **THE PHASE COMES FROM THE AGENT, NOT FROM US.** LiveKit publishes the agent's own
   state on the `lk.agent.state` participant attribute (idle / initializing / listening /
   thinking / speaking). The old code ran its own turn state machine and could disagree
   with what was actually happening; this cannot. Barge-in comes free with it — the agent
   decides it is listening again the moment the caller speaks over it, where the old
   pipeline had to keep `ALLOW_BARGE_IN = false` because it could not interrupt an MP3.

   ⚠️ **A ROOM IS NEVER REUSED.** `/api/livekit-token` mints a fresh room per call because
   LiveKit only dispatches an agent from a token when the room is FIRST created. That is
   the server's job; this hook must therefore ask for a new token on every connect and
   never cache one.
   ============================================================================= */

/** How long to wait for the room before giving up and saying so. */
const CONNECT_TIMEOUT_MS = 12_000;

export type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export interface VoiceTurn {
  speaker: "agent" | "consumer";
  text: string;
}

export interface LiveKitVoice {
  phase: VoicePhase;
  turns: VoiceTurn[];
  /** 0..1 mic input, for the listening meter. Ref-driven in the UI, mirrored here. */
  levelRef: React.RefObject<number>;
  /** Null until something fails; a string the screen can show and fall back on. */
  error: string | null;
  connect: (opts: { brain: unknown; profileId: string; greeting?: string }) => Promise<void>;
  hangUp: () => void;
  setMuted: (muted: boolean) => void;
}

/** Map the agent's own published state onto the phases the screen already renders. */
function phaseOf(state: string | undefined): VoicePhase {
  switch (state) {
    case "listening": return "listening";
    case "thinking": return "thinking";
    case "speaking": return "speaking";
    case "initializing": return "connecting";
    default: return "connecting";
  }
}

export function useLiveKitVoice(): LiveKitVoice {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const levelRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  /* ⚠️ StrictMode double-invokes effects and a demo can be hung up mid-connect, so every
     async continuation checks this before touching state — the same `aliveRef` guard the
     old VoiceCall used, for the same reason. */
  const aliveRef = useRef(true);

  /* Transcription arrives as SEGMENTS that are revised in place until `final`, so turns
     are keyed by segment id rather than appended. Appending each update instead prints
     the caller's sentence four times as it firms up. */
  const segRef = useRef<Map<string, { speaker: "agent" | "consumer"; text: string }>>(new Map());

  const teardown = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      meterRef.current.ctx.close().catch(() => {});
      meterRef.current = null;
    }
    audioElRef.current?.remove();
    audioElRef.current = null;
    roomRef.current?.disconnect().catch(() => {});
    roomRef.current = null;
    levelRef.current = 0;
  }, []);

  useEffect(() => () => { aliveRef.current = false; teardown(); }, [teardown]);

  const hangUp = useCallback(() => {
    teardown();
    setPhase("idle");
  }, [teardown]);

  const setMuted = useCallback((muted: boolean) => {
    roomRef.current?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
  }, []);

  const connect = useCallback<LiveKitVoice["connect"]>(async ({ brain, profileId, greeting }) => {
    aliveRef.current = true;
    setError(null);
    setTurns([]);
    segRef.current.clear();
    setPhase("connecting");

    let cfg: { url: string; token: string };
    try {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain, profileId, greeting }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Token request failed (${res.status}).`);
      cfg = data;
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
      return;
    }
    if (!aliveRef.current) return;

    /* The on-demand load. Awaited before the room is built, so a slow first fetch shows as
       "connecting" rather than as a dead button. */
    const { Room, RoomEvent, Track } = await import("livekit-client");
    if (!aliveRef.current) return;

    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      /* The agent's voice. Attaching to a detached element and appending it is what makes
         it audible; a bare `attach()` that is never in the document plays nothing. */
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach() as HTMLAudioElement;
      el.style.display = "none";
      document.body.appendChild(el);
      audioElRef.current = el;
      el.play().catch(() => {/* autoplay guard — the click that started the call satisfies it */});
    });

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant: Participant) => {
      if (!aliveRef.current || participant.isLocal) return;
      const st = participant.attributes?.["lk.agent.state"];
      if (st) setPhase(phaseOf(st));
    });

    room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant?: Participant) => {
      if (!aliveRef.current) return;
      /* ⚠️ THE SPEAKER IS DECIDED BY WHO PUBLISHED IT, not by guessing from the text.
         `participant.isLocal` is the SE on the mic; anything else is the agent. */
      const speaker: "agent" | "consumer" = participant?.isLocal ? "consumer" : "agent";
      for (const s of segments) segRef.current.set(s.id, { speaker, text: s.text });
      setTurns([...segRef.current.values()].filter((t) => t.text.trim()));
    });

    room.on(RoomEvent.Disconnected, () => {
      if (!aliveRef.current) return;
      setPhase("idle");
    });

    try {
      /* ⚠️ **`room.connect()` RETRIES INTERNALLY AND CAN HANG INDEFINITELY**, which is worse
         than failing: observed in the in-app preview browser, where outbound WebSockets to
         LiveKit are blocked — the screen sat on "Connecting…" forever with no error, and an
         SE would just watch it. A demo needs a fast, visible failure it can fall back from,
         so the connect races a timeout. 12s is generous for a healthy network and short
         enough that nobody is left guessing on a projector. */
      await Promise.race([
        room.connect(cfg.url, cfg.token),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error("Could not reach the voice service. Check the network, or end the call and retry.")),
          CONNECT_TIMEOUT_MS,
        )),
      ]);
      if (!aliveRef.current) { room.disconnect().catch(() => {}); return; }
      await room.localParticipant.setMicrophoneEnabled(true);
      if (!aliveRef.current) { room.disconnect().catch(() => {}); return; }
      startMeter(room, levelRef, meterRef);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
      teardown();
    }
  }, [teardown]);

  return { phase, turns, levelRef, error, connect, hangUp, setMuted };
}

/**
 * Drive the listening meter off the caller's own published track.
 *
 * ⚠️ Kept as Web Audio rather than LiveKit's speaking events: the meter needs a
 * CONTINUOUS 0..1 for the pulse ring, and `isSpeaking` is a boolean. Written to a ref and
 * read by a CSS variable, so a 60fps meter never re-renders the call screen — the same
 * decision the old VoiceCall made and the reason its UI stayed smooth.
 */
function startMeter(
  room: Room,
  levelRef: React.RefObject<number>,
  meterRef: React.RefObject<{ ctx: AudioContext; raf: number } | null>,
) {
  const pub = [...room.localParticipant.audioTrackPublications.values()][0];
  const track = pub?.track as LocalAudioTrack | undefined;
  const stream = track?.mediaStream;
  if (!stream) return;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    levelRef.current = Math.min(1, peak * 1.8);
    if (meterRef.current) meterRef.current.raf = requestAnimationFrame(tick);
  };
  meterRef.current = { ctx, raf: requestAnimationFrame(tick) };
}

/**
 * Is the LiveKit pipeline available in this environment?
 *
 * ⚠️ **ASKED ONCE PER APP LOAD AND CACHED, NOT PER CALL.** The answer cannot change while
 * the tab is open (it is a server config), and probing on every render would fire a request
 * each time the preview drawer opened.
 *
 * ⚠️ **A PROBE, NOT A GUESS.** There is no way to see the server's env from the browser, and
 * a build-time `VITE_` flag would have to be kept in step with the real keys by hand — which
 * is exactly how you end up with a Start Call button that dies mid-demo because someone set
 * the flag and not the secret. This asks the endpoint that would actually mint the token.
 */
let readyCache: Promise<boolean> | null = null;
export function useLiveKitReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    readyCache ??= fetch("/api/livekit-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* No brain: the endpoint answers 400 when it IS configured and 501 when it is not, so
         a 400 is a positive result here. That keeps the probe from minting a real token —
         and therefore from creating a room — just to answer a yes/no question. */
      body: JSON.stringify({}),
    })
      .then((r) => r.status !== 501)
      .catch(() => false);
    readyCache.then((v) => { if (alive) setReady(v); });
    return () => { alive = false; };
  }, []);
  return ready;
}
