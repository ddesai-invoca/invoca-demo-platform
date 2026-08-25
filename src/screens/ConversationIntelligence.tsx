import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { Pill } from "../components/Pill";
import type { CITranscriptTurn } from "../data/schema";
import { usePageData, DashAssistant } from "../components/GeneratedTiles";
import { tierView, type SignalTier, type TierSignal, type TierView } from "../data/signalTiers";

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

/* One signal row on a tiered report. A MET row is the platform's normal green check; an UNMET
   row is the grey outline the Call Detail rail already uses for its unmet group.

   ⚠️ NO EXPLANATORY NOTE UNDER THE ROW — that was V1 and no real Invoca report prints one.
   The commentary lives on the Comments tab, which is a real tab holding real free text. */
function TierRow({ s }: { s: TierSignal }) {
  return (
    <div className={"ci-signal ci-tier-sig" + (s.met ? "" : " is-unmet")}>
      <span className={"material-icons " + (s.met ? "ci-sig-check" : "ci-sig-x")}>
        {s.met ? "check_circle" : "cancel"}
      </span>
      <span className="ci-sig-name">{s.name}</span>
      {s.badges.map((b) => (
        <span className={"ci-badge" + (b === "AI" ? " ci-badge--ai" : "")} key={b}>{b}</span>
      ))}
      {s.count > 0 && <span className="ci-sig-count">{s.count}</span>}
      {s.count > 0 && <span className="material-icons ci-sig-caret">expand_more</span>}
    </div>
  );
}

const metOf = (v: TierView) => v.signals.filter((s) => s.met);
const unmetOf = (v: TierView) => v.signals.filter((s) => !s.met);

const TABS = [
  { label: "Analysis", icon: "bar_chart" },
  { label: "Call Info", icon: "call" },
  { label: "Comments", icon: "chat_bubble_outline" },
  { label: "AI Summary", icon: "verified" },
  { label: "Deliveries", icon: "work_outline" },
];

/* ⚠️ `tier` IS OPT-IN AND DEFAULTS TO UNDEFINED, so the plain Conversation Intelligence report
   renders exactly as it did before this file learned about tiers — the standing rule that a
   change for one screen must not touch another. Everything tier-specific below is inside a
   `t &&` guard, and the Silver/Gold routes are the only callers that pass one. */
export function ConversationIntelligence({ tier }: { tier?: SignalTier } = {}) {
  const { profile } = useProfile();
  /* Registers this page as the AI scope and returns the slice with any
     edits made ON THIS PAGE overlaid (see usePageData). */
  const d = usePageData(profile.reports.conversationIntelligence);
  const [tab, setTab] = useState("Analysis");
  const t = tier ? tierView(profile, tier) : null;

  /* A tier route on a prospect that does not have these reports: refuse rather than render a
     generic pair. The signal names are Health Spring's own. */
  if (tier && !t) {
    return (
      <div className="report-surface">
        <div className="placeholder"><h2>Not available for {profile.customerName}</h2>
          <p className="muted">
            The Signal AI tier comparison was built for a specific account. Open it from{" "}
            <Link to="/reports">My Reports</Link> on that prospect.
          </p></div>
      </div>
    );
  }
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
              {/* ⚠️ TWO RENDER PATHS ON PURPOSE. The untiered report keeps its ORIGINAL markup
                  below, untouched; a tiered report draws its own met/unmet groups. Folding the
                  two together would have meant editing the line the base report renders. */}
              {t ? (
                <>
                  <div className="ci-sig-sub">MET SIGNALS ({metOf(t).length})</div>
                  {metOf(t).map((s) => <TierRow s={s} key={s.name} />)}
                  {unmetOf(t).length > 0 && (
                    <>
                      <div className="ci-sig-sub ci-sig-sub--unmet">UNMET SIGNALS ({unmetOf(t).length})</div>
                      {unmetOf(t).map((s) => <TierRow s={s} key={s.name} />)}
                    </>
                  )}
                </>
              ) : (
                <>
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
                </>
              )}

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
                </div>
                <p className="ci-sum-text">{d.aiSummary.summary}</p>
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

          {/* ⚠️ THE TALK TRACK LIVES HERE, and only on a tiered report. Comments are a real
              feature of this screen (the centre column already says "Add comment at 0:00"), so
              parking the timing and the phrase-list explanations here keeps the rail looking
              exactly like the product while leaving the argument one click away mid-demo.
              The untiered report keeps its original empty state. */}
          {tab === "Comments" && (
            t ? (
              <div className="ci-analysis-body ci-cmt">
                <div className="ci-section-head">
                  <span className="ci-section-title">Comments</span>
                </div>
                {t.comments.map((c) => (
                  <div className={"ci-cmt-row" + (c.miss ? " is-miss" : "")} key={c.signal + c.time}>
                    <span className="ci-cmt-time">{c.time}</span>
                    <div className="ci-cmt-main">
                      <div className="ci-cmt-sig">{c.signal}</div>
                      <p className="ci-cmt-text">{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ci-analysis-body ci-empty-tab">
                <span className="material-icons">chat_bubble_outline</span>
                <p>No comments on this call yet.</p>
              </div>
            )
          )}

          {tab === "Deliveries" && (
            <div className="ci-analysis-body ci-empty-tab">
              <span className="material-icons">work_outline</span>
              <p>No deliveries for this call.</p>
            </div>
          )}
        </aside>
      {/* Renders any tile the AI added on this page, and the hidden-tile rules.
          Without it both were silent no-ops here: the tile was stored and never
          drawn, and "remove that tile" reported success and changed nothing. */}
      <DashAssistant />
      </div>
    </div>
  );
}
