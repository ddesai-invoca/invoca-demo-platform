import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { usePageData } from "../components/GeneratedTiles";
import {
  buildVerifyCalls, labelDescription, seedTally, accuracy, verifiedPercent, convStartIndex,
  type Tally, type VerifyCall,
} from "../data/verifyCalls";

/* =============================================================================
   VerifyLabels — what "Verify Labels" on a Signal AI Studio row opens.
   -----------------------------------------------------------------------------
   Real page: /networks/2160/label_groups/manage/verify_calls/532
              ?round=5&folderId=...&reviewMode=false&callId=...

   The point of the screen, for a prospect: here is how Invoca's AI decided this
   call carried the signal, and here is you agreeing or disagreeing. Transcript on
   the left, the label under verification on the right, five calls rotating.

   Values MEASURED off the saved live page (8/17/2026), not read off a screenshot.
   Two of them the screenshot actively misleads about:

     • The accuracy readout is NOT a percentage bar. It is a track carrying a
       darker 80-100% target band, a HATCHED confidence interval
       (repeating-linear-gradient 135deg over rgba(38,102,249,.3), 1px #2666f9
       border), a 1px point-estimate tick, and a chip labelling the interval.
       Measured: interval 89.7% -> 97.6%, chip "90%-98%", tick 93.5%.
     • "Save & Next Call" is an OUTLINED white button (bg #fff, border
       1px rgba(38,102,249,.5), ink #2666f9), not the filled primary it appears to
       be. "Review Last Call" and "Train AI Model" are the disabled greys.

     page bg      #f6f7f9        h1  24px/400 #15243e
     eyebrow      <a> 12px/700 #2666f9, text-transform UPPERCASE (DOM text is mixed case)
     card         white, 2px solid #e7e9eb, radius 3, w468, pad 24
     "Signal Activated" chip   bg #abe5bc, ink #0d5400, radius 16, 12px/400
     T:/F: + description       16px/400 #66708e
     segmented True/False/Not Sure   3 joined outlined buttons ~138x36, RADIUS 0,
                                     ink #2666f9, selected bg #d4e0fe, icon 20px
     transcript turn rules     2px wide, radius 5:  agent #855ede, caller #e4126f
     Verified Calls bar        165x18, track #e7e9eb r3, fill #2666f9 (live: 47.5%)

   "Predicted by AI" is a bracket over WHICHEVER button the AI chose, not a fixed
   label: the wrapper is position:relative on that one cell.
   ============================================================================= */

type Verdict = "true" | "false" | "unsure";

/* One committed verification, kept so "Review Last Call" can step back and
   UN-APPLY it. Without the delta, stepping back and saving again would count the
   same call twice and quietly inflate the accuracy an SE is standing in front of. */
interface Saved { idx: number; verdict: Verdict; countsToward: boolean; agreed: boolean }

export function VerifyLabels() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { modelId } = useParams();
  const [params] = useSearchParams();

  /* The label, model name and round arrive in the query the way the real page
     carries round/folderId/callId, so a refresh or a pasted link still resolves,
     and an Ask AI edit to the row's label on the previous screen carries through.
     Falls back to deriving from bookingTerm rather than rendering an empty page. */
  const label = params.get("label")
    || `${(profile.bookingTerm || "appointment").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_set`;
  const modelName = params.get("name") || "this AI Model";
  const round = Number(params.get("round") || 2) || 2;

  /* A MODEL BELONGS TO ONE ACCOUNT, so switching the network selector while this
     page is open invalidates it: the label, the model name and its hashed
     "Created on" date all came from the previous prospect. Left alone, the page
     showed `consultation_set` over National Van Lines' calls, which is a claim the
     demo must never make. Bouncing back to the model list is both correct and what
     the real product does when you change account. */
  const forProfile = params.get("p");
  useEffect(() => {
    if (forProfile && forProfile !== profile.id) navigate("/signal/ai-studio", { replace: true });
  }, [forProfile, profile.id, navigate]);

  const calls = useMemo(() => buildVerifyCalls(profile), [profile]);

  const base = useMemo(() => ({
    title: "Verify Labels",
    label,
    description: labelDescription(label, profile.bookingTerm),
  }), [label, profile.bookingTerm]);
  /* Only the label and its description are exposed to Ask AI. The transcripts are
     deliberately out of scope: they are the evidence on screen, and an edit that
     rewrote them could contradict the AI prediction shown beside them. */
  const data = usePageData(base);

  const [idx, setIdx] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /* Seeded per PROFILE and per MODEL: two models on the same prospect are separate
     rounds of work, so they must not share one tally. `modelId` is the path param,
     the same role the live URL's /verify_calls/532 plays. */
  const seedKey = `${profile.id}:${modelId ?? "m"}`;
  const [tally, setTally] = useState<Tally>(() => seedTally(seedKey, round));
  const [history, setHistory] = useState<Saved[]>([]);
  const [query, setQuery] = useState("");

  /* A new prospect means a new seeded tally; without this the previous
     prospect's counts would follow you across a demo switch. */
  useEffect(() => {
    setTally(seedTally(seedKey, round));
    setIdx(0); setVerdict(null); setHistory([]); setQuery("");
  }, [seedKey, round]);

  const call: VerifyCall | undefined = calls[idx];
  const acc = accuracy(tally);
  const pct = verifiedPercent(tally);

  const scroller = useRef<HTMLDivElement | null>(null);
  /* Back to the top of the transcript on every call change, and clear the search:
     landing half way down the previous call's text reads as the page not having
     advanced. */
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; setQuery(""); }, [idx]);

  function save() {
    if (!verdict || !call) return;
    const countsToward = verdict !== "unsure";
    const agreed = countsToward && (verdict === "true") === call.predicted;
    /* "Not Sure" advances but scores nothing. You cannot measure agreement
       against an answer the reviewer declined to give, and counting it either way
       would move the accuracy on no evidence. */
    if (countsToward) {
      setTally((t) => ({
        total: t.total + 1,
        agree: t.agree + (agreed ? 1 : 0),
        t: t.t + (verdict === "true" ? 1 : 0),
        f: t.f + (verdict === "false" ? 1 : 0),
      }));
    }
    setHistory((h) => [...h, { idx, verdict, countsToward, agreed }]);
    setIdx((i) => (i + 1) % calls.length);   // five calls, then rotate
    setVerdict(null);
  }

  function reviewLast() {
    const last = history[history.length - 1];
    if (!last) return;
    if (last.countsToward) {
      setTally((t) => ({
        total: t.total - 1,
        agree: t.agree - (last.agreed ? 1 : 0),
        t: t.t - (last.verdict === "true" ? 1 : 0),
        f: t.f - (last.verdict === "false" ? 1 : 0),
      }));
    }
    setHistory((h) => h.slice(0, -1));
    setIdx(last.idx);
    setVerdict(last.verdict);
  }

  const turns = call?.turns ?? [];
  const q = query.trim().toLowerCase();
  const shownTurns = q ? turns.filter((t) => t.text.toLowerCase().includes(q)) : turns;
  /* -1 when this call has no meaningful marker, and suppressed entirely while
     searching, where a "conversation starts here" line among filtered lines would
     be pointing at nothing. */
  const markerAt = q ? -1 : convStartIndex(turns, call?.convStart ?? "");

  const SEG: { key: Verdict; label: string; icon: string }[] = [
    { key: "true",   label: "True",     icon: "check" },
    { key: "false",  label: "False",    icon: "close" },
    { key: "unsure", label: "Not Sure", icon: "help_outline" },
  ];
  /* The bracket sits over the AI's own prediction, which is why the label moves
     between True and False from call to call instead of being decoration. */
  const predictedKey: Verdict = call?.predicted ? "true" : "false";

  return (
    <div className="vl-page">
      <div className="vl-head">
        <div>
          <Link className="vl-eyebrow" to="/signal/ai-studio">Signal AI Studio</Link>
          <h1 className="vl-h1">Verify Labels for {modelName}</h1>
          <div className="vl-sub">
            <span className="vl-round">Round {round}</span>
            <span className="vl-about">
              <span className="material-icons">info</span>
              <a href="#about" onClick={(e) => e.preventDefault()}>
                About Label Accuracy &amp; Signal Creation
              </a>
            </span>
          </div>
        </div>
        <div className="vl-head-right">
          <span className="vl-verified-label">Verified Calls</span>
          <span className="vl-verified">
            <span className="vl-verified-fill" style={{ width: `${pct}%` }} />
          </span>
          {/* Disabled, exactly as the live page has it. The tooltip is here so an
              SE who gets asked what it does has the answer on screen. */}
          <button className="vl-train" type="button" disabled
            title={`Available once this round has enough verified calls. Training rebuilds the model from every verification in Round ${round}.`}>
            Train AI Model
          </button>
        </div>
      </div>

      <div className="vl-body">
        <section className="vl-transcript">
          <div className="vl-panel-head">
            <span className="vl-panel-title">TRANSCRIPT</span>
            {/* Goes to the real Call Detail screen we already have, so the link
                lands somewhere true instead of being inert chrome. */}
            <button className="vl-vcd" type="button"
              onClick={() => navigate("/call-review/detail")}>
              <span className="material-icons">open_in_new</span>View Call Details
            </button>
          </div>

          <div className="vl-search">
            <span className="material-icons">search</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the Call" />
          </div>

          <div className="vl-turns" ref={scroller}>
            {shownTurns.map((t, i) => {
              const marker = i === markerAt;
              return (
                <div key={`${idx}-${i}`}>
                  {marker && (
                    <div className="vl-convstart">
                      <span className="material-icons">record_voice_over</span>
                      Estimated Conversation Start - {call!.convStart}
                      <span className="material-icons vl-i">info</span>
                    </div>
                  )}
                  <div className={"vl-turn vl-turn--" + t.speaker}>
                    <div className="vl-who">
                      <span className="vl-speaker">{t.speaker === "agent" ? "Agent" : "Caller"}</span>
                      <span className="vl-time">{t.time}</span>
                    </div>
                    <span className="vl-rule" />
                    <p className="vl-text">{t.text}</p>
                  </div>
                </div>
              );
            })}
            {q && shownTurns.length === 0 && (
              <p className="vl-noturns">Nothing in this call matches “{query}”.</p>
            )}
            {q && shownTurns.length > 0 && (
              <p className="vl-noturns">
                {shownTurns.length} of {turns.length} lines match “{query}”.
              </p>
            )}
          </div>
        </section>

        <aside className="vl-side">
          <span className="vl-panel-title">
            ACTIVE LABELS (1)
            <span className="material-icons vl-i">info</span>
          </span>

          <div className="vl-card">
            <div className="vl-card-top">
              <span className="vl-label">{data.label ?? label}</span>
              <button className="vl-kebab" aria-label="More actions">
                <span className="material-icons">more_vert</span>
              </button>
            </div>

            <span className="vl-activated">Signal Activated</span>

            <p className="vl-tf">T: {tally.t}&nbsp;&nbsp;&nbsp;F: {tally.f}</p>
            <p className="vl-desc">{data.description ?? base.description}</p>

            <div className="vl-seg">
              {SEG.map((s) => (
                <span key={s.key}
                  className={"vl-seg-cell" + (s.key === predictedKey ? " vl-seg-cell--pred" : "")}>
                  {s.key === predictedKey && (
                    <span className="vl-pred">
                      <span className="vl-pred-label">Predicted by AI</span>
                      <span className="vl-pred-bracket" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                    </span>
                  )}
                  <button type="button"
                    className={"vl-seg-btn" + (verdict === s.key ? " vl-seg-btn--on" : "")}
                    aria-pressed={verdict === s.key}
                    onClick={() => setVerdict(s.key)}>
                    <span className="material-icons">{s.icon}</span>{s.label}
                  </button>
                </span>
              ))}
            </div>

            <p className="vl-desc vl-desc-tight">This Label is now activated as a Signal
              <span className="material-icons vl-i">info</span>
            </p>

            {/* THE ACCURACY BAR. Four layers, all measured: track, the darker
                80-100% target band, the hatched confidence interval, and the
                point-estimate tick. The interval narrows as calls are verified,
                which is the story the screen is here to tell. */}
            <div className="vl-acc">
              <div className="vl-acc-track">
                <span className="vl-acc-band" />
                <span className="vl-acc-range"
                  style={{ left: `${acc.lo}%`, width: `${Math.max(acc.hi - acc.lo, 1)}%` }} />
              </div>
              <span className="vl-acc-tick" style={{ left: `${acc.point}%` }} />
              <span className="vl-acc-chip" style={{ left: `${acc.lo}%` }}>
                {Math.round(acc.lo)}%-{Math.round(acc.hi)}%
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className="vl-player">
        <span className="vl-rate">1x <span className="material-icons">arrow_drop_down</span></span>
        <span className="vl-pbar"><span className="vl-pdot" /></span>
        <span className="vl-pcontrols">
          <span className="material-icons">replay_10</span>
          <span className="material-icons vl-play">play_circle_filled</span>
          <span className="material-icons">forward_10</span>
          <span className="material-icons">volume_up</span>
        </span>
        <span className="vl-ptime">00:00 / {call?.duration ?? "00:00"}</span>
      </div>

      <div className="vl-foot">
        <button className="vl-exit" onClick={() => navigate("/signal/ai-studio")}>Exit</button>
        <span className="vl-foot-right">
          <button className="vl-review" type="button" disabled={history.length === 0}
            onClick={reviewLast}
            title={history.length ? "Step back to the call you just saved" : "Nothing saved yet in this round"}>
            Review Last Call
          </button>
          {/* Nothing to save until a verdict is picked, which is also how the live
              page behaves: it was screenshotted with True already selected. */}
          <button className="vl-save" type="button" disabled={!verdict} onClick={save}>
            Save &amp; Next Call
          </button>
        </span>
      </div>
    </div>
  );
}
