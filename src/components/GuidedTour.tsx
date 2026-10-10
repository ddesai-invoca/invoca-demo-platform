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
import { SHARE_TOKEN, SHARE_LANDING } from "../data/shareMode";

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

/* ⚠️ Whether the tour is on screen right now. Preview Agent reads it: the tour has to
   drive the phone, so only then does the phone open in this page; otherwise it opens in
   its own tab like the signed-in site (asked for 10/9/2026). */
let tourRunning = false;
export const isTourRunning = (): boolean => tourRunning;

let autoplayDone = false;
export const markAutoplayDone = () => { autoplayDone = true; };
const takeAutoplayDone = (): boolean => autoplayDone;
const resetAutoplayDone = () => { autoplayDone = false; };

/* ⚠️⚠️ **A SCREEN ASKS FOR THE TOUR; IT DOES NOT OWN IT.** The big callout lives in the
   Agent Studio page so it can sit in that page's own whitespace and scroll with it, while
   whether the tour is open is `ShareTour`'s state, outside `<Routes>`. A module-level
   subscription is the smallest thing that joins them: threading a provider through every
   screen to pass one callback is how a shared screen ends up knowing about the tour. */
const listeners = new Set<() => void>();
export function onTourRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export const requestTour = (): void => { listeners.forEach((fn) => fn()); };

/**
 * The prominent way in, for the page a prospect lands on.
 *
 * ⚠️ Asked for directly: bigger, and centred in the whitespace under the table, *"so
 * prospects can def see it"*. The small corner pill stays for every OTHER screen, where
 * there is no whitespace to put this in and the tour is not the point of the page.
 */
export function TourCallout() {
  return (
    <div className="tour-cta">
      <span className="material-icons tour-cta-ic" aria-hidden="true">play_circle</span>
      <div className="tour-cta-text">
        <h3>New here? Take the guided tour</h3>
        <p>Two minutes, start to finish. See the voice agent, the SMS agent and the reporting they write themselves.</p>
      </div>
      <button className="tour-cta-btn" onClick={requestTour}>Start the tour</button>
    </div>
  );
}

interface Box { top: number; left: number; width: number; height: number }

export function GuidedTour({ onClose }: { onClose: () => void }) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const steps = useRef<TourStep[]>(tourStepsFor(profile)).current;
  /* Set back to true in the body, not only cleared in the cleanup: StrictMode's simulated
     unmount runs the cleanup and then the effect again. */
  useEffect(() => { tourRunning = true; return () => { tourRunning = false; }; }, []);

  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  /* ⚠️⚠️ **THE CARD AVOIDS THE WHOLE CONTEXT, NOT JUST THE TARGET.** Reported against step
     11: the spotlight was correctly on the compose box at the bottom of the phone and the
     card sat squarely over the phone above it — clear of the ring and covering the
     conversation the step is about. What a prospect is looking at is the PREVIEW, so the
     thing to keep clear is the container the step had to open, not the 85px input inside
     it. `ensure.when` already names that container, so nothing new has to be declared. */
  const [guard, setGuard] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const step = steps[i];

  /**
   * ⚠️⚠️ **FINISHING RETURNS THEM TO THE LANDING PAGE; SKIPPING LEAVES THEM WHERE THEY
   * ARE.** Asked for: "Start exploring" should hand them back to Agent Studio, which is
   * where a prospect can actually begin. Skipping is the opposite intent, and yanking
   * somebody who bailed on step 3 to another screen would be the tour overruling them.
   */
  const finish = useCallback((home = false) => {
    markSeen();
    if (home) navigate(SHARE_LANDING);
    onClose();
  }, [onClose, navigate]);

  /* Navigate, then wait for the target. */
  useEffect(() => {
    if (!step) return;
    setReady(false);
    setBox(null);
    setGuard(null);
    /* ⚠️ The script is armed by `ensure` immediately before the click that consumes it —
       see `measure`. Arming here would spend the flag on a step that reopens an already
       open phone, and the earlier per-step reset was a race a real person hit. */
    if (step.route && step.route !== pathname) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    if (!step) return;
    let alive = true;
    const started = Date.now();
    const budget = step.waitMs ?? 2500;

    let scrolls = 0;
    let ensureTries = 0;
    let dismissTries = 0;
    const measure = () => {
      if (!alive) return;

      /* ⚠️⚠️ **RE-ESTABLISH THE STEP'S PRECONDITION BEFORE MEASURING ANYTHING — this is
         what makes BACK work.** Reported: step 12 -> Back landed on the reports page with
         the card describing a phone that was not there. Two causes, and this is the second:
         returning to the SMS workflow REMOUNTS it with the phone closed, so a step that had
         merely clicked its own target on the way forward had nothing to point at coming
         back. `when` is the idempotent guard — arriving with the phone already open clicks
         nothing, so going 9 -> 10 -> 11 opens it once. */
      /* ⚠️ The mirror of `ensure`, and it runs first: a step reached backwards from one
         that opened something must be able to send it away again. */
      if (step.dismiss && document.querySelector(step.dismiss.when) && dismissTries < 2) {
        const closer = document.querySelector<HTMLElement>(step.dismiss.close);
        if (closer) { dismissTries += 1; closer.click(); setTimeout(measure, 320); return; }
      }
      if (step.ensure && !document.querySelector(step.ensure.when) && ensureTries < 2) {
        const opener = document.querySelector<HTMLElement>(step.ensure.open);
        if (opener) {
          ensureTries += 1;
          /* ⚠️ Armed immediately before the click, because the click handler CONSUMES the
             flag. Only here, so reopening the phone on a later step never replays the
             script at somebody who has already watched it. */
          if (step.autoplay) { resetAutoplayDone(); armAutoplay(); }
          opener.click();
          setTimeout(measure, 450);
          return;
        }
      }

      /* ⚠️⚠️ **THE BUDGET IS CHECKED FIRST, AND PUTTING IT LAST HUNG THE TOUR DEAD.** The
         scroll-into-view branch returned before ever reaching the timeout test, so a target
         TALLER THAN THE VIEWPORT — a report's call list, say — could never satisfy
         `top >= 8 && bottom <= innerHeight - 8`, scrolled forever, and `ready` was never
         set. The card simply never appeared, on a prospect's first look at the product. */
      const over = Date.now() - started > budget;
      if (!step.target) { setBox(null); setReady(true); return; }
      const el = document.querySelector<HTMLElement>(step.target);
      if (el) {
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
          /* The container this step opened, if any, so the card can stay off it. */
          const ctx = step.ensure?.when ? document.querySelector<HTMLElement>(step.ensure.when) : null;
          if (ctx) {
            const cr = ctx.getBoundingClientRect();
            setGuard({
              top: Math.max(0, cr.top), left: cr.left, width: cr.width,
              height: Math.max(24, Math.min(window.innerHeight, cr.bottom) - Math.max(0, cr.top)),
            });
          } else setGuard(null);
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

  /**
   * ⚠️⚠️ **THE SCRIPT NEVER BLOCKS Next, AND DISABLING IT WAS THE WRONG CALL.** Reported
   * twice: *"why is it taking too long for the next button to show up"*. Measured at
   * **5.3 seconds even when everything is fast** — two live `/api/chat` round trips plus
   * the typing — and longer whenever the model is. Five seconds of a greyed-out button is
   * indistinguishable from a broken tour, and it hands a prospect a dead end on the one
   * screen that exists to impress them.
   *
   * ⚠️ So this is now a HINT, not a gate: the button always works, and a quiet line says
   * the agent is still replying. The conversation lives in the phone and carries on
   * whether or not they move. It also retires the whole class of bug — a gate can hang, a
   * hint cannot, and the 25-second bail-out that was papering over it is gone.
   */
  const [scriptLive, setScriptLive] = useState(false);
  useEffect(() => {
    if (!step?.awaitAutoplay) { setScriptLive(false); return; }
    setScriptLive(!takeAutoplayDone());
    const t = setInterval(() => { if (takeAutoplayDone()) { setScriptLive(false); clearInterval(t); } }, 300);
    return () => clearInterval(t);
  }, [i, step?.awaitAutoplay]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" && ready) setI((n) => (n + 1 < steps.length ? n + 1 : n));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [finish, ready, steps.length]);

  if (!step || !ready) return null;

  const last = i === steps.length - 1;
  /* ⚠️ The padding is clamped too, not just the box. Measured on the report screens: a
     target already flush to the viewport edge had its ring pushed 8px off, so the
     highlight was cut on a screen where the whole point is that it is pointing at
     something. */
  const pad = 8;
  /* The region the card must stay clear of: the spotlight, plus whatever container the
     step opened. One rectangle so the placement logic below stays a single decision. */
  const keepClear = box && guard
    ? {
        top: Math.min(box.top, guard.top),
        left: Math.min(box.left, guard.left),
        width: Math.max(box.left + box.width, guard.left + guard.width) - Math.min(box.left, guard.left),
        height: Math.max(box.top + box.height, guard.top + guard.height) - Math.min(box.top, guard.top),
      }
    : box;
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
  const CARD_H = 290;
  let cardStyle: React.CSSProperties = {};
  if (hole && keepClear) {
    const kc = {
      top: Math.max(0, keepClear.top - pad), left: Math.max(0, keepClear.left - pad),
      width: Math.min(window.innerWidth, keepClear.left + keepClear.width + pad) - Math.max(0, keepClear.left - pad),
      height: Math.min(window.innerHeight, keepClear.top + keepClear.height + pad) - Math.max(0, keepClear.top - pad),
    };
    const below = window.innerHeight - (kc.top + kc.height);
    const above = kc.top;
    const right = window.innerWidth - (kc.left + kc.width);
    /* ⚠️⚠️ **A TALL TARGET GETS THE CARD BESIDE IT, NOT ON TOP OF IT — reported against
       the phone preview, where the card covered the very conversation it was describing.**
       Neither above nor below fits a 560px phone on a 900px screen, so both branches
       clamped to the edge and landed over the thing being spotlit. Sideways is the only
       placement that works for something taller than the room around it. */
    if (below < CARD_H + 20 && above < CARD_H + 20) {
      /* ⚠️ **IT NARROWS RATHER THAN OVERLAPPING.** Measured at 1060px: neither side holds a
         380px card beside a 378px phone, so clamping to the edge put 55px of card over the
         spotlight. Take the roomier side and fit the card to it; a 300px floor is the point
         below which the copy stops being readable and overlapping is the lesser evil. */
      const roomier = right >= kc.left ? "right" : "left";
      const room = (roomier === "right" ? right : kc.left) - 32;
      const w = Math.min(CARD_W, Math.max(300, room));
      const left = roomier === "right"
        ? Math.min(kc.left + kc.width + 16, window.innerWidth - w - 16)
        : Math.max(16, kc.left - w - 16);
      const top = Math.max(16, Math.min(kc.top, window.innerHeight - CARD_H - 16));
      cardStyle = { top, left, width: w };
    } else {
      /* ⚠️ **PLACED CLEAR OF THE TARGET, NOT NEARLY CLEAR.** The old "above" placement was
         `hole.top - CARD_H + 40`, and that 40px fudge put the card over the bottom of
         whatever it was pointing at — measured on the compose box, an 85px target with 40px
         of card on top of it. Below is preferred when it fits; above is exact. */
      const top = below >= CARD_H + 20
        ? kc.top + kc.height + 14
        : Math.max(16, kc.top - CARD_H - 14);
      let left = kc.left + kc.width / 2 - CARD_W / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - CARD_W - 16));
      cardStyle = { top, left };
    }
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
        {scriptLive && (
          <p className="tour-live"><span className="tour-live-dot" aria-hidden="true" />The agent is replying, live</p>
        )}
        <div className="tour-foot">
          <button className="tour-skip" onClick={() => finish()}>Skip the tour</button>
          <div className="tour-nav">
            {i > 0 && <button className="tour-btn tour-btn--ghost" onClick={() => setI(i - 1)}>Back</button>}
            {/* ⚠️ `finish(true)` on the LAST step only: finishing hands them back to the
                landing page, where a prospect can start poking at things themselves.
                Skip calls `finish()` and leaves them exactly where they are. */}
            <button className="tour-btn tour-btn--go" onClick={() => (last ? finish(true) : setI(i + 1))}>
              {last ? "Start exploring" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
