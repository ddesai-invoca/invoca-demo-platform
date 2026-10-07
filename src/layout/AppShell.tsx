import { Outlet } from "react-router-dom";
import { isShareMode } from "../data/shareMode";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { AiAssistantDrawer } from "../components/AiAssistantDrawer";
import { DashboardBoundary } from "../components/DashboardBoundary";

export function AppShell() {
  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="main">
          <DashboardBoundary><Outlet /></DashboardBoundary>
        </main>
      </div>
      {/* ⚠️ NOT RENDERED ON A SHARED DEMO. No control opens it there — the top bar's

          pair is gone — but a closed drawer still sits in the DOM, and a prospect's page

          should not carry the markup of a feature that is not theirs. */}

      {!isShareMode() && <AiAssistantDrawer />}
    </div>
  );
}
