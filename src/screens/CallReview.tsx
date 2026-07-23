import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import type { CallReviewItem } from "../data/schema";

/* Exact stat glyphs captured from the live Call Review card. */
function ScorecardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1m-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9z" />
    </svg>
  );
}
function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2m-2 12H6v-2h12zm0-3H6V9h12zm0-3H6V6h12z" />
    </svg>
  );
}
function SentimentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM8 11C9.10457 11 10 10.1046 10 9C10 7.89543 9.10457 7 8 7C6.89543 7 6 7.89543 6 9C6 10.1046 6.89543 11 8 11ZM18 9C18 10.1046 17.1046 11 16 11C14.8954 11 14 10.1046 14 9C14 7.89543 14.8954 7 16 7C17.1046 7 18 7.89543 18 9ZM12 13C14.6124 13 16.8349 14.6696 17.6586 17H15.4649C14.7732 15.8044 13.4805 15 12 15C10.5194 15 9.22673 15.8044 8.53511 17H6.34139C7.16507 14.6696 9.38754 13 12 13Z" />
    </svg>
  );
}
const Info = () => <span className="material-icons cr-info">info</span>;

/* A single filter group (label + optional info icon + a static control). */
function Filter({ label, info, children }: { label: string; info?: boolean; children: React.ReactNode }) {
  return (
    <div className="cr-filter">
      <div className="cr-filter-label">{label}{info && <Info />}</div>
      {children}
    </div>
  );
}
function Select({ text }: { text: string }) {
  return (
    <div className="cr-select"><span>{text}</span><span className="material-icons">expand_more</span></div>
  );
}
function Input({ text }: { text: string }) {
  return <div className="cr-input">{text}</div>;
}

/* Wrap every case-insensitive occurrence of `q` in the text with a highlight. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(ql);
  let key = 0;
  while (idx !== -1) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(<mark key={key++} className="cr-hl">{text.slice(idx, idx + q.length)}</mark>);
    from = idx + q.length;
    idx = lower.indexOf(ql, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function CallCard({ c, q }: { c: CallReviewItem; q?: string }) {
  return (
    <div className={"cr-card" + (c.evaluated ? " evaluated" : "")}>
      <div className="cr-score-col">
        <div className="cr-score-label">{c.scoreLabel}</div>
        <div className="cr-score-val">{c.score}%</div>
        {c.evaluated && (
          <span className="cr-eval-badge"><span className="material-icons">check</span>Evaluated</span>
        )}
      </div>
      <div className="cr-summary-col">
        <p><Highlight text={c.summary} q={q ?? ""} /></p>
      </div>
      <div className="cr-meta-col">
        <div className="cr-meta-date">{c.date}</div>
        <div className="cr-meta-agent">{c.agent}</div>
        <div className="cr-meta-dur">{c.duration}</div>
        <div className="cr-stats">
          <span className="cr-stat" title="Scorecards that applied to this call"><ScorecardIcon />{c.scorecards}</span>
          <span className="cr-stat" title="Comment threads on this call"><CommentIcon />{c.comments}</span>
          <span className="cr-stat cr-stat-neg" title="Negative sentiment score"><SentimentIcon />{c.negativeSentiment}</span>
        </div>
      </div>
    </div>
  );
}

/* ---- Signals filter -------------------------------------------------------
   Clicking the "Signals" field opens a two-panel modal (signal list ← /
   Yes-No-Not Applied →). Only the top signal — the prospect's CONVERSION
   signal ("<bookingTerm>: Scheduled") — is active; picking outcomes + Apply
   drops a pill into the field and filters the call list. */
type Outcome = "yes" | "no" | "na";
const OUTCOME_LABEL: Record<Outcome, string> = { yes: "Yes", no: "No", na: "Not Applied" };
const OPTIONS: { id: Outcome; desc: string }[] = [
  { id: "yes", desc: "The signal's conditions were met." },
  { id: "no", desc: "The signal's conditions were not met." },
  { id: "na", desc: "The conversation had no opportunity for that signal to take place." },
];

/* Did the primary conversion (the booking) happen on this call? Prefers the
   seeded/generated `converted` flag; falls back to summary keywords so older
   profiles that predate the flag still filter sensibly. */
function didConvert(c: CallReviewItem): boolean {
  if (typeof c.converted === "boolean") return c.converted;
  const s = c.summary.toLowerCase();
  const neg = /(voicemail|no agent|cancel|complain|dispute|refund|billed twice|double|frustrat|upset|angry|missed|re-measure|damaged|scratch|warranty|stopped (working|responding)|broke|delay|long wait)/.test(s);
  const booked = /(book|schedul|set up (a|an) appointment|appointment (for|the)|reserv)/.test(s);
  return booked && !neg;
}
function matchesOutcome(c: CallReviewItem, outcomes: Set<Outcome>): boolean {
  const conv = didConvert(c);
  if (outcomes.has("yes") && conv) return true;
  if (outcomes.has("no") && !conv) return true;
  if (outcomes.has("na") && !conv) return true;
  return false;
}

/* Fallback Global-Transcript-Search suggestions when a prospect has no curated
   `searchSuggestions` (e.g. profiles generated before that field existed): the
   most common 5+ letter words across the summaries, ranked by how many calls
   contain them — which also sinks one-off caller names below recurring topics. */
const SEARCH_STOP = new Set(
  "about after again agent already along also another around asked because been before being between both call callback called caller calls collected come confirmed could customer design does doing during email even every explained following further gave going have having here home into just made make mentioned more most name named need needed next note noted offer offered order over phone provided reason requested reviewed said same scheduled some such than that their them then there these they this those through time under until very visit walked want wanted were what when which while will with within would your"
    .split(" ")
);
function extractTerms(calls: CallReviewItem[]): string[] {
  const df = new Map<string, number>();
  for (const c of calls) {
    const seen = new Set<string>();
    for (const w of c.summary.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
      if (SEARCH_STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      df.set(w, (df.get(w) ?? 0) + 1);
    }
  }
  return [...df.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => w);
}

type AppliedFilter = { signalName: string; outcomes: Set<Outcome> };

export function CallReview() {
  const { profile } = useProfile();
  const r = profile.reports.callReview;

  const convSignal = `${profile.bookingTerm || "Appointment"}: Scheduled`;
  /* 10 signals shown; only the conversion one (top) is interactive for the demo. */
  const SIGNALS = [
    { id: "conversion", name: convSignal, active: true },
    { id: "s2", name: "(Compliance) Call Recording", active: false },
    { id: "s3", name: "(QA) Commitment to Help", active: false },
    { id: "s4", name: "(QA) Proper Close", active: false },
    { id: "s5", name: "(QA) Proper Greeting", active: false },
    { id: "s6", name: "Answered By AI Voice Agent", active: false },
    { id: "s7", name: "Answered by Agent", active: false },
    { id: "s8", name: "Business Hours: During", active: false },
    { id: "s9", name: "Caller Type: New Customer", active: false },
    { id: "s10", name: "Qualified Lead", active: false },
  ];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("conversion");
  const [draft, setDraft] = useState<Set<Outcome>>(new Set());
  const [applied, setApplied] = useState<AppliedFilter | null>(null);
  const [search, setSearch] = useState("");

  // Close the modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset all filters when switching prospects, so a stale search/Signals pill
  // from the previous prospect doesn't strand the list on "0 Calls".
  useEffect(() => {
    setSearch("");
    setApplied(null);
    setOpen(false);
    setDraft(new Set());
  }, [profile.id]);

  const openModal = () => {
    setQuery("");
    setSelectedId("conversion");
    setDraft(new Set(applied?.outcomes ?? []));
    setOpen(true);
  };
  const toggleOutcome = (o: Outcome) =>
    setDraft((prev) => {
      const n = new Set(prev);
      n.has(o) ? n.delete(o) : n.add(o);
      return n;
    });
  const apply = () => {
    setApplied(draft.size ? { signalName: convSignal, outcomes: new Set(draft) } : null);
    setOpen(false);
  };
  const removeOutcome = (o: Outcome) =>
    setApplied((prev) => {
      if (!prev) return null;
      const n = new Set(prev.outcomes);
      n.delete(o);
      return n.size ? { ...prev, outcomes: n } : null;
    });

  const calls = r?.calls ?? [];
  /* Global Transcript Search: live substring match over each call's summary
     (the transcript-derived text we have per call). Composes with the Signals
     filter — both narrow the list together. */
  const q = search.trim();
  const ql = q.toLowerCase();
  let filtered = applied ? calls.filter((c) => matchesOutcome(c, applied.outcomes)) : calls;
  if (ql) filtered = filtered.filter((c) => c.summary.toLowerCase().includes(ql));
  /* Example search terms for the input placeholder ("i.e. …"): curated terms from
     the profile first (validated against the real summaries so they're always
     real), topped up with auto-extracted terms — so every prospect, even old
     ones, gets good, working examples. */
  const inSummaries = (t: string) => t.length > 0 && calls.some((c) => c.summary.toLowerCase().includes(t.toLowerCase()));
  const exampleTerms = [...new Set([...(r?.searchSuggestions ?? []), ...extractTerms(calls)])]
    .filter(inSummaries)
    .slice(0, 3);
  const searchPlaceholder = exampleTerms.length ? `i.e. ${exampleTerms.join(", ")}` : "Enter a keyword or phrase";
  /* The 4th call drills into Call Detail; track it by reference so it stays
     correct after filtering (indices shift). */
  const drillCall = profile.reports.callDetail && calls.length > 3 ? calls[3] : null;
  const isFiltered = !!applied || !!ql;
  const countLabel = isFiltered ? `${filtered.length} Calls` : r?.shownCount ?? "";

  const visibleSignals = query
    ? SIGNALS.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : SIGNALS;
  const selectedSignal = SIGNALS.find((s) => s.id === selectedId && s.active) ?? null;

  return (
    <div className="cr-page">
      <aside className="cr-left">
        <h1 className="cr-title">Call Review</h1>
        <div className="cr-filters">
          <div className="cr-filters-head">
            <span className="cr-filters-title">Filters</span>
            <a href="#" className="cr-clear" onClick={(e) => { e.preventDefault(); setApplied(null); setSearch(""); }}>Clear Filters</a>
          </div>
          <Filter label="Date Range"><Select text={r?.dateRange ?? "01/01/2025-10/31/2025"} /></Filter>
          <Filter label="Scores" info>
            <div className="cr-chip-row"><span className="cr-chip">Quality Score<span className="material-icons">close</span></span></div>
          </Filter>
          <Filter label="Evaluated By" info><Select text="Select People" /></Filter>
          <Filter label="Agent" info><Select text="Select Agent" /></Filter>
          <Filter label="Review Status"><Select text="Not Yet Reviewed" /></Filter>
          <div className="cr-filter">
            <div className="cr-filter-label">Signals</div>
            <div className="cr-signals-field" onClick={openModal}>
              {applied ? (
                <div className="cr-chip-row">
                  {[...applied.outcomes].map((o) => (
                    <span key={o} className="cr-chip" onClick={(e) => { e.stopPropagation(); removeOutcome(o); }}>
                      {applied.signalName}: {OUTCOME_LABEL[o]}<span className="material-icons">close</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="cr-signals-ph">Select Signals</span>
              )}
            </div>
          </div>
          <div className="cr-filter-pair">
            <div className="cr-filter">
              <div className="cr-filter-label">Global Transcript Search</div>
              <div className="cr-search-field">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label="Global transcript search" />
              </div>
            </div>
            <div className="cr-filter cr-filter-speaker">
              <div className="cr-filter-label">Speaker</div>
              <Select text="Either" />
            </div>
          </div>
          <Filter label="Caller ID"><Input text="Enter Caller ID" /></Filter>
          <Filter label="Comments"><Select text="Select Comments" /></Filter>
          <Filter label="Marketing Data"><Input text="Select Marketing Data" /></Filter>
          <Filter label="Sentiment" info><Select text="Negative" /></Filter>
          <Filter label="More Filters"><Input text="Select More Filters" /></Filter>
        </div>
      </aside>

      <section className="cr-main">
        {r ? (
          <>
            <div className="cr-toolbar">
              <div className="cr-count">
                <span className="cr-count-num">{countLabel}</span>
                <span className="cr-count-note"> ({r.totalNote})</span>
              </div>
              <div className="cr-toolbar-right">
                <div className="cr-toolbar-ctl">
                  <span className="cr-ctl-label">Score Display: <Info /></span>
                  <div className="cr-select cr-select-lg"><span>{r.scoreDisplay}</span><span className="material-icons">expand_more</span></div>
                </div>
                <div className="cr-toolbar-ctl">
                  <span className="cr-ctl-label">Sort By:</span>
                  <div className="cr-select"><span>{r.sortBy}</span><span className="material-icons">expand_more</span></div>
                </div>
              </div>
            </div>
            <div className="cr-list">
              {filtered.length === 0 ? (
                <div className="cr-empty">No calls match this filter.</div>
              ) : (
                filtered.map((c, i) =>
                  c === drillCall
                    ? <Link key={i} to="/call-review/detail" className="cr-card-link"><CallCard c={c} q={q} /></Link>
                    : <CallCard key={i} c={c} q={q} />
                )
              )}
            </div>
          </>
        ) : (
          <div className="placeholder">
            <span className="material-icons placeholder-icon">reviews</span>
            <h2>No Call Review data</h2>
            <p className="muted">Call Review isn't set up for {profile.customerName} yet.</p>
          </div>
        )}
      </section>

      {open && (
        <div className="sig-overlay" onClick={() => setOpen(false)}>
          <div className="sig-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sig-head">Signals</div>
            <div className="sig-body">
              <div className="sig-list-col">
                <div className="sig-search">
                  <span className="material-icons">search</span>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search signals" />
                </div>
                <div className="sig-ctls">
                  <span className="sig-ctl">Show: All <span className="material-icons">arrow_drop_down</span></span>
                  <span className="sig-ctl">Status: All <span className="material-icons">arrow_drop_down</span></span>
                </div>
                <div className="sig-list">
                  {visibleSignals.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={"sig-item" + (s.id === selectedId ? " selected" : "") + (s.active ? "" : " disabled")}
                      disabled={!s.active}
                      onClick={() => s.active && setSelectedId(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sig-detail-col">
                {selectedSignal ? (
                  <>
                    <div className="sig-detail-head">Multiple options can be applied</div>
                    <div className="sig-options">
                      {OPTIONS.map((opt) => (
                        <label key={opt.id} className={"sig-option" + (draft.has(opt.id) ? " checked" : "")}>
                          <input type="checkbox" checked={draft.has(opt.id)} onChange={() => toggleOutcome(opt.id)} />
                          <span className="sig-option-name">{OUTCOME_LABEL[opt.id]}</span>
                          <span className="sig-option-desc">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="sig-empty-detail">
                    <span className="material-icons">insights</span>
                    <div className="sig-empty-title">No signal selected</div>
                    <div className="sig-empty-sub">Select a signal to view the filter options available</div>
                  </div>
                )}
              </div>
            </div>
            <div className="sig-foot">
              <button type="button" className="sig-clear" disabled={draft.size === 0} onClick={() => setDraft(new Set())}>Clear All</button>
              <div className="sig-foot-right">
                <button type="button" className="sig-cancel" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="sig-apply" onClick={apply}>Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
