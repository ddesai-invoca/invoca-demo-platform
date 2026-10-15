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
import { tourStepsFor, TOUR_CHAPTERS, type TourStep } from "../data/tourSteps";
import { SHARE_TOKEN, SHARE_LANDING, SHARE_BASENAME } from "../data/shareMode";

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
/** Where the next step's link is, and how to describe finding it. */
interface Beacon extends Box { via: boolean; where: string }

/** The route the prospect is on, without the share prefix. Read live rather than from a
 *  render, because the handoff poll has to see a click land the moment it does. */
const here = () => window.location.pathname.slice(SHARE_BASENAME.length) || "/";

/**
 * ⚠️⚠️ **THE LINK IS FOUND BY WHERE IT GOES, NOT BY A SELECTOR PER STEP.** Every screen in a
 * share renders real links with the share prefix, so "the anchor whose href is this route" is
 * the one definition that cannot go stale when a menu is restyled. A link in the page content
 * beats the left rail when both exist: it is closer to where they are reading.
 */
function linkTo(route: string): HTMLElement | null {
  const want = SHARE_BASENAME + route;
  const vis = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => {
    if (a.getAttribute("href") !== want || a.closest(".tour-root")) return false;
    const r = a.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return vis.find((a) => !a.classList.contains("nav-item")) ?? vis[0] ?? null;
}

function whereIs(el: HTMLElement, s: TourStep): string {
  if (s.handoff) return "It is the button at the top of the workflow.";
  if (el.classList.contains("nav-item")) return "It is in the menu on the left.";
  if (el.closest(".ag-nav-item, .ag-wf")) return "It is in the Agent Studio menu.";
  if (el.classList.contains("rp-link")) return "It is in your list of reports.";
  if (el.classList.contains("as-link")) return "It is the first row in the Agent Studio list.";
  return "It is highlighted on the page.";
}

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
  /* ⚠️⚠️ **WAITING FOR THE PROSPECT TO CLICK THROUGH TO THE NEXT SCREEN (10/15/2026).** Asked
     for: highlight the button that takes them to the next feature with a pulsating indicator,
     and once they click it the guide carries on. `pending` is the step they are heading to;
     the tour itself does not navigate there. That is the whole point: by the end they know
     where everything is, because they clicked their own way round it. */
  const [pending, setPending] = useState<number | null>(null);
  const [beacon, setBeacon] = useState<Beacon | null>(null);
  /* The control the beacon is on, so a click anywhere in the glow can press it. */
  const beaconEl = useRef<HTMLElement | null>(null);
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

  /** The control that gets them to `s`, if it is on screen. */
  const handoffEl = (s: TourStep): { el: HTMLElement; via: boolean } | null => {
    if (s.handoff) {
      const el = document.querySelector<HTMLElement>(s.handoff.click);
      return el ? { el, via: false } : null;
    }
    if (!s.route) return null;
    const direct = linkTo(s.route);
    if (direct) return { el: direct, via: false };
    if (s.via && here() !== s.via) {
      const hop = linkTo(s.via);
      if (hop) return { el: hop, via: true };
    }
    return null;
  };
  const arrived = (s: TourStep) => (s.handoff ? !!document.querySelector(s.handoff.until) : !s.route || here() === s.route);

  /**
   * Next. ⚠️ Only FORWARD hands off: Back is for re-reading, and making somebody find their
   * way back to a screen they have already seen is a chore, not a lesson. And a step with no
   * link on screen falls back to the old behaviour (the tour goes there itself), so a
   * restyled menu degrades to a tour that drives, never to one that waits forever.
   */
  const advance = () => {
    if (i === steps.length - 1) { finish(true); return; }
    const n = steps[i + 1];
    if (n.navLabel && !arrived(n) && handoffEl(n)) {
      /* Armed before THEIR click, because the click handler consumes it. */
      if (n.autoplay) { resetAutoplayDone(); armAutoplay(); }
      setPending(i + 1);
    } else setI(i + 1);
  };
  const cancelHandoff = () => { takeAutoplay(); setPending(null); setBeacon(null); };
  /* The escape hatch for anybody who cannot find it: the tour does the click for them. */
  const takeMeThere = () => {
    if (pending == null) return;
    const s = steps[pending];
    if (s.handoff) document.querySelector<HTMLElement>(s.handoff.click)?.click();
    else if (s.route) navigate(s.route);
  };

  useEffect(() => {
    if (pending == null) { setBeacon(null); return; }
    const s = steps[pending];
    let misses = 0;
    let closes = 0;
    const tick = () => {
      if (arrived(s)) { setBeacon(null); setPending(null); setI(pending); return; }
      const t = handoffEl(s);
      if (!t) {
        /* The link went away (they wandered, or a menu re-rendered). After ~2s, take them
           there rather than leave a prompt pointing at nothing. */
        if (++misses > 10) { setBeacon(null); setPending(null); setI(pending); if (s.route) navigate(s.route); }
        return;
      }
      misses = 0;
      beaconEl.current = t.el;
      let r = t.el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) { t.el.scrollIntoView({ block: "center" }); r = t.el.getBoundingClientRect(); }
      /* ⚠️ Something sitting on top of the link would eat their click: the phone preview's
         own overlay covers the left menu, and clicking it just closes the phone. Close it
         first so the click they make is the one we asked for. */
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && !t.el.contains(hit) && closes < 2) {
        const closer = document.querySelector<HTMLElement>(".phone-close");
        if (closer) { closes += 1; closer.click(); }
      }
      const where = t.via ? `Open ${s.viaLabel ?? "it"} first, then choose ${s.navLabel}.` : whereIs(t.el, s);
      setBeacon((b) => (b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height && b.via === t.via
        ? b : { top: r.top, left: r.left, width: r.width, height: r.height, via: t.via, where }));
    };
    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (pending != null) cancelHandoff(); else finish(); }
      if (e.key === "ArrowRight" && ready && pending == null) advance();
      if (e.key === "ArrowLeft") { if (pending != null) cancelHandoff(); else setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (pending != null) {
    if (!beacon) return null;
    const s = steps[pending];
    const pad = 6;
    const hole = {
      top: Math.max(0, beacon.top - pad), left: Math.max(0, beacon.left - pad),
      width: Math.min(window.innerWidth, beacon.left + beacon.width + pad) - Math.max(0, beacon.left - pad),
      height: Math.min(window.innerHeight, beacon.top + beacon.height + pad) - Math.max(0, beacon.top - pad),
    };
    /* Beside the target, pointing at it: right first (the menus are on the left), then below,
       then above, then left. The arrow is on the side facing the target. */
    const W = 300, H = 170, gap = 18;
    let side: "left" | "top" | "bottom" | "right";
    let pos: React.CSSProperties;
    const cy = hole.top + hole.height / 2;
    if (window.innerWidth - (hole.left + hole.width) >= W + gap + 16) {
      side = "left"; pos = { left: hole.left + hole.width + gap, top: Math.max(16, Math.min(cy - 44, window.innerHeight - H - 16)) };
    } else if (window.innerHeight - (hole.top + hole.height) >= H + gap + 16) {
      side = "top"; pos = { top: hole.top + hole.height + gap, left: Math.max(16, Math.min(hole.left + hole.width / 2 - W / 2, window.innerWidth - W - 16)) };
    } else if (hole.top >= H + gap + 16) {
      side = "bottom"; pos = { top: hole.top - H - gap, left: Math.max(16, Math.min(hole.left + hole.width / 2 - W / 2, window.innerWidth - W - 16)) };
    } else {
      side = "right"; pos = { left: Math.max(16, hole.left - W - gap), top: Math.max(16, Math.min(cy - 44, window.innerHeight - H - 16)) };
    }
    const label = beacon.via ? s.viaLabel : s.navLabel;
    return (
      <div className="tour-root" role="dialog" aria-modal="false" aria-label={`Click ${label}`}>
        <div className="tour-shade" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
        <div className="tour-shade" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
        <div className="tour-shade" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
        <div className="tour-shade" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
        <div className="tour-ring tour-ring--beacon" style={hole} />
        {/* ⚠️ THE WHOLE GLOW IS THE BUTTON. Measured: a real click 3px off a 37px-tall
            "Preview Agent" still landed inside the ring and did nothing, which reads as the
            tour being broken. Anywhere inside the highlight presses the real control, so its
            own handler runs (the router's Link, or the button that consumes the script). */}
        <button className="tour-hit" style={hole} aria-label={`Click ${beacon.via ? s.viaLabel : s.navLabel}`}
          onClick={() => beaconEl.current?.click()} />
        <div className="tour-ripple" style={hole} aria-hidden="true" />
        <div className={`tour-card tour-hand tour-hand--${side}`} style={pos} key={`hand-${pending}-${beacon.via}`}>
          <div className="tour-step">Next up · {s.chapter}</div>
          <h2 className="tour-title tour-hand-title">
            <span className="material-icons" aria-hidden="true">ads_click</span>
            Click {label}
          </h2>
          <p className="tour-body">{beacon.where}</p>
          <div className="tour-foot">
            <button className="tour-btn tour-btn--ghost" onClick={cancelHandoff}>Back</button>
            <button className="tour-skip" onClick={takeMeThere}>Take me there</button>
          </div>
        </div>
      </div>
    );
  }

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

      <div className={"tour-card" + (hole ? "" : " tour-card--center")} style={cardStyle} key={i}>
        <TourProgress steps={steps} i={i} />
        <div className="tour-step">{step.chapter} · Step {i + 1} of {steps.length}</div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        {step.value && (
          <p className="tour-value"><span className="material-icons" aria-hidden="true">check_circle</span>{step.value}</p>
        )}
        {last && <TourRecap name={profile.customerName} />}
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
            <button className="tour-btn tour-btn--go" onClick={advance}>
              {last ? "Start exploring" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The four chapters as a segmented bar, so a prospect can see how far through they are and
 * what is still to come. "Step 7 of 16" says how long; this says what it is about.
 */
function TourProgress({ steps, i }: { steps: TourStep[]; i: number }) {
  return (
    <div className="tour-prog" aria-hidden="true">
      {TOUR_CHAPTERS.map((c) => {
        const idx = steps.map((s, k) => (s.chapter === c ? k : -1)).filter((k) => k >= 0);
        const first = idx[0] ?? 0;
        const pct = !idx.length || i < first ? 0 : Math.min(100, ((i - first + 1) / idx.length) * 100);
        const cur = idx.includes(i);
        return (
          <div key={c} className={"tour-prog-seg" + (cur ? " is-cur" : pct >= 100 ? " is-done" : "")}>
            <span className="tour-prog-bar"><i style={{ width: `${pct}%` }} /></span>
            <span className="tour-prog-lbl">{c}</span>
          </div>
        );
      })}
    </div>
  );
}

/** What they just saw, ticked off, on the closing card. */
function TourRecap({ name }: { name: string }) {
  const rows: [string, string][] = [
    ["Agent Studio", `Built and tuned on ${name}'s own material`],
    ["Voice agent", "Answers, qualifies and routes every call"],
    ["SMS agent", "Replies in seconds and books by text"],
    ["Reports", "Every conversation captured and scored"],
  ];
  return (
    <ul className="tour-recap">
      {rows.map(([t, d]) => (
        <li key={t}><span className="material-icons" aria-hidden="true">check_circle</span><b>{t}</b><span>{d}</span></li>
      ))}
    </ul>
  );
}
