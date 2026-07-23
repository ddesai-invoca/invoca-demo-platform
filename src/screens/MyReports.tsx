import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import type { GumloopArtifact } from "../data/schema";
import { openArtifact } from "../artifacts";

/* My Reports — the landing page for the Reports nav item. Lists a customer's
   saved reports; clicking the built Digital Journey report opens it. The other
   rows are realistic saved-report entries (the real list behaves the same — most
   saved reports are just names/schedules). Derived from customerName, so this
   works for any generated prospect with no engine change. */
interface ReportRow {
  name: string;
  type: string;
  createdAt: string;
  to?: string;   // set → clickable link to a built (in-platform) report
  artifact?: GumloopArtifact;  // set → Gumloop leave-behind (opens in a new tab; status shown)
}

function reportsFor(
  customerName: string,
  hasConversation: boolean,
  hasSmsConversation: boolean,
  hasVoiceConversation: boolean,
  artifacts: GumloopArtifact[],
): ReportRow[] {
  const rows: ReportRow[] = [
    { name: `Digital Journey & Call Attribution Report (${customerName})`, type: "Interaction Details", createdAt: "6/25/26 7:35 am", to: "/reports/digital-insights" },
  ];
  if (hasConversation) {
    rows.push({ name: `Conversation Intelligence (${customerName})`, type: "Interaction Details", createdAt: "6/25/26 7:41 am", to: "/reports/conversation-intelligence" });
  }
  if (hasSmsConversation) {
    rows.push({ name: `AI SMS Conversation Intelligence (${customerName})`, type: "Interaction Details", createdAt: "6/25/26 7:44 am", to: "/reports/sms-conversation-intelligence" });
  }
  if (hasVoiceConversation) {
    rows.push({ name: `AI Voice Conversation Intelligence (${customerName})`, type: "Interaction Details", createdAt: "6/25/26 7:45 am", to: "/reports/voice-conversation-intelligence" });
  }
  // Gumloop leave-behinds — open in a new browser tab once complete; status shows in the Schedule Status column.
  for (const a of artifacts) {
    rows.push({
      name: `${a.name} (${customerName})`,
      type: "AI Artifact",
      createdAt: a.createdAt ?? "—",
      artifact: a,
    });
  }
  return rows;
}

/* Schedule Status cell for a Gumloop row: Creating… (pulsing) / Failed.
   Complete artifacts show no status label (a dash, like every other row). */
function StatusCell({ status }: { status: GumloopArtifact["status"] }) {
  if (status === "failed") return <span className="rp-status rp-status-failed">Failed</span>;
  if (status === "creating") return (
    <span className="rp-status rp-status-creating">
      <span className="rp-status-dot" />Creating…
    </span>
  );
  return <span className="rp-dash">—</span>;
}

const TABS = ["Saved", "Requested", "Subscriptions"] as const;

export function MyReports() {
  const { profile } = useProfile();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Saved");
  const [search, setSearch] = useState("");

  const all = reportsFor(profile.customerName, !!profile.reports.conversationIntelligence, !!profile.reports.smsConversationIntelligence, !!profile.reports.voiceConversationIntelligence, profile.reports.gumloopArtifacts ?? []);
  const rows = search.trim()
    ? all.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : all;

  return (
    <div className="report-surface rp-page">
      <h1 className="rp-heading">My Reports</h1>

      <div className="rp-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={"rp-tab" + (t === tab ? " active" : "")}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Saved" ? (
        <>
          <input
            className="rp-search"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="rp-editcols"><a href="#">Edit Columns</a></div>

          <div className="rp-table-scroll">
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-name-col sorted">Name <span className="material-icons">arrow_downward</span></th>
                  <th>Report Type</th>
                  <th>Created At</th>
                  <th>Schedule Frequency</th>
                  <th>Schedule Status</th>
                  <th className="rp-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.artifact && r.artifact.status !== "complete" ? "rp-row-pending" : undefined}>
                    <td>
                      <div className="rp-name-cell">
                        <span className="material-icons rp-star">star_border</span>
                        {r.artifact ? (
                          r.artifact.status === "complete" ? (
                            <button
                              className="rp-link rp-link-btn"
                              onClick={() => openArtifact(profile, r.artifact!)}
                              title="Opens in a new tab"
                            >
                              {r.name}
                              <span className="material-icons rp-ext">open_in_new</span>
                            </button>
                          ) : (
                            <span className="rp-link rp-link-disabled">{r.name}</span>
                          )
                        ) : r.to ? (
                          <Link className="rp-link" to={r.to}>{r.name}</Link>
                        ) : (
                          <a className="rp-link" href="#">{r.name}</a>
                        )}
                      </div>
                    </td>
                    <td>{r.type}</td>
                    <td>{r.createdAt}</td>
                    <td className="rp-dash">—</td>
                    <td>{r.artifact ? <StatusCell status={r.artifact.status} /> : <span className="rp-dash">—</span>}</td>
                    <td className="rp-actions-col"><span className="material-icons rp-kebab">more_vert</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rp-footer">
            <div className="rp-perpage">
              <span className="rp-select">25 <span className="material-icons">expand_more</span></span>
              records per page
            </div>
            <div className="rp-pageinfo">
              <span className="rp-entries">Showing 1 to {rows.length} of {rows.length} entries</span>
              <span className="rp-pager">
                <button className="rp-page-arrow">&larr;</button>
                <button className="rp-page-num active">1</button>
                <button className="rp-page-arrow">&rarr;</button>
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="rp-empty">No {tab.toLowerCase()} reports.</div>
      )}
    </div>
  );
}
