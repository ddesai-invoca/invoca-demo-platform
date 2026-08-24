import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu } from "../components/DashTileMenu";
import { DashAssistant, usePageDataWithLabels } from "../components/GeneratedTiles";
import { HBarChart } from "../components/HBarChart";
import { tileId } from "../data/tileId";
import { franchiseAiView, type FranchiseRow } from "../data/franchiseAi";

/* =============================================================================
   AI Conversion by <Location> — the organization on top, then its franchises.
   -----------------------------------------------------------------------------
   Requested 8/24/2026 alongside the Location Performance Comparison, whose card shape this
   screen deliberately reuses: the top row is the WHOLE organization, then the same figures
   per franchise, carrying call data AND the AI Agent Conversion dashboard's numbers split
   into Lead Form / Voice Agent / After Hours.

   All of the arithmetic — and every note about what is read versus modelled — lives in
   `src/data/franchiseAi.ts`. Read that file before changing a number here.

   DESIGN: NO NEW CSS. Every class is one another dashboard already defines — `.dash-page`,
   `.dash-card`, `.kpi-grid`, `.kpi-tile`, `.dash-table`, `.aac-conv-grid` for the cards row
   and `.aac-chip` for the filter pills. Same rule the Location Comparison screen follows, so
   this cannot drift from the platform's look.

   ⚠️ THE AFTER HOURS CHANNEL IS MODELLED, and it says so ON SCREEN — its card carries a
   "Modelled" chip and the table footnotes it. No profile has an after-hours field, so it is
   built from the calls the prospect actually missed. A demo number that cannot be traced back
   to another screen has to be labelled, not quietly mixed in with ones that can.
   ============================================================================= */

const LABELS = {
  title: "AI Conversion by Location",
  org: "Whole Organization",
  channels: "AI Conversion by Channel",
  perLocation: "By Location",
  table: "AI Conversion Scorecard",
  ranking: "After-Hours Opportunity by Location",
  calls: "Call Count",
  forms: "Lead Forms (Count)",
  bookingRate: "Booked (Percent)",
  revenue: "Total Revenue (Sale Amount)",
  interactions: "Interactions",
  conversion: "Converted (Percent)",
  channelRevenue: "Revenue (Sale Amount)",
  missed: "Call Not Answered (Count)",
  location: "Location",
  total: "Total",
} as const;

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n)}%`;

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-label" title={label}>{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function CardHead({ title, chips }: { title: string; chips?: string[] }) {
  return (
    <>
      <div className="dash-card-head" data-tile={tileId(title)}>
        <span className="dash-card-title">{title}</span>
        <DashTileMenu />
      </div>
      {chips?.length ? (
        <div className="toolbar">
          {chips.map((c) => <span className="aac-chip" key={c}>{c}</span>)}
        </div>
      ) : null}
    </>
  );
}

export function FranchiseAiDashboard() {
  const { profile } = useProfile();
  const derived = franchiseAiView(profile);
  const md = profile.reports.marketingDashboard;

  /* Registered as this page's AI scope with its labels folded in, so the sparkle can rename
     any heading and retitle any metric, and those edits belong to this page alone. */
  const base = {
    title: derived
      ? `AI Conversion by ${derived.locationNoun} (${profile.customerName})`
      : LABELS.title,
    dateRange: md?.dateRange ?? "",
    org: derived?.org ?? null,
    channels: derived?.channels ?? [],
    rows: derived?.rows ?? [],
  };
  const view = usePageDataWithLabels(base, LABELS);
  const L = view.labels;
  const rows: FranchiseRow[] = view.rows ?? [];
  const channels = view.channels ?? [];
  const org = view.org;

  if (!derived || !rows.length || !org) {
    return (
      <div className="dash-page">
        <div className="placeholder">
          <h2>No {derived?.locationNoun.toLowerCase() ?? "location"} data</h2>
          <p className="muted">
            {profile.customerName} has no per-location call handling yet, so there is nothing
            to break down.
          </p>
        </div>
      </div>
    );
  }

  const noun = derived.locationNoun;
  /* Axis headroom rounded up to a clean step, so the longest bar does not touch the edge. */
  const rankMax = (() => {
    const top = Math.max(...rows.map((r) => r.afterHours.revenue), 1);
    const mag = Math.pow(10, Math.floor(Math.log10(top)));
    return Math.ceil((top * 1.1) / mag) * mag;
  })();
  /* The three channels, in the order the AI dashboard lists them. */
  const chan = (i: number) => channels[i];

  return (
    <div className="dash-page">
      <div className="breadcrumb"><Link to="/dashboards">Manage Dashboards</Link></div>
      <div className="title-row">
        <h1 className="title">{view.title}</h1>
        <DashHeaderActions />
      </div>
      <div className="toolbar"><span className="chip">{view.dateRange}</span></div>

      {/* ---- row 1: the whole organization ---- */}
      <h2 className="fai-section">{L.org}</h2>
      <section className="dash-card">
        <CardHead title={`${profile.customerName} (All ${noun}s)`} />
        <div className="kpi-grid">
          <Tile label={L.calls} value={int(org.calls)} />
          <Tile label={L.forms} value={int(org.forms)} />
          <Tile label={L.bookingRate} value={pct(org.bookingRate)} />
          <Tile label={L.revenue} value={usd(org.revenue)} />
        </div>
      </section>

      {/* ---- row 2: the same org, split by AI channel ---- */}
      <h2 className="fai-section">{L.channels}</h2>
      <div className="aac-conv-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {channels.map((c) => (
          <section className="dash-card" key={c.label}>
            <CardHead title={c.label}
              chips={c.modelled ? [...c.chips, "Modelled"] : c.chips} />
            <div className="kpi-grid">
              <Tile label={L.interactions} value={int(c.interactions)} />
              <Tile label={L.conversion} value={pct(c.rate)} />
              <Tile label={L.channelRevenue} value={usd(c.revenue)} />
            </div>
          </section>
        ))}
      </div>

      {/* ---- row 3: a card per franchise, the shape the Location screen uses ---- */}
      <h2 className="fai-section">{L.perLocation}</h2>
      <div className="aac-conv-grid"
        style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 4)}, 1fr)` }}>
        {rows.map((r) => (
          <section className="dash-card" key={r.name}>
            <CardHead title={r.name} />
            <div className="kpi-grid">
              <Tile label={L.calls} value={int(r.calls)} />
              <Tile label={L.forms} value={int(r.forms)} />
              <Tile label={L.bookingRate} value={pct(r.bookingRate)} />
              <Tile label={L.revenue} value={usd(r.revenue)} />
            </div>
          </section>
        ))}
      </div>

      {/* ---- the scorecard: one row per franchise, the three channels across ---- */}
      <h2 className="fai-section">{L.table}</h2>
      <section className="dash-card">
        <CardHead title={L.table} />
        <div className="table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th>{noun}</th>
                {channels.map((c) => (
                  <th key={c.label} colSpan={2}>{c.label}{c.modelled ? " *" : ""}</th>
                ))}
                <th>{L.revenue}</th>
              </tr>
              <tr>
                <th />
                {/* ⚠️ THE KEY GOES ON THE FRAGMENT, not on the two <th> inside it — a bare
                    `<>` in a map has no key and React warns about the LIST, which is easy to
                    misread as the cells being at fault. */}
                {channels.map((c) => (
                  <Fragment key={c.label}>
                    <th>{L.conversion}</th>
                    <th>{L.channelRevenue}</th>
                  </Fragment>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{pct(r.leadForm.rate)}</td>
                  <td>{usd(r.leadForm.revenue)}</td>
                  <td>{pct(r.voiceAgent.rate)}</td>
                  <td>{usd(r.voiceAgent.revenue)}</td>
                  <td>{pct(r.afterHours.rate)}</td>
                  <td>{usd(r.afterHours.revenue)}</td>
                  <td>{usd(r.revenue)}</td>
                </tr>
              ))}
              {/* ⚠️ A TOTALS ROW IS SAFE HERE, unlike on the Location Comparison screen: the
                  three channels PARTITION the AI revenue, so summing them is meaningful. Each
                  column is apportioned, so these totals equal the cards above exactly. */}
              <tr>
                <td><strong>{L.total}</strong></td>
                <td><strong>{pct(chan(0)?.rate ?? 0)}</strong></td>
                <td><strong>{usd(rows.reduce((s, r) => s + r.leadForm.revenue, 0))}</strong></td>
                <td><strong>{pct(chan(1)?.rate ?? 0)}</strong></td>
                <td><strong>{usd(rows.reduce((s, r) => s + r.voiceAgent.revenue, 0))}</strong></td>
                <td><strong>{pct(chan(2)?.rate ?? 0)}</strong></td>
                <td><strong>{usd(rows.reduce((s, r) => s + r.afterHours.revenue, 0))}</strong></td>
                <td><strong>{usd(rows.reduce((s, r) => s + r.revenue, 0))}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          * After Hours is modelled from calls that went unanswered, converted at the AI-only
          agent rate. Every other figure is read from the AI Agent Conversion dashboard.
        </p>
      </section>

      {/* ---- where the missed calls actually are ---- */}
      <h2 className="fai-section">{L.ranking}</h2>
      <section className="dash-card">
        <CardHead title={L.ranking} />
        <HBarChart
          chart={{
            legend: L.channelRevenue,
            axisMax: rankMax,
            axisTicks: Array.from({ length: 7 }, (_, i) => Math.round((rankMax / 6) * i)),
            axisSuffix: "",
            bars: [...rows]
              .sort((a, b) => b.afterHours.revenue - a.afterHours.revenue)
              .map((r) => ({ name: r.name, value: Math.round(r.afterHours.revenue),
                display: usd(r.afterHours.revenue) })),
          }}
        />
      </section>

      <DashAssistant />
    </div>
  );
}
