import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* =============================================================================
   Tooltip — what a row control actually does, on hover
   -----------------------------------------------------------------------------
   Asked for 10/7/2026: *"Add tooltips when users hover over the flag, share and
   delete, telling them what they are do"*.

   ⚠️⚠️ **THESE BUTTONS ALREADY HAD `title`, AND THAT IS WHY THE ASK IS FAIR.** A
   native title waits about a second, renders in the OS's own styling, and is
   invisible on touch — so in practice nobody reads one. The `title` attributes are
   REMOVED at each call site rather than left alongside, or a viewer gets this
   tooltip and then the OS one a second later on top of it.

   ⚠️⚠️ **PORTALLED AND `position: fixed`, BECAUSE THE ROW LIVES IN A SCROLL BOX.**
   The demo picker's list is `overflow-y: auto`, so a tooltip positioned inside it
   is CLIPPED at the box's edge — the first and last visible rows are exactly where
   it would be cut, and they are as likely to be hovered as any other. The same
   trap the Create Workflow popup, the sidebar flyout and both Launch panels each
   paid for.

   ⚠️ **ONE MEASUREMENT, ON ENTER — this does NOT need the anchoring machinery the
   mark and share panels had to delete.** Those grew asynchronously (a rep lookup, a
   link list), so they needed a rAF pass and a ResizeObserver. A tooltip's content
   is fixed at the moment it opens, so measuring once is correct and nothing can
   grow out from under it.

   ⚠️ **ACCESSIBILITY IS `aria-describedby`, NOT the visual node.** Every one of
   these controls already carries its own `aria-label`, which is what a screen
   reader announces; this adds the longer description without replacing that name.
   ============================================================================= */

/** How long the pointer must rest before it appears. Long enough that scrolling a
 *  76-row roster does not flash tooltips past you, short enough to feel immediate. */
const DELAY_MS = 350;

export default function Tooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const id = useId();
  const [box, setBox] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);

  const hide = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setBox(null);
  };

  const show = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const b = wrapRef.current?.getBoundingClientRect();
      if (!b) return;
      /* Measured against an estimate first; the effect below corrects it with the
         real width once it has rendered. An 8px gap clears the button's own box. */
      setBox({ top: b.top - 8, left: b.left + b.width / 2, below: false });
    }, DELAY_MS);
  };

  /* ⚠️ Flip below when there is no room above, and pull back inside the viewport
     horizontally — a `position: fixed` tooltip that lands off-screen simply cannot
     be read, and the controls sit at the RIGHT edge of their row. */
  useEffect(() => {
    const el = tipRef.current;
    const b = wrapRef.current?.getBoundingClientRect();
    if (!box || !el || !b) return;
    const r = el.getBoundingClientRect();
    const below = b.top - 8 - r.height < 4;
    const half = r.width / 2;
    const left = Math.min(Math.max(b.left + b.width / 2, half + 8), window.innerWidth - half - 8);
    const top = below ? b.bottom + 8 : b.top - 8;
    if (box.below !== below || Math.abs(box.left - left) > 0.5 || Math.abs(box.top - top) > 0.5) {
      setBox({ top, left, below });
    }
  }, [box]);

  /* Any scroll or resize invalidates the one measurement, so it closes rather than
     drifting away from the control it describes. Capture phase: the list scrolls,
     not the window, and scroll does not bubble. */
  useEffect(() => {
    if (!box) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [box]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return (
    <>
      <span
        ref={wrapRef}
        className="ttp-wrap"
        onPointerEnter={(e) => { if (e.pointerType !== "touch") show(); }}
        onPointerLeave={hide}
        /* ⚠️ Hidden on press: the click is already happening, so holding a label
           over the thing you just pressed only gets in the way. */
        onPointerDown={hide}
        onFocus={show}
        onBlur={hide}
      >
        {/* `aria-describedby` only once it is on screen, or it points at nothing. */}
        <span aria-describedby={box ? id : undefined} style={{ display: "contents" }}>{children}</span>
      </span>
      {box && createPortal(
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className={"ttp" + (box.below ? " ttp--below" : "")}
          style={{ top: box.top, left: box.left }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}
