import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { Pill } from "../components/Pill";
import type { CITranscriptTurn } from "../data/schema";
import { usePageData, DashAssistant } from "../components/GeneratedTiles";
import { tierView, tierScore, type SignalTier, type TierSignal, type TierView } from "../data/signalTiers";

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
   row is the grey outline the Call Detail rail already uses for its unmet group — and it
   carries the phrases the engine was listening for, because "why didn't it fire" is the
   question the whole comparison exists to answer. */
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
      {(s.missNote || s.hitNote) && (
        <p className={"ci-tier-note" + (s.missNote ? " is-miss" : "")}>{s.missNote ?? s.hitNote}</p>
      )}
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
          <h1 className="title ci-title">
            {d.title}
            {t && <span className={"ci-tier-chip ci-tier-chip--" + t.tier}>{t.label}</span>}
          </h1>
          {t && (
            <p className="ci-tier-blurb">
              {t.blurb}
              {/* The headline number, on the header rather than buried in the rail: this is
                  the sentence an SE says out loud when the two reports sit side by side. */}
              <span className={"ci-tier-fired" + (tierScore(t).met < tierScore(t).total ? " is-short" : "")}>
                {tierScore(t).met} of {tierScore(t).total} signals fired on this call
              </span>
            </p>
          )}
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

              {/* ---- Gold-only panels. Their ABSENCE on Silver is the argument, so Silver
                      renders an explicit "this tier cannot" note rather than nothing at all —
                      a blank space reads as a screen that failed to load. ---- */}
              {t && (
                <>
                  <div className="ci-section-head ci-tier-head">
                    <span className="ci-section-title">Caller Sentiment</span>
                  </div>
                  {t.sentiment ? (
                    <div className="ci-tier-mood">
                      <div className="ci-tier-moodbar">
                        {t.sentiment.slots.map((k, i) => <span className={"ci-mood-" + k} key={i} />)}
                      </div>
                      <div className="ci-tier-moodlab">{t.sentiment.label}</div>
                    </div>
                  ) : (
                    <p className="ci-tier-none">Not available on {t.label}. There is no sentiment model on this tier.</p>
                  )}

                  <div className="ci-section-head ci-tier-head">
                    <span className="ci-section-title">Signal AI Discovery</span>
                  </div>
                  {t.themes ? (
                    <div className="ci-tier-themes">
                      <p className="ci-tier-sub">Themes found across this month's calls that nobody built a signal for.</p>
                      {t.themes.map((th) => (
                        <div className="ci-tier-theme" key={th.label}>
                          <span className="ci-tier-theme-lb">{th.label}</span>
                          <span className="ci-tier-theme-bar"><i style={{ width: `${th.pct}%` }} /></span>
                          <span className="ci-tier-theme-pc">{th.pct}%</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ci-tier-none">Not available on {t.label}. Themes have to be known in advance to be spotted.</p>
                  )}

                  <div className="ci-section-head ci-tier-head">
                    <span className="ci-section-title">What reaches your systems</span>
                  </div>
                  <div className="ci-tier-out">
                    {t.downstream.map((r) => (
                      <div className={"ci-tier-outrow" + (r.tone ? " is-" + r.tone : "")} key={r.system}>
                        <span className="ci-tier-outk">{r.system}</span>
                        <span className="ci-tier-outv">{r.value}</span>
                      </div>
                    ))}
                  </div>
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

          {/* ⚠️ SILVER'S EMPTY AI SUMMARY IS A CAPABILITY STATEMENT, NOT A MISSING FIELD, and it
              must not reuse the "regenerate this prospect" empty state below — that one reads
              as our tool being broken. Silver structurally has no summariser. */}
          {tab === "AI Summary" && t && !t.hasAiSummary && (
            <div className="ci-analysis-body ci-empty-tab ci-tier-locked">
              <span className="material-icons">lock</span>
              <p><strong>Not produced on {t.label}.</strong><br />
                This tier returns a transcript and phrase matches. Summarisation, sentiment and
                theme detection are Gold capabilities.</p>
            </div>
          )}

          {tab === "AI Summary" && !(t && !t.hasAiSummary) && (
            d.aiSummary ? (
              <div className="ci-analysis-body ci-summary">
                <div className="ci-section-head">
                  <span className="ci-section-title">AI Summary</span>
                </div>
                <p className="ci-sum-text">{d.aiSummary.summary}</p>
                {/* Gold shows the structured read as well as the paragraph — the contrast with
                    Silver's locked panel is the argument, so the panel has to be full. */}
                {t && d.aiSummary.keyPoints?.length > 0 && (
                  <>
                    <div className="ci-section-head ci-tier-head">
                      <span className="ci-section-title">Key Points</span>
                    </div>
                    <ul className="ci-tier-points">
                      {d.aiSummary.keyPoints.map((k: string) => <li key={k}>{k}</li>)}
                    </ul>
                    <div className="ci-tier-out">
                      <div className="ci-tier-outrow is-good">
                        <span className="ci-tier-outk">Outcome</span>
                        <span className="ci-tier-outv">{d.aiSummary.outcome}</span>
                      </div>
                      <div className="ci-tier-outrow">
                        <span className="ci-tier-outk">Sentiment</span>
                        <span className="ci-tier-outv">{d.aiSummary.sentiment}</span>
                      </div>
                    </div>
                  </>
                )}
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
      {/* Renders any tile the AI added on this page, and the hidden-tile rules.
          Without it both were silent no-ops here: the tile was stored and never
          drawn, and "remove that tile" reported success and changed nothing. */}
      <DashAssistant />
      </div>
    </div>
  );
}
