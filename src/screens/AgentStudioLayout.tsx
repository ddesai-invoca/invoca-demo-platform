import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";

/* Shared chrome for the Agent Studio editor sub-pages (Agent Settings,
   Knowledge Sources, …): header + left sub-nav + sticky footer. The active
   sub-nav item is driven by the current route. Icons match the live Titan/MUI
   set: LibraryBooksIcon / School / AutoAwesome / TransformIcon. */

export function InfoDot() {
  return <span className="material-icons ag-info">info_outline</span>;
}

const SUBNAV = [
  { key: "settings", label: "Agent Settings", icon: "library_books", to: "/agent-studio/agent" },
  { key: "knowledge", label: "Knowledge Sources", icon: "school", to: "/agent-studio/agent/knowledge" },
  { key: "recommendations", label: "AI Recommendations", icon: "auto_awesome", to: "/agent-studio/agent/recommendations" },
];

export function AgentStudioLayout({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const name = profile.customerName;
  const { pathname } = useLocation();

  const workflows = [
    { name: `${name} - Voice`, channel: "voice", status: "Live" },
    { name: `${name} - SMS`, channel: "sms", status: "Live" },
  ];

  return (
    <div className="ag-page">
      <div className="ag-header">
        <div className="ag-header-main">
          <div className="ag-eyebrow">AGENT STUDIO</div>
          <div className="ag-title-row">
            <h1 className="ag-title">{name}</h1>
            <span className="ag-live">Live</span>
          </div>
        </div>
        <div className="ag-lastsaved">Last Saved 6/21/2026, 1:01:31 PM</div>
      </div>

      <div className="ag-body">
        <aside className="ag-subnav">
          {SUBNAV.map((s) => {
            const inner = (<><span className="material-icons">{s.icon}</span><span>{s.label}</span></>);
            return s.to ? (
              <Link key={s.key} to={s.to} className={"ag-nav-item" + (pathname === s.to ? " active" : "")}>{inner}</Link>
            ) : (
              <button key={s.key} className="ag-nav-item">{inner}</button>
            );
          })}
          <button className="ag-nav-item ag-nav-workflows">
            <span className="material-icons">transform</span>
            <span>Agent Workflows</span>
          </button>
          <div className="ag-wf-list">
            {workflows.map((w) => {
              const to = `/agent-studio/agent/workflow/${w.channel}`;
              return (
                <Link to={to} className={"ag-wf" + (pathname === to ? " active" : "")} key={w.name}>
                  <span className="material-icons ag-wf-ic">{w.channel === "voice" ? "call" : "chat"}</span>
                  <span className="ag-wf-name">{w.name}</span>
                  <span className="ag-wf-status">{w.status}</span>
                  <span className="material-icons ag-wf-menu">more_vert</span>
                </Link>
              );
            })}
            <button className="ag-create-wf"><span className="material-icons">add</span> Create Workflow</button>
          </div>
        </aside>

        <section className="ag-content">{children}</section>
      </div>

      <div className="ag-footer">
        <a className="ag-cancel" href="#">Cancel</a>
        <button className="ag-save">Save</button>
        <button className="ag-publish">Publish</button>
      </div>
    </div>
  );
}
