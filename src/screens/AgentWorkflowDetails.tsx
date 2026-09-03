import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAiAssistant } from "../data/AiAssistantContext";
import { ZERO_TRIGGER } from "../data/workflowChrome";
import { VOICE_OPTIONS, previewModel, voiceOption } from "../data/voiceOptions";

/* =============================================================================
   The workflow's DETAILS tab — and the one control on it that changes a live call
   -----------------------------------------------------------------------------
   Asked for 9/3/2026: "make the Details page clickable and allow users to change the voice
   of the voice agent." Built from the user's screenshot of the real page (LoadUp, a Voice
   workflow), which gives the sections, their order, the copy and the controls.

   ⚠️ **PROVENANCE: SCREENSHOT, NOT A SingleFile CAPTURE — chosen by the user when offered
   both.** So the CONTENT here is faithful and the geometry is authored: this repo's own rule
   is that screenshot-derived paddings look plausible and measure wrong, and four Salesforce
   screens were rebuilt for exactly that reason. Everything is spaced off the platform's own
   tokens rather than guessed pixel values, and a capture of this tab can be diffed against
   it later the way `create-workflow-modal` was. Same standing as the Create-Tile-with-AI
   drawer, which carries this note too.

   ⚠️ **WHAT IS FUNCTIONAL AND WHAT IS CHROME, stated rather than left to be discovered.**
     - **Agent Voice** — real. Writes `agent.voice`, reaches the call, previews on demand.
     - **Custom Greeting** — real. Writes `agent.greeting`, which was already plumbed to the
       call (`specWithConfig` even keeps the copy inside `rules` in step with it).
     - Channel and the trigger line — DERIVED from the workflow being rendered.
     - Default Business Hours ("Open 24/7"), its Edit link, and the Invoca Custom checkbox —
       CHROME. The screenshot shows them; nothing behind them is captured or modelled, and a
       control that silently does nothing is worse than one that plainly is not wired. They
       are inert and non-interactive rather than dressed up as working.
   ============================================================================= */

/** The line the play button speaks, matching the real page's own preview field. */
const PREVIEW_TEXT = "How can I help you?";

interface Props {
  /** The workflow's scope key, so edits land on the page the SE is looking at. */
  scopeKey: string;
  /** SMS or Voice — the Channel row, and whether a voice can be chosen at all. */
  isSms: boolean;
  /** The effective agent config; absent on a workflow with no agent half. */
  agent?: { voice?: string; greeting?: string };
  /** What fires this workflow, when the workflow authored its own trigger line. */
  triggeredBy?: string;
}

export function AgentWorkflowDetails({ scopeKey, isSms, agent, triggeredBy }: Props) {
  const { applyEdits, readOnly } = useAiAssistant();
  const current = voiceOption(agent?.voice);

  /* ---- the preview ("play") button -------------------------------------------
     ⚠️ ONE AUDIO ELEMENT, HELD IN A REF. A fresh `new Audio()` per click leaves the previous
     one playing, so an SE auditioning four voices hears them overlap. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const preview = useCallback(async (voiceId: string) => {
    setPreviewErr(null);
    audioRef.current?.pause();
    setPlaying(voiceId);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* The DEEPGRAM model id, derived from the same entry that builds the LiveKit string,
           so what an SE hears here is what the call will use. */
        body: JSON.stringify({ text: PREVIEW_TEXT, model: previewModel(voiceId) }),
      });
      if (!res.ok) {
        /* ⚠️ SAY WHY. A dead play button reads as a broken page; the honest answer is usually
           that no Deepgram key is configured on this server (the endpoint answers 501). */
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg?.error || `Preview failed (${res.status}).`);
      }
      const blob = await res.blob();
      const el = new Audio(URL.createObjectURL(blob));
      audioRef.current = el;
      el.onended = () => setPlaying(null);
      el.onerror = () => { setPlaying(null); setPreviewErr("The preview audio could not be played."); };
      await el.play();
    } catch (e) {
      setPlaying(null);
      setPreviewErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* ---- the two real edits ----------------------------------------------------
     Through `applyEdits`, not a bespoke writer: it respects `readOnly` on somebody else's
     demo, pushes an undo step so the page's undo covers a voice change, and runs the same
     editGuard the assistant's edits go through. */
  const write = useCallback((path: string, value: unknown) => {
    applyEdits(scopeKey, [{ path, value: JSON.stringify(value) }]);
  }, [applyEdits, scopeKey]);

  const onPickVoice = (id: string) => {
    write("agent.voice", id);
    /* Audition it immediately — the SE's next question is always "what does it sound like". */
    void preview(id);
  };

  return (
    <div className="wfd-page">
      <section className="wfd-sec">
        <h3 className="wfd-h">Channel</h3>
        <div className="wfd-val">{isSms ? "SMS" : "Voice"}</div>
      </section>

      <section className="wfd-sec">
        <h3 className="wfd-h">
          Default Business Hours
          {/* Inert: the hours editor is not captured, and a link that opens something
              invented is worse than one that does nothing. */}
          <span className="wfd-edit" aria-disabled="true" title="Not part of this demo">Edit</span>
        </h3>
        <div className="wfd-val">Open 24/7</div>
      </section>

      {/* ---- the voice picker: the whole point of this tab -------------------- */}
      {!isSms && (
        <section className="wfd-sec">
          <h3 className="wfd-h">Agent Voice</h3>
          <div className="wfd-voicerow">
            <div className="wfd-field">
              <select
                className="wfd-select"
                value={current.id}
                disabled={readOnly || !agent}
                onChange={(e) => onPickVoice(e.target.value)}
                aria-label="Agent Voice"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <div className="wfd-help">What voice should the agent use?</div>
            </div>

            <div className="wfd-field">
              <div className="wfd-preview">
                {/* Read-only: it labels what the play button says, as the real page does. */}
                <span className="wfd-previewtext">{PREVIEW_TEXT}</span>
                <button
                  className={"wfd-play" + (playing === current.id ? " wfd-play--on" : "")}
                  onClick={() => void preview(current.id)}
                  title={`Hear ${current.label}`}
                  aria-label={`Play a sample of ${current.label}`}
                >
                  <span className="material-icons">{playing === current.id ? "graphic_eq" : "play_arrow"}</span>
                </button>
              </div>
              <div className="wfd-help">
                {current.gender} · {current.note}
              </div>
            </div>
          </div>
          {previewErr && <div className="wfd-err">{previewErr}</div>}
          {!agent && (
            /* A created workflow registers no agent half (see AgentWorkflow's note), so there
               is nothing to write a voice onto. Say so rather than offering a dead control. */
            <div className="wfd-note">
              This workflow has no agent configured yet, so its voice cannot be set here.
            </div>
          )}
          {readOnly && (
            <div className="wfd-note">This demo belongs to someone else, so it is view only.</div>
          )}
        </section>
      )}

      {/* ⚠️⚠️ **ONLY WHERE THERE IS AN AGENT TO WRITE TO, and the first build got this wrong
          in a visible way.** On an SMS workflow the page registers no `agent` half, so this
          rendered as a DISABLED, EMPTY input with no explanation — a dead control, which this
          repo holds to be worse than an absent one. Two further reasons not to fake it there:
          the screenshot this tab was built from is of a VOICE workflow, so an SMS Details tab's
          real contents are unverified; and the SMS agent's opener is `smsPlaybook.greeting` in
          the Preview Agent scope, so writing `agent.greeting` from here would edit a different
          agent from the one the page is about. */}
      {agent && (
      <section className="wfd-sec">
        <h3 className="wfd-h">Custom Greeting</h3>
        <input
          className="wfd-input"
          defaultValue={agent?.greeting ?? ""}
          placeholder="Hi, thanks for calling ..."
          disabled={readOnly || !agent}
          /* ⚠️ ON BLUR, NOT ON CHANGE. `applyEdits` pushes an undo step per call, so writing
             per keystroke would bury the page's undo stack under one entry per letter. */
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== (agent?.greeting ?? "")) write("agent.greeting", next);
          }}
        />
        <div className="wfd-help">
          What should the agent say at the start of the call? Leave blank to use the default greeting.
        </div>
      </section>
      )}

      <section className="wfd-sec">
        <h3 className="wfd-h">Triggered by {triggeredBy || ZERO_TRIGGER}</h3>
        <div className="wfd-links">
          <Link to="/campaigns">Go to campaigns</Link>
          <span className="wfd-sep">|</span>
          <Link to="/promo-numbers">Go to promo numbers</Link>
        </div>
      </section>

      <label className="wfd-check" aria-disabled="true">
        <input type="checkbox" disabled />
        Invoca Custom
      </label>
    </div>
  );
}
