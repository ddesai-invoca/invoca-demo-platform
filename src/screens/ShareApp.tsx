import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CustomerProfile } from "../data/schema";
import { ProfileProvider } from "../data/ProfileContext";
import { SmsCaptureProvider } from "../data/SmsCaptureContext";
import { VoiceCaptureProvider } from "../data/VoiceCaptureContext";
import { QuoteCaptureProvider } from "../data/QuoteCaptureContext";
import { AiAssistantProvider, useAiAssistant } from "../data/AiAssistantContext";
import { AppShell } from "../layout/AppShell";
import { AgentStudio } from "./AgentStudio";
import { AgentConfig } from "./AgentConfig";
import { KnowledgeSources } from "./KnowledgeSources";
import { AiRecommendations } from "./AiRecommendations";
import { AgentWorkflow } from "./AgentWorkflow";
import { MyReports } from "./MyReports";
import { SmsConversationIntelligence } from "./SmsConversationIntelligence";
import { VoiceConversationIntelligence } from "./VoiceConversationIntelligence";
import { SmsPreviewPage } from "./SmsPreviewPage";
import { SHARE_TOKEN, SHARE_BASENAME, SHARE_LANDING, shareAllows } from "../data/shareMode";

/* =============================================================================
   ShareApp — what a PROSPECT sees, and deliberately nothing else
   -----------------------------------------------------------------------------
   Asked for 10/6/2026, and clarified: the prospect sees only THEIR demo, cannot
   switch networks, never sees the launch screen, and lands straight on Agent
   Studio.

   ⚠️⚠️ **A SEPARATE ROUTE TREE, NOT THE REAL ONE WITH THINGS HIDDEN.** The app's
   own `<Routes>` carries every dashboard, Signal, the Salesforce screens and the
   launch form. Reusing it and filtering would mean one forgotten entry is a live
   screen on a prospect's machine — and this repo has already paid for that shape
   once: gating a dashboard's LIST ROW left a bookmarked URL rendering the whole
   dashboard. Here the routes a prospect may reach are the only routes that exist,
   so an unlisted path has nothing to render rather than something to refuse.

   ⚠️ `AiAssistantProvider` is absent on purpose. Ask AI is not hidden here, it is
   simply not mounted — the drawer, the per-tile sparkles and the top-bar pair all
   read that context, so none of them can render.
   ============================================================================= */

type Phase =
  | { k: "loading" }
  | { k: "locked"; prospect: string; error?: string }
  | { k: "gone"; message: string }
  | { k: "open"; profile: CustomerProfile; demoId: string; customizations: unknown };

function Shell({ children }: { children: ReactNode }) {
  return <div className="share-gate"><div className="share-card">{children}</div></div>;
}

export default function ShareApp() {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  /** Pull the demo once the link is unlocked. */
  async function openDemo(): Promise<boolean> {
    const res = await fetch(`/api/share/${SHARE_TOKEN}/demo`);
    if (!res.ok) return false;
    const body = await res.json();
    const parsed = CustomerProfile.safeParse(body?.demo?.profile);
    if (!parsed.success) {
      setPhase({ k: "gone", message: "This demo could not be loaded. Please contact your Invoca contact." });
      return true;
    }
    setPhase({ k: "open", profile: parsed.data, demoId: body.demo.id, customizations: body.demo.customizations ?? {} });
    return true;
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/share/${SHARE_TOKEN}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setPhase({ k: "gone", message: body?.error || "This demo link is not valid." });
      /* ⚠️ A returning visitor still holds the unlock cookie, so the password is not
         asked for twice inside the same link's lifetime. */
      if (!body.needsPassword && (await openDemo())) return;
      setPhase({ k: "locked", prospect: body.prospect || "" });
    })().catch(() => setPhase({ k: "gone", message: "This demo link is not available right now." }));
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${SHARE_TOKEN}/unlock`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 410) return setPhase({ k: "gone", message: body?.error || "This demo link has expired." });
      if (!res.ok) {
        setPhase((p) => (p.k === "locked" ? { ...p, error: body?.error || "That password is not right." } : p));
        return;
      }
      await openDemo();
    } finally { setBusy(false); }
  }

  if (phase.k === "loading") return <Shell><p className="share-muted">Opening your demo…</p></Shell>;

  if (phase.k === "gone") {
    return (
      <Shell>
        <h1 className="share-title">This demo is no longer available</h1>
        <p className="share-muted">{phase.message}</p>
        <p className="share-muted">Please get in touch with your Invoca contact for a new link.</p>
      </Shell>
    );
  }

  if (phase.k === "locked") {
    return (
      <Shell>
        <h1 className="share-title">{phase.prospect ? `${phase.prospect} — AI Agent demo` : "AI Agent demo"}</h1>
        <p className="share-muted">Enter the password your Invoca contact shared with you.</p>
        <form onSubmit={unlock} className="share-form">
          <label className="share-label" htmlFor="share-pw">Password</label>
          <input id="share-pw" className="share-input" type="password" value={password} autoFocus
            autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          {phase.error && <p className="share-error">{phase.error}</p>}
          <button className="share-btn" type="submit" disabled={busy || !password}>
            {busy ? "Checking…" : "Open demo"}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <ProfileProvider only={phase.profile}>
      <AiAssistantProvider>
      <HydrateShared demoId={phase.demoId} customizations={phase.customizations} />
      <SmsCaptureProvider>
      <VoiceCaptureProvider>
      <QuoteCaptureProvider>
        {/* ⚠️ `basename` is what lets every existing screen keep its own paths — the
            prospect's URL is `/share/<token>/agent-studio` and the app reads
            `/agent-studio`, so no screen needed changing. */}
        <BrowserRouter basename={SHARE_BASENAME}>
          <ShareRoutes />
        </BrowserRouter>
      </QuoteCaptureProvider>
      </VoiceCaptureProvider>
      </SmsCaptureProvider>
      </AiAssistantProvider>
    </ProfileProvider>
  );
}

/**
 * ⚠️⚠️ **THIS IS WHAT MAKES "the SE's changes reach the prospect" TRUE.** An SE's Ask AI
 * edits are not in the profile — they live in the demo record's `customizations`, which
 * the override layer merges on top. Without this the prospect would see the generated
 * base and none of the tuning, and the share would silently show a different agent from
 * the one the SE configured.
 * ⚠️ `canEdit: true` keeps the drawers working, which was asked for; the SYNC is blocked
 * inside `AiAssistantContext` for a share, so nothing a prospect does leaves their browser.
 */
function HydrateShared({ demoId, customizations }: { demoId: string; customizations: unknown }) {
  const { hydrateDemo } = useAiAssistant();
  useEffect(() => {
    hydrateDemo(demoId, (customizations ?? {}) as never, true, { name: "", email: "" });
  }, [demoId, customizations, hydrateDemo]);
  return null;
}

/** A path the shared demo does not carry. Not a 404 — it is not theirs to see. */
function NotInThisDemo() {
  return (
    <div className="placeholder">
      <h2>Not part of this demo</h2>
      <p className="muted">This page isn't included in the demo that was shared with you.</p>
    </div>
  );
}

function ShareRoutes() {
  const { pathname } = useLocation();
  /* ⚠️ A SECOND, BELT-AND-BRACES GUARD over the route list itself, so a route added
     to this file later without a thought still has to pass `shareAllows`. */
  if (!shareAllows(pathname)) {
    /* ⚠️ Rendered WITHOUT the shell on purpose: the sidebar and top bar belong to a
       demo, and this path is not part of one. The catch-all route below covers the
       same ground from inside the shell for a path that merely has no element. */
    return <Shell><h1 className="share-title">Not part of this demo</h1><p className="share-muted">This page isn't included in the demo that was shared with you.</p></Shell>;
  }
  return (
    <Routes>
      {/* ⚠️ OUTSIDE the shell, exactly as the real route tree registers it: the phone
          preview is a full-page screen opened in its own tab. */}
      <Route path="/agent-studio/agent/preview" element={<SmsPreviewPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={SHARE_LANDING} replace />} />
        <Route path="/agent-studio" element={<AgentStudio />} />
        {/* ⚠️ `AgentStudioLayout` is NOT a route layout — each of these screens wraps
            itself in it, the same way the real route tree registers them. */}
        <Route path="/agent-studio/agent" element={<AgentConfig />} />
        <Route path="/agent-studio/agent/knowledge" element={<KnowledgeSources />} />
        <Route path="/agent-studio/agent/recommendations" element={<AiRecommendations />} />
        <Route path="/agent-studio/agent/workflow/:channel" element={<AgentWorkflow />} />
        <Route path="/reports" element={<MyReports />} />
        <Route path="/reports/sms-conversation-intelligence" element={<SmsConversationIntelligence />} />
        <Route path="/reports/voice-conversation-intelligence" element={<VoiceConversationIntelligence />} />
        <Route path="*" element={<NotInThisDemo />} />
      </Route>
    </Routes>
  );
}
