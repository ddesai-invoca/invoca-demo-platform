import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import { VoicePreviewIllustration } from "../components/VoicePreviewIllustration";
import { WorkflowChatPreview } from "../components/WorkflowChatPreview";
import { VoiceCall } from "./VoiceCall";
import { WorkflowTree, type WorkflowTreeModel, type TreeBranch } from "../components/WorkflowTree";
import { usePageData } from "../components/GeneratedTiles";

/* Agent Studio → a workflow's Definition (flow diagram). Opened from a workflow
   in the left sub-nav. Template flow (Conversation Start → classify intent →
   Sales / Support branches) with the title derived from the customer + channel. */

/* Derives every label from the prospect's own voice routing queues
   (reports.voiceRoutingDemo.queues), which all seven profiles already carry in
   the same shape: [0] is the new-business intent, [1] is existing-customer
   support, [2] is general. Previously this tree was hardcoded Shady Blinds
   retail copy, so Orlando Health's voice workflow talked about ordering window
   treatments and collecting an Order Number. */
function voiceCopy(p: ReturnType<typeof useProfile>["profile"]) {
  const q = p.reports.voiceRoutingDemo?.queues ?? [];
  /* Queue names carry a qualifier after a separator ("Consultation - LASIK New
     Patient"); the node title wants the head, so cut at the first one.

     COMMA included, not just dashes: the em-dash migration rewrote every queue
     name from "Support - Existing Move" to "Support, Existing Move", so this
     stopped trimming anything and the intent nodes started showing the whole
     queue name. Splitting on both restores what the code always meant to do. */
  const head = (n?: string, fb = "") =>
    (n ?? fb).split(/\s*[-–—,]\s*/)[0].trim() || fb;
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

/* THE TREE MODEL, derived per prospect.

   Reproduces exactly what the four hand-built trees rendered, but as DATA, so the
   AI drawer can rename any node, add a branch or remove one and the renderer
   works the layout out (see components/WorkflowTree.tsx). Nothing is persisted in
   the schema and no engine phase is involved, so every prospect already on disk
   gets an editable diagram immediately.

   The National Van Lines two-leaf split used to be a separate 100-line component
   with its own canvas size and connector coordinates. It is now just a branch
   with two leaves, which the layout absorbs — and any prospect can be given the
   same shape by asking the AI for it. */
/* PER-PROSPECT SHAPE OVERRIDES.

   National Van Lines routes a new move to two different teams, which used to be a
   separate 100-line component with its own canvas size and hand-placed connector
   coordinates (VOICE_SPLIT + VoiceFlowTreeSplit). It is now just a branch with two
   leaves, and the computed layout absorbs it — the same shape the AI can now
   produce for any prospect on request.

   Kept as a default rather than dropped, because it was a delivered change: an SE
   opening that demo should still find the tree they were shown. */
const SHAPE: Record<string, (c: ReturnType<typeof voiceCopy>) => TreeBranch[] | null> = {
  "national-van-lines": (c) => [
    {
      title: "Book a Move", icon: "cart",
      subtitle: "Caller wants to book a move and is not an existing customer",
      leaves: [
        { title: "All Inter-State Users", action: "Route to Inter-State Move (Team A)",
          tone: "green", chips: ["Origin ZIP", "Destination ZIP", "Move Date"] },
        { title: "All Local Move Users", action: "Route to Local Move (Team B)",
          tone: "green", chips: ["Origin ZIP", "Move Size", "Move Date"] },
      ],
    },
    {
      title: c.supQ, subtitle: c.supSub, icon: "headset",
      leaves: [{ title: `All ${c.supQ} Users`, action: `Route to ${c.supQueue}`,
        tone: "orange", chips: c.supChips }],
    },
  ],
};

function deriveTree(
  profile: ReturnType<typeof useProfile>["profile"],
  isSms: boolean,
  channelLabel: string,
): WorkflowTreeModel {
  const c = voiceCopy(profile);
  const bookingTerm = profile.bookingTerm;

  if (isSms) {
    return {
      variant: "sms",
      triggeredBy: "0 campaigns and 0 forms",
      startLabel: `${channelLabel} · classify intent`,
      branches: [
        {
          title: c.newQ, icon: "cart",
          leaves: [{
            title: `All ${c.newQ} Users`,
            action: `Schedule ${bookingTerm}`,
            tone: "green",
            chips: ["Consumer Name", c.newChips[0]],
          }],
        },
        {
          title: c.supQ, icon: "headset",
          leaves: [{ title: `All ${c.supQ} Users`, action: "Support & Escalate", tone: "orange" }],
        },
      ],
    };
  }

  const shaped = SHAPE[profile.id]?.(c);
  return {
    variant: "voice",
    triggeredBy: "2 campaigns and 0 forms",
    startLabel: "Voice · classify intent",
    branches: shaped ?? [
      {
        title: c.newQ, subtitle: c.newSub, icon: "cart",
        leaves: [{
          title: `All ${c.newQ} Users`,
          action: `Route to ${c.newQueue}`,
          tone: "green",
          chips: c.newChips,
        }],
      },
      {
        title: c.supQ, subtitle: c.supSub, icon: "headset",
        leaves: [{
          title: `All ${c.supQ} Users`,
          action: `Route to ${c.supQueue}`,
          tone: "orange",
          chips: c.supChips,
        }],
      },
    ],
  };
}

/* An extra workflow (Reyes Law's SMS nurture) already carried its branches as
   data; this maps that flatter shape onto the same model so there is one renderer
   rather than two. */
function extraTree(
  wf: NonNullable<ReturnType<typeof useProfile>["profile"]["reports"]["extraWorkflows"]>[number],
): WorkflowTreeModel {
  return {
    variant: "sms",
    triggeredBy: wf.triggeredBy ?? "1 Campaign",
    startLabel: wf.startLabel,
    branches: wf.branches.map((b) => ({
      title: b.title,
      icon: "altRoute",
      leaves: [{ title: `${b.title} Users`, action: b.action, tone: b.tone, chips: b.chips }],
    })),
  };
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

  /* The diagram is this page's DATA. Registering it as the AI scope is what lets
     the drawer rename a node, add a branch or remove one; the renderer recomputes
     the layout from whatever it is handed. SMS and Voice are different pathnames,
     so their edits and undo stacks are separate. `title` gives the drawer a real
     scope label. */
  const baseTree = useMemo(() => ({
    title: `${workflowName} workflow`,
    ...(extra ? extraTree(extra) : deriveTree(profile, isSms, channelLabel)),
  }), [extra, profile, isSms, channelLabel, workflowName]);
  const tree = usePageData(baseTree);
  const [voicePreview, setVoicePreview] = useState(false);
  const [inCall, setInCall] = useState(false);
  const closeVoice = () => { setVoicePreview(false); setInCall(false); };
  /* Preview Workflow is channel-specific: Voice slides in the call drawer, SMS
     opens the chat drawer that tests the same agent as the Preview Agent screen.
     Until now the SMS button was inert — it rendered and did nothing. */
  const [smsPreview, setSmsPreview] = useState(false);

  return (
    <AgentStudioLayout>
      <div className="wf-top">
        <h2 className="wf-title">Agent Workflow: {workflowName}</h2>
        <div className="wf-top-actions">
          {isSms && <button className="wf-preview wf-preview-agent" onClick={() => window.open(
            extra ? `/agent-studio/agent/preview?wf=${encodeURIComponent(extra.slug)}`
                  : "/agent-studio/agent/preview",
            "_blank", "noopener")}>Preview Agent</button>}
          <button className="wf-preview" onClick={() => isSms ? setSmsPreview(true) : setVoicePreview(true)}>Preview Workflow</button>
        </div>
      </div>
      {isSms && smsPreview && (
        <WorkflowChatPreview
          workflowName={workflowName}
          wfSlug={extra?.slug}
          onClose={() => setSmsPreview(false)}
        />
      )}
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
        <WorkflowTree model={tree} />

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
