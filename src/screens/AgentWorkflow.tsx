import { useState } from "react";
import { useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import { VoicePreviewIllustration } from "../components/VoicePreviewIllustration";
import { VoiceCall } from "./VoiceCall";

/* Agent Studio → a workflow's Definition (flow diagram). Opened from a workflow
   in the left sub-nav. Template flow (Conversation Start → classify intent →
   Sales / Support branches) with the title derived from the customer + channel. */

/* The flow tree is drawn at a fixed 760×470 size with absolutely-positioned
   nodes + an SVG connector layer, then centered in the dotted canvas. */
function FlowTree({ channelLabel, profile }: {
  channelLabel: string; profile: ReturnType<typeof useProfile>["profile"];
}) {
  /* Same source as the voice tree so both channels name the prospect's real
     intents. "Sales Inquiry" read wrong for a hospital. */
  const c = voiceCopy(profile);
  const bookingTerm = profile.bookingTerm;
  return (
    <div className="wf-tree">
      <svg className="wf-lines" viewBox="0 0 760 470" width="760" height="470" aria-hidden="true">
        {/* trigger → start */}
        <line x1="380" y1="62" x2="380" y2="122" className="wf-l" />
        {/* start stem + fork */}
        <line x1="380" y1="176" x2="380" y2="210" className="wf-l" />
        <line x1="230" y1="210" x2="530" y2="210" className="wf-l" />
        <line x1="230" y1="210" x2="230" y2="240" className="wf-l" />
        <line x1="530" y1="210" x2="530" y2="240" className="wf-l" />
        {/* branch drops to leaves */}
        <line x1="230" y1="284" x2="230" y2="360" className="wf-l wf-l-green" />
        <line x1="530" y1="284" x2="530" y2="360" className="wf-l wf-l-orange" />
      </svg>

      <div className="wf-node wf-trigger" style={{ left: 280, top: 8, width: 200 }}>
        <div className="wf-node-title"><span className="material-icons">bolt</span>Triggered by</div>
        <div className="wf-node-sub">0 campaigns and 0 forms</div>
      </div>

      <div className="wf-node wf-start" style={{ left: 275, top: 122, width: 210 }}>
        <div className="wf-node-title"><span className="material-icons">chat</span>Conversation Start</div>
        <div className="wf-node-sub">{channelLabel} · classify intent</div>
      </div>

      <div className="wf-node wf-intent" style={{ left: 140, top: 240, width: 180 }}>
        <div className="wf-node-title"><span className="material-icons">shopping_cart</span>{c.newQ}</div>
      </div>
      <div className="wf-node wf-intent" style={{ left: 440, top: 240, width: 180 }}>
        <div className="wf-node-title"><span className="material-icons">headset_mic</span>{c.supQ}</div>
      </div>

      <div className="wf-node wf-leaf wf-leaf-green" style={{ left: 120, top: 360, width: 220 }}>
        <div className="wf-leaf-title">All {c.newQ} Users</div>
        <div className="wf-leaf-action"><span className="material-icons">call</span>Schedule {bookingTerm}</div>
        <div className="wf-chips"><span className="wf-chip">Consumer Name</span><span className="wf-chip">{c.newChips[0]}</span></div>
      </div>
      <div className="wf-node wf-leaf wf-leaf-orange" style={{ left: 430, top: 360, width: 200 }}>
        <div className="wf-leaf-title">All {c.supQ} Users</div>
        <div className="wf-leaf-action"><span className="material-icons">headset_mic</span>Support &amp; Escalate</div>
      </div>
    </div>
  );
}

/* Exact MUI icon paths pulled from Invoca's real Voice workflow (agent-management-v2). */
const VIC = {
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  chat: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2M6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z",
  cart: "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z",
  headset: "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  altRoute: "m18 4-4 4h3v7c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.21-1.79-4-4-4S5 5.79 5 8v7H2l4 4 4-4H7V8c0-1.1.9-2 2-2s2 .9 2 2v7c0 2.21 1.79 4 4 4s4-1.79 4-4V8h3z",
} as const;
function VIcon({ d }: { d: string }) {
  return <svg className="wf-svg-ic" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={d} /></svg>;
}

/* Voice flow diagram — a qualify-and-ROUTE tree, matched to Invoca's real Voice
   workflow (agent-management-v2): 248px nodes, MUI icons, grey node icons, green
   "Inform & Route" (AltRoute) + orange "Support & Escalate" leaves. */
/* Derives every label from the prospect's own voice routing queues
   (reports.voiceRoutingDemo.queues), which all seven profiles already carry in
   the same shape: [0] is the new-business intent, [1] is existing-customer
   support, [2] is general. Previously this tree was hardcoded Shady Blinds
   retail copy, so Orlando Health's voice workflow talked about ordering window
   treatments and collecting an Order Number. */
function voiceCopy(p: ReturnType<typeof useProfile>["profile"]) {
  const q = p.reports.voiceRoutingDemo?.queues ?? [];
  // Queue names carry a qualifier after a dash ("Consultation - LASIK New
  // Patient"); the node title wants the head, so cut at the first dash.
  const head = (n?: string, fb = "") =>
    (n ?? fb).split(/\s*[-–—]\s*/)[0].trim() || fb;
  const newQ = head(q[0]?.name, "New Inquiry");
  const supQ = head(q[1]?.name, "Existing Customer Support");
  // "patient" vs "customer" comes from the prospect's own queue wording rather
  // than a guess about the vertical.
  const who = /patient/i.test(q[1]?.name ?? "") ? "patient"
    : /resident/i.test(q[1]?.name ?? "") ? "resident" : "customer";
  const hero = p.reports.marketingDashboard.breakdowns
    .find((b) => /Product Category/i.test(b.title))?.rows[0]?.name;
  const booking = p.bookingTerm.toLowerCase();
  return {
    newQ, supQ, who,
    newSub: `Caller wants to book ${/^[aeiou]/i.test(booking) ? "an" : "a"} ${booking} and is not an existing ${who}`,
    supSub: `Caller is an existing ${who} and needs help with something already in progress`,
    newChips: [hero ?? p.industry, p.bookingTerm, "Timeline"],
    supChips: [`Existing ${who[0].toUpperCase()}${who.slice(1)}`, "Issue Type"],
    newQueue: q[0]?.name ?? "New Inquiry",
    supQueue: q[1]?.name ?? "Support",
  };
}

function VoiceFlowTree({ profile }: { profile: ReturnType<typeof useProfile>["profile"] }) {
  const c = voiceCopy(profile);
  return (
    <div className="wf-tree wf-voice">
      <svg className="wf-lines" viewBox="0 0 560 650" width="560" height="650" aria-hidden="true">
        <line x1="278" y1="80" x2="278" y2="176" className="wf-l" />
        <line x1="278" y1="248" x2="278" y2="280" className="wf-l" />
        <line x1="130" y1="280" x2="426" y2="280" className="wf-l" />
        <line x1="130" y1="280" x2="130" y2="344" className="wf-l" />
        <line x1="426" y1="280" x2="426" y2="344" className="wf-l" />
        <line x1="130" y1="434" x2="130" y2="512" className="wf-l wf-l-green" />
        <line x1="426" y1="434" x2="426" y2="512" className="wf-l wf-l-orange" />
      </svg>

      <div className="wf-node wf-trigger" style={{ left: 154, top: 8, width: 248 }}>
        <div className="wf-node-title"><VIcon d={VIC.bolt} />Triggered by</div>
        <div className="wf-node-sub">2 campaigns and 0 forms</div>
      </div>

      <div className="wf-node wf-start" style={{ left: 154, top: 176, width: 248 }}>
        <div className="wf-node-title"><VIcon d={VIC.chat} />Conversation Start</div>
        <div className="wf-node-sub">Voice · classify intent</div>
      </div>

      <div className="wf-node wf-intent" style={{ left: 6, top: 344, width: 248 }}>
        <div className="wf-node-title"><VIcon d={VIC.cart} />{c.newQ}</div>
        <div className="wf-node-sub">{c.newSub}</div>
      </div>
      <div className="wf-node wf-intent" style={{ left: 302, top: 344, width: 248 }}>
        <div className="wf-node-title"><VIcon d={VIC.headset} />{c.supQ}</div>
        <div className="wf-node-sub">{c.supSub}</div>
      </div>

      <div className="wf-node wf-leaf wf-leaf-green" style={{ left: 6, top: 512, width: 248 }}>
        <div className="wf-leaf-title">All {c.newQ} Users</div>
        <div className="wf-leaf-action"><VIcon d={VIC.altRoute} />Route to {c.newQueue}</div>
        <div className="wf-chips">{c.newChips.map((x) => <span className="wf-chip" key={x}>{x}</span>)}</div>
      </div>
      <div className="wf-node wf-leaf wf-leaf-orange" style={{ left: 302, top: 512, width: 248 }}>
        <div className="wf-leaf-title">All {c.supQ} Users</div>
        <div className="wf-leaf-action"><VIcon d={VIC.headset} />Route to {c.supQueue}</div>
        <div className="wf-chips">{c.supChips.map((x) => <span className="wf-chip" key={x}>{x}</span>)}</div>
      </div>
    </div>
  );
}


/* Data-driven flow tree for an extra workflow (reports.extraWorkflows). The two
   built-in trees above are hand-positioned two-branch layouts; a nurture agent
   has four outcomes, so this one COMPUTES the layout: branches are spread
   evenly across the canvas width and the connector lines are derived from the
   same centres, which means it takes 2..5 branches without redrawing anything.
   Node classes are reused from the built-in trees so it looks identical. */
function ExtraFlowTree({ wf }: { wf: NonNullable<ReturnType<typeof useProfile>["profile"]["reports"]["extraWorkflows"]>[number] }) {
  /* Match the built-in trees' 760x470 footprint exactly. Wider values (980,
     then 856) both overflowed the canvas and clipped the last branch — the
     canvas is sized around 760, so anything larger loses a node off the right
     edge. Four branches therefore get narrower columns rather than a wider
     canvas, and the titles wrap. */
  const W = 760, H = 470;
  const n = Math.max(1, wf.branches.length);
  const colW = W / n;
  const cx = (i: number) => Math.round(colW * i + colW / 2);
  const nodeW = Math.min(206, Math.round(colW - 12));
  const mid = W / 2;
  const tone = (t?: string) =>
    t === "green" ? "wf-leaf-green" : t === "orange" ? "wf-leaf-orange" : "";

  return (
    <div className="wf-tree" style={{ width: W, height: H }}>
      <svg className="wf-lines" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <line x1={mid} y1="62" x2={mid} y2="122" className="wf-l" />
        <line x1={mid} y1="176" x2={mid} y2="210" className="wf-l" />
        {/* the horizontal bus spans only as far as the outermost branches */}
        <line x1={cx(0)} y1="210" x2={cx(n - 1)} y2="210" className="wf-l" />
        {wf.branches.map((b, i) => (
          <g key={b.title}>
            <line x1={cx(i)} y1="210" x2={cx(i)} y2="240" className="wf-l" />
            <line x1={cx(i)} y1="284" x2={cx(i)} y2="360"
              className={"wf-l " + (b.tone === "green" ? "wf-l-green" : b.tone === "orange" ? "wf-l-orange" : "")} />
          </g>
        ))}
      </svg>

      <div className="wf-node wf-trigger" style={{ left: mid - 100, top: 8, width: 200 }}>
        <div className="wf-node-title"><span className="material-icons">bolt</span>Triggered by</div>
        <div className="wf-node-sub">{wf.triggeredBy ?? "1 Campaign"}</div>
      </div>

      <div className="wf-node wf-start" style={{ left: mid - 115, top: 122, width: 230 }}>
        <div className="wf-node-title"><span className="material-icons">chat</span>Conversation Start</div>
        <div className="wf-node-sub">{wf.startLabel}</div>
      </div>

      {wf.branches.map((b, i) => (
        <div className="wf-node wf-intent" key={`i-${b.title}`}
          style={{ left: cx(i) - nodeW / 2, top: 240, width: nodeW }}>
          <div className="wf-node-title"><span className="material-icons">alt_route</span>{b.title}</div>
        </div>
      ))}

      {wf.branches.map((b, i) => (
        <div className={"wf-node wf-leaf " + tone(b.tone)} key={`l-${b.title}`}
          style={{ left: cx(i) - nodeW / 2, top: 360, width: nodeW }}>
          <div className="wf-leaf-title">{b.title} Users</div>
          <div className="wf-leaf-action"><span className="material-icons">bolt</span>{b.action}</div>
          {b.chips?.length ? (
            <div className="wf-chips">{b.chips.map((c) => <span className="wf-chip" key={c}>{c}</span>)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AgentWorkflow() {
  const { profile } = useProfile();
  const { channel } = useParams();
  /* The route param is a slug, not just sms|voice: extra workflows add their
     own (e.g. "sms-nurture"). Resolve those first so they don't fall through to
     the built-in SMS tree. */
  const extra = (profile.reports.extraWorkflows ?? []).find((w) => w.slug === channel);
  const isSms = extra ? extra.channel === "SMS" : (channel ?? "sms") !== "voice";
  const channelLabel = extra ? extra.channel : isSms ? "SMS" : "Voice";
  const workflowName = extra ? extra.label : `${profile.customerName} - ${channelLabel}`;
  const [voicePreview, setVoicePreview] = useState(false);
  const [inCall, setInCall] = useState(false);
  const closeVoice = () => { setVoicePreview(false); setInCall(false); };

  return (
    <AgentStudioLayout>
      <div className="wf-top">
        <h2 className="wf-title">Agent Workflow: {workflowName}</h2>
        <div className="wf-top-actions">
          {isSms && <button className="wf-preview wf-preview-agent" onClick={() => window.open(
            extra ? `/agent-studio/agent/preview?wf=${encodeURIComponent(extra.slug)}`
                  : "/agent-studio/agent/preview",
            "_blank", "noopener")}>Preview Agent</button>}
          <button className="wf-preview" onClick={() => { if (!isSms) setVoicePreview(true); }}>Preview Workflow</button>
        </div>
      </div>
      {!isSms && voicePreview && (
        <div className="vp-root">
          <div className="vp-backdrop" onClick={closeVoice} />
          <div className="vp-drawer" role="dialog" aria-modal="true">
            <div className="vp-head">
              <span className="vp-title">Preview: {workflowName} (Draft)</span>
              <button className="vp-close" onClick={closeVoice} aria-label="Close preview"><span className="material-icons">close</span></button>
            </div>
            {inCall ? (
              <VoiceCall onEnd={() => setInCall(false)} />
            ) : (
              <div className="vp-body">
                <VoicePreviewIllustration />
                <h3 className="vp-h">Preview Your Voice Agent</h3>
                <p className="vp-sub">Start a live test call to speak to your agent as you configure and iterate.</p>
                <button className="vp-startcall" onClick={() => setInCall(true)}><span className="material-icons">call</span>Start Call</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="wf-tabs">
        <button className="wf-tab active">Definition</button>
        <button className="wf-tab">Details</button>
      </div>

      <div className="wf-toolbar">
        <div className="wf-viewtoggle">
          <button className="wf-view active"><span className="material-icons">chevron_left</span>Flow view</button>
          <button className="wf-view"><span className="material-icons">table_chart</span>Table view</button>
        </div>
      </div>

      <div className={"wf-canvas" + (isSms ? "" : " wf-canvas-voice")}>
        {extra
          ? <ExtraFlowTree wf={extra} />
          : isSms
            ? <FlowTree channelLabel={channelLabel} profile={profile} />
            : <VoiceFlowTree profile={profile} />}

        <div className="wf-zoom">
          <button className="wf-zoom-btn"><span className="material-icons">add</span></button>
          <button className="wf-zoom-btn"><span className="material-icons">remove</span></button>
          <button className="wf-zoom-btn"><span className="material-icons">crop_free</span></button>
        </div>

        <div className="wf-minimap">
          <span className="wf-mini-node" style={{ top: 10, left: 40 }} />
          <span className="wf-mini-node" style={{ top: 34, left: 34 }} />
          <span className="wf-mini-node" style={{ top: 58, left: 18 }} />
          <span className="wf-mini-node" style={{ top: 58, left: 60 }} />
        </div>
      </div>
    </AgentStudioLayout>
  );
}
