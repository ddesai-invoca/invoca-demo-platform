import { Outlet } from "react-router-dom";
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
      <AiAssistantDrawer />
    </div>
  );
}
