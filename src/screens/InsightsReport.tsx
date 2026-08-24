import { useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useInsightsDashboards } from "../data/insightsDashboards";
import { InsightsEmptyDashboard } from "./InsightsEmptyDashboard";
import { InsightsDashboard } from "./InsightsDashboard";
import { InsightsConnectAi } from "./InsightsConnectAi";
import { InsightsDetailsReport } from "./InsightsDetailsReport";

/* Dispatcher for `/insights/dashboard/:name`.

   Insights & Analytics offers three saved reports (see InsightsAnalytics.tsx) and they are
   not the same screen: Connect AI is the agentic-rollout report and has nothing in common
   with the Summary Dashboard's layout. The route stays ONE path because the real product's
   does — a saved report is a uuid under /insights/dashboard — so the split happens here on
   the report's name rather than by giving Connect AI a different URL shape.

   Anything unrecognised falls through to the Summary Dashboard, which is the sensible default
   for a report whose contents have not been defined. */
export function InsightsReport() {
  const { name } = useParams();
  const { profileId } = useProfile();
  const { byName } = useInsightsDashboards(profileId);
  const report = name ? decodeURIComponent(name) : "";
  const r = report.trim();
  /* ⚠️ A DASHBOARD THE SE CREATED IS CHECKED FIRST, so a new one called "Details Report"
     opens as theirs rather than as the seeded report. The three seeded names are matched by
     an exact-ish regex below, and a user-named dashboard should not be able to collide with
     one of them and silently disappear. */
  const own = byName(r);
  if (own) return <InsightsEmptyDashboard dashboard={own} />;
  if (/^connect ai$/i.test(r)) return <InsightsConnectAi />;
  if (/^details report$/i.test(r)) return <InsightsDetailsReport />;
  return <InsightsDashboard />;
}
