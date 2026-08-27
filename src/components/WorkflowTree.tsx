import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* =============================================================================
   WorkflowTree — ONE data-driven renderer for every Agent Studio flow diagram
   -----------------------------------------------------------------------------
   Replaces four hand-positioned trees (the SMS tree, the Voice tree, the
   National Van Lines two-leaf split, and the extra-workflow tree), each of which
   carried its own hardcoded node coordinates and SVG line endpoints. That is why
   adding a branch used to mean writing a new component: the geometry was the
   code.

   Here the LAYOUT IS COMPUTED from the model, so the AI can add or remove a
   branch and the columns, the connector bus and the canvas all follow. The model
   is the page's data (registered via usePageData), so an edit is scoped to that
   one workflow page and undo covers it.

   What is NOT data, and stays exactly as it was: node styling, sizes, colours,
   fonts, the icon set. Rule 2 still holds — the AI reshapes the tree's CONTENT,
   never its design.
   ============================================================================= */

/** One answer of a Qualify leaf, drawn as its own node on the row below. */
export interface TreePath {
  title: string;                                  // the answer, e.g. "Looking for care services"
  action: string;                                 // "Inform & Route"
  tone?: "green" | "orange" | "blue" | "grey";
  chips?: string[];
  actionIcon?: "phone" | "headset" | "altRoute" | "cart";
  /**
   * The team this branch hands off to, drawn on the action line and named aloud on transfer.
   *
   * ⚠️ **THIS PUTS BACK SOMETHING THE LOCKED CHROME TOOK AWAY.** When the leaf became
   * "All Sales Inquiry Users" (product chrome, 8/26/2026) the note in `AgentWorkflow` recorded
   * the consequence: "the diagram no longer contains a destination the agent could name aloud",
   * and `buildVoiceSystem` stopped reading a group label into the spoken handoff. The
   * destination belongs on the USE CASE, which is where a real routing decision is made.
   *
   * ⚠️ **OPTIONAL, so every existing diagram is byte-identical.** Without it the action line
   * renders `action` exactly as before — the opt-in-prop rule this component already follows
   * for `actionIcon` and `warn`.
   */
  route?: string;
}

export interface TreeLeaf {
  title: string;                                  // "All Appointment Scheduling Users"
  action: string;                                 // "Route to Appointment Scheduling"
  /* A FOURTH ROW. The Qualify action asks a question and routes on the answer, so its leaf
     has one child per answer — which is what the real Comfort Keepers voice workflow shows
     under "All Sales Inquiry Users". A leaf with no paths is a terminal, exactly as before.

     ⚠️ **THE PATH TITLES ARE THE QUALIFY DRAWER'S ANSWERS/SEGMENTS.** One list, two
     renderings: the diagram draws them as nodes and the drawer lists them as segments. Two
     copies would disagree the first time an SE edited one. */
  paths?: TreePath[];
  /* ⚠️ PRODUCT CHROME, same flag and same reason as `TreeBranch.locked` — but here it covers
     the ACTION as well as the title, because a leaf has one and a branch does not. Set on the
     voice tree's two default leaves: the real page names the user group after the intent and
     offers a fixed set of actions, so neither is the prospect's to rename. The CHIPS below
     stay editable, which is where per-prospect configuration now lives. */
  locked?: boolean;
  tone?: "green" | "orange" | "blue" | "grey";
  chips?: string[];
  /* ⚠️ BOTH OPT-IN, DEFAULTED TO TODAY'S BEHAVIOUR — the same pattern DonutChart's extra
     props follow, and for the same reason: these two exist for ONE prospect's SMS tree
     (Comfort Keepers) and every other diagram in the app must render byte-identically.
     Omit them and the action icon is still chosen from `tone` and no warning is drawn. */
  actionIcon?: "phone" | "headset" | "altRoute" | "cart";
  /** Draws MUI's warning triangle after the action text. */
  warn?: boolean;
}

export interface TreeBranch {
  title: string;                                  // the intent node's title
  /* ⚠️ PRODUCT CHROME: the real page does not let a user rename this node, so neither may
     the AI. `editGuard.isLockedEdit` reads this flag and REFUSES a rename rather than
     letting it write a field the renderer would ignore — a silent no-op is the failure this
     repo has been bitten by three times. */
  locked?: boolean;
  subtitle?: string;                              // caller-intent line (Voice)
  icon?: "cart" | "headset" | "altRoute";
  /* More than one leaf splits this branch a second time — how National Van Lines
     routes "Book a Move" to an inter-state team and a local team. Each leaf takes
     its own column, so the layout absorbs it. */
  leaves: TreeLeaf[];
}

/* ⚠️ OPT-IN, DEFAULTED TO TODAY'S BEHAVIOUR — the same pattern DonutChart's extra props and
   the leaf's `actionIcon` follow. Without `onNode` no node is clickable, carries a pointer
   cursor or gains a hover shadow, so the SMS tree and every extra-workflow diagram are
   byte-identical. Passing it is what turns the boxes into drawer triggers. */
export interface WorkflowTreeModel {
  /* Only the node WIDTH and the icon set differ between channels; both are
     matched to the real Invoca pages. */
  variant: "sms" | "voice";
  triggeredBy: string;
  startLabel: string;
  /* ⚠️ PRODUCT CHROME AT THE TOP OF THE TREE. The trigger line and the Conversation Start
     label are the product's own wording, not this prospect's, so `editGuard.isLockedEdit`
     refuses a write to either when this is set. The node TITLES beside them ("Triggered by",
     "Conversation Start") are literals below and were never at risk; these two are model
     data and so needed enforcing. Flagged on the MODEL rather than matched by path, for the
     same reason `TreeBranch.locked` is: the rule travels with the data. */
  chromeLocked?: boolean;
  branches: TreeBranch[];
}

/* Exact MUI icon paths from Invoca's real Voice workflow (agent-management-v2). */
const VIC: Record<string, string> = {
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  chat: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2M6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z",
  cart: "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z",
  headset: "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  altRoute: "m18 4-4 4h3v7c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.21-1.79-4-4-4S5 5.79 5 8v7H2l4 4 4-4H7V8c0-1.1.9-2 2-2s2 .9 2 2v7c0 2.21 1.79 4 4 4s4-1.79 4-4V8h3z",
  /* MUI Phone and Warning, on the same 24-unit grid as the four above — added for the
     Comfort Keepers SMS tree, which shows a handset beside "Schedule Callback" and a warning
     triangle after "Support & Escalate". */
  phone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02z",
  warning: "M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z",
};

function VIcon({ name }: { name: keyof typeof VIC | string }) {
  const d = VIC[name] ?? VIC.altRoute;

  return (
    <svg className="wf-svg-ic" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const toneClass = (t?: string) =>
  t === "green" ? " wf-leaf-green" : t === "orange" ? " wf-leaf-orange" : "";
const toneLine = (t?: string) =>
  t === "green" ? " wf-l-green" : t === "orange" ? " wf-l-orange" : "";

/* NODE HEIGHTS ARE MEASURED, NOT ASSUMED.

   The connectors used to leave each node at a hardcoded offset — `top + 54` for
   the trigger/start and `top + 108` for an intent node. Both were wrong, and the
   two channels failed differently, which is why it read as two separate bugs:

     SMS   intent nodes are 43px and 64px tall (the title "Existing Customer
           Support" wraps, "Consultation" does not), so their real bottoms are 283
           and 304 — but the line was drawn from 348 DOWN TO the leaf top at 344.
           A 4px line pointing UPWARDS: nothing visible at all.
     Voice intent nodes are taller (they carry a subtitle) and the leaf row is
           lower, so the same +108 produced a correctly-directed line that STARTED
           ~44px below the node — a stub floating in space, connected to nothing.

   A hardcoded height cannot survive text that wraps, a re-skinned label, or the AI
   renaming a node — all of which this component exists to support. So each node
   reports its own height and the lines are drawn between real edges. Fallbacks
   below only cover the single frame before the first measurement. */
const FALLBACK = { trigger: 65, start: 65, intent: 64, leaf: 88 };

/* Row geometry per channel, matched to the two real pages. Voice nodes are 248px
   and carry a subtitle, so every row sits lower. */
const GEO = {
  /* ⚠️ `leafBus` and `path` are the FOURTH ROW, and `pathHeight` is only used when a leaf
     actually has paths — so a tree without them keeps its signed-off canvas height exactly. */
  sms:   { nodeW: 220, gap: 26, trigger: 8, start: 122, intent: 240, subBus: 300, leaf: 344, leafBus: 462, path: 500, height: 470, pathHeight: 660, triggerW: 200, startW: 230 },
  voice: { nodeW: 248, gap: 32, trigger: 8, start: 176, intent: 344, subBus: 470, leaf: 528, leafBus: 660, path: 700, height: 700, pathHeight: 880, triggerW: 248, startW: 248 },
} as const;

/* The canvas clips (overflow: hidden) and is roughly 640px wide, so a tree wider
   than that loses its right-hand column — which is exactly how the National Van
   Lines split tree first rendered. transform: scale() shrinks the PAINT but not
   the layout box, so the wrapper has to reserve the SCALED size or `margin: auto`
   centres the wrong box. This measures the real canvas instead of assuming, so
   any branch count fits. */
/**
 * Shrink the tree to fit its canvas.
 *
 * ⚠️ **IT FITS BOTH DIMENSIONS NOW, AND WIDTH-ONLY WAS A REAL BUG.** It solved
 * `avail / designWidth` and ignored height, which was invisible while every tree was
 * shorter than the canvas. The fourth row made the voice tree 880px tall, the canvas grew
 * to fit it, and the whole diagram could only be seen by SCROLLING — where the real page
 * shows all of it. Solving for the smaller of the two ratios fits any tree in any box.
 *
 * ⚠️ The canvas reserves 136px at the bottom for the zoom cluster, so the height available
 * to the tree is the parent's client height MINUS that strip and the tree's own margin.
 * Measuring the parent's full height instead would slide a tall tree under the controls.
 */
/** Never shrink past this — see the note at the clamp. */
const MIN_SCALE = 0.5;
/** The hair of space under the lowest row, in design units. */
const BOTTOM_PAD = 10;
/** Breathing room around the fitted tree, top and bottom, in real pixels. Deliberately small:
    the ask is that the first row sits JUST under the frame and the last JUST above it. */
const FIT_INSET = 16;

/* User zoom bounds. The FIT can go below MIN_ZOOM (it has its own 0.5 floor); these bound
   what the +/- buttons and the wheel can reach. */
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
/* Multiplicative, so each press feels the same size at any zoom — a fixed +0.1 step is
   a 33% jump at 0.3 and a 4% nudge at 2.5. */
const ZOOM_STEP = 1.2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function useFitScale(designWidth: number, designHeight: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  /* ⚠️ null MEANS "FOLLOW THE FIT", which is not the same as holding the fit's current
     number. Storing the number would freeze the diagram at whatever the fit happened to be
     when the window was that size, so a later resize would stop re-fitting — and nothing on
     screen would say why. */
  const [user, setUser] = useState<number | null>(null);
  const scale = user ?? fit;
  /* ⚠️ A REF MIRRORS THE LIVE SCALE, and without it rapid zooming barely moves. Every wheel
     event in a burst closes over the SAME `scale` from its render, so three clicks all
     computed `0.62 * 1.2` and set the identical value — three notches of input, one notch of
     zoom, which reads as the gesture being ignored. Reading the ref lets consecutive events
     compose before React has re-rendered. */
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  /* Where to put the scroll after a zoom, so the point under the cursor stays under it. */
  const anchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);

  const setScale = setFit;
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const availW = el.clientWidth - 32;                                  // breathing room either side
      /* ⚠️ SUBTRACT THE INSET TWICE — once for the top, once for the bottom — and let the
         box's own margin be exactly that inset. Budgeting it once while the margin claimed it
         at BOTH ends is what left 31px above the first row and 0 below the last, with the
         diagram overflowing by a hair. Symmetric by construction now rather than by arithmetic
         that has to be kept in step. */
      const availH = el.clientHeight - parseFloat(cs.paddingBottom || "0") - FIT_INSET * 2;
      const byW = availW > 0 ? availW / designWidth : 1;
      const byH = availH > 0 ? availH / designHeight : 1;
      /* ⚠️ THERE IS A FLOOR, because "fits" is not the same as "readable". On a 620px-tall
         window the four-row tree solved to 0.28, which renders a 13px node title at an
         effective 3.8px — a grey smudge, and the page scrolled anyway because the canvas had
         hit its own min-height. Below the floor it stops shrinking and the canvas scrolls
         instead, which is the honest trade: a legible diagram you move, not an illegible one
         you cannot read. */
      setScale(Math.max(MIN_SCALE, Math.min(1, byW, byH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth, designHeight]);

  /* ⚠️ THE SCROLL FIX HAS TO RUN AFTER THE NEW SCALE IS PAINTED, hence a LAYOUT effect: the
     scaled box only has its new size once React has committed, and setting scroll before that
     lands against the old dimensions and jumps. */
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = ref.current?.parentElement;
    if (!el) return;
    el.scrollLeft = a.cx * scale - a.px;
    el.scrollTop = a.cy * scale - a.py;
  }, [scale]);

  /**
   * Zoom to `next`, keeping the content under (clientX, clientY) in place.
   *
   * ⚠️ Without the anchor a zoom recentres on the box and the node you were looking at slides
   * away, which makes the wheel feel like it is fighting you. Anchoring on the POINTER for the
   * wheel and on the box CENTRE for the buttons is what each gesture implies.
   */
  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = clientX != null ? clientX - r.left : el.clientWidth / 2;
    const py = clientY != null ? clientY - r.top : el.clientHeight / 2;
    const from = scaleRef.current;
    const to = clampZoom(next);
    anchor.current = { cx: (el.scrollLeft + px) / from, cy: (el.scrollTop + py) / from, px, py };
    scaleRef.current = to;
    setUser(to);
  };

  const zoomIn = () => zoomTo(scaleRef.current * ZOOM_STEP);
  const zoomOut = () => zoomTo(scaleRef.current / ZOOM_STEP);
  /** Back to the computed fit, re-centred — the whole diagram visible however far you strayed. */
  const resetZoom = () => {
    anchor.current = null;
    setUser(null);
    const el = ref.current?.parentElement;
    if (el) requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      el.scrollTop = 0;
    });
  };

  /* ⚠️ A NATIVE, NON-PASSIVE LISTENER. React's onWheel is registered passively at the root, so
     `preventDefault` there is ignored with a console warning and the canvas scrolls INSTEAD of
     zooming. Attaching it here with `{ passive: false }` is the only way the gesture works. */
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;                     // leave browser pinch-zoom alone
      e.preventDefault();
      /* ⚠️ PROPORTIONAL TO deltaY, NOT ONE FIXED STEP PER EVENT. A mouse notch is about
         ±100, so it gets a full ZOOM_STEP; a trackpad sends a stream of small deltas, and
         charging a full step for each would rocket from 0.6 to the ceiling on one flick.
         Clamped to a single step per event so a chunky OS setting cannot jump either. */
      const notches = Math.max(-1, Math.min(1, -e.deltaY / 100));
      zoomTo(scaleRef.current * Math.pow(ZOOM_STEP, notches), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return { ref, scale, zoomIn, zoomOut, resetZoom, zoomed: user !== null };
}

export function WorkflowTree({ model, onNode }: { model: WorkflowTreeModel; onNode?: (id: string) => void }) {
  const g = GEO[model.variant];
  const branches = model.branches?.length ? model.branches : [];

  /* Each leaf gets a column; a branch spans its leaves' columns and centres over
     them. This is what makes "add a branch" and "split a branch" both work
     without touching the renderer. */
  /* ⚠️ A COLUMN IS A TERMINAL, NOT A LEAF (8/26/2026). It was one column per leaf; now a
     leaf that HAS paths contributes one column per path and the leaf centres over them,
     exactly as a branch centres over its leaves. Reusing the second fork's machinery one
     level down beats adding a parallel one, and a leaf with no paths behaves precisely as
     before (`path: -1`). */
  const slots: { branch: number; leaf: number; path: number }[] = [];
  branches.forEach((b, bi) => {
    const n = Math.max(1, b.leaves?.length ?? 1);
    for (let li = 0; li < n; li++) {
      const np = b.leaves?.[li]?.paths?.length ?? 0;
      if (np) for (let pi = 0; pi < np; pi++) slots.push({ branch: bi, leaf: li, path: pi });
      else slots.push({ branch: bi, leaf: li, path: -1 });
    }
  });
  const nSlots = Math.max(1, slots.length);
  const anyPaths = slots.some((s) => s.path >= 0);

  const colW = g.nodeW + g.gap;
  const W = Math.max(760, nSlots * colW);
  /* ⚠️ THE DESIGN HEIGHT IS THE MEASURED CONTENT, NOT THE ROW CONSTANT. The constants exist
     to POSITION rows; using one as the height meant fitting to a box with dead space at the
     bottom (880 against a lowest node ending near 788), which shrank the diagram for no
     reason. `BOTTOM_PAD` is the hair of space under the last row.
     ⚠️ Falls back to the constant for the single frame before the first measurement, and for
     the degenerate case of a tree with no nodes at all. */
  const triggerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const intentRefs = useRef<(HTMLDivElement | null)[]>([]);
  /* ⚠️ LEAVES ARE MEASURED NOW TOO, keyed by the terminal column so a leaf spanning two
     paths is found once. Without it the leaf-to-path connector would leave a HARDCODED
     offset — the exact mistake recorded above, which produced a 4px upward line on SMS and a
     stub floating 24px below the node on voice. */
  const leafRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /* ⚠️ THE TREE'S REAL BOTTOM, MEASURED — the row constants cannot tell you it. `pathHeight`
     is 880 while the lowest node ends near 788, so fitting to the constant left ~90 design
     units of nothing under the diagram and made the whole thing render smaller than it needed
     to. Node offsets are DESIGN units even inside the scaled wrapper (transform changes the
     paint, not the layout box), so this can be read straight off the DOM. */
  const treeRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<{ trigger: number; start: number; intents: number[]; leaves: Record<string, number>; content: number }>(
    { trigger: FALLBACK.trigger, start: FALLBACK.start, intents: [], leaves: {}, content: 0 });

  const H = h.content > 0 ? h.content + BOTTOM_PAD : (anyPaths ? g.pathHeight : g.height);
  const colX = (i: number) => (W - nSlots * colW) / 2 + i * colW + colW / 2;

  /* Where each branch's intent node centres: the midpoint of its own terminals. */
  const branchSlots = (bi: number) => slots.map((s, i) => ({ ...s, i })).filter((s) => s.branch === bi);
  const cxOf = (own: { i: number }[]) =>
    own.length ? (colX(own[0].i) + colX(own[own.length - 1].i)) / 2 : W / 2;
  const branchCx = (bi: number) => cxOf(branchSlots(bi));
  /* And where a LEAF centres: the midpoint of its own paths, or its single column. */
  const leafSlots = (bi: number, li: number) => branchSlots(bi).filter((s) => s.leaf === li);
  const leafCx = (bi: number, li: number) => cxOf(leafSlots(bi, li));

  const mid = W / 2;
  const busY = g.intent - 30;
  const firstCx = branches.length ? branchCx(0) : mid;
  const lastCx = branches.length ? branchCx(branches.length - 1) : mid;

  const { ref, scale, zoomIn, zoomOut, resetZoom } = useFitScale(W, H);

  /* Measure the nodes so the connectors can start and end on real edges. Layout
     effect + ResizeObserver: the effect covers the first paint and any model
     change, the observer covers a later reflow (a longer label wrapping to a
     second line) that changes no prop. offsetHeight is the LAYOUT box, so the
     wrapper's transform: scale() does not distort it. */

  useLayoutEffect(() => {
    const measure = () => {
      const next = {
        trigger: triggerRef.current?.offsetHeight || FALLBACK.trigger,
        start: startRef.current?.offsetHeight || FALLBACK.start,
        intents: branches.map((_, i) => intentRefs.current[i]?.offsetHeight || FALLBACK.intent),
        leaves: Object.fromEntries(Object.entries(leafRefs.current)
          .map(([k, el]) => [k, el?.offsetHeight || FALLBACK.leaf])),
        content: (() => {
          const t = treeRef.current;
          if (!t) return 0;
          const rows = [...t.querySelectorAll<HTMLElement>(".wf-node")];
          return rows.length ? Math.max(...rows.map((n2) => n2.offsetTop + n2.offsetHeight)) : 0;
        })(),
      };
      setH((prev) =>
        prev.trigger === next.trigger && prev.start === next.start
        && prev.intents.length === next.intents.length
        && prev.intents.every((v, i) => v === next.intents[i])
        && prev.content === next.content
        && JSON.stringify(prev.leaves) === JSON.stringify(next.leaves) ? prev : next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    [triggerRef.current, startRef.current, ...intentRefs.current].forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [model, branches.length, scale]);

  /* Real edges. Each branch uses ITS OWN intent height — on SMS two sibling nodes
     differ by 21px purely because one title wraps. */
  const triggerBottom = g.trigger + h.trigger;
  const startBottom = g.start + h.start;
  const intentBottom = (bi: number) => g.intent + (h.intents[bi] ?? FALLBACK.intent);
  const leafBottom = (bi: number, li: number) => g.leaf + (h.leaves[`${bi}-${li}`] ?? FALLBACK.leaf);

  /* One place decides what a clickable node looks like and does, so a node cannot end up
   with a pointer cursor and no handler (or the reverse). */
  const open = (id: string) => (onNode
  ? { className: "wf-node--open", onClick: () => onNode(id), role: "button" as const, tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNode(id); } } }
  : { className: "" });

  return (
    <>
    {/* ⚠️ THE ZOOM CLUSTER LIVES HERE NOW, not in AgentWorkflow. It rendered next to the
        canvas with no state behind it, so all three buttons were decorative — the classic
        control that looks live and does nothing. Its state is the fit scale, which is
        measured in this component, so the buttons belong with it rather than being wired
        up through props. It is absolutely positioned against `.wf-canvas`, which is still
        the positioned ancestor, so it lands in exactly the same corner. */}
    <div className="wf-zoom">
      <button className="wf-zoom-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
        <span className="material-icons">add</span>
      </button>
      <button className="wf-zoom-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
        <span className="material-icons">remove</span>
      </button>
      <button className="wf-zoom-btn" onClick={resetZoom} aria-label="Fit to view" title="Fit to view">
        <span className="material-icons">crop_free</span>
      </button>
    </div>
    {/* ⚠️ AN INNER SCROLLER, SO THE OVERLAYS DO NOT SCROLL WITH THE DIAGRAM. The canvas
        itself used to scroll, and an absolutely-positioned child of a scroll container
        moves with its content — so zooming in far enough carried the zoom cluster (and the
        minimap) up and out of the corner. The canvas is the non-scrolling frame the
        overlays anchor to; this box inside it does the scrolling. */}
    <div className="wf-scroll">
    <div className="wf-fit" ref={ref}
      /* ⚠️ THE MARGIN IS THE FIT INSET, and the fit subtracts that inset TWICE. Those two
         facts have to agree: the margin was a hardcoded 24px against a budget of 16px at each
         end, so the box claimed 48px of a 32px allowance and the diagram overflowed its frame
         by exactly the 16px difference — which is what made it scroll while looking like it
         fitted. Derived from the one constant now, so they cannot drift apart again. */
      style={{ width: W * scale, height: H * scale, margin: `${FIT_INSET}px auto` }}>
      <div ref={treeRef} className={"wf-tree" + (model.variant === "voice" ? " wf-voice" : "")}
        style={{ width: W, height: H, margin: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <svg className="wf-lines" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          {/* trigger → start → the branch bus, from measured node bottoms */}
          <line x1={mid} y1={triggerBottom} x2={mid} y2={g.start} className="wf-l" />
          <line x1={mid} y1={startBottom} x2={mid} y2={busY} className="wf-l" />
          {branches.length > 1 && (
            <line x1={firstCx} y1={busY} x2={lastCx} y2={busY} className="wf-l" />
          )}
          {branches.map((b, bi) => {
            const bx = branchCx(bi);
            const own = branchSlots(bi);
            /* ⚠️ SPLIT MEANS TWO LEAVES, NOT TWO COLUMNS — and this broke the moment columns
               became terminals. A branch with ONE Qualify leaf that has two paths has two
               terminals, so `own.length > 1` drew the second-fork bus above a single leaf: a
               green line spanning nothing, visible on screen the first time it rendered. */
            const split = new Set(own.map((s) => s.leaf)).size > 1;
            return (
              <g key={`lines-${bi}`}>
                <line x1={bx} y1={busY} x2={bx} y2={g.intent} className="wf-l" />
                {split ? (
                  <>
                    {/* second fork: stem, bus across this branch's leaves, drops */}
                    <line x1={bx} y1={intentBottom(bi)} x2={bx} y2={g.subBus}
                      className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                    <line x1={colX(own[0].i)} y1={g.subBus} x2={colX(own[own.length - 1].i)} y2={g.subBus}
                      className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                    {[...new Set(own.map((s) => s.leaf))].map((li) => (
                      <line key={`d-${li}`} x1={leafCx(bi, li)} y1={g.subBus} x2={leafCx(bi, li)} y2={g.leaf}
                        className={"wf-l" + toneLine(b.leaves[li]?.tone)} />
                    ))}
                  </>
                ) : (
                  <line x1={bx} y1={intentBottom(bi)} x2={bx} y2={g.leaf}
                    className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                )}

                {/* ⚠️ THE FOURTH ROW'S CONNECTORS, and they mirror the second fork exactly:
                    a stem from the leaf's MEASURED bottom, a bus across its own paths, then a
                    drop into each. A single path still gets a bus of zero width, which is
                    harmless and keeps one code path instead of two. */}
                {(b.leaves ?? []).map((lf, li) => {
                  const own2 = leafSlots(bi, li);
                  if (!lf.paths?.length) return null;
                  const lx = leafCx(bi, li);
                  return (
                    <g key={`paths-${bi}-${li}`}>
                      <line x1={lx} y1={leafBottom(bi, li)} x2={lx} y2={g.leafBus}
                        className={"wf-l" + toneLine(lf.paths[0]?.tone ?? lf.tone)} />
                      <line x1={colX(own2[0].i)} y1={g.leafBus} x2={colX(own2[own2.length - 1].i)} y2={g.leafBus}
                        className={"wf-l" + toneLine(lf.paths[0]?.tone ?? lf.tone)} />
                      {own2.map((s2) => (
                        <line key={`pd-${s2.i}`} x1={colX(s2.i)} y1={g.leafBus} x2={colX(s2.i)} y2={g.path}
                          className={"wf-l" + toneLine(lf.paths?.[s2.path]?.tone ?? lf.tone)} />
                      ))}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        <div {...open("trigger")} className={"wf-node wf-trigger " + open("trigger").className} ref={triggerRef}
          style={{ left: mid - g.triggerW / 2, top: g.trigger, width: g.triggerW }}>
          <div className="wf-node-title"><VIcon name="bolt" />Triggered by</div>
          <div className="wf-node-sub">{model.triggeredBy}</div>
        </div>

        <div className="wf-node wf-start" ref={startRef}
          style={{ left: mid - g.startW / 2, top: g.start, width: g.startW }}>
          <div className="wf-node-title"><VIcon name="chat" />Conversation Start</div>
          <div className="wf-node-sub">{model.startLabel}</div>
        </div>

        {branches.map((b, bi) => (
          <div {...open(`intent-${bi}`)} className={"wf-node wf-intent " + open(`intent-${bi}`).className} key={`intent-${bi}`}
            ref={(el) => { intentRefs.current[bi] = el; }}
            style={{ left: branchCx(bi) - g.nodeW / 2, top: g.intent, width: g.nodeW }}>
            <div className="wf-node-title"><VIcon name={b.icon ?? "altRoute"} />{b.title}</div>
            {b.subtitle ? <div className="wf-node-sub">{b.subtitle}</div> : null}
          </div>
        ))}

        {/* ⚠️ ONE NODE PER LEAF, NOT PER COLUMN. `slots` now holds one entry per PATH, so
            mapping it here rendered a leaf on top of itself once per path — two identical
            boxes stacked, which reads as a blur rather than as a bug. Dedupe to the distinct
            (branch, leaf) pairs and centre each over its own columns. */}
        {[...new Map(slots.map((s) => [`${s.branch}-${s.leaf}`, s])).values()].map((s) => {
          const i = slots.findIndex((x) => x.branch === s.branch && x.leaf === s.leaf);
          const b = branches[s.branch];
          const leaf = b?.leaves?.[s.leaf];
          if (!leaf) return null;
          return (
            /* ⚠️ THE ID CARRIES BOTH INDICES, not the flat slot index `i`. `slots` is FLATTENED
                 across every branch, so `leaf-2` is ambiguous the moment a branch has two
                 leaves — the National Van Lines split makes that real, not hypothetical.
                 Same class of bug as building an edit path from a filtered index. */
              <div {...open(`leaf-${s.branch}-${s.leaf}`)}
                className={"wf-node wf-leaf" + toneClass(leaf.tone) + " " + open("").className}
                key={`leaf-${i}`}
              ref={(el) => { leafRefs.current[`${s.branch}-${s.leaf}`] = el; }}
              style={{ left: leafCx(s.branch, s.leaf) - g.nodeW / 2, top: g.leaf, width: g.nodeW }}>
              <div className="wf-leaf-title">{leaf.title}</div>
              <div className="wf-leaf-action">
                <VIcon name={leaf.actionIcon ?? (leaf.tone === "orange" ? "headset" : "altRoute")} />
                {leaf.action}
                {leaf.warn ? <VIcon name="warning" /> : null}
              </div>
              {leaf.chips?.length ? (
                <div className="wf-chips">
                  {leaf.chips.map((c, ci) => <span className="wf-chip" key={`${c}-${ci}`}>{c}</span>)}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* ⚠️ THE PATH ROW. Same node chrome as a leaf, on its own row and one per column, so an
            SE reads them as the same kind of thing the product draws them as. Only rendered for
            slots that ARE paths, so a tree without any adds no elements at all — the SMS diagram
            and every extra workflow are untouched by construction. */}
        {slots.map((s, i) => {
          if (s.path < 0) return null;
          const pth = branches[s.branch]?.leaves?.[s.leaf]?.paths?.[s.path];
          if (!pth) return null;
          return (
            <div {...open(`path-${s.branch}-${s.leaf}-${s.path}`)}
              className={"wf-node wf-leaf" + toneClass(pth.tone ?? "green") + " " + open("").className}
              key={`path-${i}`}
              style={{ left: colX(i) - g.nodeW / 2, top: g.path, width: g.nodeW }}>
              <div className="wf-leaf-title">{pth.title}</div>
              <div className="wf-leaf-action">
                <VIcon name={pth.actionIcon ?? "altRoute"} />
                {/* ⚠️ "Route to <team>" REUSES THE ACTION SLOT rather than adding a line. The
                    product itself used that wording on this diagram before these rows became
                    chrome, so it needs no new node chrome and no new CSS — which matters on a
                    six-branch tree that already has to fit without scrolling. */}
                {pth.route?.trim() ? `Route to ${pth.route.trim()}` : pth.action}
              </div>
              {pth.chips?.length ? (
                <div className="wf-chips">
                  {pth.chips.map((c, ci) => <span className="wf-chip" key={`${c}-${ci}`}>{c}</span>)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
      </div>
    </>
  );
}
