/* =============================================================================
   GuidedTour — the first-run walkthrough on a shared demo
   -----------------------------------------------------------------------------
   ⚠️⚠️ **SHARED DEMOS ONLY, AND IT IS MOUNTED BY `ShareApp` RATHER THAN GATED
   INSIDE.** The signed-in app never constructs it, which is the same guarantee the
   rest of share mode relies on: not hidden, not disabled, not there.

   ⚠️⚠️ **IT NEVER BLOCKS THE THING IT IS POINTING AT.** The backdrop is four panels
   with a hole cut for the target, so the highlighted control stays clickable and the
   prospect can wander off mid-tour — which they will. A full-screen scrim with a
   `pointer-events: none` hole is the usual trick and it fails on a scrolled page;
   four real rectangles cannot.

   ⚠️⚠️ **A MISSING TARGET DEGRADES TO A CENTRED CARD, IT DOES NOT HANG.** Selectors
   are the brittle part of any tour: a screen gets restyled and a step points at
   nothing. After `waitMs` the step shows anyway, centred, with its copy intact — so
   the worst case is a tour that reads slightly less well, never one that stops dead
   on somebody's first look at the product.
   ============================================================================= */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { tourStepsFor, type TourStep } from "../data/tourSteps";
import { SHARE_TOKEN } from "../data/shareMode";

/** ⚠️ Per link AND per browser: a second prospect opening the same link gets the
 *  tour, and the same person reopening it does not. */
const seenKey = () => `invoca-demo:tour-seen::${SHARE_TOKEN ?? "none"}`;

export function hasSeenTour(): boolean {
  try { return localStorage.getItem(seenKey()) === "1"; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(seenKey(), "1"); } catch { /* private window */ }
}

/* ⚠️ The scripted SMS conversation is armed by the tour and consumed by the phone.
   A module-level signal rather than a context: the two are on opposite sides of the
   route tree, and threading a provider through every screen to pass one boolean is
   how a shared component ends up knowing about the tour. */
let autoplayArmed = false;
export const armAutoplay = () => { autoplayArmed = true; };
export const takeAutoplay = (): boolean => { const v = autoplayArmed; autoplayArmed = false; return v; };

let autoplayDone = false;
export const markAutoplayDone = () => { autoplayDone = true; };
const takeAutoplayDone = (): boolean => autoplayDone;
const resetAutoplayDone = () => { autoplayDone = false; };

interface Box { top: number; left: number; width: number; height: number }

export function GuidedTour({ onClose }: { onClose: () => void }) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const steps = useRef<TourStep[]>(tourStepsFor(profile)).current;

  const [i, setI] = useState(0);
  /* ⚠️⚠️ **THE CLICK GUARD IS A REF KEYED ON THE STEP, NOT A LOCAL — and a local cost the
     scripted conversation twice.** StrictMode re-runs this effect, and a `let clicked` is
     re-created on each run, so the button was pressed TWICE. The second press consumed an
     already-spent autoplay flag and handed the phone `undefined`, overwriting the armed
     script: the conversation silently never started. A ref keyed on the step index is what
     actually means "this step has already done its click". */
  const clickedStep = useRef<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const step = steps[i];

  const finish = useCallback(() => { markSeen(); onClose(); }, [onClose]);

  /* Navigate, then wait for the target. */
  useEffect(() => {
    if (!step) return;
    setReady(false);
    setBox(null);
    resetAutoplayDone();
    if (step.autoplay) armAutoplay();
    if (step.route && step.route !== pathname) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    if (!step) return;
    let alive = true;
    const started = Date.now();
    const budget = step.waitMs ?? 2500;

    let scrolls = 0;
    const measure = () => {
      if (!alive) return;
      /* ⚠️⚠️ **THE BUDGET IS CHECKED FIRST, AND PUTTING IT LAST HUNG THE TOUR DEAD.** The
         scroll-into-view branch returned before ever reaching the timeout test, so a target
         TALLER THAN THE VIEWPORT — a report's call list, say — could never satisfy
         `top >= 8 && bottom <= innerHeight - 8`, scrolled forever, and `ready` was never
         set. The card simply never appeared, on a prospect's first look at the product. */
      const over = Date.now() - started > budget;
      if (!step.target) { setBox(null); setReady(true); return; }
      const el = document.querySelector<HTMLElement>(step.target);
      if (el) {
        /* ⚠️ A step may ask for the target to be CLICKED — opening the phone preview,
           say. Done once per step, and only after it exists. */
        if (step.click && clickedStep.current !== i) {
          clickedStep.current = i;
          el.click();
          setTimeout(measure, 420);
          return;
        }
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          /* Scroll it into view before measuring again, or the hole lands off screen.
             ⚠️ Only when scrolling could actually help: an element taller than the viewport
             will never fit, and two attempts is plenty for one that would. */
          const fits = r.height <= window.innerHeight - 32;
          const offScreen = r.top < 8 || r.bottom > window.innerHeight - 8;
          if (!over && fits && offScreen && scrolls < 2) {
            scrolls += 1;
            el.scrollIntoView({ block: "center" });
            setTimeout(measure, 220);
            return;
          }
          /* ⚠️ CLAMPED TO THE VIEWPORT. A target taller than the screen is spotlit for the
             part that is actually visible — an unclamped hole puts the card off screen. */
          const top = Math.max(0, r.top);
          const bottom = Math.min(window.innerHeight, r.bottom);
          setBox({ top, left: r.left, width: r.width, height: Math.max(24, bottom - top) });
          setReady(true);
          return;
        }
      }
      if (over) { setBox(null); setReady(true); return; }
      setTimeout(measure, 120);
    };
    const t = setTimeout(measure, step.route ? 260 : 60);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, pathname]);

  /* Keep the hole on the target while the page moves under it. */
  useEffect(() => {
    if (!box || !step?.target) return;
    const sync = () => {
      const el = document.querySelector<HTMLElement>(step.target!);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [box === null, step?.target]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A step that waits on the scripted conversation polls for it rather than guessing. */
  const [autoBusy, setAutoBusy] = useState(false);
  useEffect(() => {
    if (!step?.awaitAutoplay) { setAutoBusy(false); return; }
    setAutoBusy(!takeAutoplayDone());
    const t = setInterval(() => { if (takeAutoplayDone()) { setAutoBusy(false); clearInterval(t); } }, 300);
    /* ⚠️ Bounded. A failed `/api/chat` must not leave Next disabled forever on a
       prospect's screen — after 25s they can carry on regardless. */
    const give = setTimeout(() => { setAutoBusy(false); clearInterval(t); }, 25_000);
    return () => { clearInterval(t); clearTimeout(give); };
  }, [i, step?.awaitAutoplay]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" && ready && !autoBusy) setI((n) => (n + 1 < steps.length ? n + 1 : n));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [finish, ready, autoBusy, steps.length]);

  if (!step || !ready) return null;

  const last = i === steps.length - 1;
  /* ⚠️ The padding is clamped too, not just the box. Measured on the report screens: a
     target already flush to the viewport edge had its ring pushed 8px off, so the
     highlight was cut on a screen where the whole point is that it is pointing at
     something. */
  const pad = 8;
  const hole = box
    ? (() => {
        const top = Math.max(0, box.top - pad);
        const left = Math.max(0, box.left - pad);
        const bottom = Math.min(window.innerHeight, box.top + box.height + pad);
        const right = Math.min(window.innerWidth, box.left + box.width + pad);
        return { top, left, width: Math.max(24, right - left), height: Math.max(24, bottom - top) };
      })()
    : null;

  /* Put the card beside the hole, flipping to whichever side has room. */
  const CARD_W = 380;
  let cardStyle: React.CSSProperties = {};
  if (hole) {
    const below = window.innerHeight - (hole.top + hole.height);
    const top = below > 260 ? hole.top + hole.height + 14 : Math.max(16, hole.top - 250);
    let left = hole.left + hole.width / 2 - CARD_W / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - CARD_W - 16));
    cardStyle = { top, left };
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="false" aria-label={step.title}>
      {hole ? (
        <>
          <div className="tour-shade" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="tour-shade" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-shade" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="tour-shade" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          <div className="tour-ring" style={hole} />
        </>
      ) : (
        <div className="tour-shade tour-shade--all" />
      )}

      <div className={"tour-card" + (hole ? "" : " tour-card--center")} style={cardStyle}>
        <div className="tour-step">Step {i + 1} of {steps.length}</div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        {step.value && (
          <p className="tour-value"><span className="material-icons" aria-hidden="true">check_circle</span>{step.value}</p>
        )}
        <div className="tour-foot">
          <button className="tour-skip" onClick={finish}>Skip the tour</button>
          <div className="tour-nav">
            {i > 0 && <button className="tour-btn tour-btn--ghost" onClick={() => setI(i - 1)}>Back</button>}
            <button className="tour-btn tour-btn--go" disabled={autoBusy}
              onClick={() => (last ? finish() : setI(i + 1))}>
              {autoBusy ? "One moment…" : last ? "Start exploring" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
