import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProfileProvider } from "./data/ProfileContext";
import { SmsCaptureProvider } from "./data/SmsCaptureContext";
import { VoiceCaptureProvider } from "./data/VoiceCaptureContext";
import { AiAssistantProvider } from "./data/AiAssistantContext";
import { DemoLibraryProvider } from "./data/DemoLibraryContext";
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
import { LocationComparisonDashboard } from "./screens/LocationComparisonDashboard";
import { ManageDashboards } from "./screens/ManageDashboards";
import { InsightsAnalytics } from "./screens/InsightsAnalytics";
import { InsightsReport } from "./screens/InsightsReport";
import { InsightsCallDetail } from "./screens/InsightsCallDetail";
import { CallReview } from "./screens/CallReview";
import { CallDetail } from "./screens/CallDetail";
import { AgentStudio } from "./screens/AgentStudio";
import { AgentConfig } from "./screens/AgentConfig";
import { KnowledgeSources } from "./screens/KnowledgeSources";
import { AiRecommendations } from "./screens/AiRecommendations";
import { AgentWorkflow } from "./screens/AgentWorkflow";
import { SignalManager } from "./screens/SignalManager";
import { SignalTypeSelect } from "./screens/SignalTypeSelect";
import { SemanticSignalLibrary } from "./screens/SemanticSignalLibrary";
import { EditRuleSignal } from "./screens/EditRuleSignal";
import { Launch } from "./screens/Launch";
import { SmsPreviewPage } from "./screens/SmsPreviewPage";
import { ChatGptAd } from "./screens/ChatGptAd";
import { GoogleSearch } from "./screens/GoogleSearch";
import { Placeholder } from "./screens/Placeholder";
import { ReadmeButton } from "./components/ReadmeButton";
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
  "/insights": <InsightsAnalytics />,
  "/dashboards": <ManageDashboards />,
  "/call-review": <CallReview />,
  "/agent-studio": <AgentStudio />,
  "/signal": <SignalManager />,
};

/* Standalone screens render OUTSIDE the app shell (their own full-page chrome). */
const STANDALONE = new Set(["/integrations"]);

export default function App() {
  return (
    <ProfileProvider>
      <DemoLibraryProvider>
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

          {/* ChatGPT sponsored placement — the AI-channel counterpart to the
              Google Ads page: where the call starts, before Invoca sees it.
              Profile-driven, so it re-skins per prospect like the app screens. */}
          <Route path="/integrations/chatgpt" element={<ChatGptAd />} />

          {/* Google results page, opened from the "Network" chip in the top bar.
              The other half of the same story: the prospect holds the top
              sponsored slot, and the click carries the paid parameters into
              their site. Standalone, because it is not an Invoca screen. */}
          <Route path="/google-search" element={<GoogleSearch />} />

          {/* Preview Agent (SMS) — opens in its own browser tab from Agent Workflow */}
          <Route path="/agent-studio/agent/preview" element={<SmsPreviewPage />} />

          {/* Everything else lives inside the app shell */}
          <Route element={<AppShell />}>
            {/* Reports nav → My Reports list; individual reports open from there */}
            {/* A saved Insights dashboard. The real URL carries a uuid; we pass
                the name so the title matches the row that was clicked. */}
            <Route path="/insights/dashboard/:name" element={<InsightsReport />} />
            {/* The one call reachable from the interaction drawer. NOT the Call Review
                detail page (/call-review/detail) — different Invoca screen, left alone. */}
            <Route path="/insights/call" element={<InsightsCallDetail />} />
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
            <Route path="/dashboards/location-comparison" element={<LocationComparisonDashboard />} />
            <Route path="/call-review/detail" element={<CallDetail />} />
            {/* Signal's flyout offers three destinations. Manage Signals is /signal
                (SignalManager, via the NAV loop below); these two are not built yet. */}
            <Route path="/signal/rule" element={<EditRuleSignal />} />
            <Route path="/signal/new" element={<SignalTypeSelect />} />
            <Route path="/signal/new/semantic" element={<SemanticSignalLibrary />} />
            <Route path="/signal/ai-studio" element={<Placeholder name="Signal AI Studio" />} />
            <Route path="/signal/discovery" element={<Placeholder name="Signal Discovery" />} />
            {NAV.filter((item) => !STANDALONE.has(item.path)).map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={BUILT[item.path] ?? <Placeholder name={item.label} />}
              />
            ))}
          </Route>
        </Routes>
        {/* Outside <Routes> so it renders on every screen, Launch included -- but inside
            <BrowserRouter>, because it reads the path to stay off the prospect-facing pages. */}
        <ReadmeButton />
      </BrowserRouter>
      </AiAssistantProvider>
      </VoiceCaptureProvider>
      </SmsCaptureProvider>
      </DemoLibraryProvider>
    </ProfileProvider>
  );
}
