import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { LineChart } from "../components/LineChart";
import { StackedBarChart } from "../components/StackedBarChart";
import type { AimKpiCard as AimKpiCardT } from "../data/schema";

/* AI Messaging Impact on Lead Capture & Revenue (Human vs AI) — 4th dashboard.
   Reuses the shared dashboard template (dash-card / kpi tiles + LineChart +
   StackedBarChart). Paired 1/3 + 2/3 KPI rows (AI This Month vs Human Last
   Month), an AI-assisted appointment trend line, AI opportunity/nurture tiles,
   and a re-skinned "Common Topics" stacked bar. Data-driven per prospect. */

function KpiCard({ card }: { card: AimKpiCardT }) {
  return (
    <section className={"dash-card aim-card" + (card.chip ? " aim-card--chip" : "")}>
      <div className="dash-card-head">
        <span className="dash-card-title">{card.title}</span>
        <DashTileMenu />
      </div>
      {card.chip && <div className="aim-chips"><span className="aac-chip">{card.chip}</span></div>}
      <div className="kpi-row" style={{ gridTemplateColumns: `repeat(${card.tiles.length}, 1fr)` }}>
        {card.tiles.map((t, i) => (
          <div className="kpi-tile" key={i}>
            <div className="kpi-label" title={t.label}>{t.label}</div>
            <div className="kpi-value">{t.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AiMessagingImpactDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.aiMessagingImpact);
  if (!d) {
    return <div className="dash-page"><div className="placeholder"><h2>No dashboard data</h2><p className="muted">This dashboard isn't set up for {profile.customerName} yet.</p></div></div>;
  }

  return (
    <div className="dash-page aim-page">
      <div className="breadcrumb"><Link to="/dashboards">Manage Dashboards</Link></div>

      <div className="title-row">
        <h1 className="title">{d.title} <span className="material-icons ops-caret">expand_more</span></h1>
        <DashHeaderActions />
      </div>

      <div className="toolbar">
        <button className="pill-outline pill-active">{d.dateRange}</button>
        <button className="pill-outline">Marketing Data</button>
        <button className="pill-outline">Signals</button>
        <button className="pill-outline">Scores</button>
        <button className="pill-outline">More Filters</button>
      </div>

      {/* AI (this month) — lead engagement + appointment performance */}
      <div className="aim-row">
        <KpiCard card={d.aiLeadEngagement} />
        <KpiCard card={d.aiAppointmentPerformance} />
      </div>

      {/* Human (last month) — the comparison */}
      <div className="aim-row">
        <KpiCard card={d.humanLeadEngagement} />
        <KpiCard card={d.humanAppointmentPerformance} />
      </div>

      {/* AI-Assisted Appointment Trend (line) */}
      <section className="dash-card aim-card aim-card--chip">
        <div className="dash-card-head">
          <span className="dash-card-title">{d.trendTitle}</span>
          <DashTileToggle />
        </div>
        <div className="aim-chips"><span className="aac-chip">{d.trendChip}</span></div>
        <div className="chart-wrap"><LineChart chart={d.trendChart} height={190} /></div>
      </section>

      {/* AI-Assisted Opportunities + AI Lead Nurture */}
      <div className="aim-row">
        <KpiCard card={d.aiOpportunities} />
        <KpiCard card={d.aiLeadNurture} />
      </div>

      {/* Common Topics (stacked bar, re-skinned) */}
      <section className="dash-card">
        <div className="dash-card-head">
          <span className="dash-card-title">{d.commonTopicsTitle}</span>
          <DashTileToggle />
        </div>
        <div className="chart-wrap"><StackedBarChart chart={d.commonTopicsChart} height={190} /></div>
      </section>

      <DashAssistant />
    </div>
  );
}
