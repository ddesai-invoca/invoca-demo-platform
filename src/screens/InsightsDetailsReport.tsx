import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { usePageDataWithLabels } from "../components/GeneratedTiles";
import { detailsReportFacts } from "../data/detailsReport";

/* Insights & Analytics -> Details Report. Matched to the capture "Insights & Analytics -
   Reports｜ Invoca for Healthcare 2.0" (8/6/2026, network 2160, dashboard 4f3a7106) and its
   screenshot: one very wide table of individual calls with a UNIQUE COUNT row under it.

   Three things this screen does NOT have, all deliberate and all from the screenshot: no
   "Ask" pill, no "Add Tile" button (just the kebab), and its filter chip is UNSET — it reads
   "Call Start Time (Select)" with a lock icon at the far right of the filter bar, because the
   report is published without a date filter applied.

   NO chart hover/drawer here, which is not an oversight: the standing rule in CLAUDE.md is
   about CHARTS, and this screen has none. The rows are deliberately inert rather than
   clickable — the demo has one call transcript, and it belongs to the Summary Dashboard's
   first bar (see DrawerRequest.topCallHref).

   Reuses the .ind-* header/filter/card chrome READ-ONLY; the grid itself is .idt-*. */

const LABELS = {
  title: "Details Report",
  filterLabel: "Call Start Time",
  filterValue: "(Select)",
  cardTitle: "Details Report",
};

export function InsightsDetailsReport() {
  const { profile } = useProfile();
  /* Registers this page as the AI scope and returns its labels with any edits made ON THIS
     PAGE overlaid, so the assistant can rename this report's headings without touching the
     other two Insights reports. */
  const view = usePageDataWithLabels(profile.reports.marketingDashboard, LABELS);
  const L = view.labels;
  const f = detailsReportFacts(profile);

  return (
    <div className="ind-page idt-page">
      <div className="ind-head">
        <div>
          <Link to="/insights" className="ind-crumb">INSIGHTS &amp; ANALYTICS</Link>
          <h1 className="ind-title">{L.title}</h1>
        </div>
        {/* Kebab only — this report has neither Ask nor Add Tile. */}
        <div className="ind-actions">
          <span className="material-icons ind-kebab">more_vert</span>
        </div>
      </div>

      <div className="ind-filters idt-filters">
        <span className="ind-chip">{L.filterLabel} <b>{L.filterValue}</b></span>
        <span className="material-icons idt-lock" title="This report is locked">lock</span>
      </div>

      <section className="ind-card">
        <h2 className="ind-card-title">{L.cardTitle}</h2>
        {/* The grid scrolls in BOTH directions inside the card: 17 columns are wider than any
            window, and the body scrolls vertically under a stuck header and above a stuck
            footer, so the column names and the UNIQUE COUNT row stay readable while you scroll
            through the rows. */}
        <div className="idt-wrap">
          <table className="idt-table">
            <thead>
              <tr>
                {f.columns.map((c) => (
                  <th key={c.key} className={c.wide ? "idt-wide" : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.rows.map((r) => (
                <tr key={r.id}>
                  {f.columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "idt-num" : undefined}>{r[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {f.columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "idt-num" : undefined}>
                    <span className="ind-foot-label">
                      {c.footer === "period" ? "TIME PERIOD" : "UNIQUE COUNT"}
                    </span>
                    <b>{f.footer[c.key]}</b>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="ind-showing">
          Showing {f.shown.toLocaleString("en-US")} of many rows
        </p>
      </section>
    </div>
  );
}
