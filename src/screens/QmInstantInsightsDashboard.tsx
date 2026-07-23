import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { BarLineChart } from "../components/BarLineChart";
import type { ConversionCard as ConversionCardT, QmTablePanel as QmTablePanelT, QmBarLine } from "../data/schema";

/* QM Instant Insights dashboard (6th dashboard): "QM | Instant Insights
   Dashboard". Reuses the shared dashboard template (dash-card / kpi / aac-chip /
   dash-table) + BarLineChart. Data-driven from reports.qmInstantInsights. */

function CardHead({ title, cadence }: { title: string; cadence?: string }) {
  return (
    <div className="dash-card-head">
      <span className="dash-card-title">{title}</span>
      {cadence ? <DashTileToggle label={cadence} /> : <DashTileMenu />}
    </div>
  );
}

function Chips({ chips }: { chips: string[] }) {
  if (!chips.length) return null;
  return <div className="aac-chips">{chips.map((c) => <span className="aac-chip" key={c}>{c}</span>)}</div>;
}

function KpiCard({ card }: { card: ConversionCardT }) {
  return (
    <section className="dash-card">
      <CardHead title={card.title} />
      <Chips chips={card.chips} />
      <div className="kpi-row">
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

function TablePanel({ panel }: { panel: QmTablePanelT }) {
  return (
    <section className="dash-card">
      <CardHead title={panel.title} />
      <Chips chips={panel.chips} />
      <div className="dash-table-scroll">
        <table className="dash-table">
          <thead><tr>{panel.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {panel.table.rows.map((r, i) => (
              <tr key={i}>{r.cells.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BarLineCard({ chart, height }: { chart: QmBarLine; height?: number }) {
  return (
    <section className="dash-card">
      <CardHead title={chart.title} cadence={chart.cadence} />
      <div className="chart-wrap"><BarLineChart chart={chart} height={height} /></div>
    </section>
  );
}

export function QmInstantInsightsDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.qmInstantInsights);
  if (!d) {
    return <div className="dash-page"><div className="placeholder"><h2>No dashboard data</h2><p className="muted">This dashboard isn't set up for {profile.customerName} yet.</p></div></div>;
  }

  return (
    <div className="dash-page qm-page">
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

      {/* Row 1 — Trending Essential Metrics (full width, 50% shorter than default) */}
      <BarLineCard chart={d.trendingEssentialMetrics} height={150} />

      {/* Row 2 — Essential Metrics (2/3) | Trending Answer Rate (1/3) */}
      <div className="qm-row qm-row-21">
        <KpiCard card={d.essentialMetrics} />
        <BarLineCard chart={d.trendingAnswerRate} />
      </div>

      {/* Row 3 — Contact Center Metrics (full width) */}
      <KpiCard card={d.contactCenterMetrics} />

      {/* Row 4 — Overall Evaluation Score | Evaluation Rollup */}
      <div className="qm-row qm-row-13">
        <KpiCard card={d.overallEvaluationScore} />
        <KpiCard card={d.evaluationRollup} />
      </div>

      {/* Row 5 — Scored Calls by Evaluator (full width) */}
      <TablePanel panel={d.scoredCallsByEvaluator} />

      <DashAssistant />
    </div>
  );
}
