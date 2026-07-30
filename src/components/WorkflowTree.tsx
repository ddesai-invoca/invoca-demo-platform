import { useEffect, useRef, useState } from "react";

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

export interface TreeLeaf {
  title: string;                                  // "All Appointment Scheduling Users"
  action: string;                                 // "Route to Appointment Scheduling"
  tone?: "green" | "orange" | "blue" | "grey";
  chips?: string[];
}

export interface TreeBranch {
  title: string;                                  // the intent node's title
  subtitle?: string;                              // caller-intent line (Voice)
  icon?: "cart" | "headset" | "altRoute";
  /* More than one leaf splits this branch a second time — how National Van Lines
     routes "Book a Move" to an inter-state team and a local team. Each leaf takes
     its own column, so the layout absorbs it. */
  leaves: TreeLeaf[];
}

export interface WorkflowTreeModel {
  /* Only the node WIDTH and the icon set differ between channels; both are
     matched to the real Invoca pages. */
  variant: "sms" | "voice";
  triggeredBy: string;
  startLabel: string;
  branches: TreeBranch[];
}

/* Exact MUI icon paths from Invoca's real Voice workflow (agent-management-v2). */
const VIC: Record<string, string> = {
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  chat: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2M6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z",
  cart: "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z",
  headset: "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  altRoute: "m18 4-4 4h3v7c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.21-1.79-4-4-4S5 5.79 5 8v7H2l4 4 4-4H7V8c0-1.1.9-2 2-2s2 .9 2 2v7c0 2.21 1.79 4 4 4s4-1.79 4-4V8h3z",
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

/* Row geometry per channel, matched to the two real pages. Voice nodes are 248px
   and carry a subtitle, so every row sits lower. */
const GEO = {
  sms:   { nodeW: 220, gap: 26, trigger: 8, start: 122, intent: 240, subBus: 300, leaf: 344, height: 470, triggerW: 200, startW: 230 },
  voice: { nodeW: 248, gap: 32, trigger: 8, start: 176, intent: 344, subBus: 470, leaf: 528, height: 700, triggerW: 248, startW: 248 },
} as const;

/* The canvas clips (overflow: hidden) and is roughly 640px wide, so a tree wider
   than that loses its right-hand column — which is exactly how the National Van
   Lines split tree first rendered. transform: scale() shrinks the PAINT but not
   the layout box, so the wrapper has to reserve the SCALED size or `margin: auto`
   centres the wrong box. This measures the real canvas instead of assuming, so
   any branch count fits. */
function useFitScale(designWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth - 32;               // breathing room either side
      setScale(avail > 0 ? Math.min(1, avail / designWidth) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);
  return { ref, scale };
}

export function WorkflowTree({ model }: { model: WorkflowTreeModel }) {
  const g = GEO[model.variant];
  const branches = model.branches?.length ? model.branches : [];

  /* Each leaf gets a column; a branch spans its leaves' columns and centres over
     them. This is what makes "add a branch" and "split a branch" both work
     without touching the renderer. */
  const slots: { branch: number; leaf: number }[] = [];
  branches.forEach((b, bi) => {
    const n = Math.max(1, b.leaves?.length ?? 1);
    for (let li = 0; li < n; li++) slots.push({ branch: bi, leaf: li });
  });
  const nSlots = Math.max(1, slots.length);

  const colW = g.nodeW + g.gap;
  const W = Math.max(760, nSlots * colW);
  const H = g.height;
  const colX = (i: number) => (W - nSlots * colW) / 2 + i * colW + colW / 2;

  /* Where each branch's intent node centres: the midpoint of its own leaves. */
  const branchSlots = (bi: number) => slots.map((s, i) => ({ ...s, i })).filter((s) => s.branch === bi);
  const branchCx = (bi: number) => {
    const own = branchSlots(bi);
    if (!own.length) return W / 2;
    return (colX(own[0].i) + colX(own[own.length - 1].i)) / 2;
  };

  const mid = W / 2;
  const busY = g.intent - 30;
  const firstCx = branches.length ? branchCx(0) : mid;
  const lastCx = branches.length ? branchCx(branches.length - 1) : mid;

  const { ref, scale } = useFitScale(W);

  return (
    <div className="wf-fit" ref={ref}
      style={{ width: W * scale, height: H * scale, margin: "24px auto" }}>
      <div className={"wf-tree" + (model.variant === "voice" ? " wf-voice" : "")}
        style={{ width: W, height: H, margin: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <svg className="wf-lines" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          {/* trigger → start → the branch bus */}
          <line x1={mid} y1={g.trigger + 54} x2={mid} y2={g.start} className="wf-l" />
          <line x1={mid} y1={g.start + 54} x2={mid} y2={busY} className="wf-l" />
          {branches.length > 1 && (
            <line x1={firstCx} y1={busY} x2={lastCx} y2={busY} className="wf-l" />
          )}
          {branches.map((b, bi) => {
            const bx = branchCx(bi);
            const own = branchSlots(bi);
            const split = own.length > 1;
            return (
              <g key={`lines-${bi}`}>
                <line x1={bx} y1={busY} x2={bx} y2={g.intent} className="wf-l" />
                {split ? (
                  <>
                    {/* second fork: stem, bus across this branch's leaves, drops */}
                    <line x1={bx} y1={g.intent + 108} x2={bx} y2={g.subBus}
                      className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                    <line x1={colX(own[0].i)} y1={g.subBus} x2={colX(own[own.length - 1].i)} y2={g.subBus}
                      className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                    {own.map((s) => (
                      <line key={`d-${s.i}`} x1={colX(s.i)} y1={g.subBus} x2={colX(s.i)} y2={g.leaf}
                        className={"wf-l" + toneLine(b.leaves[s.leaf]?.tone)} />
                    ))}
                  </>
                ) : (
                  <line x1={bx} y1={g.intent + 108} x2={bx} y2={g.leaf}
                    className={"wf-l" + toneLine(b.leaves[0]?.tone)} />
                )}
              </g>
            );
          })}
        </svg>

        <div className="wf-node wf-trigger" style={{ left: mid - g.triggerW / 2, top: g.trigger, width: g.triggerW }}>
          <div className="wf-node-title"><VIcon name="bolt" />Triggered by</div>
          <div className="wf-node-sub">{model.triggeredBy}</div>
        </div>

        <div className="wf-node wf-start" style={{ left: mid - g.startW / 2, top: g.start, width: g.startW }}>
          <div className="wf-node-title"><VIcon name="chat" />Conversation Start</div>
          <div className="wf-node-sub">{model.startLabel}</div>
        </div>

        {branches.map((b, bi) => (
          <div className="wf-node wf-intent" key={`intent-${bi}`}
            style={{ left: branchCx(bi) - g.nodeW / 2, top: g.intent, width: g.nodeW }}>
            <div className="wf-node-title"><VIcon name={b.icon ?? "altRoute"} />{b.title}</div>
            {b.subtitle ? <div className="wf-node-sub">{b.subtitle}</div> : null}
          </div>
        ))}

        {slots.map((s, i) => {
          const b = branches[s.branch];
          const leaf = b?.leaves?.[s.leaf];
          if (!leaf) return null;
          return (
            <div className={"wf-node wf-leaf" + toneClass(leaf.tone)} key={`leaf-${i}`}
              style={{ left: colX(i) - g.nodeW / 2, top: g.leaf, width: g.nodeW }}>
              <div className="wf-leaf-title">{leaf.title}</div>
              <div className="wf-leaf-action">
                <VIcon name={leaf.tone === "orange" ? "headset" : "altRoute"} />{leaf.action}
              </div>
              {leaf.chips?.length ? (
                <div className="wf-chips">
                  {leaf.chips.map((c, ci) => <span className="wf-chip" key={`${c}-${ci}`}>{c}</span>)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
