import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import { VoicePreviewIllustration } from "../components/VoicePreviewIllustration";
import { WorkflowChatPreview } from "../components/WorkflowChatPreview";
import { VoiceCall } from "./VoiceCall";
import { VoiceCallLive } from "./VoiceCallLive";
import { useLiveKitReady } from "../data/liveKitVoice";
import { WorkflowTree, type WorkflowTreeModel, type TreeBranch } from "../components/WorkflowTree";
import { usePageData } from "../components/GeneratedTiles";
import { isProspect } from "../data/prospect";

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
/* ⚠️ THE SMS TEMPLATE'S NODE NAMES ARE FIXED FOR EVERY PROSPECT, because the real product
   does not let a user rename them (confirmed against the live Agent Management page
   8/24/2026). Two of the four were never at risk — "Triggered by" and "Conversation Start"
   are literals in WorkflowTree.tsx. The INTENT names were being derived from each prospect's
   own routing queues, which is why Shady Blinds showed "Design Consultation" / "Existing
   Order" where the product always shows "Sales Inquiry" / "Need Support".

   ⚠️ AND THEY ARE `locked`, so the AI cannot rename them either. Without that flag the
   assistant would accept "rename this node", write the edit and change nothing — see
   `editGuard.isLockedEdit` for why a refusal beats a silent no-op.

   ⚠️ THE TRIGGER LINE IS THE PRODUCT'S TOO: "0 Campaigns, 0 Forms, and 0 Inbound SMS". Ours
   said "0 campaigns and 0 forms", which is the VOICE wording — it never mentioned SMS on a
   screen whose whole subject is SMS.

   ⚠️ SCOPED TO THE SMS TEMPLATE. The Voice tree's intent nodes still derive from the
   prospect's real queues and carry caller-intent subtitles, because those were measured off
   Invoca's own Voice workflow page. Lock those too only against evidence from that screen. */
/* ⚠️ RENAMED FROM SMS_* BECAUSE BOTH CHANNELS USE THEM NOW (8/26/2026). The voice tree's
   intents were the prospect's own queue names until the user confirmed the real Voice page
   shows these same two words; leaving them called INTENT_SALES on a voice tree reads as a bug and
   invites someone to "fix" it back. SMS_TRIGGER keeps its name — its wording genuinely names
   inbound SMS and the voice tree has its own trigger line. */
const SMS_TRIGGER = "0 Campaigns, 0 Forms, and 0 Inbound SMS";
const INTENT_SALES = "Sales Inquiry";
const INTENT_SUPPORT = "Need Support";
/** The support leaf is "All Support Users", NOT "All Need Support Users". */
const SUPPORT_LEAF = "All Support Users";
/* The two leaf ACTIONS the product defaults to. Not the prospect's queue: "Route to <queue>"
   was ours, and the real page shows one of a fixed set of agent behaviours here. */
const LEAF_QUALIFY = "Qualify";
const LEAF_ESCALATE = "Support & Escalate";

/* `isProspect` moved to src/data/prospect.ts when the franchise AI dashboard needed the same
   test. ONE implementation, several callers — see the note at the top of that file. */

/* PER-PROSPECT *SMS* SHAPE OVERRIDES, matched by prospect name.

   ⚠️ THIS TABLE SHRANK when the four node names were locked into the template above. Three
   of the five things that made Comfort Keepers' tree different turned out to be the
   PRODUCT's, not the prospect's — the trigger line, the two intent names and the support
   leaf title — so they moved into the template and every prospect gets them. What is left is
   genuinely this prospect's configuration:
     - the sales action is "Schedule Callback", with a PHONE icon, not "Schedule <bookingTerm>"
     - one chip, "Consumer Name", where the default carries two
   Keeping the whole tree here instead would have frozen a copy of the template that stops
   tracking it — the same drift the SMS brain note warns about. */
const SMS_SHAPE: { prospect: string; tree: () => Pick<WorkflowTreeModel, "triggeredBy" | "branches"> }[] = [
  {
    prospect: "comfort keepers",
    tree: () => ({
      triggeredBy: SMS_TRIGGER,
      branches: [
        {
          title: INTENT_SALES, icon: "cart", locked: true,
          leaves: [{
            title: `All ${INTENT_SALES} Users`, action: "Schedule Callback",
            tone: "green", actionIcon: "phone", chips: ["Consumer Name"],
          }],
        },
        {
          title: INTENT_SUPPORT, icon: "headset", locked: true,
          leaves: [{
            title: SUPPORT_LEAF, action: "Support & Escalate",
            tone: "orange", warn: true,
          }],
        },
      ],
    }),
  },
];

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
      /* ⚠️ THE INTENT NAME IS THE TEMPLATE'S, EVEN HERE. This override exists for the
         two-team SPLIT, which is genuinely this prospect's configuration; the node it hangs
         off is the same locked "Sales Inquiry" every other account shows. It used to read
         "Book a Move", which is exactly the drift the SMS note warns about — an override
         that quietly keeps a copy of a template that has since changed. */
      title: INTENT_SALES, icon: "cart", locked: true,
      subtitle: "Caller wants to book a move and is not an existing customer",
      leaves: [
        { title: "All Inter-State Users", action: "Route to Inter-State Move (Team A)",
          tone: "green", chips: ["Origin ZIP", "Destination ZIP", "Move Date"] },
        { title: "All Local Move Users", action: "Route to Local Move (Team B)",
          tone: "green", chips: ["Origin ZIP", "Move Size", "Move Date"] },
      ],
    },
    {
      title: INTENT_SUPPORT, subtitle: c.supSub, icon: "headset", locked: true,
      /* ⚠️ THE SUPPORT PATH IS THE TEMPLATE'S, even in this override. Only the SALES branch
         differs for this prospect (two teams instead of one); this side was still carrying
         `All ${c.supQ} Users` / `Route to ${c.supQueue}` — a copy of the default from before
         the leaf became chrome, which is exactly the drift that shrank the Comfort Keepers
         override. An override should differ only where it genuinely differs. */
      leaves: [{ title: SUPPORT_LEAF, action: LEAF_ESCALATE,
        tone: "orange", chips: c.supChips, locked: true }],
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
    const smsShaped = SMS_SHAPE.find((o) => isProspect(profile, o.prospect))?.tree();
    if (smsShaped) return { variant: "sms", startLabel: `${channelLabel} · classify intent`,
      ...smsShaped };
    return {
      variant: "sms",
      triggeredBy: SMS_TRIGGER,
      startLabel: `${channelLabel} · classify intent`,
      /* Same chrome lock: SMS_TRIGGER is the product's exact wording, so it was
         inconsistent for the AI to be able to rewrite it while the intents were refused. */
      chromeLocked: true,
      branches: [
        {
          title: INTENT_SALES, icon: "cart", locked: true,
          leaves: [{
            title: `All ${INTENT_SALES} Users`,
            /* Still per prospect: the ACTION is a configured queue action, not chrome. */
            action: `Schedule ${bookingTerm}`,
            tone: "green",
            chips: ["Consumer Name", c.newChips[0]],
          }],
        },
        {
          title: INTENT_SUPPORT, icon: "headset", locked: true,
          leaves: [{ title: SUPPORT_LEAF, action: "Support & Escalate", tone: "orange" }],
        },
      ],
    };
  }

  const shaped = SHAPE[profile.id]?.(c);
  return {
    variant: "voice",
    triggeredBy: "2 campaigns and 0 forms",
    startLabel: "Voice · classify intent",
    /* Trigger line and Conversation Start are the product's, not the prospect's. */
    chromeLocked: true,
    branches: shaped ?? [
      {
        /* ⚠️ THE VOICE INTENTS ARE THE SAME TWO WORDS THE SMS TEMPLATE USES, and locked for
           the same reason: the real product does not let a user rename them (confirmed
           8/25/2026). They USED to derive from each prospect's own routing queues, which is
           why Shady Blinds read "Design Consultation" / "Existing Order" and AutoNation
           "Test Drive" / "Service Appointment" on a screen that always shows these two.

           ⚠️ THE PROSPECT-SPECIFIC PART MOVED DOWN A ROW, IT DID NOT DISAPPEAR. The queue
           name now lives where it is genuinely configuration — the leaf title and its route
           action — so the diagram still names this prospect's own teams. Only the intent
           label is generic, because in the product it always is. */
        title: INTENT_SALES, subtitle: c.newSub, icon: "cart", locked: true,
        leaves: [{
          /* ⚠️ THE LEAF IS CHROME TOO (8/26/2026). It read `All ${c.newQ} Users` /
             `Route to ${c.newQueue}` — the prospect's own queue — where the real page always
             shows the user group named after the intent and one of a fixed set of actions.
             So the whole top of the tree down to and including this row is the product's, and
             only the CHIPS below it are configuration.

             ⚠️ CONSEQUENCE, AND IT IS REAL: the diagram no longer contains a destination the
             agent could name aloud. `buildVoiceSystem` therefore stopped reading a group label
             into the spoken handoff — see the note there. */
          title: `All ${INTENT_SALES} Users`,
          action: LEAF_QUALIFY,
          tone: "green",
          chips: c.newChips,
          locked: true,
        }],
      },
      {
        title: INTENT_SUPPORT, subtitle: c.supSub, icon: "headset", locked: true,
        leaves: [{
          title: SUPPORT_LEAF,
          action: LEAF_ESCALATE,
          tone: "orange",
          locked: true,
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
  /* This page's sparkle edits the DIAGRAM, and only the diagram. The SMS agent is a
     different thing living in a different scope, and it has its own sparkle inside
     the Preview Workflow chat. */
  const tree = usePageData(baseTree);
  const [voicePreview, setVoicePreview] = useState(false);
  const [inCall, setInCall] = useState(false);
  const liveKitReady = useLiveKitReady();
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
              /* ⚠️ LIVEKIT WHEN IT IS CONFIGURED, THE ORIGINAL ENGINE OTHERWISE. The
                 streaming pipeline is the point (the old one took 4.5-6s to speak), but a
                 missing key or a LiveKit outage must not leave an SE with a dead Start Call
                 mid-demo — so the fallback is real and stays until this is proven. */
              liveKitReady
                ? <VoiceCallLive onEnd={() => setInCall(false)} />
                : <VoiceCall onEnd={() => setInCall(false)} />
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
