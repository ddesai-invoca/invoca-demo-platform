import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { isShareMode } from "../data/shareMode";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { AiAssistantDrawer } from "../components/AiAssistantDrawer";
import { DashboardBoundary } from "../components/DashboardBoundary";

export function AppShell() {
  /* The phone menu (body.nav-open, toggled by the top bar's hamburger) closes itself on
     every navigation, so picking a screen from it lands on that screen rather than behind
     the menu. A no-op on desktop, where the class is never set. */
  const { pathname } = useLocation();
  useEffect(() => { document.body.classList.remove("nav-open"); }, [pathname]);
  return (
    <div className="app">
      <div className="nav-scrim" onClick={() => document.body.classList.remove("nav-open")} aria-hidden="true" />
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
