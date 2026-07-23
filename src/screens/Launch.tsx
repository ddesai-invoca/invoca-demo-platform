import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { CustomerProfile } from "../data/schema";
import { SEED_IDS } from "../data/profiles";

/* Where a prospect opens (both a fresh generation and revisiting one) — the
   demo starts on the Marketing Performance dashboard. */
const LANDING = "/dashboards/marketing";

/* The pieces the engine builds, in display order, with a rough weight for the
   progress bar (research + report are the heavy sequential prefix). The `key`
   matches the phase name the engine streams via SSE (onProgress). */
type StepStatus = "pending" | "building" | "done";
const BUILD_STEPS: { key: string; label: string; weight: number }[] = [
  { key: "research", label: "Researching the business & website", weight: 10 },
  { key: "terms", label: "Identifying key metrics & terminology", weight: 3 },
  { key: "digitalInsights", label: "Digital Journey & Call Attribution report", weight: 1 },
  { key: "dashboard", label: "Marketing Performance dashboard", weight: 1 },
  { key: "opsDashboard", label: "Marketing & Operations dashboard", weight: 1 },
  { key: "aiAgentConversion", label: "AI Agent Conversion dashboard", weight: 1 },
  { key: "aiMessagingImpact", label: "AI Messaging Impact dashboard", weight: 1 },
  { key: "qualityManagement", label: "QM Actionable Insights dashboard", weight: 1 },
  { key: "qmInstantInsights", label: "QM Instant Insights dashboard", weight: 1 },
  { key: "callReview", label: "Call Review", weight: 1 },
  { key: "callDetail", label: "Call Detail drill-in", weight: 1 },
  { key: "conversationIntelligence", label: "Conversation Intelligence", weight: 1 },
  { key: "smsConversationIntelligence", label: "AI SMS Conversation Intelligence", weight: 1 },
  { key: "voiceConversationIntelligence", label: "AI Voice Conversation Intelligence", weight: 1 },
  { key: "agentConfig", label: "Agent Studio configuration", weight: 1 },
  { key: "screenpops", label: "Voice & SMS Screenpops", weight: 1 },
  { key: "voiceRoutingDemo", label: "Voice Routing demo", weight: 1 },
];
const TOTAL_WEIGHT = BUILD_STEPS.reduce((s, st) => s + st.weight, 0);

export function Launch() {
  const { profiles, addProfile, removeProfile, setProfileId } = useProfile();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [, setTick] = useState(0);
  const stepStartRef = useRef<Record<string, number>>({});

  // Searchable prospects dropdown + delete confirmation.
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomerProfile | null>(null);
  const selectRef = useRef<HTMLDivElement | null>(null);

  // While generating, tick every 0.5s so the % bar can creep smoothly even when a
  // single phase (research) runs for minutes — otherwise it looks frozen.
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? profiles.filter((p) => p.customerName.toLowerCase().includes(q) || p.industry.toLowerCase().includes(q))
    : profiles;

  function open(id: string) {
    setProfileId(id);
    navigate(LANDING);
  }

  // Overall % — done steps count fully; the in-flight step eases up asymptotically
  // from when it started building, so the bar ALWAYS creeps forward (never frozen),
  // even while one long phase (research) runs for minutes. research/report ramp
  // slower since they're the long sequential prefix. Capped <100 until the real
  // "done" event navigates.
  const RAMP_MS: Record<string, number> = { research: 90000, terms: 15000 };
  const now = Date.now();
  const doneWeight = BUILD_STEPS.reduce((s, st) => {
    const status = statuses[st.key];
    if (status === "done") return s + st.weight;
    if (status === "building") {
      const elapsed = now - (stepStartRef.current[st.key] ?? now);
      const frac = Math.min(0.92, 1 - Math.exp(-elapsed / (RAMP_MS[st.key] ?? 15000)));
      return s + st.weight * frac;
    }
    return s;
  }, 0);
  const pct = Math.min(99, Math.round((doneWeight / TOTAL_WEIGHT) * 100));

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmedName = name.trim();
    let trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) { setError("Enter both a prospect name and a website URL."); return; }
    if (!/^https?:\/\//i.test(trimmedUrl)) trimmedUrl = "https://" + trimmedUrl;

    setError(null);
    setStatuses({});
    stepStartRef.current = {};
    setBusy(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, url: trimmedUrl }),
      });
      if (!res.body) throw new Error("Generation failed: no response stream.");

      // Read the Server-Sent Events stream: {type:"progress",phase,status} events
      // during the build, then a final {type:"done",profile} (or {type:"error"}).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalProfile: unknown = null;
      let streamError: string | null = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const rawEvent = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let evt: any;
          try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (evt.type === "progress") {
            if (evt.status !== "done" && !stepStartRef.current[evt.phase]) stepStartRef.current[evt.phase] = Date.now();
            setStatuses((prev) => ({ ...prev, [evt.phase]: evt.status === "done" ? "done" : "building" }));
          } else if (evt.type === "done") {
            finalProfile = evt.profile;
          } else if (evt.type === "error") {
            streamError = evt.error;
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!finalProfile) throw new Error("Generation ended without a profile.");
      const profile = CustomerProfile.parse(finalProfile);
      addProfile(profile);
      open(profile.id);
    } catch (err: any) {
      setError(err?.message || "Something went wrong generating this prospect.");
      setBusy(false);
    }
  }

  return (
    <div className="launch-page">
      <div className="launch-card">
        <img className="launch-logo" src="/logo.png" alt="Invoca" />
        <h1 className="launch-title">Launch a demo</h1>
        <p className="launch-sub">
          Enter a prospect's name and website. We'll research their business and spin up the
          Invoca platform pre-loaded with their data.
        </p>

        {busy ? (
          <div className="launch-loading">
            <div className="launch-progress-head">
              <span className="launch-progress-title">Building {name.trim() || "the prospect"}'s Invoca platform…</span>
              <span className="launch-progress-pct">{pct}%</span>
            </div>
            <div className="launch-progress-track">
              <div className="launch-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <ul className="launch-steps">
              {BUILD_STEPS.map((st) => {
                const s = statuses[st.key] ?? "pending";
                return (
                  <li key={st.key} className={"launch-step launch-step-" + s}>
                    <span className="launch-step-ic">
                      {s === "done" ? (
                        <span className="material-icons">check_circle</span>
                      ) : s === "building" ? (
                        <span className="launch-step-spin" />
                      ) : (
                        <span className="material-icons">radio_button_unchecked</span>
                      )}
                    </span>
                    <span className="launch-step-label">{st.label}</span>
                  </li>
                );
              })}
            </ul>
            <div className="launch-hint">This takes a few minutes — building {BUILD_STEPS.length} pieces of the platform.</div>
          </div>
        ) : (
          <form className="launch-form" onSubmit={launch}>
            <label className="launch-field">
              <span>Prospect name</span>
              <input
                type="text" value={name} autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shady Blinds"
              />
            </label>
            <label className="launch-field">
              <span>Website URL</span>
              <input
                type="text" value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="e.g. https://www.shadyblindsnow.com"
              />
            </label>
            {error && <div className="launch-error">{error}</div>}
            <button className="launch-btn" type="submit">Launch demo</button>
          </form>
        )}

        {profiles.length > 0 && !busy && (
          <div className="launch-recent">
            <div className="launch-recent-head">Your prospects</div>
            <div className="prospect-select" ref={selectRef}>
              <div className={"prospect-search" + (dropdownOpen ? " open" : "")}>
                <span className="material-icons prospect-search-icon">search</span>
                <input
                  type="text"
                  placeholder="Search prospects…"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                />
                <span className="material-icons prospect-caret" onClick={() => setDropdownOpen((o) => !o)}>expand_more</span>
              </div>
              {dropdownOpen && (
                <div className="prospect-dropdown">
                  {filtered.length === 0 ? (
                    <div className="prospect-empty">No prospects match "{query}"</div>
                  ) : (
                    filtered.map((p) => (
                      <div key={p.id} className="prospect-option" onClick={() => open(p.id)}>
                        <div className="prospect-option-text">
                          <span className="prospect-name">{p.customerName}</span>
                          <span className="prospect-meta">{p.industry}</span>
                        </div>
                        {!SEED_IDS.has(p.id) && (
                          <button
                            className="prospect-delete"
                            title={`Delete ${p.customerName}`}
                            aria-label={`Delete ${p.customerName}`}
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}
                          >
                            <span className="material-icons">delete_outline</span>
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="confirm-overlay" onClick={() => setPendingDelete(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon"><span className="material-icons">warning_amber</span></div>
            <h2 className="confirm-title">Delete this prospect?</h2>
            <p className="confirm-text">
              Are you sure you want to delete <strong>{pendingDelete.customerName}</strong>? This can't be undone.
            </p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button
                className="confirm-delete"
                onClick={() => { removeProfile(pendingDelete.id); setPendingDelete(null); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
