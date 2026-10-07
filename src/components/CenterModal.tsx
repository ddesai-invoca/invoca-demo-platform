import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* =============================================================================
   CenterModal — a centred dialog over a backdrop, shared by the two Launch-row
   panels (mark a demo, share a demo)
   -----------------------------------------------------------------------------
   Asked for 10/7/2026: *"for both demo mark box and share demo box, lets just do
   it as a modal in the center of the page, and make them both bigger … and also
   put a 'x' on the top right to close it out"*.

   ⚠️⚠️ **THIS REPLACES ~60 LINES OF ANCHORING IN EACH COMPONENT, AND THAT IS THE
   REAL WIN.** Both panels were `position: fixed` popovers anchored to their
   trigger, which meant: measuring the trigger, flipping above it when there was no
   room below, a rAF pass because the height is unknown until it renders, a
   ResizeObserver because the panel GROWS when a rep lookup or a link list arrives,
   and a scroll listener in the capture phase because the row's own container
   scrolls. Each of those existed to fix a real bug — a panel hanging off the
   bottom of the viewport is unreachable, since fixed elements do not scroll. A
   CENTRED modal cannot have that bug at all: there is no anchor, so there is
   nothing to fall off. The whole class of defect goes away rather than being
   defended against.

   ⚠️⚠️ **`data-picker-safe` IS ON THE BACKDROP AND IT IS LOAD-BEARING.** The Launch
   library dropdown closes on any capture-phase mousedown outside itself, and this
   backdrop covers the entire screen — so without it, a click anywhere on the
   backdrop would close the dropdown, UNMOUNT the row, and take this modal (rendered
   by a component inside that row) with it. The share panel already paid for this
   once: its Create-link button did nothing because the row unmounted on the
   pointerdown that was pressing it. See the note in LibraryPicker.
   ============================================================================= */
export default function CenterModal({
  title,
  onClose,
  width,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  /** Content width. The modal caps itself to the viewport on a short/narrow screen. */
  width: number;
  children: React.ReactNode;
  /** ⚠️ OPT-IN, defaulted absent, so a dialog that does not pass one is rendered
   *  exactly as before — the share dialog's primary button lives INSIDE its form
   *  and must stay there, or the submit stops working. A footer sits OUTSIDE the
   *  scrolling body, so the primary action stays put while long content scrolls. */
  footer?: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  /* ⚠️ Escape closes, and the listener is on `document` rather than the box so it
     works before anything inside has been focused. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="cmd-backdrop"
      data-picker-safe=""
      /* ⚠️ The BACKDROP closes, the box does not — and the test is `e.target ===
         e.currentTarget` rather than "is the target inside the box". A pointerdown
         that starts inside the box and ends on the backdrop (selecting text in the
         note and releasing outside) would otherwise dismiss the modal and throw the
         note away. */
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={boxRef}
        className="cmd-box"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-head">
          <span className="cmd-title">{title}</span>
          <button type="button" className="cmd-x" aria-label="Close" title="Close" onClick={onClose}>
            <span className="material-icons">close</span>
          </button>
        </div>
        <div className="cmd-body">{children}</div>
        {footer && <div className="cmd-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
