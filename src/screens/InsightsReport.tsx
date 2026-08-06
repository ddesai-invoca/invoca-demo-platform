import { useParams } from "react-router-dom";
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
  const report = name ? decodeURIComponent(name) : "";
  const r = report.trim();
  if (/^connect ai$/i.test(r)) return <InsightsConnectAi />;
  if (/^details report$/i.test(r)) return <InsightsDetailsReport />;
  return <InsightsDashboard />;
}
