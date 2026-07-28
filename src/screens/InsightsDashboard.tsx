import { useParams, Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DonutChart } from "../components/DonutChart";

/* Insights & Analytics -> a saved dashboard (network 1847
   /insights/dashboard/<uuid>). Matched to the capture: breadcrumb + title, an
   "Ask" pill beside Add Tile, a filter chip row, Summary Metrics, two rate
   tiles, a multi-series time chart, four "Performance By ..." sections that are
   each a donut plus a table with a UNIQUE COUNT / TOTAL footer, and a Calls by
   Location map.

   EVERYTHING IS DERIVED from reports.marketingDashboard, which already carries
   Source / Medium / Campaign / Search Term breakdowns in exactly the shape these
   sections need. No schema slice and no engine phase, so every prospect on disk
   gets this screen immediately and the numbers agree with the Marketing
   Performance dashboard rather than being a second, conflicting set.

   The four sections are ONE component rendered four times, which is also how the
   real page behaves: the columns are identical and only the first column's
   dimension changes. */

const K = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 2 : 2).replace(/\.?0+$/, "")}K` : String(n);

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
   colour: legend on the right, a rotated y-axis title, an x-axis title, and a
   forecast band. Bending the shared components into that shape would put six
   other dashboards at risk for no benefit. */

/* Weekly-trend sparkline: flat baseline with occasional spikes, a light area
   fill, and the grey FORECAST band the capture shows past the last actual week.
   Deterministic from the prospect id so it never moves between renders. */
function TrendSparkline({ seed }: { seed: string }) {
  const W = 760, H = 190, base = H - 26;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  const rnd = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);

  const N = 78;
  const vals = Array.from({ length: N }, (_, i) => {
    const r = rnd();
    if (i === Math.floor(N * 0.27)) return 0.62;   // the two tall spikes in
    if (i === Math.floor(N * 0.74)) return 1;       // the capture
    return r < 0.12 ? r * 0.16 : r * 0.03;
  });
  const x = (i: number) => 8 + (i / (N - 1)) * (W - 16);
  const y = (v: number) => base - v * (base - 14);
  const line = vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");

  /* Forecast band: stepped grey blocks after the last actual point, above AND
     below the baseline, which is how the capture draws the uncertainty range. */
  const fStart = Math.floor(N * 0.78);
  const steps = Array.from({ length: 6 }, (_, i) => {
    const x0 = x(fStart + i * 3), x1 = x(fStart + (i + 1) * 3);
    const up = 34 + rnd() * 26, dn = 30 + rnd() * 34;
    return <rect key={i} x={x0} y={base - up} width={Math.max(1, x1 - x0)} height={up + dn} />;
  });

  return (
    <svg className="ind-spark" viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
      <g className="ind-spark-band">{steps}</g>
      <path className="ind-spark-area" d={`${line} L${x(N - 1)},${base} L${x(0)},${base} Z`} />
      <path className="ind-spark-line" d={line} />
    </svg>
  );
}

/* Conversations/Metrics Over Time. Matched to the capture: legend on the RIGHT
   with round swatches, the y-axis title rotated up the left edge, an x-axis
   title, and dense weekly ticks across two years where most weeks sit near zero
   and a few spike hard. */
function MetricsOverTime({ seed, series }: { seed: string; series: string[] }) {
  const W = 1180, H = 470, padL = 92, padR = 300, padT = 22, padB = 74;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  const rnd = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);

  const N = 108;                                  // roughly two years of weeks
  const yMax = 30000;
  const cols = Array.from({ length: N }, (_, i) => {
    const r = rnd();
    if (i === Math.floor(N * 0.86)) return 0.93;   // the one tall spike
    if (i === Math.floor(N * 0.74)) return 0.11;   // the smaller cluster
    if (i > Math.floor(N * 0.29) && i < Math.floor(N * 0.34)) return 0.02 + r * 0.05;
    return r * 0.006;
  });
  const x = (i: number) => padL + (i / (N - 1)) * plotW;
  const yOf = (f: number) => padT + plotH - f * plotH;

  const TICKS = [0, 10000, 20000, 30000];
  const XL = ["07/01/2024", "01/01/2025", "07/01/2025", "01/01/2026", "07/01/2026"];

  return (
    <svg className="ind-tsline" viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
      {TICKS.map((t) => (
        <text key={t} className="ind-ax" x={padL - 14} y={yOf(t / yMax) + 4} textAnchor="end">
          {t === 0 ? "0" : `${t / 1000}K`}
        </text>
      ))}
      <text className="ind-axtitle" transform={`translate(26,${padT + plotH / 2}) rotate(-90)`}
        textAnchor="middle">Total Call Count &amp; Total Call Answered by Agent &amp; Total New ...</text>

      {/* Each week draws all four series as thin adjacent ticks, which is what
          makes the real chart read as a dense picket fence rather than lines. */}
      {cols.map((f, i) => (
        <g key={i}>
          {series.map((_, si) => {
            const fv = Math.max(0.0025, f * (1 - si * 0.13));
            return <rect key={si} x={x(i) + si * 1.7} y={yOf(fv)} width={1.4}
              height={padT + plotH - yOf(fv)} fill={TS_LINE_COLORS[si % TS_LINE_COLORS.length]} />;
          })}
        </g>
      ))}
      <line className="ind-axline" x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} />

      {XL.map((l, i) => (
        <text key={l} className="ind-ax" x={padL + (i / (XL.length - 1)) * plotW}
          y={padT + plotH + 26} textAnchor="middle">{l}</text>
      ))}
      <text className="ind-axtitle" x={padL + plotW / 2} y={H - 16} textAnchor="middle">
        Weekly Call Start Time
      </text>

      {series.map((name, i) => (
        <g key={name}>
          <circle cx={W - padR + 26} cy={padT + 106 + i * 42} r={7}
            fill={TS_LINE_COLORS[i % TS_LINE_COLORS.length]} />
          <text className="ind-legend" x={W - padR + 44} y={padT + 112 + i * 42}>
            {name.length > 26 ? name.slice(0, 25) + "..." : name}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PerfSection({ title, dimension, rows }: { title: string; dimension: string; rows: Row[] }) {
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
          />
        </div>
        <div className="ind-half">
          <h3 className="ind-sub">{title} (Table)</h3>
          <div className="ind-tablewrap">
            <table className="ind-table">
              <thead>
                <tr>
                  <th>{dimension}</th>
                  <th>Total Call Count</th>
                  <th>Total Call Answered by Agent</th>
                  <th>Total New Sales Call</th>
                  <th>Total New Service Activation</th>
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

/* Calls by Location. The real tile is a Mapbox scatter of every call's origin;
   this plots deterministic points across the continental US from the row data,
   so the density differs per prospect but never moves between renders. A light
   basemap matches the capture, which uses Mapbox's light style here rather than
   the dark one the ChatGPT screen uses. */
const MAPBOX_TOKEN = (import.meta.env as Record<string, string | undefined>).VITE_MAPBOX_TOKEN;

function LocationTile({ seed, count }: { seed: string; count: number }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  const rand = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);

  /* Loose population-weighted boxes so the scatter clusters where people are,
     rather than dusting the map evenly including empty desert. */
  const BOXES: [number, number, number, number, number][] = [
    [24, 49, -125, -115, 0.16], [31, 49, -115, -100, 0.12],
    [29, 49, -100, -87, 0.26], [25, 47, -87, -75, 0.34],
    [25, 36, -100, -80, 0.12],
  ];
  const pts = Array.from({ length: Math.min(420, Math.max(60, count)) }, () => {
    const r = rand();
    let acc = 0;
    const box = BOXES.find((b) => (acc += b[4]) >= r) ?? BOXES[3];
    const lat = box[0] + rand() * (box[1] - box[0]);
    const lon = box[2] + rand() * (box[3] - box[2]);
    return { x: ((lon + 128) / 60) * 100, y: ((52 - lat) / 30) * 100 };
  });

  const src = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/-95,38,3.1,0/1000x520@2x`
      + `?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
    : null;

  return (
    <section className="ind-card">
      <h2 className="ind-card-title">Calls by Location</h2>
      <div className="ind-map">
        {src ? <img className="ind-map-img" src={src} alt="Calls by location" />
             : <div className="ind-map-flat" />}
        <div className="ind-dots">
          {pts.map((p, i) => (
            <span key={i} className="ind-dot" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
          ))}
        </div>
        <div className="ind-map-zoom"><button>+</button><button>−</button></div>
        <span className="ind-map-attr">© Mapbox © OpenStreetMap</span>
      </div>
    </section>
  );
}

export function InsightsDashboard() {
  const { profile } = useProfile();
  const { name } = useParams();
  const md = profile.reports.marketingDashboard;
  const find = (re: RegExp) => md.breakdowns.find((b) => re.test(b.title));

  const medium = toRows(find(/Medium/i));
  const source = toRows(find(/Source/i));
  const campaign = toRows(find(/Campaign/i));
  const page = toRows(find(/Search Term|Calling Page/i));

  const totalCalls = source.reduce((s, r) => s + r.calls, 0);
  const conversations = source.reduce((s, r) => s + r.answered, 0);
  const missed = totalCalls - conversations;
  const activations = source.reduce((s, r) => s + r.activation, 0);
  const buyingIntent = totalCalls ? (100 - (missed / totalCalls) * 100 * 0.14).toFixed(2) : "0";
  const conversions = totalCalls ? ((activations / totalCalls) * 100).toFixed(2) : "0";

  const title = name ? decodeURIComponent(name) : "Marketing Performance";

  return (
    <div className="ind-page">
      <div className="ind-head">
        <div>
          <Link to="/insights" className="ind-crumb">INSIGHTS &amp; ANALYTICS</Link>
          <h1 className="ind-title">{title}</h1>
        </div>
        <div className="ind-actions">
          <button className="ind-ask"><span className="material-icons">auto_awesome</span>Ask</button>
          <button className="ind-add"><span className="material-icons">add</span>Add Tile</button>
          <span className="material-icons ind-kebab">more_vert</span>
        </div>
      </div>

      <div className="ind-filters">
        <span className="ind-chip">Call Start Time <b>(Select)</b></span>
      </div>

      <div className="ind-grid">
        <section className="ind-card">
          <h2 className="ind-card-title">Summary Metrics</h2>
          <div className="ind-summary">
            <div className="ind-metrics">
              <div><span className="ind-m-label">Total Calls</span><span className="ind-m-value">{totalCalls.toLocaleString()}</span></div>
              <div><span className="ind-m-label">Missed Conversations</span><span className="ind-m-value">{missed.toLocaleString()}</span></div>
              <div><span className="ind-m-label">Total Conversations</span><span className="ind-m-value">{conversations.toLocaleString()}</span></div>
            </div>
            <div className="ind-trend">
              <span className="ind-m-label">Total Conversations Weekly Trend</span>
              <span className="ind-trend-value">0</span>
              <span className="ind-trend-sub">Week of {md.dateRange?.split("-")[1] ?? ""}</span>
              <span className="ind-trend-sub"><mark>0% (0)</mark> Week of {md.dateRange?.split("-")[0] ?? ""} ›</span>
              <TrendSparkline seed={profile.id} />
            </div>
          </div>
        </section>

        <section className="ind-card">
          <h2 className="ind-card-title">Conversations/Metrics Over Time</h2>
          <MetricsOverTime seed={profile.id} series={[
            "Total Call Count", "Total Call Answered by Agent",
            "Total New Sales Call", "Total New Service Activation",
          ]} />
        </section>

        <section className="ind-card ind-rate">
          <h2 className="ind-card-title">Buying Intent</h2>
          <span className="ind-m-value ind-big">{buyingIntent}%</span>
        </section>
        <section className="ind-card ind-rate">
          <h2 className="ind-card-title">Conversions</h2>
          <span className="ind-m-value ind-big">{conversions}%</span>
        </section>
      </div>

      <PerfSection title="Performance By Medium" dimension="Marketing Medium" rows={medium} />
      <PerfSection title="Performance By Source" dimension="Marketing Source" rows={source} />
      <PerfSection title="Performance By Campaign" dimension="Marketing Campaign" rows={campaign} />
      <PerfSection title="Performance By Calling Page" dimension="Calling Page" rows={page} />

      <LocationTile seed={profile.id} count={Math.round(totalCalls / 100)} />
    </div>
  );
}
