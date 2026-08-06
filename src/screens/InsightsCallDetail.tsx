import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { usePageData } from "../components/GeneratedTiles";
import type { CallDetailTurn } from "../data/schema";

/* Insights & Analytics -> a single call, reached by clicking the top card in the
   interaction drawer. Matched to the capture "Insights & Analytics - Showing Call｜
   Invoca for Forrester (8_6_2026 11:56:39 AM)" and its two screenshots: a left column
   with the player, a phrase-search box and the transcript, and a right column of Info
   panels — AI Summary, Sentiment, Signals, Call Scoring, then six metadata cards.

   THIS IS NOT THE CALL REVIEW DETAIL SCREEN. `/call-review/detail` is a different
   Invoca page from a different capture, and it stays exactly as it is; this one has its
   own route and its own .icd-* namespace. Two screens, on purpose.

   EVERYTHING IS DERIVED from reports.callDetail (id, agent, date, duration, summary,
   transcript, scorecard rows, signal lists) plus digitalInsights.rows[0] for the
   marketing attribution and voiceScreenpop for the caller. No schema slice and no engine
   phase, so every prospect already on disk has this screen and its numbers agree with
   Call Review and the Digital Journey report rather than being a third set.

   ONLY ONE CALL IS REACHABLE, by design — see DrawerRequest.topCallHref. */

/* ---- time helpers. The profile stores "2m 26s"; the page needs 00:02:26 (About This
   Call), 2:26 (the player) and "2 min 26 sec" (Contact Center Metrics). ---- */
function toSeconds(d: string): number {
  const m = /(\d+)\s*m/.exec(d), s = /(\d+)\s*s/.exec(d);
  return (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
}
const hms = (t: number) =>
  `00:${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
const mss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
const minSec = (t: number) => `${Math.floor(t / 60)} min ${t % 60} sec`;

/* SENTIMENT is read off the transcript rather than invented: count the turns carrying
   genuinely positive language and the turns carrying trouble language, and score from the
   balance. The capture reads "Neutral (55) / 2 positive moments / 3 negative moments" for
   a resolved billing call, and real calls cluster near neutral.

   ⚠️ TWO THINGS WERE WRONG on the first pass, both of which read as generated:

   1. Bare "thank you" / "thanks" counted as a positive MOMENT. Every polite call opens
      and closes with thanks, so a clean booking scored 8 positive moments — and call
      etiquette is already what the "Helpful Agent" and "Proper Greeting" scorecard signals
      measure. Only real enthusiasm counts here.
   2. The score was `52 + (pos - neg) * 3` clamped at 74, and it hit the CLAMP: the tile
      read "Positive (74)", the ceiling exactly. A score sitting on its own bound is a
      giveaway.

   ⚠️ AND IT HAPPENED AGAIN with the ratio version. `50 + round(ratio * 35)` clamped to
   [30, 72] read exactly 72 for continuing-life, whose transcript is a delighted tour booking
   with 12 warm turns out of 19 and no cold ones. The counts were right; the CLAMP was the
   problem — any hard min/max is a value the data can land on. tanh saturates toward the same
   bounds without ever reaching them (that transcript now reads 67), and is linear for the
   small ratios most calls produce. If a score ever needs bounding again, bound it with a
   curve, not a clamp. */
const WARM = /\b(great|perfect|wonderful|excellent|appreciate|happy|glad|fantastic|love)\b/i;
const COLD = /\b(sorry|unfortunately|problem|issue|confus|frustrat|wrong|delay|unable|cannot|can't)\b/i;

function sentiment(turns: CallDetailTurn[]) {
  const positive = turns.filter((t) => WARM.test(t.text)).length;
  const negative = turns.filter((t) => COLD.test(t.text)).length;
  const n = Math.max(1, turns.length);
  const score = Math.round(50 + 22 * Math.tanh(((positive - negative) / n) * 1.6));
  const label = score > 60 ? "Positive" : score < 40 ? "Negative" : "Neutral";
  return { positive, negative, score, label };
}

/* FOUND PHRASES for a met signal. The real panel expands a keyword-spotting signal into
   the phrases that fired it, with the speaker and the timestamp — so they are looked up
   in the transcript instead of being made up. A signal whose words appear nowhere renders
   as a plain "Rule" signal, which the capture also has ("Inbound Call", "Neutral
   Sentiment"): those are rules, not spotted keywords. */
function foundPhrases(signal: string, turns: CallDetailTurn[]) {
  const words = (signal.replace(/\(.*?\)/g, "").toLowerCase().match(/[a-z']{5,}/g) ?? []).slice(0, 3);
  const hits: { phrase: string; speaker: string; time: string }[] = [];
  for (const w of words) {
    for (const t of turns) {
      const low = t.text.toLowerCase();
      const at = low.indexOf(w);
      if (at < 0) continue;
      /* Quote the matched word plus what follows it, so the panel shows a phrase the way
         the real one does ("got a bill") rather than a bare stem. */
      const phrase = low.slice(at).split(/[.,?!]/)[0].split(/\s+/).slice(0, 3).join(" ");
      hits.push({ phrase, speaker: t.speaker === "agent" ? "Agent" : "Caller", time: t.time });
      break;
    }
  }
  return hits;
}

/* Deterministic per prospect so an SE revisiting sees the same values. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return Math.abs(h);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="icd-field">
      <span className="icd-f-label">{label}</span>
      <span className="icd-f-value">{value}</span>
    </div>
  );
}

function Panel({ title, children, edit, className = "" }: {
  title: string; children: React.ReactNode; edit?: boolean; className?: string;
}) {
  return (
    <section className={`icd-panel ${className}`}>
      <div className="icd-panel-head">
        <h2 className="icd-panel-title">{title}</h2>
        {edit && <span className="material-icons icd-panel-edit">edit</span>}
      </div>
      {children}
    </section>
  );
}

/* One expandable signal group (Met / Not Met / Didn't Apply). */
/* ⚠️ The badge counts the names it is about to LIST, not callDetail.signalsUnmet /
   signalsNa. Every engine-generated profile writes 26 and 25 for those two while the name
   lists hold 5-15 entries, so the declared count contradicts the panel that expands right
   underneath it — "Not Met 26" over ten rows is a thing a prospect can count. (The two
   numbers are also identical across all ten profiles, which is its own tell.) Shady
   Blinds, hand-authored, is the only profile where they agree.
   The root cause is in the engine and is filed separately; using the list length keeps
   this panel honest either way. */
function SignalGroup({ icon, cls, label, names, turns, phrases }: {
  icon: string; cls: string; label: string; names: string[];
  turns: CallDetailTurn[]; phrases: boolean;
}) {
  const count = names.length;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="icd-sg">
      <button className="icd-sg-head" type="button" onClick={() => setOpen(!open)}>
        <span className={`material-icons ${cls}`}>{icon}</span>
        <span className="icd-sg-label">{label}</span>
        <span className="icd-sg-count">{count}</span>
        <span className="material-icons icd-sg-chev">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && (
        <div className="icd-sg-body">
          {names.map((n) => {
            const hits = phrases ? foundPhrases(n, turns) : [];
            const isOpen = expanded === n;
            return (
              <div className="icd-sig" key={n}>
                <button className="icd-sig-head" type="button"
                  onClick={() => setExpanded(isOpen ? null : n)}>
                  <span className="icd-sig-name">{n}</span>
                  <span className="icd-sig-badges">
                    {hits.length > 0 && <span className="icd-badge">Keyword Spotting</span>}
                    <span className="icd-badge">Rule</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="icd-sig-body">
                    <div className="icd-sig-type">
                      Signal Type: {hits.length > 0 ? "Keyword Spotting, Rule" : "Rule"}
                    </div>
                    {hits.length > 0 ? (
                      <table className="icd-phrases">
                        <thead>
                          <tr><th>Found Phrases</th><th>Speaker</th><th>Time</th></tr>
                        </thead>
                        <tbody>
                          {hits.map((h, i) => (
                            <tr key={i}>
                              <td>&ldquo;{h.phrase}&rdquo;</td><td>{h.speaker}</td><td>{h.time}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="icd-nophrase">No spoken phrases found</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* A scorecard row in Call Scoring: a percent ring (or N/A) plus its rows. */
function Scorecard({ name, percent, rows, open, onToggle }: {
  name: string; percent: number | null;
  rows: { name: string; points: string }[]; open: boolean; onToggle: () => void;
}) {
  const R = 18, C = 2 * Math.PI * R;
  return (
    <div className="icd-sc">
      <button className="icd-sc-head" type="button" onClick={onToggle}>
        <svg className="icd-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={R} className="icd-ring-bg" />
          {percent !== null && (
            <circle cx="22" cy="22" r={R} className="icd-ring-fg"
              strokeDasharray={`${(percent / 100) * C} ${C}`} transform="rotate(-90 22 22)" />
          )}
          <text x="22" y="26" textAnchor="middle" className="icd-ring-t">
            {percent === null ? "N/A" : `${percent}%`}
          </text>
        </svg>
        <span className="icd-sc-name">
          {name}
          <span className="icd-badge icd-badge-combo">Combination</span>
        </span>
        <span className="material-icons icd-sg-chev">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && (
        <div className="icd-sc-body">
          {rows.map((r) => (
            <div className="icd-sc-row" key={r.name}>
              <span className="icd-sc-rname">{r.name}</span>
              <span className="icd-badge">Keyword Spotting</span>
              <span className="icd-badge">Rule</span>
              <span className="icd-sc-pts">{r.points}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = ["Info", "Coaching", "Comments", "Deliveries"] as const;
const TAB_ICONS: Record<string, string> = {
  Info: "info", Coaching: "school", Comments: "chat_bubble", Deliveries: "work",
};

export function InsightsCallDetail() {
  const { profile } = useProfile();
  const [params] = useSearchParams();
  /* Registers this page as the AI scope and returns the slice with any edits made ON
     THIS PAGE overlaid (see usePageData). */
  const d = usePageData(profile.reports.callDetail);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Info");
  const [openCard, setOpenCard] = useState<string | null>(null);

  if (!d) {
    return (
      <div className="icd-page">
        <p className="icd-empty">This prospect has no call detail record.</p>
      </div>
    );
  }

  /* The tile and the interaction count come from the drawer that opened this page, so
     the pager reads "1 of 10,632" against the number the viewer just clicked rather than
     an invented total. */
  const dash = params.get("d") || "Summary Dashboard";
  const total = Number(params.get("n") || 0);

  const secs = toSeconds(d.duration);
  const sent = sentiment(d.transcript);
  const row = profile.reports.digitalInsights?.rows?.[0];
  const pop = profile.reports.voiceScreenpop;
  const h = hash(d.callId);

  /* Contact Center Metrics are SPLITS OF THE REAL DURATION, so they add up against the
     call rather than floating free: agent talks a little over half, the caller about a
     third, a few seconds of silence, no overtalk (a clean call). */
  const agentTalk = Math.round(secs * 0.6);
  const callerTalk = Math.round(secs * 0.31);
  const silence = Math.max(1, secs - agentTalk - callerTalk);

  const scorecardRows = d.scorecardRows.map((r) => ({ name: r.name, points: r.points }));
  /* The capture shows ONE scored scorecard and the rest N/A — a call only gets scored by
     the scorecards whose criteria applied to it. Those extra names are Invoca's own
     product vocabulary, so they stay verbatim rather than being re-skinned. */
  const extraCards = ["Outbound Sales", "Retention", "Compliance"];

  return (
    <div className="icd-page">
      <div className="icd-head">
        <Link to={`/insights/dashboard/${encodeURIComponent(dash)}`} className="icd-back">
          <span className="material-icons">arrow_back</span>{dash}
        </Link>
        <div className="icd-head-row">
          <h1 className="icd-title">{dash}</h1>
          <div className="icd-pager">
            <span className="material-icons icd-disabled">chevron_left</span>
            <span>1 of {total ? total.toLocaleString("en-US") : "1"}</span>
            <span className="material-icons">chevron_right</span>
          </div>
        </div>
        <div className="icd-callid">
          <span className="icd-callid-ic material-icons">call</span>
          <b>{d.callId}</b>
        </div>
      </div>

      <div className="icd-body">
        {/* ---------------- left: player + transcript ---------------- */}
        <div className="icd-left">
          {/* VISUAL ONLY. We have no call audio, so nothing here claims to play — the
              same choice the Call Review detail screen already makes. The marker strip
              is the transcript's own turns placed along the timeline, so it lines up
              with the conversation instead of being decorative noise. */}
          <div className="icd-player">
            <span className="material-icons icd-p-ic">replay_10</span>
            <span className="material-icons icd-p-play">play_circle_outline</span>
            <span className="material-icons icd-p-ic">forward_10</span>
            <span className="icd-p-speed">1x <span className="material-icons">arrow_drop_down</span></span>
            <span className="icd-p-time">0:00</span>
            <div className="icd-track">
              <span className="icd-track-start" />
              {d.transcript.map((t, i) => {
                const at = (toSeconds(t.time.replace(":", "m ") + "s") / Math.max(1, secs)) * 100;
                return (
                  <span key={i} className={`icd-mark ${t.speaker === "agent" ? "icd-mark-a" : "icd-mark-c"}`}
                    style={{ left: `${Math.min(99, at)}%` }} />
                );
              })}
            </div>
            <span className="icd-p-time">{mss(secs)}</span>
          </div>

          <div className="icd-addcomment">
            <span className="material-icons">comment</span>Add comment at 0:00
          </div>

          <div className="icd-legend">
            <span><span className="material-icons icd-lg-c">person</span>Caller</span>
            <span><span className="material-icons icd-lg-a">headset_mic</span>Agent</span>
          </div>

          <div className="icd-search">
            <span className="material-icons">search</span>
            <input type="text" placeholder="Search" aria-label="Search transcript" />
            <span className="icd-search-count">0/0</span>
            <span className="material-icons icd-disabled">chevron_left</span>
            <span className="material-icons icd-disabled">chevron_right</span>
          </div>
          <a className="icd-adv" href="#advanced" onClick={(e) => e.preventDefault()}>
            Advanced search options
          </a>

          <div className="icd-transcript">
            {d.transcript.map((t, i) => (
              <div className="icd-turn" key={i}>
                <div className="icd-turn-who">
                  <span className={`material-icons ${t.speaker === "agent" ? "icd-lg-a" : "icd-lg-c"}`}>
                    {t.speaker === "agent" ? "headset_mic" : "person"}
                  </span>
                  <span className="icd-turn-time">{t.time.replace(/^00:/, "0:")}</span>
                </div>
                <p className="icd-turn-text">{t.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ---------------- right: Info panels ---------------- */}
        <div className="icd-right">
          <div className="icd-tabs">
            {TABS.map((t) => (
              <button key={t} type="button"
                className={`icd-tab${tab === t ? " icd-tab-on" : ""}`} onClick={() => setTab(t)}>
                <span className="material-icons">{TAB_ICONS[t]}</span>{t}
              </button>
            ))}
          </div>

          {tab === "Comments" && (
            <Panel title="Comments">
              {d.comment ? (
                <div className="icd-comment">
                  <div className="icd-comment-head">
                    <b>{d.comment.author}</b>
                    <span>{d.comment.audience}</span>
                    <span>{d.comment.date}</span>
                  </div>
                  <p>{d.comment.text}</p>
                </div>
              ) : (
                <p className="icd-empty">No comments on this call yet.</p>
              )}
            </Panel>
          )}

          {/* HONEST EMPTY STATES rather than invented records. Coaching sessions and
              delivery logs exist on no other screen, so there is nothing to keep them
              consistent with — and an account that has not started coaching shows
              exactly this. */}
          {tab === "Coaching" && (
            <Panel title="Coaching">
              <p className="icd-empty">No coaching sessions have been assigned for this call.</p>
            </Panel>
          )}
          {tab === "Deliveries" && (
            <Panel title="Deliveries">
              <p className="icd-empty">No deliveries have been sent for this call.</p>
            </Panel>
          )}

          {tab === "Info" && (
            <>
              <Panel title="AI Summary">
                <p className="icd-summary">{d.aiSummary}</p>
              </Panel>

              <Panel title="Sentiment">
                <div className="icd-sent-score">Score: {sent.label} ({sent.score})</div>
                <div className="icd-sent-moments">
                  <span><span className="material-icons icd-sent-pos">sentiment_satisfied_alt</span>
                    {sent.positive} positive moments</span>
                  <span><span className="material-icons icd-sent-neg">sentiment_very_dissatisfied</span>
                    {sent.negative} negative moments</span>
                </div>
              </Panel>

              <div className="icd-pair">
                <Panel title="Signals" edit>
                  <div className="icd-search icd-search-sm">
                    <span className="material-icons">search</span>
                    <input type="text" aria-label="Search signals" />
                  </div>
                  <SignalGroup icon="check_circle" cls="icd-ic-met" label="Met Signals"
                    names={d.metSignals} turns={d.transcript} phrases />
                  <SignalGroup icon="cancel" cls="icd-ic-unmet" label="Not Met"
                    names={d.unmetSignals} turns={d.transcript} phrases={false} />
                  <SignalGroup icon="remove" cls="icd-ic-na" label="Didn't Apply"
                    names={d.naSignals} turns={d.transcript} phrases={false} />
                </Panel>

                <Panel title="Call Scoring" edit>
                  <Scorecard name={d.scorecardName} percent={d.scorecardPercent}
                    rows={scorecardRows} open={openCard === d.scorecardName}
                    onToggle={() => setOpenCard(openCard === d.scorecardName ? null : d.scorecardName)} />
                  {extraCards.map((n) => (
                    <Scorecard key={n} name={n} percent={null} rows={[]}
                      open={openCard === n}
                      onToggle={() => setOpenCard(openCard === n ? null : n)} />
                  ))}
                </Panel>
              </div>

              <div className="icd-pair">
                <Panel title="About This Call">
                  <div className="icd-fields">
                    <Field label="CALL RECORD ID" value={d.callId} />
                    <Field label="CALL START TIME" value={d.date} />
                    <Field label="TOTAL IVR DURATION" value="00:00:00" />
                    <Field label="TOTAL CONNECTED DURATION" value={hms(secs)} />
                    <Field label="TOTAL DURATION" value={hms(secs)} />
                    <Field label="DESTINATION PHONE NUMBER" value={`909-390-${String(1000 + (h % 8999)).slice(0, 4)}`} />
                    <Field label="CALL SEGMENT PATH" value="Inbound Calls" />
                    <Field label="TRANSACTIONS" value="2" />
                    <Field label="SOURCE" value="External" />
                    {/* convStart is mm:ss ("00:16"); this field is h:mm:ss in the capture
                        ("00:00:00"), so it gets an hours segment rather than a reformat. */}
                    <Field label="ESTIMATED CONVERSATION START" value={`00:${d.convStart}`} />
                  </div>
                </Panel>

                <Panel title="Caller Data">
                  <div className="icd-fields">
                    <Field label="CALLER ID" value={pop?.callerPhone ?? `(${300 + (h % 600)}) 555-${String(1000 + (h % 8999)).slice(0, 4)}`} />
                    <Field label="REPEAT CALLER" value="No" />
                    <Field label="PHONE TYPE" value={h % 3 === 0 ? "Landline" : "Mobile"} />
                  </div>
                </Panel>
              </div>

              <div className="icd-pair">
                <Panel title="Marketing Data">
                  <div className="icd-fields">
                    <Field label="AGENT" value={d.agent} />
                    <Field label="CALLING PAGE" value={pop?.callingWebpage ?? row?.websiteJourney ?? "—"} />
                    <Field label="MARKETING SOURCE" value={row?.marketingSource ?? "Organic"} />
                    <Field label="MARKETING MEDIUM" value={row?.marketingMedium ?? "Organic"} />
                    <Field label="MARKETING CAMPAIGN" value={row?.marketingCampaign ?? "—"} />
                    <Field label="SENTIMENT" value={sent.label} />
                    <Field label="WEBSITE JOURNEY" value={pop?.digitalJourney ?? row?.websiteJourney ?? "—"} />
                    <Field label="FULL LANDING PAGE URL" value={row?.landingPageUrl ?? profile.websiteUrl} />
                    <Field label="GOOGLE ANALYTICS CLIENT ID" value={`${1000000000 + (h % 899999999)}.${2000000000 + (h % 999999)}`} />
                    <Field label="ADOBE ADVERTISING ID" value={`${5000000000 + (h % 999999999)}.${1000000000 + (h % 899999999)}`} />
                  </div>
                </Panel>

                <Panel title="Campaign Data">
                  <div className="icd-fields">
                    <Field label="FINAL CAMPAIGN" value="Default: Inbound Calls" />
                    <Field label="FINAL CAMPAIGN ID" value={String(9000000 + (h % 999999))} />
                  </div>
                </Panel>
              </div>

              <div className="icd-pair">
                <Panel title="Conversion Data">
                  <div className="icd-fields">
                    <Field label="REVENUE (SALE AMOUNT)" value={`$${(40 + (h % 60)).toFixed(2)}`} />
                  </div>
                  <div className="icd-sub">Publisher Payout</div>
                  <div className="icd-fields">
                    <Field label="CALL RESULT" value="Not Paid" />
                    <Field label="EARNED" value="$0.00" />
                    <Field label="PAID" value="$0.00" />
                    <Field label="MARGIN" value="$0.00" />
                    <Field label="FEES" value="$0.00" />
                    <Field label="ADVERTISER FEES" value="$0.00" />
                  </div>
                </Panel>

                <Panel title="Contact Center Metrics">
                  <div className="icd-fields">
                    <Field label="AGENT HANDLE TIME" value={minSec(secs)} />
                    <Field label="SILENCE TIME" value={minSec(silence)} />
                    <Field label="AGENT TALK TIME" value={minSec(agentTalk)} />
                    <Field label="OVERTALK TIME" value="0 min 0 sec" />
                    <Field label="CALLER TALK TIME" value={minSec(callerTalk)} />
                    <Field label="AGENT LONGEST MONOLOG TIME" value={minSec(Math.round(secs * 0.13))} />
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
