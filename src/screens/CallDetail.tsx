import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import type { CallDetailScorecardRow } from "../data/schema";

/* Call Detail — opened from the 4th (evaluated) call in Call Review. 3-column
   layout matched to Invoca's real Call Detail (call-review-flow): left rail
   (review status / evaluation / Scorecard + Signals [both expandable] / Prompts),
   center transcript, right AI summary + comment, plus a bottom audio bar.
   Data-driven from reports.callDetail, re-skinned per prospect. */

function StatusIcon({ status }: { status: CallDetailScorecardRow["status"] }) {
  if (status === "met") return <span className="material-icons cd-ic-met">check_circle</span>;
  if (status === "unmet") return <span className="material-icons cd-ic-unmet">cancel</span>;
  return <span className="material-icons cd-ic-na">block</span>;
}

export function CallDetail() {
  const { profile } = useProfile();
  const d = profile.reports.callDetail;

  const [reviewed, setReviewed] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);
  const [group, setGroup] = useState<null | "met" | "unmet" | "na">(null);
  const [prompt, setPrompt] = useState<number | null>(null);

  if (!d) {
    return (
      <div className="cd-page">
        <div className="placeholder"><h2>No call detail</h2>
          <p className="muted">This call isn't set up for {profile.customerName} yet.</p></div>
      </div>
    );
  }

  const groupList = group === "met" ? d.metSignals : group === "unmet" ? d.unmetSignals : group === "na" ? d.naSignals : [];

  return (
    <div className="cd-page">
      {/* Header */}
      <div className="cd-head">
        <h1 className="cd-title">Call Detail</h1>
        <div className="cd-head-actions">
          <span className="material-icons cd-link-ic">link</span>
          <button className="cd-hbtn"><span className="material-icons">download</span>Download Audio</button>
          <button className="cd-hbtn cd-hbtn-outline"><span className="material-icons">info</span>Call Info</button>
        </div>
      </div>

      <div className="cd-body">
        {/* LEFT rail */}
        <aside className="cd-left">
          <div className="cd-sec-label">REVIEW STATUS</div>
          <label className="cd-reviewed">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            <span>Reviewed</span>
          </label>

          <div className="cd-sec-label">EVALUATION</div>
          <div className="cd-select"><span>Select Evaluation Form</span><span className="material-icons">expand_more</span></div>

          <div className="cd-sec-label">SCORECARDS</div>
          <section className="cd-scorecard">
            <button className="cd-scorecard-head" onClick={() => setScoreOpen((v) => !v)}>
              <span className="material-icons cd-sc-ic">assignment_turned_in</span>
              <span className="cd-sc-pct">{d.scorecardPercent}%</span>
              <span className="cd-sc-meta"><span className="cd-sc-name">{d.scorecardName}</span><span className="cd-sc-points">{d.scorecardPoints}</span></span>
              <span className="material-icons cd-caret">{scoreOpen ? "expand_less" : "expand_more"}</span>
            </button>
            {scoreOpen && (
              <div className="cd-sc-rows">
                <div className="cd-sc-rowhead"><span className="material-icons cd-sc-ic-sm">explore</span><span>Signal Name</span><span className="cd-sc-pts-col">Points</span></div>
                {d.scorecardRows.map((r, i) => (
                  <div className="cd-sc-row" key={i}>
                    <StatusIcon status={r.status} />
                    <span className="cd-sc-signame" title={r.name}>{r.name}</span>
                    <span className="cd-sc-pts">{r.points}</span>
                    <span className="material-icons cd-caret-sm">expand_more</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="cd-sec-label">SIGNALS</div>
          <section className="cd-signals">
            <button className="cd-signals-head" onClick={() => setSignalsOpen((v) => !v)}>
              <span className="cd-sig-all">All Signals</span>
              <span className="cd-sig-counts">
                <span className="cd-sig-count cd-ic-met"><span className="material-icons">check</span>{d.signalsMet}</span>
                <span className="cd-sig-count cd-ic-unmet"><span className="material-icons">close</span>{d.signalsUnmet}</span>
                <span className="cd-sig-count cd-ic-na"><span className="material-icons">block</span>{d.signalsNa}</span>
              </span>
              <span className="material-icons cd-caret">{signalsOpen ? "expand_less" : "expand_more"}</span>
            </button>
            {signalsOpen && (
              <div className="cd-sig-body">
                <div className="cd-sig-search"><span className="material-icons">search</span><input placeholder="Search Signals" /></div>
                {([["met", "Met Signals", d.signalsMet], ["unmet", "Unmet Signals", d.signalsUnmet], ["na", "Not Applicable Signals", d.signalsNa]] as const).map(([key, label, count]) => (
                  <div key={key}>
                    <button className={"cd-sig-group cd-sig-" + key + (group === key ? " active" : "")} onClick={() => setGroup((g) => (g === key ? null : key))}>
                      <span className={"material-icons cd-ic-" + key}>{key === "met" ? "check" : key === "unmet" ? "close" : "block"}</span>
                      <span className="cd-sig-glabel">{label}</span>
                      <span className="cd-sig-gcount">{count}</span>
                      <span className="material-icons cd-caret-sm">{group === key ? "expand_less" : "expand_more"}</span>
                    </button>
                    {group === key && (
                      <div className="cd-sig-list">
                        {groupList.map((s) => <div className="cd-sig-item" key={s}><span className={"material-icons cd-ic-" + key}>{key === "met" ? "check" : key === "unmet" ? "close" : "block"}</span>{s}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="cd-sec-label">PROMPTS</div>
          <div className="cd-prompts">
            {d.prompts.map((p, i) => (
              <div className="cd-prompt" key={i}>
                <button className="cd-prompt-head" onClick={() => setPrompt((v) => (v === i ? null : i))}>
                  <span>{p.question}</span>
                  <span className="material-icons cd-caret-sm">{prompt === i ? "expand_less" : "expand_more"}</span>
                </button>
                {prompt === i && <div className="cd-prompt-body">{p.answer}</div>}
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER transcript */}
        <section className="cd-center">
          <div className="cd-sec-label cd-transcript-label">TRANSCRIPT</div>
          <div className="cd-transcript-card">
            <div className="cd-tr-search"><span className="material-icons">search</span><input placeholder="Search the Call" /></div>
            <div className="cd-tr-turns">
              {d.transcript.map((t, i) => (
                <div key={i}>
                  <div className="cd-turn">
                    <div className="cd-turn-side">
                      <span className={"cd-turn-who " + (t.speaker === "agent" ? "cd-agent" : "cd-caller")}>{t.speaker === "agent" ? "Agent" : "Caller"}</span>
                      <span className="cd-turn-time">{t.time}</span>
                    </div>
                    <div className={"cd-turn-text " + (t.speaker === "agent" ? "cd-t-agent" : "cd-t-caller")}>{t.text}</div>
                  </div>
                  {t.time === "00:14" && (
                    <div className="cd-conv-start"><span className="material-icons">emoji_objects</span>Estimated Conversation Start - {d.convStart}<span className="material-icons cd-cs-info">info</span></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT rail */}
        <aside className="cd-right">
          <div className="cd-sec-label">AI SUMMARY</div>
          <p className="cd-ai-summary">{d.aiSummary}</p>
          <div className="cd-ai-meta">
            <div className="cd-ai-metarow"><span className="material-icons">person</span>{d.agent}</div>
            <div className="cd-ai-metarow"><span className="material-icons">calendar_today</span>{d.date}</div>
            <div className="cd-ai-metarow"><span className="material-icons">schedule</span>{d.duration}</div>
          </div>

          <div className="cd-comments-head">
            <span className="cd-sec-label">COMMENTS ({d.comment ? 1 : 0})</span>
            <button className="cd-comment-btn"><span className="material-icons">add_comment</span>Call Comment</button>
          </div>
          {d.comment && (
            <div className="cd-comment">
              <div className="cd-comment-top">
                <span className="cd-comment-author">{d.comment.author}</span>
                <span className="cd-comment-aud"><span className="material-icons">groups</span>{d.comment.audience}</span>
                <span className="material-icons cd-comment-more">more_vert</span>
              </div>
              <div className="cd-comment-date">{d.comment.date}</div>
              <p className="cd-comment-text">{d.comment.text}</p>
            </div>
          )}
        </aside>
      </div>

      {/* Audio bar */}
      <div className="cd-audio">
        <div className="cd-scrubber"><span className="cd-scrub-knob" /></div>
        <div className="cd-audio-controls">
          <Link to="/call-review" className="cd-back"><span className="material-icons">arrow_back</span>Back To Search Results</Link>
          <div className="cd-audio-center">
            <span className="cd-audio-speed">1x <span className="material-icons">expand_more</span></span>
            <span className="material-icons cd-audio-btn">replay_10</span>
            <span className="material-icons cd-audio-play">play_circle</span>
            <span className="material-icons cd-audio-btn">forward_10</span>
            <span className="material-icons cd-audio-btn">volume_up</span>
          </div>
          <span className="cd-audio-time">00:00 / {playerTotal(d.duration)}</span>
        </div>
      </div>
    </div>
  );
}

/* Rough mm:ss for the player from a "4m 12s"-style duration. */
function playerTotal(dur: string): string {
  const m = dur.match(/(\d+)\s*m\s*(\d+)/);
  if (m) return `${m[1]}:${m[2].padStart(2, "0")}`;
  return "02:22";
}
