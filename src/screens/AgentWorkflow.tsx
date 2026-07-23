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
function FlowTree({ channelLabel, bookingTerm }: { channelLabel: string; bookingTerm: string }) {
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
        <div className="wf-node-title"><span className="material-icons">shopping_cart</span>Sales Inquiry</div>
      </div>
      <div className="wf-node wf-intent" style={{ left: 440, top: 240, width: 180 }}>
        <div className="wf-node-title"><span className="material-icons">headset_mic</span>Need Support</div>
      </div>

      <div className="wf-node wf-leaf wf-leaf-green" style={{ left: 120, top: 360, width: 220 }}>
        <div className="wf-leaf-title">All Sales Inquiry Users</div>
        <div className="wf-leaf-action"><span className="material-icons">call</span>Schedule {bookingTerm}</div>
        <div className="wf-chips"><span className="wf-chip">Consumer Name</span><span className="wf-chip">Interest</span></div>
      </div>
      <div className="wf-node wf-leaf wf-leaf-orange" style={{ left: 430, top: 360, width: 200 }}>
        <div className="wf-leaf-title">All Support Users</div>
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
function VoiceFlowTree() {
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
        <div className="wf-node-title"><VIcon d={VIC.cart} />Sales Inquiry</div>
        <div className="wf-node-sub">Caller is looking to order new window treatments — hasn't placed an order yet</div>
      </div>
      <div className="wf-node wf-intent" style={{ left: 302, top: 344, width: 248 }}>
        <div className="wf-node-title"><VIcon d={VIC.headset} />Need Support</div>
        <div className="wf-node-sub">Caller already has an order placed and needs help with it</div>
      </div>

      <div className="wf-node wf-leaf wf-leaf-green" style={{ left: 6, top: 512, width: 248 }}>
        <div className="wf-leaf-title">All Sales Inquiry Users</div>
        <div className="wf-leaf-action"><VIcon d={VIC.altRoute} />Inform &amp; Route</div>
        <div className="wf-chips"><span className="wf-chip">Room Type</span><span className="wf-chip">Product Type</span><span className="wf-chip">Timeline</span></div>
      </div>
      <div className="wf-node wf-leaf wf-leaf-orange" style={{ left: 302, top: 512, width: 248 }}>
        <div className="wf-leaf-title">All Support Users</div>
        <div className="wf-leaf-action"><VIcon d={VIC.headset} />Support &amp; Escalate</div>
        <div className="wf-chips"><span className="wf-chip">Order Number</span><span className="wf-chip">Order Issue</span></div>
      </div>
    </div>
  );
}

export function AgentWorkflow() {
  const { profile } = useProfile();
  const { channel } = useParams();
  const isSms = (channel ?? "sms") !== "voice";
  const channelLabel = isSms ? "SMS" : "Voice";
  const workflowName = `${profile.customerName} - ${channelLabel}`;
  const [voicePreview, setVoicePreview] = useState(false);
  const [inCall, setInCall] = useState(false);
  const closeVoice = () => { setVoicePreview(false); setInCall(false); };

  return (
    <AgentStudioLayout>
      <div className="wf-top">
        <h2 className="wf-title">Agent Workflow: {workflowName}</h2>
        <div className="wf-top-actions">
          {isSms && <button className="wf-preview wf-preview-agent" onClick={() => window.open("/agent-studio/agent/preview", "_blank", "noopener")}>Preview Agent</button>}
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
        {isSms
          ? <FlowTree channelLabel={channelLabel} bookingTerm={profile.bookingTerm} />
          : <VoiceFlowTree />}

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
