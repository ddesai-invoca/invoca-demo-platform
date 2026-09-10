import { useLayoutEffect, type RefObject } from "react";

/* =============================================================================
   useAutoGrow — a textarea that grows with its text, up to its own CSS max-height
   -----------------------------------------------------------------------------
   Two message-composer fields (the Ask AI drawer, the SMS phone preview) stayed
   a fixed one-line height no matter how much was typed, because a bare `rows={1}`
   sets the STARTING height and nothing was ever re-measuring it. `.aiad-input
   textarea` already had `max-height: 120px` in the CSS — the intent was there,
   nothing was driving it.

   ⚠️ CLEAR TO "auto" BEFORE READING `scrollHeight`, THEN SET THE REAL HEIGHT —
   the same trick `WorkflowNodeDrawer.tsx`'s `AutoTa` uses. Reading `scrollHeight`
   with the PREVIOUS pass's height still applied only ever reports that old
   height back (a box can't shrink by measuring itself while pinned open), so a
   deleted line would leave the field stranded tall.

   ⚠️ THE MAX-HEIGHT AND THE SCROLL ARE THE CALLER'S CSS, NOT THIS HOOK'S.
   Setting `el.style.height` past the CSS `max-height` does nothing — the browser
   clamps rendering to it — so the element's own stylesheet rule already caps how
   tall this can grow; this hook only ever has to ask for the CONTENT height and
   let the box do the clamping. The caller's rule needs `overflow-y: auto` (not
   the default `visible`) or text keeps growing past the cap instead of scrolling
   inside it — which is why the fix here is paired with an `overflow-y` edit on
   the two rules, not just a JS change.

   Re-fits on every keystroke because `value` is a dependency and a controlled
   field's `value` changes on every keystroke — no separate input listener needed. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
