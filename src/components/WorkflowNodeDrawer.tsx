import { useEffect } from "react";
import {
  ACTION_LABEL, ACTION_DESCRIPTION, ACTION_PROMPT, PHONE_PROMPT,
  type NodeDrawer,
} from "../data/workflowDrawers";

/* =============================================================================
   WorkflowNodeDrawer — what a node of the flow diagram opens
   -----------------------------------------------------------------------------
   Three shells behind one component, measured off six captures of the real page, each
   saved with a different drawer open (8/26/2026). **Those captures serialised their emotion
   CSS**, so unlike the call screen every number here is a real computed style.

   ⚠️ **IT IS READ-ONLY, AND THAT IS DELIBERATE.** Every field renders as the real control
   (textarea, input, chip, combobox) and none of them writes anything: Cancel and Apply both
   close. The reason is the standing rule that a replica must not out-feature the product it
   replicates — but the sharper reason is that these drawers configure the AGENT, and an
   Apply that appeared to save while changing nothing is the silent no-op this repo has been
   bitten by five times. Wiring them for real means deciding what each field writes back to
   (`agentConfig`? the tree? a new slice?) and that is its own pass.
   `readOnly` is set on every control so a mid-demo keystroke cannot leave a half-edited box.

   ⚠️ **THE COMBOBOXES ARE NOT `<select>`.** The real ones are MUI comboboxes whose options
   were not captured, so these render the closed control with its measured chevron and do not
   open. A dropdown listing invented options is worse than one that does not open.
   ============================================================================= */

export function WorkflowNodeDrawer({ d, onClose }: { d: NodeDrawer; onClose: () => void }) {
  /* Escape closes, as the real drawer does. */
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="wnd-root" role="dialog" aria-modal="true" aria-label={d.title}>
      <div className="wnd-backdrop" onClick={onClose} />
      <div className="wnd-paper">
        <div className="wnd-head">
          <h2 className="wnd-title">{d.title}</h2>
          <button className="wnd-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="wnd-body">
          {d.kind === "trigger" && (
            <>
              <div className="wnd-strong">{d.summary}</div>
              {/* ⚠️ `#00ACF1`, NOT the `#2666F9` accent every other link on the page uses.
                  Measured, and not something anyone would guess. */}
              <div className="wnd-links">
                <a className="wnd-link" href="#" onClick={(e) => e.preventDefault()}>Go to campaigns</a>
                <span className="wnd-pipe">|</span>
                <a className="wnd-link" href="#" onClick={(e) => e.preventDefault()}>Go to promo numbers</a>
              </div>
            </>
          )}

          {d.kind === "intent" && (
            <>
              {/* Title-case in the DOM, uppercased in CSS — so a screenshot reading of
                  "INTENT NAME" would have baked the wrong string into the markup. */}
              <div className="wnd-eyebrow">Intent Name</div>
              <div className="wnd-value">{d.name}</div>

              <label className="wnd-label">What does this intent look like?</label>
              <textarea className="wnd-ta wnd-ta--tall" readOnly value={d.looksLike} />

              <label className="wnd-label">How would you like to define the conversation rules?</label>
              {(d.rules.length ? d.rules : ["", "", ""]).map((r, i) => (
                <div className="wnd-rulerow" key={i}>
                  <textarea className="wnd-ta wnd-ta--rule" readOnly value={r} placeholder="Enter rule..." />
                  <button className="wnd-del" aria-label="Remove rule" onClick={(e) => e.preventDefault()}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              ))}
              <button className="wnd-add" onClick={(e) => e.preventDefault()}>
                <span className="material-icons">add</span>Add
              </button>
            </>
          )}

          {d.kind === "action" && (
            <>
              <label className="wnd-label">Action</label>
              <div className="wnd-combo"><span>{ACTION_LABEL[d.action]}</span><Chevron /></div>

              <div className="wnd-strong wnd-strong--section">Description</div>
              <p className="wnd-prose">{ACTION_DESCRIPTION[d.action]}</p>

              <label className="wnd-label wnd-label--info">
                {ACTION_PROMPT[d.action]}<InfoDot />
              </label>

              {d.action === "qualify" ? (
                <>
                  <input className="wnd-input" readOnly value={d.question ?? ""} />
                  <label className="wnd-label wnd-label--info">Answers/Segments<InfoDot /></label>
                  {(d.segments ?? []).map((s, i) => (
                    <input className="wnd-input" key={i} readOnly value={s} />
                  ))}
                  <button className="wnd-add" onClick={(e) => e.preventDefault()}>
                    <span className="material-icons">add</span>Add
                  </button>
                  <label className="wnd-label wnd-label--info">
                    If the agent can't determine the answer<InfoDot />
                  </label>
                  <textarea className="wnd-ta" readOnly value={d.fallback ?? ""} />
                </>
              ) : (
                <>
                  {/* ⚠️ ONLY INFORM & ROUTE GETS THE TALL BOX. Measured 230px there, where it
                      holds six numbered routing steps; the escalate capture's is the default
                      height for its two-line instruction. One shared `--tall` made a short
                      instruction sit in a half-empty 230px well. */}
                  <textarea
                    className={"wnd-ta" + (d.action === "inform" ? " wnd-ta--tall" : "")}
                    readOnly value={d.handling ?? ""}
                  />
                  <label className="wnd-label wnd-label--info">
                    {PHONE_PROMPT[d.action]}<InfoDot />
                  </label>
                  <input className="wnd-input" readOnly value={d.phone ?? ""} />

                  <label className="wnd-label wnd-label--info">
                    Signal <span className="wnd-optional">(optional)</span><InfoDot />
                  </label>
                  <div className="wnd-combo wnd-combo--empty"><span>Select a signal...</span><Chevron /></div>

                  <div className="wnd-strong wnd-strong--section">
                    What To Collect <span className="wnd-optional">(optional)</span>
                  </div>
                  <p className="wnd-help">
                    This is primarily used to gather information about an individual and data fields
                    captured can be sent to various systems through integrations or custom webhooks.
                  </p>
                  {(d.collect ?? []).map((f) => (
                    <div key={f.name}>
                      <span className="wnd-chip">
                        {f.name}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                          <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z" />
                        </svg>
                      </span>
                      <p className="wnd-help">{f.help}</p>
                    </div>
                  ))}
                  <label className="wnd-label">Add Info Field</label>
                  <div className="wnd-combo wnd-combo--empty"><span>Select an info field...</span><Chevron /></div>
                </>
              )}
            </>
          )}
        </div>

        {/* ⚠️ ONE button on the trigger drawer and TWO everywhere else — measured, and the
            trigger's is the FILLED one reading "Close", not an outlined Cancel. */}
        <div className="wnd-foot">
          {d.kind === "trigger" ? (
            <button className="wnd-btn wnd-btn--primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button className="wnd-btn wnd-btn--ghost" onClick={onClose}>Cancel</button>
              <button className="wnd-btn wnd-btn--primary" onClick={onClose}>Apply</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="wnd-chev" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

/** The little ⓘ beside most labels on the real drawers. */
function InfoDot() {
  return (
    <svg className="wnd-info" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
    </svg>
  );
}
