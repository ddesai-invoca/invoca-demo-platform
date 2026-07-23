import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { DonutChart } from "../components/DonutChart";
import { StackedBarChart } from "../components/StackedBarChart";
import type { KpiGroup, Breakdown, ConversionCard as ConversionCardT } from "../data/schema";

/* AI Agent Conversion Dashboard (3rd dashboard). Reuses the shared dashboard
   template (the dash-card / breakdown / kpi styling + DonutChart + StackedBarChart),
   with one new pattern: the six "conversion" cards (title + filter chips + 2 tiles).
   Data-driven from reports.aiAgentConversion, re-skinned per prospect. */

function CardHead({ title }: { title: string }) {
  return (
    <div className="dash-card-head">
      <span className="dash-card-title">{title}</span>
      <DashTileMenu />
    </div>
  );
}

function KpiSection({ group }: { group: KpiGroup }) {
  return (
    <section className="dash-card">
      <CardHead title={group.title} />
      <div className="kpi-row">
        {group.tiles.map((t, i) => (
          <div className="kpi-tile" key={i}>
            <div className="kpi-label" title={t.label}>{t.label}</div>
            <div className="kpi-value">{t.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* One of the six small conversion cards: title, grey filter chips, two KPI tiles. */
function ConversionCard({ card }: { card: ConversionCardT }) {
  return (
    <section className="dash-card aac-conv-card">
      <CardHead title={card.title} />
      <div className="aac-chips">
        {card.chips.map((c) => <span className="aac-chip" key={c}>{c}</span>)}
      </div>
      <div className="kpi-row aac-conv-tiles">
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

function OutcomeTable({ bd }: { bd: Breakdown }) {
  return (
    <div className="dash-table-scroll">
      <table className="dash-table">
        <thead>
          <tr>
            <th>{bd.dimensionColumn}</th>
            {bd.metricColumns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {bd.rows.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td>
              {r.metrics.map((m, j) => <td key={j}>{m}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DonutBreakdown({ bd }: { bd: Breakdown }) {
  const segments = bd.rows.map((r) => ({ label: r.name, value: parseInt(r.metrics[0].replace(/[^\d]/g, "")) || 0 }));
  // Donut % labels are share of the grand total (incl. a long tail of other
  // rows); fall back to the sum of shown rows when no donutTotal is given.
  const total = bd.donutTotal ?? segments.reduce((s, d) => s + d.value, 0);
  return (
    <div className="breakdown-row">
      <section className="dash-card breakdown-donut">
        <CardHead title={bd.title} />
        <div className="donut-wrap"><DonutChart segments={segments} total={total} /></div>
      </section>
      <section className="dash-card breakdown-table">
        <CardHead title={bd.tableTitle} />
        <OutcomeTable bd={bd} />
      </section>
    </div>
  );
}

export function AiAgentConversionDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.aiAgentConversion);
  if (!d) {
    return <div className="dash-page"><div className="placeholder"><h2>No dashboard data</h2><p className="muted">This dashboard isn't set up for {profile.customerName} yet.</p></div></div>;
  }

  const donutBreakdowns = d.breakdowns.filter((b) => b.hasDonut);
  const productCategory = d.breakdowns.find((b) => !b.hasDonut);

  return (
    <div className="dash-page aac-page">
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

      <KpiSection group={d.summary} />

      {/* Six conversion cards — Lead Form (row 1) + Voice Agent (row 2) */}
      <div className="aac-conv-grid">
        {d.conversionCards.map((c, i) => <ConversionCard key={i} card={c} />)}
      </div>

      {/* Donut + outcome-table breakdowns (Source / Medium / Campaign / Search Term) */}
      {donutBreakdowns.map((b, i) => <DonutBreakdown key={i} bd={b} />)}

      {/* Conversions by Product Category: table (left) + stacked bar (right) */}
      {productCategory && (
        <div className="breakdown-row breakdown-prodcat">
          <section className="dash-card breakdown-table">
            <CardHead title={productCategory.title} />
            <OutcomeTable bd={productCategory} />
          </section>
          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">{productCategory.title}</span>
              <DashTileToggle />
            </div>
            <div className="chart-wrap"><StackedBarChart chart={d.productCategoryGraph} /></div>
          </section>
        </div>
      )}

      <DashAssistant />
    </div>
  );
}
