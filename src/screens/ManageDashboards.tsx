import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { vocabFor } from "../data/insightsCatalog";
import { isProspect, COMFORT_KEEPERS } from "../data/prospect";

/* Manage Dashboards — the landing list you get when clicking "Dashboards".
   For now it holds the one dashboard we've built (Marketing Performance);
   add rows here as more dashboards are created. */
export function ManageDashboards() {
  const { profile } = useProfile();

  const dashboards = [
    {
      name: profile.reports.marketingDashboard.title,
      path: "/dashboards/marketing",
      shared: ["All Users", "All Profiles"],
      owner: "You",
      modified: "5/6/26 12:37 pm",
    },
    ...(profile.reports.opsDashboard
      ? [{
          name: profile.reports.opsDashboard.title,
          path: "/dashboards/marketing-ops",
          shared: ["All Users"],
          owner: "You",
          modified: "8/16/25 9:14 am",
        }]
      : []),
    ...(profile.reports.aiAgentConversion
      ? [{
          name: profile.reports.aiAgentConversion.title,
          path: "/dashboards/ai-agent-conversion",
          shared: ["All Users", "All Profiles"],
          owner: "You",
          modified: "1/24/26 8:02 am",
        }]
      : []),
    ...(profile.reports.aiMessagingImpact
      ? [{
          name: profile.reports.aiMessagingImpact.title,
          path: "/dashboards/ai-messaging-impact",
          shared: ["All Users", "All Profiles"],
          owner: "You",
          modified: "8/30/25 10:18 am",
        }]
      : []),
    ...(profile.reports.qualityManagement
      ? [{
          name: profile.reports.qualityManagement.title,
          path: "/dashboards/quality-management",
          shared: ["All Users", "All Profiles"],
          owner: "You",
          modified: "2/28/25 9:41 am",
        }]
      : []),
    ...(profile.reports.qmInstantInsights
      ? [{
          name: profile.reports.qmInstantInsights.title,
          path: "/dashboards/qm-instant-insights",
          shared: ["All Users", "All Profiles"],
          owner: "You",
          modified: "2/28/25 9:44 am",
        }]
      : []),
    /* Only when the prospect actually HAS per-location call handling — the screen
       derives entirely from it, so listing a dashboard that would open on an empty
       state is worse than not listing it at all. */
    ...(profile.reports.opsDashboard?.locationHandling?.rows?.length
      ? [{
          name: `Location Performance Comparison (${profile.customerName})`,
          path: "/dashboards/location-comparison",
          shared: ["All Users"],
          owner: "You",
          modified: "1/28/26 4:02 pm",
        }]
      : []),
    /* ⚠️ COMFORT KEEPERS ONLY (requested 8/24/2026) — the one dashboard on this list that is
       scoped to a single prospect. Matched by NAME through the shared `isProspect`, never by
       a guessed id, for the reason recorded in src/data/prospect.ts.
       The data gates stay as well, and both still matter: this screen breaks the AI
       conversion figures down by location, so with no `locationHandling` there is nothing to
       break down, and it needs the AI Agent Conversion slice because the Lead Form and Voice
       Agent channels are read straight off its cards. To open it up to every prospect, drop
       the `isProspect` line and nothing else. */
    ...(isProspect(profile, COMFORT_KEEPERS)
      && profile.reports.opsDashboard?.locationHandling?.rows?.length
      && profile.reports.aiAgentConversion?.conversionCards?.length
      ? [{
          name: `AI Conversion by ${vocabFor(profile).location} (${profile.customerName})`,
          path: "/dashboards/ai-conversion-by-location",
          shared: ["All Users"],
          owner: "You",
          modified: "8/24/26 3:41 pm",
        }]
      : []),
  ];

  return (
    <div className="md-page">
      <div className="md-head">
        <h1 className="md-title">Manage Dashboards</h1>
        <button className="md-new"><span className="material-icons">add</span>New</button>
      </div>

      <div className="md-search">
        <span className="material-icons">search</span>
        <input type="text" aria-label="Search dashboards" />
      </div>

      <table className="md-table">
        <thead>
          <tr>
            <th className="md-col-name">Name</th>
            <th>Shared Status</th>
            <th>Owned By</th>
            <th>Last Modified</th>
          </tr>
        </thead>
        <tbody>
          {dashboards.map((d) => (
            <tr key={d.path}>
              <td><Link to={d.path} className="md-link">{d.name}</Link></td>
              <td>{d.shared.map((s) => <span key={s} className="md-pill">{s}</span>)}</td>
              <td>{d.owner}</td>
              <td>{d.modified}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="md-footer">
        <span className="md-rpp">Rows per page: <strong>100</strong> <span className="material-icons">expand_more</span></span>
        <span className="md-range">1–{dashboards.length} of {dashboards.length}</span>
        <span className="material-icons md-arrow md-arrow-disabled">chevron_left</span>
        <span className="material-icons md-arrow md-arrow-disabled">chevron_right</span>
      </div>
    </div>
  );
}
