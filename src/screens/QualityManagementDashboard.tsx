import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { HBarChart } from "../components/HBarChart";
import { StackedBarChart } from "../components/StackedBarChart";
import { BarLineChart } from "../components/BarLineChart";
import type { ConversionCard as ConversionCardT, QmBarPanel as QmBarPanelT, QmTablePanel as QmTablePanelT, QmBarLine } from "../data/schema";

/* Quality Management dashboard (5th dashboard): "QM | Actionable Insights
   Dashboard". Reuses the shared dashboard template (dash-card / kpi / aac-chip /
   dash-table + HBarChart / StackedBarChart) plus the new BarLineChart.
   Data-driven from reports.qualityManagement, re-skinned per prospect. */

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
  return (
    <div className="aac-chips">
      {chips.map((c) => <span className="aac-chip" key={c}>{c}</span>)}
    </div>
  );
}

/* KPI card: title + filter chips + tiles (reuses the conversion-card layout). */
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

function BarPanel({ panel }: { panel: QmBarPanelT }) {
  return (
    <section className="dash-card">
      <CardHead title={panel.title} />
      <Chips chips={panel.chips} />
      <HBarChart chart={panel.chart} />
      {panel.pager && (
        <div className="qm-pager">{panel.pager} <span className="material-icons">chevron_right</span></div>
      )}
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
          <thead>
            <tr>{panel.table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
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

export function QualityManagementDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.qualityManagement);
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

      {/* Row 1 — Sales Opportunities (2/3) | Sales Conversions (1/3) */}
      <div className="qm-row qm-row-21">
        <KpiCard card={d.salesOpportunities} />
        <KpiCard card={d.salesConversions} />
      </div>

      {/* Row 2 — Calls Needing Review (1/3) | Highest Converting Agents (2/3) */}
      <div className="qm-row qm-row-13">
        <BarPanel panel={d.callsNeedingReview} />
        <section className="dash-card">
          <CardHead title="Highest Converting Agents" cadence="Weekly" />
          <div className="chart-wrap"><StackedBarChart chart={d.highestConvertingAgents} /></div>
        </section>
      </div>

      {/* Row 3 — Baseline Skills (1/3) | Scored Calls (2/3) */}
      <div className="qm-row qm-row-13">
        <KpiCard card={d.baselineSkills} />
        <KpiCard card={d.scoredCalls} />
      </div>

      {/* Row 4 — Baseline Sales Quality Score (full width) */}
      <BarLineCard chart={d.baselineQualityScore} />

      {/* Row 5 — Bottom Quality Scores: bar (1/3) | table (2/3) */}
      <div className="qm-row qm-row-13">
        <BarPanel panel={d.bottomByAgentBar} />
        <TablePanel panel={d.bottomByAgentTable} />
      </div>

      {/* Row 6 — Top Quality Scores: bar (1/3) | table (2/3) */}
      <div className="qm-row qm-row-13">
        <BarPanel panel={d.topByAgentBar} />
        <TablePanel panel={d.qualityByAgentTable} />
      </div>

      {/* Row 7 & 8 — Trending (full width, 40% shorter than the default) */}
      <BarLineCard chart={d.trendingToConversion} height={180} />
      <BarLineCard chart={d.trendingToRevenue} height={180} />

      <DashAssistant />
    </div>
  );
}
