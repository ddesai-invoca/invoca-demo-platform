import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { DonutChart, TS_GEOM } from "../components/DonutChart";
import { usePageDataWithLabels } from "../components/GeneratedTiles";
import { InteractionsDrawer, type DrawerRequest } from "../components/InteractionsDrawer";
import { buildInteractions, isoDate } from "../data/interactions";
import { connectAiFacts, ENTRY_POINTS, type MediumRow } from "../data/connectAi";

/* Insights & Analytics -> Connect AI. Matched to the capture "Insights & Analytics Connect
   AI｜ Invoca for Healthcare 2.0" (8/6/2026, network 2160, dashboard c925e7d5) and its two
   screenshots.

   The whole report is one argument: switching the AI agent on lifted answer rate and
   bookings. Every tile is the same month cut into three rollout phases — Pre Agentic,
   Voice Agentic Only, Full Agentic — so the six KPIs, the daily curve, the phase tiles,
   the lift table and both medium tables are all views of the same numbers. See
   src/data/connectAi.ts for where each one comes from and for what is designed rather
   than measured.

   REUSES the .ind-* header, filter and card styles from the Summary Dashboard READ-ONLY,
   because the chrome is identical and two copies would drift. Everything new to this
   report is .ica-*. Per the one-screen-one-change rule in CLAUDE.md, no .ind-* rule may be
   edited for this page — if a shared rule ever needs to differ here, add an .ica-* override
   rather than touching .ind-*. */

const PHASE_COLORS = ["#f0757a", "#f5cf4b", "#5bc98a"];
const TS_COLORS = ["#2ee0ca", "#f3cb00", "#2666f9", "#2cbf58", "#7b61ff", "#f5575a", "#8892a0"];

/* Money the way the real tiles read it: $979.09K, and M once past a million so an
   enterprise prospect does not get "$1,845.90K". */
const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(2)}K`;

/* ONE UNIT FOR A WHOLE GROUP of money tiles, chosen from the largest in the group.
   `money()` per tile switches at a million each on its own, so continuing-life's three phase
   tiles came out "$718.08K / $1.12M / $2.00M" — three numbers meant to be compared at a
   glance, in two different units. Comparing them then needs mental arithmetic, which is the
   opposite of what a row of three tiles is for. Applied to the phase revenues and to the
   three revenue KPIs; standalone tiles keep `money()`. */
function moneyGroup(values: number[]) {
  const useM = Math.max(0, ...values) >= 1_000_000;
  return (n: number) =>
    useM ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(2)}K`;
}
const K = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2).replace(/\.?0+$/, "")}K` : String(Math.round(n));
const pct = (f: number) => `${Math.round(f * 100)}%`;
const pct2 = (f: number) => `${(f * 100).toFixed(2)}%`;

/* Round axis ticks, shared by both bar charts. Dividing the max into N equal parts gives
   ladders like 0 / 714 / 1429 / 2143, which no real chart prints; picking the STEP off a
   nice-number ladder first and letting the ceiling fall out of it gives 0 / 1000 / 2000.
   Same fix as the Summary Dashboard's bar chart, kept local so that one is untouched. */
function niceTicks(max: number, want: number) {
  const target = Math.max(1, max / want);
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(Math.round(t));
  return { top, ticks };
}

const LABELS = {
  title: "Connect AI",
  filterLabel: "Call Start Time",
  scheduled: "<BOOK>s: Scheduled",
  totalRevenue: "Total Revenue",
  voiceRevenue: "AI Voice Agent Revenue",
  messagingRevenue: "AI Messaging Agent Revenue",
  containment: "AI Agent Containment Rate",
  fte: "FTE Hours Saved",
  incremental: "Incremental Revenue from Agentic Rollout",
  curveTitle: "<BOOK> Conversion Rate by Phase: Non Agentic, Voice Agent, Voice & Messaging Agent",
  yAxis: "<BOOK> Conversion Rate",
  xAxis: "Daily Call Start Time",
  reasons: "AI Agent Not Completed Reason",
  savedByPhase: "Cancellations Saved by Rollout Phase",
  lift: "Answer Rate Lift thru Agentic Rollout",
  byMedium: "Performance By Medium",
  donut: "Interactions by Top Marketing Mediums",
  preTable: "Conversion Rate by Marketing Source | Pre Agentic",
  fullTable: "Conversion Rate by Marketing Source | Full Agentic",
  intents: "Consumer Intents during Agentic Interactions",
  byEntry: "By Entry Point",
  byAgent: "By Agent Type",
  saved: "Cancellations Saved",
  revenueRetained: "Revenue Retained",
  mInteraction: "Total Interaction",
  mAnswered: "Total Answered",
  mAnswerRate: "Answer Rate",
  mNewAppt: "Total New <BOOK>",
  mScheduleRate: "New <BOOK> Schedule Rate",
  mVoice: "Total Answered By AI Voice Agent",
  mMessaging: "Total Answered by AI Messaging Agent",
  mHighIntent: "Total High Intent Lead",
  mApptRate: "New <BOOK> Rate",
  mMedium: "Marketing Medium",
};

/* <BOOK> -> this prospect's booking term, so a clinic reads "Appointment Conversion Rate"
   and a blinds company reads "Consultation Conversion Rate". Done in one place so the
   chart title, the y-axis and both tables cannot drift apart. */
function buildLabels(booking: string) {
  const out = { ...LABELS };
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    out[k] = out[k].replace(/<BOOK>/g, booking);
  }
  return out;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <section className="ind-card ica-kpi">
      <span className="ica-kpi-label">{label}</span>
      {sub && <span className="ica-kpi-sub">{sub}</span>}
      <span className="ica-kpi-value">{value}</span>
    </section>
  );
}

/* The daily conversion-rate curve, filled per phase. Three polygons that share their
   boundary days rather than three separate series, so the bands butt together with no gap
   the way the capture's do.

   HOVER highlights the PHASE the pointed-at day belongs to and fades the other two almost
   out, which is what the reference's two hover shots show: point at Apr 07 and the red band
   stays saturated while yellow and green wash out. The point labels fade with their band,
   the hovered day gets a marker, and the panel names the rate, the full date and the phase
   with its own colour dot. */
function PhaseCurve({ points, dates, yTitle, xTitle, legend, onPick }: {
  points: { value: number; phase: number }[];
  dates: { short: string; full: string }[];
  yTitle: string; xTitle: string; legend: { label: string; color: string }[];
  onPick: (i: number) => void;
}) {
  const W = 1400, H = 470, padL = 74, padR = 230, padT = 26, padB = 62;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const TOP = 1.2;
  const n = points.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => padT + (1 - v / TOP) * plotH;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2];
  const base = padT + plotH;

  const [hot, setHot] = useState<number | null>(null);
  const hotPhase = hot === null ? null : points[hot]!.phase;

  /* Nearest day to the pointer, from the fraction across the PLOT (not the whole svg — the
     legend gutter is 230 units of it, and including that would skew every reading right). */
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const f = ((e.clientX - r.left) / r.width * W - padL) / plotW;
    setHot(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };

  /* Each band spans its own days PLUS the first day of the next one, so the fills meet. */
  const bands = [0, 1, 2].map((p) => {
    const idx = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.phase === p).map((pt) => pt.i);
    if (!idx.length) return null;
    const last = idx[idx.length - 1]!;
    const span = last + 1 < n ? [...idx, last + 1] : idx;
    const line = span.map((i) => `${x(i).toFixed(1)},${y(points[i]!.value).toFixed(1)}`);
    return { p, span, d: `M${x(span[0]!).toFixed(1)},${base} L${line.join(" L")} L${x(last + 1 < n ? last + 1 : last).toFixed(1)},${base} Z` };
  }).filter(Boolean) as { p: number; span: number[]; d: string }[];

  const hv = hot === null ? null : points[hot]!.value;
  const flip = hot !== null && x(hot) > padL + plotW / 2;

  return (
    <div className="ica-chartwrap" onMouseMove={onMove} onMouseLeave={() => setHot(null)}
      onClick={() => { if (hot !== null) onPick(hot); }}>
      <svg className="ica-curve" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={yTitle}>
        {ticks.map((t) => (
          <text key={t} className="ica-tick" x={padL - 14} y={y(t) + 4} textAnchor="end">{t}</text>
        ))}
        {bands.map((b) => {
          const dim = hotPhase !== null && hotPhase !== b.p;
          return (
            <g key={b.p} opacity={dim ? 0.14 : 1}>
              <path d={b.d} fill={PHASE_COLORS[b.p]} opacity={0.85} />
              <polyline fill="none" stroke={PHASE_COLORS[b.p]} strokeWidth={2}
                points={b.span.map((i) => `${x(i)},${y(points[i]!.value)}`).join(" ")} />
            </g>
          );
        })}
        {/* Value on every point, as the capture has it, fading with its own band. */}
        {points.map((pt, i) => (
          <text key={i} className="ica-pointlabel" x={x(i)} y={y(pt.value) - 9} textAnchor="middle"
            opacity={hotPhase !== null && hotPhase !== pt.phase ? 0.3 : 1}>
            {pt.value}
          </text>
        ))}
        {hot !== null && (
          <circle className="ica-curvedot" cx={x(hot)} cy={y(hv!)} r="7"
            fill={PHASE_COLORS[points[hot]!.phase]} />
        )}
        <line className="ica-axis" x1={padL} y1={base} x2={padL + plotW} y2={base} />
        {/* Every other day, which is how the real axis thins 30 labels. */}
        {dates.map((d, i) => (i % 2 === 0 ? (
          <text key={i} className="ica-tick" x={x(i)} y={base + 20} textAnchor="middle">{d.short}</text>
        ) : null))}
        <text className="ica-axtitle" transform={`translate(24 ${padT + plotH / 2}) rotate(-90)`}
          textAnchor="middle">{yTitle}</text>
        <text className="ica-axtitle" x={padL + plotW / 2} y={H - 16} textAnchor="middle">
          {xTitle} (for 2026)
        </text>
        {legend.map((l, i) => (
          <g key={l.label} transform={`translate(${padL + plotW + 40} ${padT + 16 + i * 24})`}>
            <circle cx="6" cy="-4" r="6" fill={l.color} />
            <text className="ica-legend" x="20" y="0">{l.label}</text>
          </g>
        ))}
      </svg>

      {hot !== null && (
        <div className="ind-tip" style={{
          left: `${(x(hot) / W) * 100}%`, top: `${(y(hv!) / H) * 100}%`,
          transform: `translate(${flip ? "calc(-100% - 16px)" : "16px"}, -50%)`,
        }}>
          <div className="ind-tip-k">{yTitle}:</div>
          <div className="ind-tip-v">{hv}</div>
          <div className="ind-tip-k ind-tip-gap">{xTitle}:</div>
          <div className="ind-tip-v">{dates[hot]?.full}</div>
          <div className="ind-tip-k ind-tip-gap">Rollout Phase:</div>
          <div className="ind-tip-v ica-tip-phase">
            <span className="ica-tip-dot" style={{ background: PHASE_COLORS[points[hot]!.phase] }} />
            {legend.find((l) => l.color === PHASE_COLORS[points[hot]!.phase])?.label}
          </div>
        </div>
      )}
    </div>
  );
}

/* Horizontal bars with the value at the bar's end and a labelled x-axis, matching both bar
   tiles on this report (Not Completed Reason and Cancellations Saved).

   BARS NEARLY TOUCH. The reference's bars are thick with only a hairline between them, so
   the gap is a fixed 4 units rather than a share of the row — at rowH 46 minus 14 the bars
   sat in the middle of their rows with as much air as bar. */
const BAR_GAP = 4;

function HBars({ rows, color, xTitle, yTitle, onPick }: {
  rows: { name: string; value: number }[]; color: string; xTitle: string; yTitle: string;
  onPick: (row: { name: string; value: number }) => void;
}) {
  const W = 1100, rowH = 46, padL = 210, padR = 60, padT = 12, padB = 56;
  const H = padT + rows.length * rowH + padB;
  const plotW = W - padL - padR;
  const { top, ticks } = niceTicks(Math.max(1, ...rows.map((r) => r.value)), 8);
  const [hot, setHot] = useState<number | null>(null);

  return (
    <div className="ica-chartwrap">
      <svg className="ica-hbars" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={xTitle}>
        {rows.map((r, i) => {
          const yTop = padT + i * rowH + BAR_GAP / 2;
          const w = Math.max(2, (r.value / top) * plotW);
          const dim = hot !== null && hot !== i;
          return (
            <g key={r.name} opacity={dim ? 0.22 : 1}>
              <text className="ica-tick ica-hbar-name" x={padL - 12} y={yTop + (rowH - BAR_GAP) / 2 + 4}
                textAnchor="end">{r.name}</text>
              <rect x={padL} y={yTop} width={w} height={rowH - BAR_GAP} fill={color}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}
                onClick={() => onPick(r)} style={{ cursor: "pointer" }} />
              <text className="ica-barvalue" x={padL + w + 8} y={yTop + (rowH - BAR_GAP) / 2 + 4}>
                {r.value.toLocaleString("en-US")}
              </text>
            </g>
          );
        })}
        <line className="ica-axis" x1={padL} y1={padT + rows.length * rowH} x2={W - padR} y2={padT + rows.length * rowH} />
        {ticks.map((t) => (
          <text key={t} className="ica-tick" x={padL + (t / top) * plotW} y={padT + rows.length * rowH + 20}
            textAnchor="middle">{t.toLocaleString("en-US")}</text>
        ))}
        <text className="ica-axtitle" x={padL + plotW / 2} y={H - 12} textAnchor="middle">{xTitle}</text>
        <text className="ica-axtitle" transform={`translate(18 ${padT + (rows.length * rowH) / 2}) rotate(-90)`}
          textAnchor="middle">{yTitle}</text>
      </svg>

      {hot !== null && (() => {
        const r = rows[hot]!;
        const w = Math.max(2, (r.value / top) * plotW);
        const cx = padL + w;
        const cy = padT + hot * rowH + rowH / 2;
        const flip = cx > padL + plotW / 2;
        return (
          <div className="ind-tip" style={{
            left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%`,
            transform: `translate(${flip ? "calc(-100% - 18px)" : "44px"}, -50%)`,
          }}>
            <div className="ind-tip-k">{yTitle}:</div>
            <div className="ind-tip-v">{r.name}</div>
            <div className="ind-tip-k ind-tip-gap">{xTitle}:</div>
            <div className="ind-tip-v">{r.value.toLocaleString("en-US")}</div>
          </div>
        );
      })()}
    </div>
  );
}

/* Grouped horizontal bars, two series per intent (voice vs messaging).

   The two bars in a group TOUCH and the gap sits between groups, which is how the reference
   reads — a group is one intent, so its bars belong together. Hover fades by SERIES, the
   same behaviour as the Summary Dashboard's bar chart: point at a teal bar and every teal
   bar stays saturated, isolating one metric across all six intents. */
function GroupedHBars({ rows, series, yTitle, onPick }: {
  rows: { name: string; values: number[] }[];
  series: { label: string; color: string }[]; yTitle: string;
  onPick: (row: { name: string; values: number[] }, si: number) => void;
}) {
  const W = 1100, rowH = 62, padL = 190, padR = 300, padT = 34, padB = 46;
  const H = padT + rows.length * rowH + padB;
  const plotW = W - padL - padR;
  const { top, ticks } = niceTicks(Math.max(1, ...rows.flatMap((r) => r.values)), 7);
  const groupH = rowH - BAR_GAP * 2;
  const barH = groupH / series.length;
  const [hot, setHot] = useState<{ i: number; si: number } | null>(null);

  return (
    <div className="ica-chartwrap">
      <svg className="ica-hbars" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={yTitle}>
        {ticks.map((t) => (
          <text key={t} className="ica-tick" x={padL + (t / top) * plotW} y={padT - 12}
            textAnchor="middle">{t.toLocaleString("en-US")}</text>
        ))}
        {rows.map((r, i) => (
          <g key={r.name}>
            <text className="ica-tick ica-hbar-name" x={padL - 12} y={padT + i * rowH + rowH / 2}
              textAnchor="end">{r.name}</text>
            {r.values.map((v, si) => {
              const w = Math.max(2, (v / top) * plotW);
              const yTop = padT + i * rowH + BAR_GAP + si * barH;
              const dim = hot !== null && hot.si !== si;
              return (
                <g key={si} opacity={dim ? 0.22 : 1}>
                  <rect x={padL} y={yTop} width={w} height={barH} fill={series[si]!.color}
                    onMouseEnter={() => setHot({ i, si })} onMouseLeave={() => setHot(null)}
                    onClick={() => onPick(r, si)} style={{ cursor: "pointer" }} />
                  <text className="ica-barvalue" x={padL + w + 6} y={yTop + barH / 2 + 3}>
                    {v.toLocaleString("en-US")}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        <line className="ica-axis" x1={padL} y1={padT + rows.length * rowH} x2={W - padR} y2={padT + rows.length * rowH} />
        <text className="ica-axtitle" transform={`translate(18 ${padT + (rows.length * rowH) / 2}) rotate(-90)`}
          textAnchor="middle">{yTitle}</text>
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(${padL + plotW + 34} ${padT + 6 + i * 24})`}
            opacity={hot !== null && hot.si !== i ? 0.35 : 1}>
            <circle cx="6" cy="-4" r="6" fill={s.color} />
            <text className="ica-legend" x="20" y="0">
              {s.label.length > 34 ? s.label.slice(0, 33) + "…" : s.label}
            </text>
          </g>
        ))}
      </svg>

      {hot !== null && (() => {
        const v = rows[hot.i]!.values[hot.si]!;
        const w = Math.max(2, (v / top) * plotW);
        const cx = padL + w;
        const cy = padT + hot.i * rowH + BAR_GAP + hot.si * barH + barH / 2;
        const flip = cx > padL + plotW / 2;
        return (
          <div className="ind-tip" style={{
            left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%`,
            transform: `translate(${flip ? "calc(-100% - 18px)" : "48px"}, -50%)`,
          }}>
            <div className="ind-tip-k">{series[hot.si]!.label}:</div>
            <div className="ind-tip-v">{v.toLocaleString("en-US")}</div>
            <div className="ind-tip-k ind-tip-gap">{yTitle}:</div>
            <div className="ind-tip-v">{rows[hot.i]!.name}</div>
          </div>
        );
      })()}
    </div>
  );
}

/* The intent x entry-point heatmap. Cell colour is the value's share of the largest cell,
   over the same teal ramp the capture uses, with a scale bar underneath. */
function Heatmap({ rows, cols, rowTitle, colTitle, scaleTitle, onPick }: {
  rows: { name: string; values: number[] }[]; cols: string[];
  rowTitle: string; colTitle: string; scaleTitle: string;
  onPick: (rowName: string, colName: string, value: number) => void;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const min = Math.min(...rows.flatMap((r) => r.values));
  const shade = (v: number) => {
    const f = (v - min) / Math.max(1, max - min);
    /* Pale teal to saturated teal. Dark text stays readable across the whole ramp, which is
       why the capture never switches to white type. */
    return `rgb(${Math.round(178 - f * 128)}, ${Math.round(240 - f * 30)}, ${Math.round(238 - f * 30)})`;
  };
  const [hot, setHot] = useState<{ r: number; c: number } | null>(null);

  return (
    <div className="ica-heat">
      {/* NO GAP between cells — the reference's grid is continuous, and 2px of white between
          every cell broke the ramp into tiles you read individually instead of a field you
          read as a whole. Hover LIGHTENS the cell rather than dimming its neighbours: on a
          colour ramp, fading the rest would change the very thing the ramp encodes. */}
      <div className="ica-heat-grid" style={{ gridTemplateColumns: `140px repeat(${cols.length}, 1fr)` }}>
        <span className="ica-heat-corner">{rowTitle}</span>
        {cols.map((c) => <span key={c} className="ica-heat-col">{c}</span>)}
        {rows.map((r, ri) => (
          <div className="ica-heat-row" key={r.name} style={{ display: "contents" }}>
            <span className="ica-heat-rowname">{r.name}</span>
            {r.values.map((v, ci) => {
              const isHot = hot?.r === ri && hot?.c === ci;
              return (
                <span key={ci} className={`ica-heat-cell${isHot ? " ica-heat-cell-hot" : ""}`}
                  style={{ background: shade(v) }}
                  onMouseEnter={() => setHot({ r: ri, c: ci })}
                  onMouseLeave={() => setHot(null)}
                  onClick={() => onPick(r.name, cols[ci]!, v)}>
                  {v.toLocaleString("en-US")}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {hot && (
        <div className="ind-tip ica-heat-tip">
          <div className="ind-tip-k">Call Intent:</div>
          <div className="ind-tip-v">{rows[hot.r]!.name}</div>
          <div className="ind-tip-k ind-tip-gap">{colTitle}:</div>
          <div className="ind-tip-v">{cols[hot.c]}</div>
          <div className="ind-tip-k ind-tip-gap">{scaleTitle}:</div>
          <div className="ind-tip-v">{rows[hot.r]!.values[hot.c]!.toLocaleString("en-US")}</div>
        </div>
      )}

      <div className="ica-heat-scale">
        <span className="ica-heat-scale-t">{scaleTitle}</span>
        <span className="ica-heat-ramp" />
        <span className="ica-heat-scale-n">{min.toLocaleString("en-US")}</span>
        <span className="ica-heat-scale-n">{max.toLocaleString("en-US")}</span>
      </div>
      <p className="ind-showing">{colTitle}</p>
    </div>
  );
}

function MediumTable({ title, rows, L }: { title: string; rows: MediumRow[]; L: typeof LABELS }) {
  return (
    <div className="ica-half">
      <h3 className="ind-sub">{title}</h3>
      <div className="ind-tablewrap">
        <table className="ind-table">
          <thead>
            <tr>
              <th>{L.mMedium}</th><th>{L.mInteraction}</th><th>{L.mVoice}</th>
              <th>{L.mMessaging}</th><th>{L.mHighIntent}</th><th>{L.mApptRate}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.interactions.toLocaleString("en-US")}</td>
                <td>{r.voiceAgent}</td><td>{r.messagingAgent}</td>
                <td>{r.highIntent}</td><td>{pct(r.appointmentRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ind-showing">Showing {rows.length} of {rows.length} rows</p>
    </div>
  );
}

export function InsightsConnectAi() {
  const { profile } = useProfile();
  /* Registers this page as the AI scope and returns its labels with any edits made ON THIS
     PAGE overlaid, so the assistant can rename any heading here without touching the
     Summary Dashboard. */
  const view = usePageDataWithLabels(
    profile.reports.marketingDashboard, buildLabels(profile.bookingTerm || "Appointment"));
  const L = view.labels;
  const f = connectAiFacts(profile);

  const filterRange = (() => {
    const [a, b] = String(f.dateRange ?? "").split("-");
    const pad = (d: string) => d.trim().split("/").map((x, i) => (i < 2 ? x.padStart(2, "0") : x)).join("/");
    return a && b ? `${pad(a)} <= ${pad(b)}` : String(f.dateRange ?? "");
  })();

  const legend = [
    { label: f.phases[2]!.label, color: PHASE_COLORS[2]! },
    { label: f.phases[0]!.label, color: PHASE_COLORS[0]! },
    { label: f.phases[1]!.label, color: PHASE_COLORS[1]! },
  ];

  /* THE INTERACTION DRAWER, on every chart on this report — the standing rule for Insights &
     Analytics screens (see CLAUDE.md). One piece of state: whatever was clicked writes the
     tile name, the metric, the count and the date, and the rows are derived from that. The
     charts stay presentational and report WHAT was clicked, knowing nothing about drawers.

     `pinFirst`/`topCallHref` are deliberately NOT set here: the one openable call belongs to
     the Summary Dashboard's first bar, because the demo has a single transcript. */
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null);
  const rangeStart = isoDate(String(f.dateRange ?? "").split("-")[0]?.trim() ?? "");
  const items = useMemo(
    () => (drawer ? buildInteractions(profile, drawer) : []),
    [profile, drawer],
  );
  const open = (title: string, metric: string, count: number, date = rangeStart) =>
    setDrawer({ title, metric, count, date });

  /* Shared units within each group of money tiles — see moneyGroup. */
  const kpiMoney = moneyGroup([f.revenue, f.voiceRevenue, f.messagingRevenue]);
  const phaseMoney = moneyGroup(f.phases.map((p) => p.revenue));

  return (
    <div className="ind-page ica-page">
      <div className="ind-head">
        <div>
          <Link to="/insights" className="ind-crumb">INSIGHTS &amp; ANALYTICS</Link>
          <h1 className="ind-title">{L.title}</h1>
        </div>
        <div className="ind-actions">
          <button className="ind-ask"><span className="material-icons">auto_awesome</span>Ask</button>
          <button className="ind-add"><span className="material-icons">add</span>Add Tile</button>
          <span className="material-icons ind-kebab">more_vert</span>
        </div>
      </div>

      <div className="ind-filters">
        <span className="ind-chip">{L.filterLabel} <b>Between ({filterRange})</b></span>
      </div>

      {/* six KPIs across the top */}
      <div className="ica-kpis">
        <Kpi label={L.scheduled} value={K(f.appointments)} />
        <Kpi label={L.totalRevenue} value={kpiMoney(f.revenue)} />
        <Kpi label={L.voiceRevenue} value={kpiMoney(f.voiceRevenue)} />
        <Kpi label={L.messagingRevenue} value={kpiMoney(f.messagingRevenue)} />
        <Kpi label={L.containment} value={pct2(f.containment)} sub="Full Rollout" />
        <Kpi label={L.fte} value={f.fteHours.toFixed(2)} />
      </div>

      <section className="ind-card">
        <h2 className="ind-card-title">{L.incremental}</h2>
        <h3 className="ind-sub">{L.curveTitle}</h3>
        <PhaseCurve points={f.dailyPoints} dates={f.dailyDates}
          yTitle={L.yAxis} xTitle={L.xAxis} legend={legend}
          onPick={(i) => {
            const p = f.phases[f.dailyPoints[i]!.phase]!;
            /* The count is that day's share of its phase, so the drawer's header matches the
               day that was clicked rather than the whole phase. */
            open(L.incremental, `${p.label} · ${f.dailyDates[i]?.full ?? ""}`,
              Math.max(1, Math.round(p.interactions / 10)),
              isoDate(f.dailyDates[i]?.full ?? rangeStart));
          }} />
        <p className="ind-showing">Showing {f.dailyPoints.length} of {f.dailyPoints.length} data points</p>

        {/* Phase revenue, then phase schedule rate — the two rows of three under the curve. */}
        <div className="ica-phase-row">
          {f.phases.map((p) => (
            <div className="ica-phase" key={`rev-${p.key}`}>
              <span className="ica-phase-label">{L.totalRevenue} | {p.tileLabel}</span>
              <span className="ica-phase-sub">{p.phase}</span>
              <span className="ica-phase-value">{phaseMoney(p.revenue)}</span>
            </div>
          ))}
        </div>
        <div className="ica-phase-row">
          {f.phases.map((p) => (
            <div className="ica-phase" key={`rate-${p.key}`}>
              <span className="ica-phase-label">Schedule Rate | {p.tileLabel}</span>
              <span className="ica-phase-sub">{p.phase}</span>
              <span className="ica-phase-value">{pct(p.scheduleRate)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ind-card">
        <h2 className="ind-card-title">{L.reasons}</h2>
        <HBars rows={f.reasons} color="#2666f9" xTitle={L.mInteraction} yTitle="Not Completed Reason"
          onPick={(r) => open(L.reasons, r.name, r.value)} />
        <p className="ind-showing">Showing {f.reasons.length} of {f.reasons.length} data points</p>
      </section>

      <div className="ind-grid">
        <section className="ind-card">
          <h2 className="ind-card-title">{L.savedByPhase}</h2>
          <HBars color="#f5793b" xTitle={L.saved} yTitle="Rollout Phase"
            rows={[...f.phases].reverse().map((p) => ({ name: p.label, value: p.cancellationsSaved }))}
            onPick={(r) => open(L.savedByPhase, r.name, r.value)} />
          <p className="ind-showing">Showing 3 of 3 data points</p>
        </section>

        <section className="ind-card">
          <h2 className="ind-card-title">{L.lift}</h2>
          <div className="ind-tablewrap">
            <table className="ind-table">
              <thead>
                <tr>
                  <th>Rollout Phase</th><th>{L.mInteraction}</th><th>{L.mAnswered}</th>
                  <th>{L.mAnswerRate}</th><th>{L.mNewAppt}</th><th>{L.mScheduleRate}</th>
                </tr>
              </thead>
              <tbody>
                {[...f.phases].reverse().map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td>{K(p.interactions)}</td><td>{K(p.answered)}</td>
                    <td>{pct(p.answerRate)}</td><td>{p.appointments}</td><td>{pct(p.scheduleRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ind-showing">Showing 3 of 3 rows</p>
        </section>
      </div>

      <section className="ind-card">
        <h2 className="ind-card-title">{L.byMedium}</h2>
        <div className="ica-split">
          <div className="ica-half">
            <h3 className="ind-sub">{L.donut}</h3>
            <DonutChart segments={f.topMediums} total={f.topMediums.reduce((s, m) => s + m.value, 0)}
              colors={TS_COLORS} geom={TS_GEOM} slicePct={false}
              hover={{ metricLabel: L.mInteraction, dimensionLabel: L.mMedium, format: K }}
              onSlice={(seg) => open(L.donut, `${L.mInteraction} · ${seg.label}`, seg.value)} />
            <p className="ind-showing">Showing {f.topMediums.length} of {f.topMediums.length} data points</p>
          </div>
          <div className="ica-stack">
            <MediumTable title={L.preTable} rows={f.preRows} L={L} />
            <MediumTable title={L.fullTable} rows={f.fullRows} L={L} />
          </div>
        </div>
      </section>

      <section className="ind-card">
        <h2 className="ind-card-title">{L.intents}</h2>
        <div className="ica-split ica-split-even">
          <div className="ica-half">
            <h3 className="ind-sub">{L.byEntry}</h3>
            <Heatmap cols={ENTRY_POINTS} rowTitle="Intent" colTitle="Interaction Type"
              scaleTitle="Total Agentic Interactions"
              rows={f.intents.map((i) => ({ name: i.name, values: i.byEntry }))}
              onPick={(intent, entry, v) => open(L.byEntry, `${intent} · ${entry}`, v)} />
          </div>
          <div className="ica-half">
            <h3 className="ind-sub">{L.byAgent}</h3>
            <GroupedHBars yTitle="Intents"
              series={[{ label: L.mVoice, color: "#2ee0ca" }, { label: L.mMessaging, color: "#2666f9" }]}
              rows={f.intents.map((i) => ({ name: i.name, values: [i.voiceAgent, i.messagingAgent] }))}
              onPick={(r, si) => open(L.byAgent,
                `${si === 0 ? L.mVoice : L.mMessaging} · ${r.name}`, r.values[si]!)} />
            <p className="ind-showing">Showing {f.intents.length} of {f.intents.length} data points</p>
          </div>
        </div>
      </section>

      <section className="ind-card ica-saved">
        <h2 className="ind-card-title">{L.saved}</h2>
        <span className="ica-kpi-label">{L.revenueRetained}</span>
        <span className="ica-kpi-value">{money(f.revenueRetained)}</span>
        <span className="ica-kpi-sub">
          {f.savedTotal.toLocaleString("en-US")} cancellations saved
        </span>
      </section>

      {drawer && (
        <InteractionsDrawer req={drawer} items={items} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
