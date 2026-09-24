/* =============================================================================
   DemoMarkButton — "I delivered this one", from the library row
   -----------------------------------------------------------------------------
   Asked for by an SE who gave ~25 demos in a day at the Dallas Summit and could
   not afterwards reconstruct who to follow up with. So the design constraint is
   SPEED AT VOLUME, not completeness: one click from the row they are already
   scrolling, no navigation, no required fields.

   ⚠️⚠️ **THE ROW IS THE SURFACE BECAUSE OPENING EACH DEMO TO MARK IT WOULD NOT
   HAPPEN.** Twenty-five demos means twenty-five loads of a heavy profile to click
   one button. The Launch list already groups the Summit roster under its own
   dropdown, which is exactly the set being worked through.

   ⚠️ **EVERY HANDLER STOPS PROPAGATION.** The row itself has an `onClick` that
   OPENS the demo, so a click that reaches it costs a full profile load and throws
   the SE onto a dashboard mid-conference. Verified on the popover too, not only
   the trigger.
   ============================================================================= */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDemoLibrary, type MarkStatus } from "../data/DemoLibraryContext";

const LABEL: Record<MarkStatus, string> = {
  demoed: "Demoed",
  "follow-up": "Follow-up",
  lead: "Lead",
};

const ORDER: MarkStatus[] = ["demoed", "follow-up", "lead"];

export default function DemoMarkButton({ demoId, name }: { demoId: string; name: string }) {
  const { markFor, setMark } = useDemoLibrary();
  const mark = markFor(demoId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* ⚠️ FIXED AND PORTALLED, not absolute inside the row. The library list sits in
     its own scroll box, so a panel positioned inside it is CLIPPED at the box's
     edge — the same trap the Create Workflow channel popup and the sidebar flyout
     both document. Anchored to the trigger's own rect instead. */
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const W = 268;
    /* ⚠️⚠️ IT FLIPS ABOVE THE TRIGGER WHEN THERE IS NO ROOM BELOW, and that
       is not polish. The panel is `position: fixed`, so one hanging past the
       bottom of the viewport cannot be scrolled to at all — and the rows most
       likely to be marked are the LAST ones in a long list, which is exactly
       where that happens. Measured before the fix: 34px off screen on a
       one-row list, and far worse further down the Summit roster.
       The height is unknown until the panel has rendered, so the first pass
       uses a conservative estimate and the rAF pass below re-places it against
       the real box. */
    const h = panelRef.current?.getBoundingClientRect().height ?? 210;
    const below = b.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, b.top - 6 - h);
    setRect({ top, left: Math.max(8, Math.min(b.right - W, window.innerWidth - W - 8)) });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    /* A second pass once the panel has actually rendered, so the flip above
       decides against the real height rather than the estimate. */
    const raf = requestAnimationFrame(place);
    /* Scroll does not bubble, so the listener is on the capture phase — the row's
       own scroll container is what moves, not the window. */
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE. On bubble, a click on the trigger while
     the panel is open closes it here and immediately reopens it in the button's
     own onClick, so the trigger can never dismiss its own panel — a trap this repo
     has already paid for on the Signal flyout and the workflow combobox. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(ev: React.MouseEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    setNote(mark?.note ?? "");
    setOpen((v) => !v);
  }

  async function choose(ev: React.MouseEvent, status: MarkStatus) {
    ev.stopPropagation();
    setOpen(false);
    await setMark(demoId, status, note.trim() || undefined);
  }

  async function clear(ev: React.MouseEvent) {
    ev.stopPropagation();
    setOpen(false);
    await setMark(demoId, null);
  }

  return (
    <>
      <button
        ref={btnRef}
        className={"dmk-btn" + (mark ? ` dmk-btn--on dmk-${mark.status}` : "")}
        title={mark ? `${LABEL[mark.status]} — click to change` : `Mark ${name} as delivered`}
        aria-label={mark ? `${name}: ${LABEL[mark.status]}` : `Mark ${name} as delivered`}
        onClick={toggle}
      >
        <span className="material-icons">{mark ? "flag" : "outlined_flag"}</span>
        {mark && <span className="dmk-btn-label">{LABEL[mark.status]}</span>}
      </button>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          className="dmk-panel"
          /* Read by the Launch library picker's outside-click handler: this
             panel lives on <body>, so without it the dropdown closes on the
             pointerdown that is picking a status. See the note there. */
          data-picker-safe=""
          style={{ top: rect.top, left: rect.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dmk-head">{name}</div>
          <div className="dmk-opts">
            {ORDER.map((s) => (
              <button
                key={s}
                className={"dmk-opt dmk-" + s + (mark?.status === s ? " dmk-opt--on" : "")}
                onClick={(e) => void choose(e, s)}
              >
                {LABEL[s]}
              </button>
            ))}
          </div>
          <input
            className="dmk-note"
            value={note}
            placeholder="Optional — who you met, what they asked for"
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            /* Enter commits the status already on the demo, or Demoed when there
               is none — so a note can be typed and saved without reaching for the
               mouse, which is the whole point at conference pace. */
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(false);
                void setMark(demoId, mark?.status ?? "demoed", note.trim() || undefined);
              }
            }}
          />
          {mark && (
            <button className="dmk-clear" onClick={(e) => void clear(e)}>Remove mark</button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
