import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DashHeaderActions } from "../components/DashHeaderActions";
import { DashTileMenu } from "../components/DashTileMenu";
import { DashAssistant, usePageDataWithLabels } from "../components/GeneratedTiles";
import { DonutChart } from "../components/DonutChart";
import { HBarChart } from "../components/HBarChart";
import { tileId } from "../data/tileId";

/* =============================================================================
   Location Performance Comparison — a per-location scorecard for managers
   -----------------------------------------------------------------------------
   One card per location, then the locations side by side: share of calls, a
   head-to-head table of every metric, and a booking-rate ranking.

   EVERYTHING IS DERIVED from reports.opsDashboard.locationHandling plus the
   Marketing dashboard's KPI totals. No schema slice, no engine phase — so every
   prospect already on disk gets this screen immediately, generation stays at
   ~2m45s, and the numbers AGREE with the other dashboards instead of being a
   second, conflicting set. Same approach as InsightsDashboard.

   That the locations reconcile is not luck: locationHandling is a complete
   partition. Measured on Avi & Co, its rows sum to 5,943 calls, which is exactly
   the Marketing dashboard's Call Count. So this screen can show location totals
   next to company totals without a prospect being able to add up the columns and
   catch a discrepancy — the thing that gives a demo away.

   DESIGN: no new CSS. Every class here is already used by another dashboard —
   .dash-page / .dash-card / .kpi-grid / .kpi-tile / .breakdown-row / .dash-table,
   and .aac-conv-grid for the three-across row (a 3-column 10px grid the AI Agent
   Conversion dashboard already defines). Reused rather than duplicated so this
   screen cannot drift from the platform's look.
   ============================================================================= */

const LABELS = {
  title: "Location Performance Comparison",
  perLocation: "By Location",
  share: "Share of Calls by Location",
  headToHead: "Location Scorecard",
  ranking: "Booking Rate by Location",
  calls: "Call Count",
  answerRate: "Answer Rate",
  voicemail: "Voice Mail (Percent)",
  bookingRate: "Booked (Percent)",
  booked: "Booked (Count)",
  revenue: "Total Revenue (Sale Amount)",
  revPerCall: "Revenue per Call",
  forms: "Lead Forms (Count)",
  revPerForm: "Revenue per Lead Form",
  formsBooked: "Form Booked (Count)",
  formRevenue: "Form-Attributed Revenue",
  metric: "Metric",
  best: "Top Location",
};

const num = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/* Whole percent unless the value genuinely has a fraction AND is small enough for
   it to matter. The source figures are integers ("5%", "31%"), and rendering those
   as "5.0%" next to a derived "93%" looks like two different data sources. */
const pct = (n: number) =>
  Number.isInteger(n) || n >= 10 ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;

interface Loc {
  name: string;
  calls: number;
  unanswered: number;
  answerRate: number;   // %
  voicemail: number;    // %
  bookingRate: number;  // %
  booked: number;
  revenue: number;
  revPerCall: number;
  /* Lead forms — only populated when the profile carries the two totals these are
     derived from. Zero/absent otherwise, and the rows are dropped. */
  forms: number;
  formsBooked: number;
  formRevenue: number;
}

/* LEAD-FORM TOTALS, taken from real anchors rather than a made-up call:form ratio.

     Form Submits          aiMessagingImpact.aiLeadEngagement  (Avi & Co: 1,247)
     Form-driven revenue   the sum of aiAgentConversion's "LEAD FORM (Conversions)"
                           cards' revenue tiles                (Avi & Co: $6,346,140)

   Neither is per-location — nothing in the profile is — so both are split across the
   locations below. Returns nulls when either is missing, and the lead-form rows are
   then simply not shown: a fabricated form count next to real call counts is worse
   than an absent one. */
function leadFormTotals(p: {
  reports: { aiMessagingImpact?: unknown; aiAgentConversion?: unknown };
}): { forms: number; revenue: number } | null {
  const aim = p.reports.aiMessagingImpact as
    { aiLeadEngagement?: { tiles?: { label: string; value: string }[] } } | undefined;
  const submits = aim?.aiLeadEngagement?.tiles?.find((t) => /form submit/i.test(t.label))?.value;
  const forms = num(submits);

  const aac = p.reports.aiAgentConversion as
    { conversionCards?: { title?: string; tiles?: { label: string; value: string }[] }[] } | undefined;
  const revenue = (aac?.conversionCards ?? [])
    .filter((c) => /lead form/i.test(c.title ?? ""))
    .reduce((s, c) => s + num(c.tiles?.find((t) => /revenue/i.test(t.label))?.value), 0);

  return forms > 0 && revenue > 0 ? { forms, revenue } : null;
}

/* Distribute a whole into shares that sum EXACTLY back to it. Rounding each share
   independently loses or gains a few units, and "1,246 of 1,247 forms" in a demo is
   the kind of thing someone totals up. The remainder goes to the largest share. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map(() => 0);
  const out = weights.map((w) => Math.round((w / sum) * total));
  const drift = total - out.reduce((s, v) => s + v, 0);
  if (drift !== 0) {
    const biggest = weights.indexOf(Math.max(...weights));
    out[biggest] += drift;
  }
  return out;
}

/* Find a column by HEADER rather than position — locationHandling's column order
   is the engine's to decide, and reading index 1 as "calls" breaks the day it
   emits them in another order. */
function colIndex(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

function deriveLocations(
  table: { columns?: string[]; rows?: { cells?: string[] }[] } | undefined,
  totalRevenue: number,
  forms: { forms: number; revenue: number } | null,
): Loc[] {
  const headers = table?.columns ?? [];
  const rows = table?.rows ?? [];
  if (!headers.length || !rows.length) return [];

  const iName = 0;
  const iCalls = colIndex(headers, /call count/i);
  const iUnans = colIndex(headers, /not answered/i);
  const iVm = colIndex(headers, /voice ?mail/i);
  const iBook = colIndex(headers, /scheduled|booked/i);

  const base = rows.map((r) => {
    const cells = r.cells ?? [];
    const calls = iCalls >= 0 ? num(cells[iCalls]) : 0;
    const unanswered = iUnans >= 0 ? num(cells[iUnans]) : 0;
    const bookingRate = iBook >= 0 ? num(cells[iBook]) : 0;
    return {
      name: String(cells[iName] ?? "Location"),
      calls,
      unanswered,
      answerRate: calls ? ((calls - unanswered) / calls) * 100 : 0,
      voicemail: iVm >= 0 ? num(cells[iVm]) : 0,
      bookingRate,
      booked: Math.round(calls * (bookingRate / 100)),
    };
  });

  /* REVENUE IS SPLIT BY BOOKINGS, NOT BY CALLS, and then normalised so the parts
     sum to the company total the other dashboards already show.

     Splitting by call volume would have implied every location converts
     identically, which directly contradicts the booking rates right next to it —
     a manager comparing two locations would see the same revenue-per-call on a
     31% booker and a 19% one. Splitting by bookings makes the better closer earn
     more, and normalising keeps the column adding up to the real total. */
  const totalBooked = base.reduce((s, l) => s + l.booked, 0);

  /* LEAD FORMS, split across the same locations.

     Volume goes by CALL SHARE — a boutique's share of inbound demand is the only
     per-location signal the profile has, and it is a far better proxy than an
     invented ratio. Each location's forms then convert at ITS OWN booking rate: the
     operational quality that books 31% of callers books a similar share of form
     leads, and it keeps the form column consistent with the call column beside it.
     Form revenue follows form bookings, normalised to the real lead-form total.

     apportion() makes both columns sum EXACTLY to their published totals. */
  const formCounts = forms
    ? apportion(forms.forms, base.map((l) => l.calls))
    : base.map(() => 0);
  const formsBooked = base.map((l, i) => Math.round(formCounts[i] * (l.bookingRate / 100)));
  const formRevenues = forms ? apportion(forms.revenue, formsBooked) : base.map(() => 0);

  return base.map((l, i) => {
    const revenue = totalBooked ? (l.booked / totalBooked) * totalRevenue : 0;
    return {
      ...l,
      revenue,
      revPerCall: l.calls ? revenue / l.calls : 0,
      forms: formCounts[i],
      formsBooked: formsBooked[i],
      formRevenue: formRevenues[i],
    };
  });
}

function CardHead({ title }: { title: string }) {
  return (
    <div className="dash-card-head" data-tile={tileId(title)}>
      <span className="dash-card-title">{title}</span>
      <DashTileMenu />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="kpi-tile"><div className="kpi-label" title={label}>{label}</div><div className="kpi-value">{value}</div></div>;
}

export function LocationComparisonDashboard() {
  const { profile } = useProfile();
  const ops = profile.reports.opsDashboard;
  const md = profile.reports.marketingDashboard;
  const totalRevenue = num(md?.kpiGroups?.[0]?.tiles?.find((t) => /revenue/i.test(t.label))?.value);

  /* Registered as this page's AI scope with its labels folded in, so the sparkle
     can rename any heading and retitle any metric — and those edits belong to this
     page alone. Headings left as literals would accept a rename and silently not
     budge (see usePageDataWithLabels). */
  const base = {
    title: `${LABELS.title} (${profile.customerName})`,
    dateRange: md?.dateRange ?? "",
    locations: deriveLocations(ops?.locationHandling, totalRevenue, leadFormTotals(profile)),
  };
  const view = usePageDataWithLabels(base, LABELS);
  const L = view.labels;
  const locations: Loc[] = view.locations ?? [];

  if (!locations.length) {
    return (
      <div className="dash-page">
        <div className="placeholder">
          <h2>No location data</h2>
          <p className="muted">
            {profile.customerName} has no per-location call handling yet, so there is nothing to compare.
          </p>
        </div>
      </div>
    );
  }

  const totalCalls = locations.reduce((s, l) => s + l.calls, 0);
  const bestBy = (pick: (l: Loc) => number) =>
    locations.reduce((a, b) => (pick(b) > pick(a) ? b : a)).name;

  /* Metric rows for the head-to-head table: locations across, metrics down. That
     orientation is the point of the screen — a manager reads one row to see who is
     ahead, rather than comparing numbers in different cards. */
  const hasForms = locations.some((l) => l.forms > 0);
  const metrics: { label: string; cell: (l: Loc) => string; best: string }[] = [
    { label: L.calls, cell: (l) => int(l.calls), best: bestBy((l) => l.calls) },
    /* Lead Forms sits directly beneath Call Count so the two demand volumes read
       side by side, which is the comparison a manager actually makes. Its outcome
       rows are grouped with the call outcomes further down. */
    ...(hasForms ? [{ label: L.forms, cell: (l: Loc) => int(l.forms), best: bestBy((l) => l.forms) }] : []),
    { label: L.answerRate, cell: (l) => pct(l.answerRate), best: bestBy((l) => l.answerRate) },
    { label: L.voicemail, cell: (l) => pct(l.voicemail), best: locations.reduce((a, b) => (b.voicemail < a.voicemail ? b : a)).name },
    { label: L.bookingRate, cell: (l) => pct(l.bookingRate), best: bestBy((l) => l.bookingRate) },
    { label: L.booked, cell: (l) => int(l.booked), best: bestBy((l) => l.booked) },
    ...(hasForms ? [
      /* NOT a "Form Booked (Percent)" row. Form bookings are derived from each
         location's CALL booking rate (the profile has no per-location form
         conversion), so that row came out identical to "Booked (Percent)" above —
         two matching percentage rows imply two independent measurements, and only
         one exists. Revenue per form carries the same signal without the lie. */
      { label: L.formsBooked, cell: (l: Loc) => int(l.formsBooked), best: bestBy((l) => l.formsBooked) },
      { label: L.revPerForm, cell: (l: Loc) => usd(l.forms ? l.formRevenue / l.forms : 0),
        best: bestBy((l) => (l.forms ? l.formRevenue / l.forms : 0)) },
    ] : []),
    { label: L.revenue, cell: (l) => usd(l.revenue), best: bestBy((l) => l.revenue) },
    /* Labelled "Form-Attributed" and NOT "Total", because it is the lead-form channel
       cut from the AI Agent Conversion dashboard, not an amount to be added to the
       call revenue above it. There is no totals row here, so nothing sums them. */
    ...(hasForms ? [{ label: L.formRevenue, cell: (l: Loc) => usd(l.formRevenue), best: bestBy((l) => l.formRevenue) }] : []),
    { label: L.revPerCall, cell: (l) => usd(l.revPerCall), best: bestBy((l) => l.revPerCall) },
  ];

  const rankMax = Math.ceil(Math.max(...locations.map((l) => l.bookingRate)) / 10) * 10 + 10;

  return (
    <div className="dash-page">
      <div className="breadcrumb"><Link to="/dashboards">Manage Dashboards</Link></div>
      <div className="title-row">
        <h1 className="title">{view.title}</h1>
        <DashHeaderActions />
      </div>
      {view.dateRange ? <div className="toolbar"><span className="chip">{view.dateRange}</span></div> : null}

      {/* One card per location. .aac-conv-grid is the existing 3-across 10px grid;
          the column count follows the data so four locations sit on one row instead
          of leaving an orphan card below three. Same pattern the AI Messaging cards
          already use (repeat(${tiles.length}, 1fr)), capped at 4 so a prospect with
          many locations wraps rather than producing unreadably narrow cards. */}
      <div className="aac-conv-grid"
        style={{ gridTemplateColumns: `repeat(${Math.min(locations.length, 4)}, 1fr)` }}>
        {locations.map((l) => (
          <section className="dash-card" key={l.name}>
            <CardHead title={l.name} />
            <div className="kpi-grid">
              <Tile label={L.calls} value={int(l.calls)} />
              {/* Lead Forms takes the second tile so each card shows BOTH demand
                  volumes; the booked count is still a row in the scorecard. */}
              <Tile label={hasForms ? L.forms : L.booked} value={hasForms ? int(l.forms) : int(l.booked)} />
              <Tile label={L.bookingRate} value={pct(l.bookingRate)} />
              <Tile label={L.revenue} value={usd(l.revenue)} />
            </div>
          </section>
        ))}
      </div>

      {/* share of calls + the booking-rate ranking: two narrow tiles side by side */}
      <div className="breakdown-row">
        <section className="dash-card breakdown-donut">
          <CardHead title={L.share} />
          <div className="donut-wrap">
            <DonutChart
              segments={locations.map((l) => ({ label: l.name, value: l.calls }))}
              total={totalCalls}
            />
          </div>
        </section>
        <section className="dash-card">
          <CardHead title={L.ranking} />
          <HBarChart
            chart={{
              legend: L.bookingRate,
              axisMax: rankMax,
              axisTicks: Array.from({ length: 7 }, (_, i) => Math.round((rankMax / 6) * i)),
              axisSuffix: "%",
              bars: [...locations]
                .sort((a, b) => b.bookingRate - a.bookingRate)
                .map((l) => ({ name: l.name, value: l.bookingRate, display: pct(l.bookingRate) })),
            }}
          />
        </section>
      </div>

      {/* THE HEAD-TO-HEAD TABLE GETS THE FULL WIDTH. It is a metric per row and a
          location per column, so it is the widest thing on the page and the whole
          point of the screen — squeezed into a 1fr column beside the donut it
          showed two locations and scrolled for the rest. */}
      <section className="dash-card">
        <CardHead title={L.headToHead} />
        <div className="dash-table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th>{L.metric}</th>
                {locations.map((l) => <th key={l.name}>{l.name}</th>)}
                <th>{L.best}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  {locations.map((l) => <td key={l.name}>{m.cell(l)}</td>)}
                  <td>{m.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <DashAssistant />
    </div>
  );
}
