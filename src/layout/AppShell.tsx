import { Outlet } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { AiAssistantDrawer } from "../components/AiAssistantDrawer";
import { DashboardBoundary } from "../components/DashboardBoundary";
import { ReadmeButton } from "../components/ReadmeButton";

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
      <AiAssistantDrawer />
      {/* Floating, bottom-right of every in-app screen. */}
      <ReadmeButton />
    </div>
  );
}
