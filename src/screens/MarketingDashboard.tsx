import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { DonutChart } from "../components/DonutChart";
import { LineChart } from "../components/LineChart";
import { StackedBarChart } from "../components/StackedBarChart";
import type { KpiGroup, Breakdown } from "../data/schema";

function CardHead({ title }: { title: string }) {
  return (
    <div className="dash-card-head">
      <span className="dash-card-title">{title}</span>
      <DashTileMenu />
    </div>
  );
}

function KpiSection({ group, variant = "row" }: { group: KpiGroup; variant?: "row" | "grid" }) {
  return (
    <section className="dash-card">
      <CardHead title={group.title} />
      <div className={variant === "grid" ? "kpi-grid" : "kpi-row"}>
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

function DonutBreakdown({ bd, total }: { bd: Breakdown; total: number }) {
  const segments = bd.rows.map((r) => ({ label: r.name, value: parseInt(r.metrics[0].replace(/[^\d]/g, "")) || 0 }));
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

export function MarketingDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.marketingDashboard);

  // grand total call count drives donut percentages (share of all calls)
  const grandTotal = parseInt(
    (d.kpiGroups[0]?.tiles.find((t) => t.label === "Call Count")?.value || "0").replace(/[^\d]/g, "")
  ) || 0;

  const [callPerf, nonSales, breakout] = d.kpiGroups;
  const donutBreakdowns = d.breakdowns.filter((b) => b.hasDonut);
  const productCategory = d.breakdowns.find((b) => !b.hasDonut);

  return (
    <div className="dash-page">
      <div className="breadcrumb"><Link to="/dashboards">Manage Dashboards</Link></div>

      <div className="title-row">
        <h1 className="title">{d.title}</h1>
        <DashHeaderActions />
      </div>

      <div className="toolbar">
        <button className="pill-outline pill-active">{d.dateRange}</button>
        <button className="pill-outline">Marketing Data</button>
        <button className="pill-outline">Signals</button>
        <button className="pill-outline">Scores</button>
        <button className="pill-outline">More Filters</button>
      </div>

      {callPerf && <KpiSection group={callPerf} />}
      {nonSales && <KpiSection group={nonSales} />}

      {/* Sales Call Breakout Metrics (2x2) + line graph */}
      {breakout && (
        <div className="split-row">
          <div className="split-left"><KpiSection group={breakout} variant="grid" /></div>
          <section className="dash-card split-right">
            <div className="dash-card-head">
              <span className="dash-card-title">Sales Call Breakout Graph</span>
              <DashTileToggle />
            </div>
            <div className="chart-wrap"><LineChart chart={d.salesCallBreakoutGraph} /></div>
          </section>
        </div>
      )}

      {/* Donut + table breakdowns */}
      {donutBreakdowns.map((b, i) => <DonutBreakdown key={i} bd={b} total={grandTotal} />)}

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
