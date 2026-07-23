import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProfileProvider } from "./data/ProfileContext";
import { SmsCaptureProvider } from "./data/SmsCaptureContext";
import { VoiceCaptureProvider } from "./data/VoiceCaptureContext";
import { AiAssistantProvider } from "./data/AiAssistantContext";
import { AppShell } from "./layout/AppShell";
import { DigitalInsights } from "./screens/DigitalInsights";
import { MyReports } from "./screens/MyReports";
import { ConversationIntelligence } from "./screens/ConversationIntelligence";
import { SmsConversationIntelligence } from "./screens/SmsConversationIntelligence";
import { VoiceConversationIntelligence } from "./screens/VoiceConversationIntelligence";
import { ArtifactView } from "./screens/ArtifactView";
import { MarketingDashboard } from "./screens/MarketingDashboard";
import { MarketingOpsDashboard } from "./screens/MarketingOpsDashboard";
import { AiAgentConversionDashboard } from "./screens/AiAgentConversionDashboard";
import { AiMessagingImpactDashboard } from "./screens/AiMessagingImpactDashboard";
import { QualityManagementDashboard } from "./screens/QualityManagementDashboard";
import { QmInstantInsightsDashboard } from "./screens/QmInstantInsightsDashboard";
import { ManageDashboards } from "./screens/ManageDashboards";
import { CallReview } from "./screens/CallReview";
import { CallDetail } from "./screens/CallDetail";
import { AgentStudio } from "./screens/AgentStudio";
import { AgentConfig } from "./screens/AgentConfig";
import { KnowledgeSources } from "./screens/KnowledgeSources";
import { AiRecommendations } from "./screens/AiRecommendations";
import { AgentWorkflow } from "./screens/AgentWorkflow";
import { Launch } from "./screens/Launch";
import { SmsPreviewPage } from "./screens/SmsPreviewPage";
import { Placeholder } from "./screens/Placeholder";
import { NAV } from "./components/nav";

/* Some screens are EXACT static copies of real pages (the Invoca Exchange and
   the Shady Blinds Google Ads console), served from public/*.html so the real
   HTML/CSS/assets render untouched. We hand off via a full-page load. */
function StaticRedirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return null;
}

/* Screens we've built get real components; everything else in the nav routes
   to a Placeholder for now (so the nav is fully clickable end-to-end). */
const BUILT: Record<string, ReactNode> = {
  "/reports": <MyReports />,
  "/dashboards": <ManageDashboards />,
  "/call-review": <CallReview />,
  "/agent-studio": <AgentStudio />,
};

/* Standalone screens render OUTSIDE the app shell (their own full-page chrome). */
const STANDALONE = new Set(["/integrations"]);

export default function App() {
  return (
    <ProfileProvider>
      <SmsCaptureProvider>
      <VoiceCaptureProvider>
      <AiAssistantProvider>
      <BrowserRouter>
        <Routes>
          {/* Launch screen (new prospect / revisit) — full-page, outside the shell */}
          <Route path="/" element={<Launch />} />
          <Route path="/launch" element={<Launch />} />

          {/* Standalone full-page routes (no sidebar/topbar) — exact static copies */}
          <Route path="/integrations" element={<StaticRedirect to="/invoca-exchange.html" />} />
          <Route path="/integrations/google-ads" element={<StaticRedirect to="/google-ads.html" />} />

          {/* Preview Agent (SMS) — opens in its own browser tab from Agent Workflow */}
          <Route path="/agent-studio/agent/preview" element={<SmsPreviewPage />} />

          {/* Everything else lives inside the app shell */}
          <Route element={<AppShell />}>
            {/* Reports nav → My Reports list; individual reports open from there */}
            <Route path="/reports/digital-insights" element={<DigitalInsights />} />
            <Route path="/reports/conversation-intelligence" element={<ConversationIntelligence />} />
            <Route path="/reports/sms-conversation-intelligence" element={<SmsConversationIntelligence />} />
            <Route path="/reports/voice-conversation-intelligence" element={<VoiceConversationIntelligence />} />
            <Route path="/reports/artifact/:id" element={<ArtifactView />} />
            {/* Dashboards nav → Manage list; individual dashboards open from there */}
            {/* Agent Studio → agent configuration editor (opened from a workflow row) */}
            <Route path="/agent-studio/agent" element={<AgentConfig />} />
            <Route path="/agent-studio/agent/knowledge" element={<KnowledgeSources />} />
            <Route path="/agent-studio/agent/recommendations" element={<AiRecommendations />} />
            <Route path="/agent-studio/agent/workflow/:channel" element={<AgentWorkflow />} />
            <Route path="/dashboards/marketing" element={<MarketingDashboard />} />
            <Route path="/dashboards/marketing-ops" element={<MarketingOpsDashboard />} />
            <Route path="/dashboards/ai-agent-conversion" element={<AiAgentConversionDashboard />} />
            <Route path="/dashboards/ai-messaging-impact" element={<AiMessagingImpactDashboard />} />
            <Route path="/dashboards/quality-management" element={<QualityManagementDashboard />} />
            <Route path="/dashboards/qm-instant-insights" element={<QmInstantInsightsDashboard />} />
            <Route path="/call-review/detail" element={<CallDetail />} />
            {NAV.filter((item) => !STANDALONE.has(item.path)).map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={BUILT[item.path] ?? <Placeholder name={item.label} />}
              />
            ))}
          </Route>
        </Routes>
      </BrowserRouter>
      </AiAssistantProvider>
      </VoiceCaptureProvider>
      </SmsCaptureProvider>
    </ProfileProvider>
  );
}
