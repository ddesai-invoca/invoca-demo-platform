import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu, DashTileToggle } from "../components/DashTileMenu";
import { DashAssistant, usePageDataWithLabels } from "../components/GeneratedTiles";
import { DonutChart } from "../components/DonutChart";
import { LineChart } from "../components/LineChart";
import { StackedBarChart } from "../components/StackedBarChart";
import { leadFormFacts } from "../data/leadForms";
import type { KpiGroup, Breakdown } from "../data/schema";
import { fitCells } from "../components/chartFit";

/* The one heading on this screen that was a LITERAL. Everything else already
   comes from the dashboard data, so the assistant could rename any other card
   but silently no-op on this one. See usePageDataWithLabels. */
const LABELS = {
  breakoutGraph: "Sales Call Breakout Graph",
  leadFormSummary: "Lead Form Performance Summary",
  leadFormCount: "Lead Form Count",
};

/* `path` is the card's own data path. Optional, so heads that do not pass one are
   unchanged; passing it pins this card's AI edits to this card. */
function CardHead({ title, path }: { title: string; path?: string }) {
  return (
    <div className="dash-card-head">
      <span className="dash-card-title">{title}</span>
      <DashTileMenu path={path} />
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
              {/* Fitted to the header count, not mapped raw: the assistant can add
                  and remove columns now, and a row it did not finish updating must
                  show a blank cell rather than a body misaligned against its
                  headers. Same discipline as DataTable's leading cells. */}
              {fitCells(r.metrics, bd.metricColumns.length).map((m, j) => <td key={j}>{m}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DonutBreakdown({ bd, total, path }: { bd: Breakdown; total: number; path?: string }) {
  const segments = bd.rows.map((r) => ({ label: r.name, value: parseInt(r.metrics[0].replace(/[^\d]/g, "")) || 0 }));
  return (
    <div className="breakdown-row">
      <section className="dash-card breakdown-donut">
        <CardHead title={bd.title} path={path} />
        <div className="donut-wrap"><DonutChart segments={segments} total={total} /></div>
      </section>
      <section className="dash-card breakdown-table">
        <CardHead title={bd.tableTitle} path={path} />
        <OutcomeTable bd={bd} />
      </section>
    </div>
  );
}

/* The LEAD FORM equivalent of "Call Performance Summary": same shape (a count, two
   percents, revenue) so the two tiles read as a pair, and every figure anchored in
   data the engine already produces (see data/leadForms.ts).

   The LABELS come from the call group's own tiles wherever possible — tile 3 is the
   prospect's conversion term ("Watch Sold (Percent)" for a watch dealer, "Policy
   Bound (Percent)" for an insurer) and tile 4 its revenue wording. Reading them off
   the neighbouring card keeps the pair consistent per prospect instead of hardcoding
   one vertical's vocabulary. */
function deriveLeadFormGroup(
  profile: Parameters<typeof leadFormFacts>[0] & { reports: { marketingDashboard: { kpiGroups: KpiGroup[] } } },
  labels: { leadFormSummary: string; leadFormCount: string },
): KpiGroup | null {
  const facts = leadFormFacts(profile);
  if (!facts) return null;
  const callTiles = profile.reports.marketingDashboard.kpiGroups?.[0]?.tiles ?? [];
  const convLabel = callTiles[2]?.label ?? "Converted (Percent)";
  const revLabel = callTiles[3]?.label ?? "Total Revenue (Sale Amount)";
  return {
    title: labels.leadFormSummary,
    tiles: [
      { label: labels.leadFormCount, value: facts.count.toLocaleString("en-US") },
      ...(facts.engagement ? [facts.engagement] : []),
      { label: convLabel, value: `${Math.round(facts.conversionPct)}%` },
      { label: revLabel, value: `$${Math.round(facts.revenue).toLocaleString("en-US")}` },
    ],
  };
}

export function MarketingDashboard() {
  const { profile } = useProfile();
  /* The derived group is folded INTO the registered page data, so the assistant can
     edit its values and rename its labels exactly like any built-in tile, and undo
     covers it. */
  const base = {
    ...profile.reports.marketingDashboard,
    leadFormSummary: deriveLeadFormGroup(profile as never, LABELS),
  };
  const view = usePageDataWithLabels(base, LABELS);
  const d = view;
  const L = view.labels;

  // grand total call count drives donut percentages (share of all calls)
  const grandTotal = parseInt(
    (d.kpiGroups[0]?.tiles.find((t) => t.label === "Call Count")?.value || "0").replace(/[^\d]/g, "")
  ) || 0;

  const [callPerf, nonSales, breakout] = d.kpiGroups;
  /* Indices are kept alongside each breakdown because THE RENDER ORDER IS NOT THE
     ARRAY ORDER: the donut ones are drawn first and the table-only Product Category
     one last, so the tile that is 6th on screen is index 4 in the data. Filtering
     without keeping the index is what left the AI guessing, and it guessed the
     screen position -- renaming "Calls by Region" instead. */
  const indexed = d.breakdowns.map((b, i) => ({ b, i }));
  const donutBreakdowns = indexed.filter((x) => x.b.hasDonut);
  const productCategoryAt = indexed.find((x) => !x.b.hasDonut);
  const productCategory = productCategoryAt?.b;

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
      {/* directly under Call Performance Summary, as its lead-form counterpart */}
      {view.leadFormSummary && <KpiSection group={view.leadFormSummary} />}
      {nonSales && <KpiSection group={nonSales} />}

      {/* Sales Call Breakout Metrics (2x2) + line graph */}
      {breakout && (
        <div className="split-row">
          <div className="split-left"><KpiSection group={breakout} variant="grid" /></div>
          <section className="dash-card split-right">
            <div className="dash-card-head">
              <span className="dash-card-title">{L.breakoutGraph}</span>
              {/* Heading is a UI label (L.breakoutGraph), not data, so it cannot be
                  found by title -- named explicitly. The chart itself is editable. */}
              <DashTileToggle path="salesCallBreakoutGraph" />
            </div>
            <div className="chart-wrap"><LineChart chart={d.salesCallBreakoutGraph} /></div>
          </section>
        </div>
      )}

      {/* Donut + table breakdowns */}
      {donutBreakdowns.map(({ b, i }) => (
        <DonutBreakdown key={i} bd={b} total={grandTotal} path={`breakdowns.${i}`} />
      ))}

      {/* Conversions by Product Category: table (left) + stacked bar (right) */}
      {productCategory && (
        <div className="breakdown-row breakdown-prodcat">
          <section className="dash-card breakdown-table">
            <CardHead title={productCategory.title} path={`breakdowns.${productCategoryAt!.i}`} />
            <OutcomeTable bd={productCategory} />
          </section>
          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">{productCategory.title}</span>
              {/* The CHART card reads productCategoryGraph, NOT the breakdown, even
                  though the two cards share a heading. Pinning it to the breakdown
                  would silently drop every edit to the graph's own series. */}
              <DashTileToggle path="productCategoryGraph" />
            </div>
            <div className="chart-wrap"><StackedBarChart chart={d.productCategoryGraph} /></div>
          </section>
        </div>
      )}

      <DashAssistant />
    </div>
  );
}
