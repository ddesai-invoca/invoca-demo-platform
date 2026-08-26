import { useEffect, useRef, useState, type RefObject } from "react";
import { VoiceAgentGlyph, MicGlyph, ChevronGlyph, EndCallGlyph } from "./VoiceGlyphs";

/* =============================================================================
   VoiceCallUI — the live call inside the Preview Workflow drawer
   -----------------------------------------------------------------------------
   REBUILT 8/26/2026 against a SingleFile capture of the real drawer saved MID-CALL
   ("Agent Management | Invoca for Healthcare 2.0"). It is a TRANSCRIPT, not a phone
   screen: the avatar, the pulse rings, the name block, the status line and the call
   timer are all gone, because the real drawer has none of them.

   ⚠️ **WHAT IS EXACT AND WHAT IS NOT.** The capture's emotion CSS did not serialise, so:
     • EXACT — the row structure (agent = glyph + BARE text, caller = a bubble and no
       glyph), the four glyphs, the 500px panel, the `<hr>` above the controls, the
       9-bar visualiser, the mic-plus-chevron button, an OUTLINED End Call carrying
       MUI's `phone_missed`, and the "Last updated: <date>" line under everything.
     • FROM THE SCREENSHOTS + OUR TOKENS — every colour, size and gap.
   Do not let a later reader mistake the second list for measurements.

   ⚠️ **THE TITLE STAYS "(Draft)" DURING A CALL.** The screenshots show "(Live)" and it
   is tempting to flip it when the call starts — but the capture was taken MID-CALL and
   still reads "(Draft)", so Draft/Live is the WORKFLOW's publish state, not the call's.
   Flipping it on Start Call would invent a behaviour the product does not have.

   ⚠️ **WORDS ARE REVEALED ONE AT A TIME** (asked for 8/26/2026): the agent's line grows
   from the left, the caller's bubble grows on the right. `useWordReveal` clamps to the
   words that have actually ARRIVED, which matters because the two engines feed this very
   differently — LiveKit streams a line in progressively while the old pipeline hands over
   a whole sentence. Clamping makes the same animation correct for both instead of running
   ahead of text that does not exist yet.

   ⚠️ **BOTH ENGINES RENDER THIS ONE COMPONENT NOW.** `VoiceCall.tsx` used to keep its own
   inline copy, justified while nothing was changing. That justification expired here: the
   old engine is the FALLBACK, so it is what the live site serves until LiveKit is
   deployed, and leaving it behind would have shipped the new design to nobody.
   ============================================================================= */

export type VcPhase = "connecting" | "listening" | "thinking" | "speaking";

export interface VcLine {
  role: "user" | "assistant";
  content: string;
}

export interface VoiceCallUIProps {
  customerName: string;
  phase: VcPhase;
  /** Still tracked by the engine for the CI capture; the real drawer shows no timer. */
  elapsed: string;
  muted: boolean;
  lines: VcLine[];
  /** Partial caller speech; rendered as a caller bubble, as the real one does. */
  interim?: string;
  error?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  meterRef: RefObject<HTMLDivElement | null>;
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

/** How fast words appear. Fast enough to feel like speech, slow enough to SEE. */
const WORD_MS = 55;
/** The real visualiser draws nine bars. Counted in the capture, not chosen. */
const VIZ_BARS = 9;

/* ⚠️ COMPUTED ONCE AT MODULE LOAD, not per render. The real drawer shows today's date, and
   re-evaluating it inside the component would make it a new object on every reveal tick.
   (The Signal AI Studio dates are HASHED instead so an SE can rehearse against them; that
   rule is about content a prospect reads on a report, not a widget footer that legitimately
   says today.) */
const LAST_UPDATED = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Reveal the newest line one word at a time.
 *
 * ⚠️ **IT CLAMPS, IT DOES NOT DRIVE.** The counter advances on a timer but the render only
 * ever shows `min(counter, words.length)`, so a line that arrives whole animates and a line
 * that streams in word by word is shown as fast as it arrives — never ahead of it. Getting
 * this backwards (rendering `counter` words of a partial string) prints undefined tails.
 *
 * ⚠️ Only the LAST line animates. Re-animating the whole thread on every new message would
 * replay the entire call each turn.
 */
function useWordReveal(count: number, lastText: string): number {
  const [shown, setShown] = useState(0);
  const idx = useRef(count);
  /* A new line resets the counter; the same line keeps counting up. */
  if (idx.current !== count) { idx.current = count; }
  useEffect(() => { setShown(0); }, [count]);
  useEffect(() => {
    const total = lastText.trim() ? lastText.trim().split(/\s+/).length : 0;
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), WORD_MS);
    return () => clearTimeout(t);
  }, [shown, lastText]);
  return shown;
}

/** The words of `text` up to `n`, or all of them when this is not the animating line. */
function upTo(text: string, n: number | null): string {
  if (n === null) return text;
  const w = text.trim().split(/\s+/);
  return w.slice(0, Math.min(n, w.length)).join(" ");
}

export function VoiceCallUI(p: VoiceCallUIProps) {
  const last = p.lines.length ? p.lines[p.lines.length - 1] : null;
  const shown = useWordReveal(p.lines.length, last?.content ?? "");

  /* The visualiser is BARS while the agent speaks or the caller is being heard, and DOTS
     otherwise — the two states both screenshots show. Level comes through `--vc-level`,
     written on an animation frame by the engine, so this re-renders on phase only. */
  const live = (p.phase === "speaking" || (p.phase === "listening" && !p.muted)) && !p.controlsDisabled;

  return (
    <div className="vc-root">
      <div className="vc-thread" ref={p.scrollRef}>
        {p.lines.map((m, i) => {
          const isLast = i === p.lines.length - 1;
          const text = upTo(m.content, isLast ? shown : null);
          if (m.role === "assistant") {
            return (
              <div className="vc-msg vc-msg--agent" key={i}>
                <span className="vc-msg-ic"><VoiceAgentGlyph /></span>
                <span className="vc-msg-text">{text}</span>
              </div>
            );
          }
          return (
            <div className="vc-msg vc-msg--caller" key={i}>
              <span className="vc-msg-bubble">{text}</span>
            </div>
          );
        })}

        {/* Partial caller speech reads as a caller bubble, not a separate treatment. */}
        {p.interim && (
          <div className="vc-msg vc-msg--caller vc-msg--interim">
            <span className="vc-msg-bubble">{p.interim}</span>
          </div>
        )}

        {p.phase === "thinking" && (
          <div className="vc-msg vc-msg--agent">
            <span className="vc-msg-ic"><VoiceAgentGlyph /></span>
            <span className="vc-msg-text vc-thinking"><span /><span /><span /></span>
          </div>
        )}

        {p.error && <div className="vc-callerror">{p.error}</div>}
      </div>

      {p.canType && (
        <div className="vc-typebar">
          <input
            className="vc-typeinput"
            placeholder="Type what you'd say…"
            value={p.typed ?? ""}
            onChange={(e) => p.onTyped?.(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") p.onSubmitTyped?.(); }}
          />
          <button className="vc-typesend" onClick={() => p.onSubmitTyped?.()} aria-label="Send">
            <span className="material-icons">arrow_upward</span>
          </button>
        </div>
      )}

      <hr className="vc-rule" />

      <div className="vc-bar">
        <button
          className={"vc-mic" + (p.muted ? " vc-mic--off" : "")}
          onClick={p.onToggleMute}
          disabled={p.controlsDisabled}
          aria-label={p.muted ? "Unmute" : "Mute"}
        >
          <MicGlyph />
          <ChevronGlyph />
        </button>

        <div className={"vc-viz" + (live ? " is-live" : "")} ref={p.meterRef} aria-hidden="true">
          {Array.from({ length: VIZ_BARS }, (_, i) => <span key={i} data-i={i} />)}
        </div>

        {p.onToggleType && (
          <button
            className={"vc-keypad" + (p.showTypeToggle ? " is-on" : "")}
            onClick={p.onToggleType}
            disabled={p.controlsDisabled}
            aria-label="Type instead"
          >
            <span className="material-icons">keyboard</span>
          </button>
        )}

        <button className="vc-end" onClick={p.onEnd}>
          <EndCallGlyph />
          End Call
        </button>
      </div>

      {p.micNote && <div className="vc-micnote">{p.micNote}</div>}

      {/* ⚠️ IT APPEARS DURING THE CALL ONLY. Every live screenshot carries it and the
          empty state does not, so it belongs here rather than on the drawer.
          ⚠️ "Last updated" with a lower-case u, and the MEDIUM date form ("Aug 26, 2026")
          — the SMS drawer's footer says "Last Updated:" with a slashed date, which is its
          own capture's wording. Two different widgets, two measurements; do not unify them. */}
      <div className="vc-updated">Last updated: {LAST_UPDATED}</div>
    </div>
  );
}
