import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { Pill } from "../components/Pill";
import type { CITranscriptTurn } from "../data/schema";

/* Bold + underline the signal-keyword phrases inside a transcript turn. */
function Highlighted({ turn }: { turn: CITranscriptTurn }) {
  if (!turn.highlights.length) return <>{turn.text}</>;
  const esc = turn.highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "g");
  const parts = turn.text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        turn.highlights.includes(p) ? <strong className="ci-hl" key={i}>{p}</strong> : <span key={i}>{p}</span>
      )}
    </>
  );
}

/* Call-scoring ring (partial blue arc around the score %). */
function ScoreRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r, filled = (value / 100) * c;
  return (
    <svg className="ci-ring" viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r={r} fill="none" stroke="#e7ebf0" strokeWidth="8" />
      <circle
        cx="40" cy="40" r={r} fill="none" stroke="#2666f9" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`} transform="rotate(-90 40 40)"
      />
      <text x="40" y="46" textAnchor="middle" className="ci-ring-text">{value}%</text>
    </svg>
  );
}

const TABS = [
  { label: "Analysis", icon: "bar_chart" },
  { label: "Call Info", icon: "call" },
  { label: "Comments", icon: "chat_bubble_outline" },
  { label: "AI Summary", icon: "verified" },
  { label: "Deliveries", icon: "work_outline" },
];

export function ConversationIntelligence() {
  const { profile } = useProfile();
  const d = profile.reports.conversationIntelligence;
  const [tab, setTab] = useState("Analysis");
  if (!d) {
    return (
      <div className="report-surface">
        <div className="placeholder"><h2>No conversation data</h2>
          <p className="muted">This report isn't set up for {profile.customerName} yet.</p></div>
      </div>
    );
  }

  return (
    <div className="ci-page">
      <div className="breadcrumb">
        <Link to="/reports">My Reports</Link>
        <span className="sep">&rsaquo;</span>
        <span className="current">Interactions</span>
      </div>

      <div className="ci-header">
        <div className="ci-header-left">
          <h1 className="title ci-title">{d.title}</h1>
          <div className="toolbar ci-toolbar">
            <div className="view-toggle">
              <div className="view-btn active"><span className="material-icons">grid_on</span></div>
              <div className="view-btn"><span className="material-icons">view_agenda</span></div>
            </div>
            <Pill>{`Custom:  ${d.dateRange}`}</Pill>
            <button className="add-btn"><span className="material-icons">add</span></button>
          </div>
        </div>
        <div className="ci-header-actions">
          <a className="ci-req" href="#">Requested Reports</a>
          <span className="material-icons">share</span>
          <span className="material-icons">get_app</span>
          <span className="material-icons">schedule</span>
          <button className="save-btn">Save</button>
        </div>
      </div>

      <div className="ci-body">
        {/* LEFT — call list */}
        <aside className="ci-calls">
          <div className="ci-calls-head">
            <span className="ci-calls-count">{d.callCount}</span>
            <span className="ci-calls-sort">Call Start Time <span className="material-icons">arrow_upward</span></span>
          </div>
          <div className="ci-calls-list">
            {d.calls.map((c, i) => (
              <button key={c.id} className={"ci-call" + (i === 0 ? " active" : "")}>
                <div className="ci-call-time">{c.time}</div>
                <div className="ci-call-id">{c.id}</div>
              </button>
            ))}
          </div>
          <div className="ci-calls-foot">
            <span className="ci-pagerlabel">{d.pagerLabel}</span>
            <span className="ci-pager">
              <button className="ci-page-arrow"><span className="material-icons">chevron_left</span></button>
              <button className="ci-page-arrow"><span className="material-icons">chevron_right</span></button>
            </span>
          </div>
        </aside>

        {/* CENTER — player + transcript */}
        <section className="ci-center">
          <div className="ci-player">
            <span className="material-icons ci-play">play_circle_outline</span>
            <span className="ci-speed">1x <span className="material-icons">arrow_drop_down</span></span>
            <span className="ci-time">0:00</span>
            <div className="ci-scrub"><span className="ci-scrub-knob" /></div>
            <span className="ci-time">{d.duration}</span>
            <span className="material-icons ci-fwd">arrow_forward</span>
          </div>

          <div className="ci-addcomment"><span className="material-icons">chat_bubble_outline</span> Add comment at 0:00</div>

          <div className="ci-legend">
            <span className="ci-legend-item"><span className="material-icons ci-ic-caller">person</span> Caller</span>
            <span className="ci-legend-item"><span className="material-icons ci-ic-agent">headset_mic</span> Agent</span>
          </div>

          <div className="ci-search">
            <span className="material-icons ci-search-ic">search</span>
            <input placeholder="Search" />
            <span className="ci-search-count">0/0</span>
            <button className="ci-search-nav"><span className="material-icons">chevron_left</span></button>
            <button className="ci-search-nav"><span className="material-icons">chevron_right</span></button>
          </div>
          <a className="ci-adv" href="#">Advanced search options</a>

          <div className="ci-transcript">
            {d.transcript.map((turn, i) => (
              <div className="ci-turn" key={i}>
                <div className="ci-turn-side">
                  <span className={"material-icons ci-turn-ic " + (turn.speaker === "agent" ? "ci-ic-agent" : "ci-ic-caller")}>
                    {turn.speaker === "agent" ? "headset_mic" : "person"}
                  </span>
                  <span className="ci-turn-time">{turn.time}</span>
                </div>
                <div className="ci-turn-text"><Highlighted turn={turn} /></div>
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT — analysis rail */}
        <aside className="ci-analysis">
          <div className="ci-tabs">
            {TABS.map((t) => (
              <button key={t.label} className={"ci-tab" + (t.label === tab ? " active" : "")} onClick={() => setTab(t.label)}>
                <span className="material-icons">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {tab === "Analysis" && (
            <div className="ci-analysis-body">
              <div className="ci-section-head">
                <span className="ci-section-title">Signals</span>
                <span className="material-icons ci-edit">edit</span>
              </div>
              <div className="ci-sig-search"><span className="material-icons">search</span><input placeholder="" /></div>
              <div className="ci-sig-sub">MET SIGNALS</div>
              {d.signals.map((s) => (
                <div className="ci-signal" key={s.name}>
                  <span className="material-icons ci-sig-check">check_circle</span>
                  <span className="ci-sig-name">{s.name}</span>
                  {s.badges.map((b) => <span className="ci-badge" key={b}>{b}</span>)}
                  {s.count > 0 && <span className="ci-sig-count">{s.count}</span>}
                  {s.count > 0 && <span className="material-icons ci-sig-caret">expand_more</span>}
                </div>
              ))}

              <div className="ci-section-head ci-scoring-head">
                <span className="ci-section-title">Call Scoring</span>
                <span className="material-icons ci-edit">edit</span>
              </div>
              <div className="ci-score">
                <ScoreRing value={d.scoreValue} />
                <span className="ci-score-label">{d.scoreLabel}</span>
              </div>
            </div>
          )}

          {tab === "AI Summary" && (
            d.aiSummary ? (
              <div className="ci-analysis-body ci-summary">
                <div className="ci-section-head">
                  <span className="ci-section-title">AI Summary</span>
                  <span className="ci-ai-tag"><span className="material-icons">auto_awesome</span> AI generated</span>
                </div>
                <div className="ci-sum-meta">
                  <span className={"ci-sentiment ci-sent-" + d.aiSummary.sentiment.toLowerCase()}>{d.aiSummary.sentiment}</span>
                  <span className="ci-outcome"><span className="material-icons">event_available</span>{d.aiSummary.outcome}</span>
                </div>
                <p className="ci-sum-text">{d.aiSummary.summary}</p>
                <div className="ci-sig-sub">KEY POINTS</div>
                <ul className="ci-keypoints">
                  {d.aiSummary.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              </div>
            ) : (
              <div className="ci-analysis-body ci-empty-tab">
                <span className="material-icons">verified</span>
                <p>AI summary isn't available for this call.<br />Regenerate this prospect to include it.</p>
              </div>
            )
          )}

          {tab === "Call Info" && (
            <div className="ci-analysis-body ci-info">
              <div className="ci-section-head"><span className="ci-section-title">Call Info</span></div>
              <dl className="ci-info-list">
                <div><dt>Call ID</dt><dd>{d.calls[0]?.id ?? "—"}</dd></div>
                <div><dt>Start Time</dt><dd>{d.calls[0]?.time ?? "—"}</dd></div>
                <div><dt>Duration</dt><dd>{d.duration}</dd></div>
                <div><dt>Direction</dt><dd>Inbound</dd></div>
                <div><dt>Answered By</dt><dd>Agent</dd></div>
              </dl>
            </div>
          )}

          {tab === "Comments" && (
            <div className="ci-analysis-body ci-empty-tab">
              <span className="material-icons">chat_bubble_outline</span>
              <p>No comments on this call yet.</p>
            </div>
          )}

          {tab === "Deliveries" && (
            <div className="ci-analysis-body ci-empty-tab">
              <span className="material-icons">work_outline</span>
              <p>No deliveries for this call.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
