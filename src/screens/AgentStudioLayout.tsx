import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { CreateWorkflowModal } from "../components/CreateWorkflowModal";

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
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const { profile } = useProfile();
  const name = profile.customerName;
  const { pathname } = useLocation();

  const workflows = [
    { name: `${name} - Voice`, channel: "voice", status: "Live" },
    { name: `${name} - SMS`, channel: "sms", status: "Live" },
    // per-prospect extras (Reyes Law's SMS nurture agent) — keep their own label
    ...(profile.reports.extraWorkflows ?? []).map((w) => ({
      name: w.label, channel: w.slug, status: w.status ?? "Live",
    })),
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
        {/* ⚠️ THE ACTIONS LIVE UP HERE, NOT IN A FOOTER (8/26/2026). The page carried a
            Cancel / Save / Publish bar pinned to the bottom and the real page has NO footer at
            all — a capture of it contains "Go Live" once and the words Save and Cancel zero
            times (its two "Publish" hits are the sidebar's Publishers nav item). Removing the
            bar without putting its action back would have lost the affordance, so Go Live sits
            where the real one does. */}
        <div className="ag-header-right">
          <div className="ag-lastsaved">Last Saved 6/21/2026, 1:01:31 PM</div>
          <button className="ag-golive">Go Live</button>
        </div>
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
            {/* ⚠️ The modal lives on the SHARED chrome, not on one sub-page, because the
                sub-nav that carries this button is shared — the real page offers it from every
                Agent Studio screen. */}
            <button className="ag-create-wf" onClick={() => setCreateOpen(true)}>
              <span className="material-icons">add</span> Create Workflow
            </button>
          </div>
        </aside>

        <section className="ag-content">{children}</section>
      </div>

      {/* ⚠️ **WHAT CREATE *BUILDS* IS UNMEASURED, so it does the one true thing it can.** The
          capture shows the modal and nothing after it, and this app derives exactly one workflow
          per channel — so Create opens the chosen channel's workflow rather than inventing a
          third one under the typed name and leaving an SE with a row that goes nowhere. Same
          call the Dashboard Configuration drawer makes about its own Save. */}
      <CreateWorkflowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(_name, channel) => {
          setCreateOpen(false);
          navigate(`/agent-studio/agent/workflow/${channel.toLowerCase()}`);
        }}
      />

    </div>
  );
}
