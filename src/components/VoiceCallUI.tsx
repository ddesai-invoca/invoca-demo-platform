import type { RefObject } from "react";
import { AgentStudioIcon } from "./nav";

/* =============================================================================
   VoiceCallUI — the call screen, with no engine in it
   -----------------------------------------------------------------------------
   Extracted verbatim from `VoiceCall.tsx` 8/25/2026 for the LiveKit engine
   (`VoiceCallLive.tsx`) to render.

   ⚠️ **THE OLD ENGINE STILL HAS ITS OWN INLINE COPY OF THIS MARKUP, ON PURPOSE.** Pointing
   it here too would mean editing a working file that is carrying live demos tonight, to
   de-duplicate something scheduled for deletion the moment LiveKit is proven. So the
   duplication is real and TEMPORARY, and it is written down rather than left to be
   discovered: **if you change this screen before `VoiceCall.tsx` is deleted, change it in
   both places.**

   ⚠️ **PRESENTATIONAL ONLY — it owns no state and starts nothing.** Every prop is
   supplied by whichever engine is driving. That is what makes it safe to have two
   engines at once while the LiveKit swap is proven.

   ⚠️ **THE MARKUP AND CLASS NAMES ARE UNCHANGED.** Every `.vc-` class, the phase
   modifiers, the avatar/pulse states and the meter's five spans are exactly what the
   original rendered, so the signed-off call screen is byte-identical across both engines.
   ============================================================================= */

export type VcPhase = "connecting" | "listening" | "thinking" | "speaking";

export interface VcLine {
  role: "user" | "assistant";
  content: string;
}

export interface VoiceCallUIProps {
  customerName: string;
  phase: VcPhase;
  elapsed: string;              // already mm:ss — the engine owns the clock
  muted: boolean;
  lines: VcLine[];
  /** Partial caller speech under the transcript; blank when there is none. */
  interim?: string;
  error?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  meterRef: RefObject<HTMLDivElement | null>;
  /* The keyboard fallback. An engine that cannot type (LiveKit needs a mic anyway)
     passes `canType: false` and the bar and its control never render. */
  canType?: boolean;
  showTypeToggle?: boolean;
  typed?: string;
  onTyped?: (v: string) => void;
  onSubmitTyped?: () => void;
  onToggleType?: () => void;
  micNote?: string | null;
  controlsDisabled?: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
}

export function VoiceCallUI(p: VoiceCallUIProps) {
  const statusText =
    p.phase === "connecting" ? "Connecting…" :
    p.phase === "speaking" ? "Speaking…" :
    p.phase === "thinking" ? "Thinking…" :
    p.muted ? "Muted" : "Listening…";

  return (
    <div className="vc-root">
      {/* Caller-facing "call screen" */}
      <div className={"vc-stage vc-stage--" + p.phase}>
        <div className={"vc-avatar" + (p.phase === "speaking" ? " vc-avatar--speaking" : p.phase === "listening" && !p.muted ? " vc-avatar--listening" : "")}>
          <span className="vc-avatar-glyph">{AgentStudioIcon()}</span>
        </div>
        <div className="vc-name">{p.customerName}</div>
        <div className="vc-subname">AI Voice Agent</div>
        <div className="vc-status">
          <span className={"vc-dot vc-dot--" + p.phase} />
          {statusText}
          <span className="vc-timer">{p.elapsed}</span>
        </div>
      </div>

      {/* Live captions / running transcript */}
      <div className="vc-captions" ref={p.scrollRef}>
        {p.lines.map((m, i) => (
          <div key={i} className={"vc-line " + (m.role === "assistant" ? "vc-line--agent" : "vc-line--caller")}>
            <span className="vc-line-who">
              {m.role === "assistant"
                ? <span className="vc-line-glyph">{AgentStudioIcon()}</span>
                : <span className="material-icons vc-line-ic">person</span>}
            </span>
            <span className="vc-line-text">{m.content}</span>
          </div>
        ))}
        {p.phase === "listening" && p.interim && (
          <div className="vc-line vc-line--caller vc-line--interim">
            <span className="vc-line-who"><span className="material-icons vc-line-ic">person</span></span>
            <span className="vc-line-text">{p.interim}</span>
          </div>
        )}
        {p.phase === "thinking" && (
          <div className="vc-line vc-line--agent">
            <span className="vc-line-who"><span className="vc-line-glyph">{AgentStudioIcon()}</span></span>
            <span className="vc-line-text vc-thinking"><span></span><span></span><span></span></span>
          </div>
        )}
        {p.error && <div className="vc-callerror">{p.error}</div>}
      </div>

      {/* Mic activity meter (real, echo-cancelled level) while listening */}
      <div className={"vc-meter" + (p.phase === "listening" && !p.muted && !p.controlsDisabled ? " is-live" : "")} ref={p.meterRef} aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>

      {p.micNote && <div className="vc-micnote">{p.micNote}</div>}

      {p.canType && (
        <div className="vc-typebar">
          <input
            className="vc-typeinput"
            placeholder="Type what you'd say…"
            value={p.typed ?? ""}
            onChange={(e) => p.onTyped?.(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") p.onSubmitTyped?.(); }}
          />
          <button className="vc-typesend" onClick={() => p.onSubmitTyped?.()} aria-label="Send"><span className="material-icons">arrow_upward</span></button>
        </div>
      )}

      {/* Call controls */}
      <div className="vc-controls">
        <button className={"vc-ctl" + (p.muted ? " vc-ctl--on" : "")} onClick={p.onToggleMute} disabled={p.controlsDisabled}>
          <span className="material-icons">{p.muted ? "mic_off" : "mic"}</span>
          <span className="vc-ctl-lbl">{p.muted ? "Unmute" : "Mute"}</span>
        </button>
        {p.onToggleType && (
          <button className={"vc-ctl" + (p.showTypeToggle ? " vc-ctl--on" : "")} onClick={p.onToggleType} disabled={p.controlsDisabled}>
            <span className="material-icons">keyboard</span>
            <span className="vc-ctl-lbl">Keypad</span>
          </button>
        )}
        <button className="vc-ctl vc-ctl--end" onClick={p.onEnd}>
          <span className="material-icons">call_end</span>
          <span className="vc-ctl-lbl">End</span>
        </button>
      </div>
    </div>
  );
}
