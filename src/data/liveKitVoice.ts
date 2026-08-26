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
  LocalAudioTrack, Participant, RemoteTrack, Room, RoomEvent, Track, TranscriptionSegment,
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
  /** `immediate` skips the reuse grace window — the End button, not an unmount. */
  hangUp: (immediate?: boolean) => void;
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

/* =============================================================================
   ⚠️⚠️ ONE LIVE CALL PER APP, HELD AT MODULE SCOPE — AND THIS IS NOT OVER-ENGINEERING.
   -----------------------------------------------------------------------------
   React StrictMode double-invokes effects in dev: mount, cleanup, mount. With the room
   owned by component state that produced **TWO tokens, TWO rooms and TWO agents**, and the
   caller heard both greet at once. The worker log is unambiguous — two job requests 160ms
   apart into `voice-…-t49wv5` and `voice-…-i347td`.

   Neither obvious fix works on its own:
     • a `startedRef` guard skips the second mount, but the FIRST mount's cleanup has already
       torn the connection down, so the call never connects at all (0:00 forever, no error);
     • no guard at all connects twice, which is what shipped and what you heard.

   So the room lives HERE, outside the component, and a cleanup only SCHEDULES teardown.
   A remount inside the grace window cancels it and rebinds to the same room. StrictMode
   therefore gets one room; a real close still tears down 250ms later, which nobody can
   perceive; and the End button tears down immediately.
   ============================================================================= */

interface LiveCall {
  room: Room;
  audioEl: HTMLAudioElement | null;
  meter: { ctx: AudioContext; raf: number } | null;
}

let live: LiveCall | null = null;
let connecting: Promise<LiveCall | null> | null = null;
let pendingTeardown: ReturnType<typeof setTimeout> | null = null;
/** Whichever hook instance is currently bound gets the mic level written into its ref. */
let levelSink: { current: number } | null = null;
/** Transcript segments, revised in place until final. Module-scoped so a remount keeps them. */
const segments = new Map<string, { speaker: "agent" | "consumer"; text: string }>();

/** How long a teardown waits, so a StrictMode remount can cancel it and reuse the room. */
const TEARDOWN_GRACE_MS = 250;

/* ⚠️⚠️ **AN EMPTY ROOM IS THE WORST FAILURE THIS PIPELINE HAS, AND IT USED TO BE SILENT.**
   If no worker is registered, the token still mints, the room is still created and the
   browser still connects perfectly — there is simply nobody in it. The screen sat on
   "Listening…" with a running timer and no error, so the only symptom was that the agent
   never spoke. That is indistinguishable from a broken mic, a bad prompt or a dead network,
   and it cost a round trip to diagnose ("I clicked start call but voice agent isnt
   starting"). So we watch for the agent actually JOINING and say so if it does not. */
const AGENT_JOIN_TIMEOUT_MS = 10_000;
let agentWatch: ReturnType<typeof setTimeout> | null = null;
/** Whichever hook instance is bound receives a watchdog failure. */
let errorSink: ((msg: string) => void) | null = null;

function clearAgentWatch() {
  if (agentWatch) { clearTimeout(agentWatch); agentWatch = null; }
}

function destroyLive() {
  pendingTeardown = null;
  clearAgentWatch();
  errorSink = null;
  const c = live;
  live = null;
  connecting = null;
  levelSink = null;
  if (!c) return;
  if (c.meter) {
    cancelAnimationFrame(c.meter.raf);
    c.meter.ctx.close().catch(() => {});
  }
  c.audioEl?.remove();
  c.room.disconnect().catch(() => {});
}

export function useLiveKitVoice(): LiveKitVoice {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const levelRef = useRef(0);
  /* ⚠️ StrictMode double-invokes and a demo can be hung up mid-connect, so every async
     continuation checks this before touching state — the same guard the old VoiceCall used. */
  const aliveRef = useRef(true);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  /** Point the room's events at THIS instance's state. Called on a fresh connect and on reuse. */
  const bind = useCallback((call: LiveCall, RoomEventNS: typeof RoomEvent, TrackNS: typeof Track) => {
    const { room } = call;
    /* Rebinding, not adding: a StrictMode remount would otherwise stack a second set of
       handlers on the same room and every transcript line would render twice. */
    room.removeAllListeners();
    levelSink = levelRef;
    errorSink = (msg: string) => { if (aliveRef.current) setError(msg); };

    /* The agent joining is what cancels the watchdog. Checked as an EVENT rather than by
       polling, and also checked synchronously below, because on a reused room it may
       already be here. */
    room.on(RoomEventNS.ParticipantConnected, () => clearAgentWatch());

    room.on(RoomEventNS.TrackSubscribed, (track: RemoteTrack) => {
      /* The agent's voice. Attaching to a detached element and never appending it plays
         nothing, so the element goes into the document. */
      if (track.kind !== TrackNS.Kind.Audio) return;
      call.audioEl?.remove();
      const el = track.attach() as HTMLAudioElement;
      el.style.display = "none";
      document.body.appendChild(el);
      call.audioEl = el;
      el.play().catch(() => {/* the click that started the call satisfies autoplay */});
    });

    room.on(RoomEventNS.ParticipantAttributesChanged, (_c: unknown, participant: Participant) => {
      if (!aliveRef.current || participant.isLocal) return;
      const st = participant.attributes?.["lk.agent.state"];
      if (st) setPhase(phaseOf(st));
    });

    room.on(RoomEventNS.TranscriptionReceived, (segs: TranscriptionSegment[], participant?: Participant) => {
      if (!aliveRef.current) return;
      /* ⚠️ THE SPEAKER IS DECIDED BY WHO PUBLISHED IT, never guessed from the text.
         `participant.isLocal` is the SE on the mic; anything else is the agent. */
      const speaker: "agent" | "consumer" = participant?.isLocal ? "consumer" : "agent";
      for (const seg of segs) segments.set(seg.id, { speaker, text: seg.text });
      setTurns([...segments.values()].filter((t) => t.text.trim()));
    });

    room.on(RoomEventNS.Disconnected, () => { if (aliveRef.current) setPhase("idle"); });

    /* Catch up with whatever happened before this instance bound. */
    setTurns([...segments.values()].filter((t) => t.text.trim()));
  }, []);

  const hangUp = useCallback((immediate = false) => {
    setPhase("idle");
    if (immediate) { if (pendingTeardown) clearTimeout(pendingTeardown); destroyLive(); return; }
    if (pendingTeardown) clearTimeout(pendingTeardown);
    pendingTeardown = setTimeout(destroyLive, TEARDOWN_GRACE_MS);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    live?.room.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
  }, []);

  const connect = useCallback<LiveKitVoice["connect"]>(async ({ brain, profileId, greeting }) => {
    aliveRef.current = true;
    setError(null);

    const { Room, RoomEvent, Track } = await import("livekit-client");

    /* A remount inside the grace window: cancel the teardown and reuse the same room, which
       is what stops StrictMode from dispatching a second agent. */
    if (pendingTeardown) { clearTimeout(pendingTeardown); pendingTeardown = null; }
    if (live) { bind(live, RoomEvent, Track); setPhase("listening"); return; }
    if (connecting) {
      const existing = await connecting;
      if (existing && aliveRef.current) { bind(existing, RoomEvent, Track); setPhase("listening"); }
      return;
    }

    segments.clear();
    setTurns([]);
    setPhase("connecting");

    connecting = (async (): Promise<LiveCall | null> => {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain, profileId, greeting }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Token request failed (${res.status}).`);

      const room = new Room({ adaptiveStream: false, dynacast: false });
      const call: LiveCall = { room, audioEl: null, meter: null };
      bind(call, RoomEvent, Track);

      /* ⚠️ `room.connect()` RETRIES INTERNALLY AND CAN HANG INDEFINITELY, which on a
         projector is worse than failing — observed as "Connecting…" forever with no error.
         12s is generous for a healthy network and short enough that nobody is left guessing. */
      await Promise.race([
        room.connect(data.url, data.token),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error("Could not reach the voice service. End the call and try again.")),
          CONNECT_TIMEOUT_MS,
        )),
      ]);
      await room.localParticipant.setMicrophoneEnabled(true);
      call.meter = startMeter(room);
      live = call;

      /* If the agent is already here, nothing to wait for. */
      if (room.remoteParticipants.size === 0) {
        clearAgentWatch();
        agentWatch = setTimeout(() => {
          agentWatch = null;
          if (live?.room.remoteParticipants.size) return;   // it arrived late; fine
          errorSink?.("No voice agent joined this call. The agent worker may not be running — start it with `npm run dev` in the agent folder.");
        }, AGENT_JOIN_TIMEOUT_MS);
      }
      return call;
    })();

    try {
      await connecting;
    } catch (e) {
      connecting = null;
      destroyLive();
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, [bind]);

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
function startMeter(room: Room): { ctx: AudioContext; raf: number } | null {
  const pub = [...room.localParticipant.audioTrackPublications.values()][0];
  const track = pub?.track as LocalAudioTrack | undefined;
  const stream = track?.mediaStream;
  if (!stream) return null;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const handle: { ctx: AudioContext; raf: number } = { ctx, raf: 0 };
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    /* Written into whichever hook instance is currently bound, so a remount keeps the meter
       alive instead of leaving a dead ref behind. */
    if (levelSink) levelSink.current = Math.min(1, peak * 1.8);
    handle.raf = requestAnimationFrame(tick);
  };
  handle.raf = requestAnimationFrame(tick);
  return handle;
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
