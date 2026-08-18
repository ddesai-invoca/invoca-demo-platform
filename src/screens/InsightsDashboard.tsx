import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DonutChart, TS_GEOM, truncate } from "../components/DonutChart";
import { usePageDataWithLabels } from "../components/GeneratedTiles";
import { InteractionsDrawer, type DrawerRequest } from "../components/InteractionsDrawer";
import { buildInteractions } from "../data/interactions";
import { InsightsAskDrawer } from "../components/InsightsAskDrawer";

/* Insights & Analytics -> a saved dashboard (network 1847
   /insights/dashboard/<uuid>). Matched to the capture: breadcrumb + title, an
   "Ask" pill beside Add Tile, a filter chip row, Summary Metrics, two rate
   tiles, a multi-series time chart, four "Performance By ..." sections that are
   each a donut plus a table with a UNIQUE COUNT / TOTAL footer.

   NOTE the capture also has a "Calls by Location" map tile. It was built and then
   removed at the user's request, so this screen deliberately ends at the four
   Performance sections. Bring it back from git history rather than rewriting it.

   EVERYTHING IS DERIVED from reports.marketingDashboard, which already carries
   Source / Medium / Campaign / Search Term breakdowns in exactly the shape these
   sections need. No schema slice and no engine phase, so every prospect on disk
   gets this screen immediately and the numbers agree with the Marketing
   Performance dashboard rather than being a second, conflicting set.

   The four sections are ONE component rendered four times, which is also how the
   real page behaves: the columns are identical and only the first column's
   dimension changes. */

/* EVERY heading and metric label on this screen, as data.

   These were literals, which made them invisible to the Ask AI drawer: it would
   accept "rename Summary Metrics to Quarterly Summary", write the edit, and the
   screen would not change. They are folded into the page's scope by
   usePageDataWithLabels, so the assistant can edit any of them per page.

   The ThoughtSpot table footers ("UNIQUE COUNT" / "TOTAL") and the column
   dimensions ("Marketing Source" etc.) stay hardcoded on purpose: those are the
   platform's own vocabulary, not this prospect's data, and rule 2 keeps the AI
   out of the template. */
const LABELS = {
  summary: "Summary Metrics",
  totalCalls: "Total Calls",
  missed: "Missed Conversations",
  conversations: "Total Conversations",
  weeklyTrend: "Total Conversations Weekly Trend",
  overTime: "Conversations/Metrics Over Time",
  buyingIntent: "Buying Intent",
  conversions: "Conversions",
  xAxis: "Weekly Call Start Time",
  byMedium: "Performance By Medium",
  bySource: "Performance By Source",
  byCampaign: "Performance By Campaign",
  byPage: "Performance By Calling Page",
  /* The four metric columns, shared by the time chart's legend and every
     Performance-By table. Measured off the real Summary Dashboard (network 2160,
     insights/dashboard/e8ceb479): "Total Call Count", "Total Answered by Agent",
     "Total Appointment: Discussed", "Total Appointment: Scheduled". The last two
     carry the prospect's OWN booking term, so they are filled in per prospect
     (buildLabels below) rather than hardcoded to one vertical's "Appointment".
     They were literals, which made them invisible to the assistant. */
  mCalls: "Total Call Count",
  mAnswered: "Total Answered by Agent",
  mDiscussed: "Total <BOOK>: Discussed",
  mScheduled: "Total <BOOK>: Scheduled",
  saveView: "Save view",
  filterLabel: "Call Start Time",
};

/* <BOOK> -> this prospect's booking term. Done here so the four metric names stay in
   ONE place and the chart legend cannot drift from the table headers. */
function buildLabels(booking: string) {
  const out = { ...LABELS };
  for (const k of ["mDiscussed", "mScheduled"] as const) {
    out[k] = out[k].replace("<BOOK>", booking);
  }
  return out;
}

const K = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 2 : 2).replace(/\.?0+$/, "")}K` : String(n);

/* ThoughtSpot prints the donut's percent to two decimals but drops trailing zeros —
   the real tile reads "25.84%", "5.8%", "0.06%". Rounding through Number does that in
   one step; a regex trailing-zero strip is the version that turns "100.00" into "1". */
const PCT = (p: number) => `${+p.toFixed(2)}%`;

/* The donut's outside label: "Paid Search - 763 (15.65%)", measured off the real
   Performance By Medium tile. The percent is the slice's share of the grand total, so
   the labels sum to 100% across the ring.

   The NAME is truncated but the count and percent never are — a campaign name can run
   40 characters, and losing the number to fit the name would defeat the point of
   putting it there. */
const donutLabel = (seg: { label: string; value: number }, pct: number) =>
  `${truncate(seg.label, 13)} - ${K(seg.value)} (${PCT(pct)})`;

interface Row { name: string; calls: number; answered: number; sales: number; activation: number }

/* Row metrics in the profile are [calls, answered%, converted%, revenue]. The
   capture's columns are counts, so the percentages are applied to the call count
   rather than invented, which keeps every row internally consistent and the
   footer totals equal to the sum of the rows. */
function toRows(b: { rows: { name: string; metrics: string[] }[] } | undefined): Row[] {
  if (!b) return [];
  return b.rows.map((r) => {
    const calls = Number(String(r.metrics[0] ?? "0").replace(/[^\d]/g, "")) || 0;
    const ansPct = parseFloat(String(r.metrics[1] ?? "0")) || 0;
    const convPct = parseFloat(String(r.metrics[2] ?? "0")) || 0;
    const answered = Math.round(calls * (ansPct / 100));
    const sales = Math.round(calls * ((100 - convPct) / 100));
    return { name: r.name, calls, answered, sales, activation: Math.round(calls * (convPct / 100)) };
  });
}

/* ThoughtSpot's chart palette, READ OFF THE SCREENSHOTS rather than measured,
   and that limitation is worth knowing: the SingleFile capture does not render
   (ThoughtSpot builds the liveboard at runtime, so there is no DOM to measure),
   and the only hex arrays in its bundle are library defaults it overrides
   (d3 category10 and the Highcharts v10 set), neither of which matches what the
   screenshots actually show. So these are eyeballed from the captured tiles:
   grey for the {Null} slice, then mint, blue, purple, green, coral, amber.
   The green (#2cbf58) and blue (#2666f9) DO appear verbatim in
   titan-design-tokens.css, which is a good sign for the rest. */
const TS_COLORS = ["#8892a0", "#2ee0ca", "#2666f9", "#7b61ff", "#2cbf58",
  "#f5575a", "#f3cb00", "#87000b"];

/* The TIME chart uses a different order from the donuts. Taking a slice of
   TS_COLORS gave green/coral/yellow/maroon, but the capture's legend reads
   green, yellow, teal, blue in that order, so the series order is explicit
   rather than derived. */
const TS_LINE_COLORS = ["#2cbf58", "#f3cb00", "#2ee0ca", "#2666f9"];

/* Both charts below are LOCAL to this screen rather than additions to the shared
   DonutChart/LineChart. The differences from ours are structural, not just
   colour: legend on the right, a rotated y-axis title and an x-axis title.
   Bending the shared components into that shape would put six
   other dashboards at risk for no benefit. */

/* Total Conversations Weekly Trend — a filled AREA chart over the weekly buckets.

   Replaces a 78-point pseudo-random sparkline with a grey "forecast" band. That
   version showed a flat line with two spikes and a hardcoded 0 as its headline, which
   said nothing: a trend tile whose number is always zero is a tile with no content.

   Matched to the reference: a large light-blue filled area under a bright blue line,
   the value big above it, then "Week of <date>" and a highlighted percent delta
   against the previous week.

   VALUES ARE THE PROSPECT'S OWN weekly conversations, so the headline number, the
   delta and the shape all describe the same series the rest of the dashboard shows. */
function TrendArea({ values, dates, metricLabel, dateLabel, onPick }: {
  values: number[]; dates: string[]; metricLabel: string; dateLabel: string;
  onPick: (i: number) => void;
}) {
  const W = 520, H = 300, padT = 10, padB = 18;
  const max = Math.max(1, ...values);
  const n = Math.max(2, values.length);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `M0,${y(values[0] ?? 0).toFixed(1)} L${pts.replace(/ /g, " L")} L${W},${H - padB} L0,${H - padB} Z`;

  /* HOVER. The point marker and the tooltip exist only while the pointer is over the
     chart, which is how the real tile behaves.

     The marker is SVG (so it sits exactly on the line) but the tooltip is HTML
     positioned in PERCENTAGES of the same box. The svg is stretched with
     preserveAspectRatio="none", so viewBox units are NOT screen units — anything
     positioned in px would drift as the tile resizes, while a percentage of the same
     viewBox coordinate tracks it exactly. */
  const [hover, setHover] = useState<number | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };

  const hv = hover === null ? null : values[hover] ?? 0;
  /* Flip the tooltip to the left of the point past the midpoint so it never runs off
     the tile's right edge. */
  const flip = hover !== null && hover > (n - 1) / 2;

  /* CLICK opens the interaction drawer for the week under the pointer. The handler
     sits on the wrapper rather than the marker circle: the marker snaps to the
     nearest week anyway, so a 7px target would only make the same action harder to
     hit. */
  return (
    <div className="ind-trendwrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onClick={() => { if (hover !== null) onPick(hover); }}>
      <svg className="ind-trendarea" viewBox={`0 0 ${W} ${H}`} width="100%"
        preserveAspectRatio="none" aria-hidden="true">
        <path className="ind-trendarea-fill" d={area} />
        <polyline className="ind-trendarea-line" points={pts} />
        {hover !== null && (
          <circle className="ind-trenddot" cx={x(hover)} cy={y(hv ?? 0)} r="7" />
        )}
      </svg>

      {hover !== null && (
        <div className="ind-tip" style={{
          left: `${(x(hover) / W) * 100}%`,
          top: `${(y(hv ?? 0) / H) * 100}%`,
          transform: `translate(${flip ? "calc(-100% - 14px)" : "14px"}, -50%)`,
        }}>
          <div className="ind-tip-k">{metricLabel}:</div>
          <div className="ind-tip-v">{(hv ?? 0).toLocaleString("en-US")}</div>
          <div className="ind-tip-k ind-tip-gap">{dateLabel}:</div>
          <div className="ind-tip-v">{dates[hover] ?? ""}</div>
        </div>
      )}
    </div>
  );
}

/* Conversations/Metrics Over Time. Matched to the capture: legend on the RIGHT
   with round swatches, the y-axis title rotated up the left edge, an x-axis
   title, and dense weekly ticks across two years where most weeks sit near zero
   and a few spike hard. */
/* Conversations/Metrics Over Time — a GROUPED BAR chart, one group per weekly
   bucket and one bar per metric.

   It was a dense multi-week LINE chart with two spikes, which read as noise: 108
   near-zero weeks with a couple of spikes tells the viewer nothing. The real tile
   (network 2160, insights/dashboard/e8ceb479) is five weekly groups of bars with a
   0-2K axis, a rotated y-axis title, an x-axis title and a dot legend on the RIGHT.
   Read off the screenshots, since the SingleFile capture of this screen carries only
   1,770 characters of visible text — ThoughtSpot builds the liveboard at runtime, so
   there is no DOM to measure.

   VALUES COME FROM THE PROFILE, not from a random walk, so this tile agrees with the
   Summary Metrics beside it and with the Marketing Performance dashboard: the four
   series are the same call / answered / discussed / scheduled totals, split across
   the buckets with a stable per-prospect shape. */
function MetricsOverTime({ seed, series, xAxisLabel, buckets, bucketDates, totals, onPick }: {
  seed: string; series: string[]; xAxisLabel: string;
  buckets: string[]; bucketDates: string[]; totals: number[];
  /* `first` is true for the leftmost bar of the leftmost group — the one bar whose drawer
     offers a clickable call. Reported by the chart rather than recomputed by the caller,
     since the chart is what knows the drawing order. */
  onPick: (metric: string, value: number, bucket: number, first: boolean) => void;
}) {
  /* SIZED FOR THE TILE, not for the viewBox. The chart shares a half-width row, so at
     ~540px on screen the old 1180x470 box rendered barely 200px tall and the 300px
     legend gutter ate a quarter of the width. A taller box (the svg scales to the
     tile's width, so height follows the RATIO) plus a tighter gutter gives the bars
     real room; .ind-time also carries a min-height so a narrow tile cannot squash it
     back down. */
  const W = 1180, H = 640, padL = 96, padR = 210, padT = 26, padB = 80;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  /* Stable per prospect so an SE revisiting sees the same chart. */
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  const rnd = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);

  /* Each series' total spread over the buckets, weighted so the middle weeks run
     heavier than the edges (a month rarely starts and ends at its peak) and the
     parts still sum to the series total. */
  const weights = buckets.map((_, i) => 0.6 + Math.sin((i + 1) / (buckets.length + 1) * Math.PI) * 0.9 + rnd() * 0.25);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const data = totals.map((t) => weights.map((w) => Math.round((w / wSum) * t)));

  const max = Math.max(1, ...data.flat());
  /* Ticks must be ROUND NUMBERS, not quarters of an arbitrary ceiling. Rounding the
     ceiling first and then quartering it gave 0 / 3.8K / 7.5K / 11.3K, where the real
     tile reads 0 / 500 / 1K / 1.5K / 2K. So pick the STEP from a nice-number ladder
     and let the top fall out of it. */
  /* The ladder needs enough rungs to sit CLOSE above the data. With only
     1/2/2.5/5/10, a peak of 11K rounded the axis to 20K and the tallest bar filled
     barely half the plot — the chart looked small even at full width. Adding 1.5/3/4
     gives 3K/6K/9K/12K for that case, so the peak reaches ~92% of the height. */
  const niceStep = (target: number) => {
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 10]) if (m * pow >= target) return m * pow;
    return 10 * pow;
  };
  const step = niceStep(max / 4);
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => step * i);

  /* HOVER highlights the whole SERIES, not just the one bar: pointing at a green bar
     keeps every green bar saturated and washes the other three out. That is what the
     reference does, and it is the more useful reading — it isolates one metric across
     all the weeks rather than one cell. */
  const [hot, setHot] = useState<{ si: number; bi: number } | null>(null);

  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const groupW = plotW / buckets.length;
  const barW = Math.min(26, (groupW * 0.66) / series.length);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n));

  return (
    <div className="ind-timewrap">
    <svg className="ind-time" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={xAxisLabel}>
      {/* Tick LABELS only. The real tile draws no gridlines behind the bars, and the
          faint ones here were the "line in the back" — removed rather than lightened,
          since the reference has none at all. */}
      {ticks.map((t) => (
        <text key={t} className="ind-tick" x={padL - 12} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
      ))}

      {buckets.map((b, bi) => (
        <g key={b}>
          {series.map((_, si) => {
            const v = data[si]?.[bi] ?? 0;
            const cx = padL + bi * groupW + groupW / 2;
            const x = cx - (series.length * barW) / 2 + si * barW;
            const dim = hot !== null && hot.si !== si;
            return <rect key={si} x={x} y={y(v)} width={Math.max(2, barW - 2)}
              height={Math.max(0, padT + plotH - y(v))}
              fill={TS_LINE_COLORS[si % TS_LINE_COLORS.length]}
              opacity={dim ? 0.22 : 1}
              onMouseEnter={() => setHot({ si, bi })}
              onMouseLeave={() => setHot(null)}
              onClick={() => onPick(series[si] ?? "", v, bi, si === 0 && bi === 0)} />;
          })}
          <text className="ind-tick" x={padL + bi * groupW + groupW / 2} y={padT + plotH + 20}
            textAnchor="middle">{b}</text>
        </g>
      ))}

      <line className="ind-axis" x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} />

      {/* rotated y-axis title, truncated the way the real one is */}
      <text className="ind-axtitle" transform={`translate(28 ${padT + plotH / 2}) rotate(-90)`}
        textAnchor="middle">{series.slice(0, 2).join(" & ")} & ...</text>
      <text className="ind-axtitle" x={padL + plotW / 2} y={H - 22} textAnchor="middle">
        {xAxisLabel} (for 2026)
      </text>

      {/* legend on the RIGHT, round swatches */}
      {series.map((name, i) => (
        <g key={name} transform={`translate(${padL + plotW + 34} ${padT + 18 + i * 26})`}
          opacity={hot !== null && hot.si !== i ? 0.35 : 1}>
          <circle cx="6" cy="-4" r="5" fill={TS_LINE_COLORS[i % TS_LINE_COLORS.length]} />
          <text className="ind-legend-t" x="20" y="0">
            {name.length > 30 ? name.slice(0, 29) + "..." : name}
          </text>
        </g>
      ))}
    </svg>

    {/* Same dark panel as the weekly-trend tooltip, positioned in PERCENTAGES of the
        viewBox so it tracks the bar as the tile resizes (the svg scales, so px would
        drift). Flips to the left of the bar past the midpoint to stay inside the
        card, and shows the FULL date the way the reference does. */}
    {hot !== null && (() => {
      const v = data[hot.si]?.[hot.bi] ?? 0;
      const cx = padL + hot.bi * groupW + groupW / 2
        - (series.length * barW) / 2 + hot.si * barW + barW / 2;
      const flip = cx > padL + plotW / 2;
      return (
        <div className="ind-tip" style={{
          left: `${(cx / W) * 100}%`,
          top: `${(y(v) / H) * 100}%`,
          transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, -14px)`,
        }}>
          <div className="ind-tip-k">{series[hot.si]}:</div>
          <div className="ind-tip-v">{v.toLocaleString("en-US")}</div>
          <div className="ind-tip-k ind-tip-gap">{xAxisLabel}:</div>
          <div className="ind-tip-v">{bucketDates[hot.bi] ?? buckets[hot.bi]}</div>
        </div>
      );
    })()}
    </div>
  );
}

function PerfSection({ title, dimension, rows, metrics, onPick }: {
  title: string; dimension: string; rows: Row[]; metrics: string[];
  onPick: (title: string, slice: string, value: number) => void;
}) {
  /* The hover panel's captions are the SAME strings the table beside it uses — the
     metric is the first column header, the dimension is this section's own — so the two
     halves of the tile can't name the same number differently. */
  const hover = { metricLabel: metrics[0] ?? "Total Call Count", dimensionLabel: dimension, format: K };
  const total = (k: keyof Omit<Row, "name">) => rows.reduce((s, r) => s + r[k], 0);
  const shown = rows.slice(0, 8);
  return (
    <section className="ind-card">
      <h2 className="ind-card-title">{title}</h2>
      <div className="ind-split">
        <div className="ind-half">
          <h3 className="ind-sub">{title} (Donut)</h3>
          <DonutChart
            segments={rows.slice(0, 7).map((r) => ({ label: r.name, value: r.calls }))}
            total={total("calls")}
            colors={TS_COLORS}
            onSlice={(seg) => onPick(title, seg.label, seg.value)}
            geom={TS_GEOM}
            slicePct={false}
            label={donutLabel}
            hover={hover}
          />
        </div>
        <div className="ind-half">
          <h3 className="ind-sub">{title} (Table)</h3>
          <div className="ind-tablewrap">
            <table className="ind-table">
              <thead>
                <tr>
                  <th>{dimension}</th>
                  <th>{metrics[0]}</th>
                  <th>{metrics[1]}</th>
                  <th>{metrics[2]}</th>
                  <th>{metrics[3]}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{K(r.calls)}</td><td>{K(r.answered)}</td>
                    <td>{K(r.sales)}</td><td>{K(r.activation)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><span className="ind-foot-label">UNIQUE COUNT</span><b>{rows.length}</b></td>
                  {(["calls", "answered", "sales", "activation"] as const).map((k) => (
                    <td key={k}><span className="ind-foot-label">TOTAL</span><b>{K(total(k))}</b></td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="ind-showing">Showing {rows.length} of {rows.length} rows</p>
        </div>
      </div>
    </section>
  );
}

export function InsightsDashboard() {
  const { profile } = useProfile();
  const { name } = useParams();
  /* Registers this page as the AI scope and returns the slice with any
     edits made ON THIS PAGE overlaid (see usePageData). */
  /* Labels carry the prospect's own booking term, so the chart legend and every
     table header say "Total Consultation: Scheduled" for a blinds company and
     "Total Appointment: Scheduled" for a clinic, exactly as the real page does. */
  const view = usePageDataWithLabels(
    profile.reports.marketingDashboard, buildLabels(profile.bookingTerm || "Appointment"));
  const md = view;
  const L = view.labels;
  /* The "Ask" drawer's own open state. Kept separate from the interactions drawer
     below: they are different surfaces and must never be open at once by accident. */
  const [askOpen, setAskOpen] = useState(false);

  const find = (re: RegExp) => md.breakdowns.find((b) => re.test(b.title));
  const metricCols = [L.mCalls, L.mAnswered, L.mDiscussed, L.mScheduled];

  /* Weekly buckets labelled like the capture's "Mar 30 / Apr 06 / ...": the Mondays
     inside the dashboard's own date range, so the axis matches the filter chip above
     it rather than an invented window. */
  const weekDates = (() => {
    const start = new Date(String(md.dateRange ?? "").split("-")[0]?.trim() || "2026-01-01");
    if (isNaN(+start)) return [] as string[];
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i * 7);
      return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    });
  })();
  const weekBuckets = (() => {
    const start = new Date(String(md.dateRange ?? "").split("-")[0]?.trim() || "2026-01-01");
    if (isNaN(+start)) return ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"];
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i * 7);
      return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    });
  })();
  /* The chip shows the APPLIED range, the way the capture does. dateRange is
     "1/1/2026-1/31/2026"; the real chip reads "Between (04/01/2026 <= 04/30/2026)". */
  const filterRange = (() => {
    const [a, b] = String(md.dateRange ?? "").split("-");
    const pad = (d: string) => d.trim().split("/").map((x, i) => (i < 2 ? x.padStart(2, "0") : x)).join("/");
    return a && b ? `${pad(a)} <= ${pad(b)}` : String(md.dateRange ?? "");
  })();

  const medium = toRows(find(/Medium/i));
  const source = toRows(find(/Source/i));
  const campaign = toRows(find(/Campaign/i));
  const page = toRows(find(/Search Term|Calling Page/i));

  const totalCalls = source.reduce((s, r) => s + r.calls, 0);
  const conversations = source.reduce((s, r) => s + r.answered, 0);
  const missed = totalCalls - conversations;

  /* WEEKLY CONVERSATIONS for the trend tile, and the headline is the LAST bucket with a
     real percent change against the one before it (the tile used to hardcode 0 and
     "0% (0)", so it always read as no data).

     THE SHAPE RISES AND FALLS. The weights were `1.35 - i * 0.2`, which is monotonically
     decreasing by construction, so every prospect drew the same straight ramp down and
     the headline delta was always negative. Real weekly volume wobbles.

     Rather than adding noise to a trend and hoping it comes out non-monotonic, the shape
     is picked from a table where EVERY ENTRY BOTH RISES AND FALLS (four of the six change
     direction three times; the other two turn once, which reads as a build-and-fade
     month). A random wobble can still land on five descending values, so the property is
     guaranteed in code rather than asked for — the same approach the outcome story uses.

     Each row is a multiplier on the average week, so the five values still sum to the
     month's conversations whichever row is chosen. Deliberately not round, and the peak
     is never the first or last week. */
  const TREND_SHAPES = [
    [0.95, 1.18, 0.88, 1.12, 0.87],
    [0.88, 1.09, 1.24, 0.92, 0.87],
    [1.14, 0.91, 1.21, 0.86, 0.88],
    [0.86, 1.07, 0.93, 1.26, 0.88],
    [1.09, 0.88, 1.16, 0.94, 0.93],
    [0.91, 1.22, 0.94, 1.06, 0.87],
  ];

  const trend = (() => {
    /* Stable per prospect, so an SE revisiting a demo sees the same line.

       ⚠️ Take the bucket from the HIGH bits (`>>> 16`), not from `Math.abs(h) % 6`. With
       6 shapes and the eleven profiles on disk, the low bits put SIX of them on the same
       shape — the very tell this table exists to remove, and the same modulo-bias trap
       that made the Insights report view counts come out consecutive. Shifting first
       spreads them across all six. */
    let h = 2166136261;
    for (const ch of profile.id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    const weights = TREND_SHAPES[(h >>> 16) % TREND_SHAPES.length]!;
    const n = weights.length;

    const wSum = weights.reduce((a, b) => a + b, 0);
    const values = weights.map((w) => Math.round((w / wSum) * conversations));
    const latest = values[n - 1] ?? 0, prev = values[n - 2] ?? 0;
    const change = latest - prev;
    return {
      values, latest,
      pct: prev ? `${change > 0 ? "+" : ""}${Math.round((change / prev) * 100)}%` : "0%",
      delta: `${change > 0 ? "+" : ""}${change.toLocaleString("en-US")}`,
    };
  })();

  /* The chart's four series totals, taken from the SAME rows the tables show, so the
     bars, the Summary Metrics tile and the Marketing Performance dashboard all agree
     rather than being three independent sets of numbers. */
  const seriesTotals = [
    totalCalls,
    conversations,
    source.reduce((s, r) => s + r.sales, 0),
    source.reduce((s, r) => s + r.activation, 0),
  ];
  const activations = source.reduce((s, r) => s + r.activation, 0);
  const buyingIntent = totalCalls ? (100 - (missed / totalCalls) * 100 * 0.14).toFixed(2) : "0";
  const conversions = totalCalls ? ((activations / totalCalls) * 100).toFixed(2) : "0";

  const title = name ? decodeURIComponent(name) : "Marketing Performance";

  /* THE INTERACTION DRAWER. One piece of state for the whole dashboard: whatever was
     clicked writes the tile name, the metric, the value and the date, and the rows are
     derived from that. Charts stay presentational — they report WHAT was clicked and
     know nothing about drawers.

     The date is the week's own date for the two time charts and the dashboard's range
     start for the donuts, which have no time axis. Every card in the real drawer
     carries the same date, so this matches rather than inventing per-card dates. */
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null);
  const rangeStart = weekDates[0] ?? "";
  const items = useMemo(
    () => (drawer ? buildInteractions(profile, drawer) : []),
    [profile, drawer],
  );

  return (
    <div className="ind-page">
      <div className="ind-head">
        <div>
          <Link to="/insights" className="ind-crumb">INSIGHTS &amp; ANALYTICS</Link>
          <h1 className="ind-title">{title}</h1>
        </div>
        <div className="ind-actions">
          <button className="ind-ask" onClick={() => setAskOpen(true)}>
            <span className="material-icons">auto_awesome</span>Ask
          </button>
          <button className="ind-add"><span className="material-icons">add</span>Add Tile</button>
          <span className="material-icons ind-kebab">more_vert</span>
        </div>
      </div>

      {/* Matched to the capture: a "Save view" button, then the applied filter chip
          showing the real range rather than an unset "(Select)". */}
      <div className="ind-filters">
        <button className="ind-saveview">{L.saveView}</button>
        <span className="ind-chip">{L.filterLabel} <b>Between ({filterRange})</b></span>
      </div>

      <div className="ind-grid">
        <section className="ind-card">
          <h2 className="ind-card-title">{L.summary}</h2>
          <div className="ind-summary">
            <div className="ind-metrics">
              <div><span className="ind-m-label">{L.totalCalls}</span><span className="ind-m-value">{totalCalls.toLocaleString()}</span></div>
              <div><span className="ind-m-label">{L.missed}</span><span className="ind-m-value">{missed.toLocaleString()}</span></div>
              <div><span className="ind-m-label">{L.conversations}</span><span className="ind-m-value">{conversations.toLocaleString()}</span></div>
            </div>
            <div className="ind-trend">
              <span className="ind-m-label">{L.weeklyTrend}</span>
              <span className="ind-trend-value">{trend.latest.toLocaleString("en-US")}</span>
              <span className="ind-trend-sub">Week of {weekBuckets[weekBuckets.length - 1]}</span>
              <span className="ind-trend-sub">
                <mark>{trend.pct} ({trend.delta})</mark> Week of {weekBuckets[weekBuckets.length - 2] ?? ""} ›
              </span>
              <TrendArea values={trend.values} dates={weekDates.length ? weekDates : weekBuckets}
                metricLabel={L.mAnswered} dateLabel={L.xAxis}
                onPick={(i) => setDrawer({
                  title: L.weeklyTrend, metric: `${L.conversations} · Week of ${weekBuckets[i] ?? ""}`,
                  count: trend.values[i] ?? 0, date: weekDates[i] ?? rangeStart,
                })} />
            </div>
          </div>
        </section>

        {/* PAIRED with Summary Metrics, as the real dashboard has it. That means the
            chart is ~390px across in a narrow window and only reaches the reference's
            proportions on a wide one (the real page is ~1900px, so its half-width tile
            is already ~900px) — a deliberate trade, chosen over a full-width chart.
            What buys back the apparent size is the taller viewBox, the smaller legend
            gutter, and the tick ladder sitting close above the data. */}
        <section className="ind-card">
          <h2 className="ind-card-title">{L.overTime}</h2>
          <MetricsOverTime seed={profile.id} xAxisLabel={L.xAxis}
            series={metricCols} buckets={weekBuckets} bucketDates={weekDates}
            totals={seriesTotals}
            onPick={(metric, value, bi, first) => setDrawer({
              title: L.overTime, metric: `${metric} · Week of ${weekBuckets[bi] ?? ""}`,
              count: value, date: weekDates[bi] ?? rangeStart,
              /* ONLY the first bar's drawer offers a call to open, and its top card is
                 pinned to the prospect's own call-detail record so the card and the page
                 agree on the id, duration and summary. The demo has one transcript;
                 thirty cards opening it under thirty different ids would be a lie. */
              ...(first ? {
                pinFirst: true,
                topCallHref: `/insights/call?d=${encodeURIComponent(title)}&n=${value}`,
              } : {}),
            })} />
        </section>

        <section className="ind-card ind-rate">
          <h2 className="ind-card-title">{L.buyingIntent}</h2>
          <span className="ind-m-value ind-big">{buyingIntent}%</span>
        </section>
        <section className="ind-card ind-rate">
          <h2 className="ind-card-title">{L.conversions}</h2>
          <span className="ind-m-value ind-big">{conversions}%</span>
        </section>
      </div>

      {/* All four donuts drill in through the same handler: the slice's own label is
          the metric, and the tile name is its title. */}
      {([[L.byMedium, "Marketing Medium", medium], [L.bySource, "Marketing Source", source],
         [L.byCampaign, "Marketing Campaign", campaign], [L.byPage, "Calling Page", page]] as const)
        .map(([t, dim, rows]) => (
          <PerfSection key={t} metrics={metricCols} title={t} dimension={dim} rows={rows}
            onPick={(tile, slice, value) => setDrawer({
              title: tile, metric: `${L.mCalls} · ${slice}`, count: value, date: rangeStart,
            })} />
        ))}

      {drawer && (
        <InteractionsDrawer req={drawer} items={items} onClose={() => setDrawer(null)} />
      )}

      {/* Always mounted so it can transition OUT as well as in. */}
      {/* WHAT THE DRAWER IS GIVEN IS WHAT THE SCREEN SHOWS.

          Passing the registered page data alone was not enough: this screen COMPUTES
          its headline figures (Total Calls, Missed Conversations, Buying Intent,
          Conversions, the weekly trend) rather than reading them as named fields, so
          asked about the "missed conversation rate" the assistant answered that no
          such metric exists while 20,224 was on screen beside it. Anything a prospect
          can point at has to be in the context. */}
      <InsightsAskDrawer
        open={askOpen}
        onClose={() => setAskOpen(false)}
        pageTitle="Summary Dashboard"
        data={{
          onScreenSummary: {
            [L.totalCalls]: totalCalls,
            [L.missed]: missed,
            [L.conversations]: conversations,
            missedRatePercent: totalCalls ? +((missed / totalCalls) * 100).toFixed(2) : 0,
            [L.buyingIntent]: `${buyingIntent}%`,
            [L.conversions]: `${conversions}%`,
            [L.weeklyTrend]: { latest: trend.latest, change: trend.pct, delta: trend.delta },
          },
          ...md,
        }}
        customerName={profile.customerName}
      />
    </div>
  );
}
