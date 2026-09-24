import { useEffect, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import type { CustomerProfile, KnowledgeSource } from "../data/schema";
import { usePageData } from "../components/GeneratedTiles";
import { knowledgeHref } from "../data/knowledgeLinks";
import { renderSalesPlaybook } from "../artifacts/salesPlaybook";

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

  /* ⚠️ THE DOCUMENT IS BUILT ON DEMAND AND OPENED AS A BLOB, the same mechanism
     the three Gumloop artifacts use (`src/artifacts/index.ts`) — there is no
     file on disk to link to, and the playbook is derived from this prospect's
     own agent config at the moment it is asked for. Revoked after a minute so a
     reload in the new tab still works for a while. */
  function openPlaybook(e: React.MouseEvent) {
    e.preventDefault();
    const url = URL.createObjectURL(new Blob([renderSalesPlaybook(profile)], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /* Registers this page as the AI scope and returns agentConfig with any
     edits made ON THIS PAGE overlaid. */
  const ac = usePageData(profile.reports.agentConfig);
  const configured = ac?.knowledgeSources ?? [];
  const all = configured.length ? configured : defaultSources(profile);
  /* ⚠️⚠️ **RESOLVED FROM THE SITE'S OWN NAVIGATION, ASYNCHRONOUSLY, AND THE
     HOMEPAGE IS THE STATE UNTIL IT LANDS.** Reported: *"all the links are still
     going to the same home page"* — they were, because nothing in a profile
     carries a URL. The server reads the prospect's real nav and matches each
     label to a page it actually publishes (engine/siteLinks.ts); anything it
     cannot match stays on the homepage rather than becoming a guessed path.
     ⚠️ ONE REQUEST PER PROSPECT, not per row, and the result is cached server
     side per domain — a screen with five links must not be five fetches of
     somebody else's website. */
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const labels = all.filter((s) => s.type === "Web Link").map((s) => s.name);
  const labelKey = labels.join("|");
  useEffect(() => {
    let alive = true;
    setResolved({});
    if (!labels.length) return;
    fetch("/api/site-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: profile.websiteUrl || `https://${profile.brandDomain}`, labels }),
    })
      .then((r) => (r.ok ? r.json() : null))
      /* A failure is silent on purpose: every link already points somewhere
         real, so there is nothing to report and nothing to retry. */
      .then((d) => { if (alive && d?.links) setResolved(d.links); })
      .catch(() => { /* keep the homepage fallback */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, labelKey]);

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
                    {/* ⚠️ A DOCUMENT OPENS THE GENERATED PLAYBOOK; A WEB LINK GOES
                        TO THE SITE. Both are real destinations — see
                        `src/data/knowledgeLinks.ts` for why a Web Link lands on the
                        prospect's own site rather than a path guessed from its
                        label (nothing in the data carries a URL, and a guessed
                        path 404s mid-demo). */}
                    {s.type === "Document" ? (
                      <a
                        className="ks-link"
                        href="#"
                        title={`Open ${s.name}`}
                        onClick={openPlaybook}
                      >
                        {s.name}
                      </a>
                    ) : (
                      <a
                        className="ks-link"
                        href={resolved[s.name] ?? knowledgeHref(profile, s)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={resolved[s.name] ?? knowledgeHref(profile, s)}
                      >
                        {s.name}
                      </a>
                    )}
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
