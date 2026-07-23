import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, useDashboardData } from "../components/GeneratedTiles";
import { HBarChart } from "../components/HBarChart";
import { StackedBarChart } from "../components/StackedBarChart";
import type { KpiGroup, OpsTable as OpsTableT } from "../data/schema";

function CardHead({ title, toggle }: { title: string; toggle?: boolean }) {
  return (
    <div className="dash-card-head">
      <span className="dash-card-title">{title}</span>
      {toggle ? <DashTileToggle /> : <DashTileMenu />}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="kpi-tile"><div className="kpi-label" title={label}>{label}</div><div className="kpi-value">{value}</div></div>;
}

function KpiCard({ group, variant }: { group: KpiGroup; variant?: "existing" }) {
  if (variant === "existing") {
    const [first, ...rest] = group.tiles;
    return (
      <section className="dash-card">
        <CardHead title={group.title} />
        <div className="ops-existing-top"><Tile label={first.label} value={first.value} /></div>
        <div className="kpi-row ops-existing-bottom">{rest.map((t, i) => <Tile key={i} label={t.label} value={t.value} />)}</div>
      </section>
    );
  }
  return (
    <section className="dash-card">
      <CardHead title={group.title} />
      <div className="kpi-row">{group.tiles.map((t, i) => <Tile key={i} label={t.label} value={t.value} />)}</div>
    </section>
  );
}

function OpsTable({ title, table }: { title: string; table: OpsTableT }) {
  return (
    <section className="dash-card">
      <CardHead title={title} />
      <div className="dash-table-scroll">
        <table className="dash-table">
          <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => <tr key={i}>{r.cells.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MarketingOpsDashboard() {
  const { profile } = useProfile();
  const d = useDashboardData(profile.reports.opsDashboard);
  if (!d) {
    return <div className="dash-page"><div className="placeholder"><h2>No dashboard data</h2><p className="muted">This dashboard isn't set up for {profile.customerName} yet.</p></div></div>;
  }
  const [calls, newCust, existing] = d.kpiGroups;

  return (
    <div className="dash-page ops-page">
      <div className="breadcrumb"><Link to="/dashboards">Manage Dashboards</Link></div>
      <div className="title-row">
        <h1 className="title">{d.title} <span className="material-icons ops-caret">expand_more</span></h1>
        <DashHeaderActions />
      </div>
      <span className="ops-viewonly">View Only</span>

      <div className="toolbar">
        <button className="pill-outline pill-active">{d.dateRange}</button>
        <button className="pill-outline">Marketing Data</button>
        <button className="pill-outline">Signals</button>
        <button className="pill-outline">Scores</button>
        <button className="pill-outline">More Filters</button>
      </div>

      {calls && <KpiCard group={calls} />}
      <div className="ops-split">
        {newCust && <KpiCard group={newCust} />}
        {existing && <KpiCard group={existing} variant="existing" />}
      </div>

      {d.marketingSections.map((s, i) => (
        <div className="breakdown-row" key={i}>
          <section className="dash-card">
            <CardHead title={s.chartTitle} />
            <HBarChart chart={s.chart} />
          </section>
          <OpsTable title={s.tableTitle} table={s.table} />
        </div>
      ))}

      <OpsTable title={d.webpagesTitle} table={d.webpages} />
      <OpsTable title={d.locationTitle} table={d.locationHandling} />

      <section className="dash-card">
        <CardHead title="Top Reasons for No Booking" toggle />
        <div className="chart-wrap"><StackedBarChart chart={d.noBookingChart} height={204} /></div>
      </section>

      <DashAssistant />
    </div>
  );
}
