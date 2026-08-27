import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* =============================================================================
   CreateWorkflowModal — what "Create Workflow" opens in Agent Studio
   -----------------------------------------------------------------------------
   From a SingleFile capture of the live page (8/27/2026, network 2751,
   `/ai_agents/edit/169/workflow/186`), saved with the modal OPEN — so it serialises in full and
   every value below is a COMPUTED STYLE read off the rendered DOM, not a screenshot reading.
   Kept at `reference/agent-workflow/create-workflow-modal.html`.

   | | measured |
   |---|---|
   | backdrop | `rgba(0,0,0,.5)` |
   | paper | **500 x 422**, white, radius 3, MUI elevation-24 shadow |
   | title | "Create Workflow", Lato **400 20px/28px** `#15243E`, inset 12 |
   | content | padding `0 13.6px`; lede at dy 69, fields at dy 133 and 231 |
   | lede | **400 16px/20px** `#15243E`, wraps to two lines (40 tall) |
   | label | **400 16px/23px** `#15243E` + a small info button |
   | name field | 472.8 x **35**, radius 3, 1px `#E7E9EB`, text 16px, padding `6px 8px` |
   | channel field | 472.8 x **37**, radius **4** |
   | actions | band 60 tall at dy 362, buttons 36 tall, 16px apart, Create 12 from the edge |
   | Cancel | OUTLINED `1px rgba(38,102,249,.5)`, ink `#2666F9`, 14/400, `capitalize` |
   | Create | **disabled on open**: `#E7E9EB` on `#A1A7B2` |

   ⚠️ **THE PAPER DECOMPOSES EXACTLY: 52 title + 310 content + 60 actions = 422.** Worth stating
   because it is how the offsets were checked rather than eyeballed.

   ⚠️ **THE NAME FIELD IS 35 TALL AND THE CHANNEL FIELD IS 37**, and that 2px is real — MUI's
   Autocomplete wraps its input with an extra pixel each side. Reproduced rather than tidied,
   because "tidying" it is how a replica starts drifting from the thing it replicates.

   ⚠️ **NEITHER THE TITLE NOR THE ACTIONS BAND HAS A RULE** (both measured `0px none`). The New
   Dashboard modal DOES carry one under its title, and it also happens to be 500 x 422 — so the
   two are easy to conflate. They are different modals that share a paper size; every other
   value differs (its label is 16/**700**, its field 384 wide and 40 tall).

   ⚠️ **CREATE IS DISABLED UNTIL THE NAME HAS CONTENT.** Measured `disabled` in the capture while
   Channel already held "SMS", so the NAME is the gate. Same shape as `NewDashboardModal`.

   ⚠️ **THE DROPDOWN'S OPEN STATE IS NOT IN THE CAPTURE** (`aria-expanded=false`), so its popup
   geometry is the screenshot plus the combobox values already measured for the tile
   Configuration drawer — options 32px tall at `6px 16px`, 16px/400, paper radius 3 with the MUI
   shadow. Flagged rather than presented as measured. Re-measure from a capture saved with the
   list open if it ever matters.

   ⚠️ **THE TOOLTIP COPY IS VERBATIM from the capture's own `aria-label`s** — Invoca's product
   words, not ours, which is why they read as long as they do.
   ============================================================================= */

/** The channel options, in the capture's own order. */
const CHANNELS = ["SMS", "Voice"] as const;
export type WorkflowChannel = (typeof CHANNELS)[number];

/* Verbatim from the capture's `aria-label` on each info button. */
const TIP_NAME =
  'Give your workflow a descriptive name that reflects its purpose, such as the channel, '
  + 'audience, or use case (e.g., "After-Hours Lead Qualification – Voice").';
const TIP_CHANNEL =
  "The channel this workflow will run on. Voice workflows handle inbound calls, while SMS "
  + "workflows respond to text messages. Each workflow can only be assigned to one channel.";

function InfoTip({ text }: { text: string }) {
  /* The real one is a MUI IconButton whose aria-label carries the copy; `title` gives the same
     text a native tooltip so the words are reachable without building a popper. */
  return (
    <button type="button" className="cwm-tip" aria-label={text} title={text}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
      </svg>
    </button>
  );
}

export function CreateWorkflowModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, channel: WorkflowChannel) => void;
}) {
  const [name, setName] = useState("");
  /* The capture opens with "SMS" already in the field, so it is a default, not a placeholder. */
  const [channel, setChannel] = useState<WorkflowChannel>("SMS");
  const [listOpen, setListOpen] = useState(false);
  /* Where the popup sits, in viewport coordinates. See the portal note below. */
  const [pop, setPop] = useState<{ left: number; top: number; width: number } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /* Reset on each opening: a modal that remembers last time's half-typed name reads as a bug. */
  useEffect(() => {
    if (!open) return;
    setName("");
    setChannel("SMS");
    setListOpen(false);
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  /* Escape closes, matching the Dashboard Configuration drawer. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setListOpen(false); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE, the trap the sidebar flyout and the Insights combobox
     both document: on bubble, the same click that closes the list here would be seen by the
     toggle and reopen it. */
  useEffect(() => {
    if (!listOpen) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      /* ⚠️ THE LIST IS NOT INSIDE `comboRef` ANY MORE — it is portalled to the body. Testing
         only the combo closed the popup on the very pointerdown that was selecting an option,
         so the option's own handler never ran and the channel never changed. */
      if (comboRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setListOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [listOpen]);

  /* ⚠️ **THE POPUP IS PORTALLED TO THE BODY, LIKE MUI'S OWN POPPER, AND IT HAD TO BE.**
     `.cwm-content` is the measured `overflow-y: auto` scroll box, so an absolutely positioned
     list inside it was CLIPPED — "Voice" was cut in half by the content's bottom edge and the
     paper grew a scrollbar. Anchored in viewport coordinates and re-measured on any scroll
     (capture phase: scroll does not bubble, and it is the modal's own content that scrolls,
     not the window) — the same anchoring the sidebar flyout documents. */
  useLayoutEffect(() => {
    if (!listOpen) { setPop(null); return; }
    const place = () => {
      const el = comboRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPop({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [listOpen]);

  if (!open) return null;
  const canCreate = name.trim().length > 0;

  return (
    <div className="cwm-root" role="presentation">
      <div className="cwm-backdrop" onClick={onClose} />
      <div className="cwm-paper" role="dialog" aria-modal="true" aria-labelledby="cwm-title">
        <h2 className="cwm-title" id="cwm-title">Create Workflow</h2>

        <div className="cwm-content">
         <div className="cwm-inner">
          <p className="cwm-lede">
            Create this workflow in order to define how the agent handles conversations.
          </p>

          <div className="cwm-field">
            <label className="cwm-label" htmlFor="cwm-name">
              <span>Workflow Name</span>
              <InfoTip text={TIP_NAME} />
            </label>
            <input
              id="cwm-name"
              ref={nameRef}
              className="cwm-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canCreate) onCreate(name.trim(), channel); }}
            />
          </div>

          <div className="cwm-field">
            <label className="cwm-label" htmlFor="cwm-channel">
              <span>Channel</span>
              <InfoTip text={TIP_CHANNEL} />
            </label>
            <div className="cwm-combo" ref={comboRef}>
              {/* Read-only: the real control is a searchable Autocomplete, but with exactly two
                  options there is nothing to search, and a text field that accepts "Fax" would
                  be a worse lie than one that does not. The clear and caret buttons are the
                  capture's own. */}
              <input
                id="cwm-channel"
                className="cwm-comboinput"
                type="text"
                role="combobox"
                aria-expanded={listOpen}
                readOnly
                value={channel}
                onMouseDown={(e) => { e.preventDefault(); setListOpen((v) => !v); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setListOpen(true); }
                }}
              />
              <span className="cwm-adorn">
                <button type="button" className="cwm-clear" aria-label="Clear" title="Clear"
                  onMouseDown={(e) => { e.preventDefault(); setChannel("SMS"); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                </button>
                <button type="button" className="cwm-caret" aria-label="Open"
                  onMouseDown={(e) => { e.preventDefault(); setListOpen((v) => !v); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
                </button>
              </span>
              {listOpen && pop && createPortal(
                <ul className="cwm-list" role="listbox" ref={listRef}
                  style={{ left: pop.left, top: pop.top, width: pop.width }}>
                  {CHANNELS.map((c) => (
                    <li key={c} role="option" aria-selected={c === channel}
                      className={"cwm-opt" + (c === channel ? " cwm-opt--on" : "")}
                      onMouseDown={(e) => { e.preventDefault(); setChannel(c); setListOpen(false); }}>
                      {c}
                    </li>
                  ))}
                </ul>,
                document.body,
              )}
            </div>
          </div>
         </div>
        </div>

        <div className="cwm-actions">
          <button type="button" className="cwm-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="cwm-create" disabled={!canCreate}
            onClick={() => onCreate(name.trim(), channel)}>Create</button>
        </div>
      </div>
    </div>
  );
}
