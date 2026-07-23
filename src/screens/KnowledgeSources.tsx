import { useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import type { CustomerProfile, KnowledgeSource } from "../data/schema";

/* Fallback sources for profiles missing their own — derived from the brand's
   name + domain so the table always renders. Freshly generated prospects get
   their own (playbook + the main website pages the agent learned from). */
function defaultSources(profile: CustomerProfile): KnowledgeSource[] {
  const doc = `${profile.customerName.replace(/[^A-Za-z0-9]+/g, "_")}_Sales_Playbook.pdf`;
  const base = `https://www.${profile.brandDomain}`;
  return [
    { name: doc, type: "Document", lastUpdated: "03/11/2026 10:21 AM" },
    { name: base, type: "Web Link", lastUpdated: "03/11/2026 10:02 AM" },
    { name: `${base}/services/`, type: "Web Link", lastUpdated: "03/11/2026 10:02 AM" },
    { name: `${base}/contact/`, type: "Web Link", lastUpdated: "03/11/2026 10:02 AM" },
  ];
}

export function KnowledgeSources() {
  const { profile } = useProfile();
  const [search, setSearch] = useState("");

  const configured = profile.reports.agentConfig?.knowledgeSources ?? [];
  const all = configured.length ? configured : defaultSources(profile);
  const rows = search.trim()
    ? all.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : all;

  return (
    <AgentStudioLayout>
      <h2 className="ag-section-title">Knowledge Sources</h2>
      <p className="ks-sub">These are links or documents the agent can reference when answering questions.</p>

      <div className="ks-toolbar">
        <div className="ks-search">
          <span className="material-icons">search</span>
          <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="ks-btn"><span className="material-icons">add</span>Upload Documents</button>
        <button className="ks-btn"><span className="material-icons">add</span>Add Web Links</button>
      </div>

      <div className="ks-table-scroll">
        <table className="ks-table">
          <thead>
            <tr>
              <th className="ks-status-col">Status</th>
              <th>Name</th>
              <th>Type</th>
              <th>Last Updated</th>
              <th>Refresh</th>
              <th className="ks-menu-col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={i}>
                <td className="ks-status-col"><span className="material-icons ks-check">check_circle</span></td>
                <td className="ks-name">
                  <span className="ks-name-inner">
                    <span className="material-icons ks-name-ic">{s.type === "Document" ? "attach_file" : "language"}</span>
                    <a className="ks-link" href="#">{s.name}</a>
                  </span>
                </td>
                <td>{s.type}</td>
                <td>{s.lastUpdated}</td>
                <td>{s.type === "Document" ? <span className="ks-dash">-</span> : <a className="ks-refresh" href="#">Off (manual only)</a>}</td>
                <td className="ks-menu-col"><span className="material-icons ks-menu">more_vert</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ks-footer">
        <span className="ks-perpage">Rows per page: <span className="ks-select">10 <span className="material-icons">expand_more</span></span></span>
        <span className="ks-count">1&ndash;{rows.length} of {rows.length}</span>
        <span className="ks-pager">
          <button className="ks-page-arrow"><span className="material-icons">chevron_left</span></button>
          <button className="ks-page-arrow"><span className="material-icons">chevron_right</span></button>
        </span>
      </div>
    </AgentStudioLayout>
  );
}
