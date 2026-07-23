import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useVoiceCapture } from "../data/VoiceCaptureContext";
import { Pill } from "../components/Pill";
import { AgentStudioIcon } from "../components/nav";
import type { VoiceConversation, VoiceInfo } from "../data/schema";

/* AI Voice Conversation Intelligence — the voice sibling of the SMS report. Lists
   AI-voice phone calls (top ones active with transcript/signals/call metadata,
   the rest inactive shells). Ending a Preview-Agent voice call prepends the
   just-had call at the top (via VoiceCaptureContext), with signals filled in by
   /api/analyze. Reuses the .ci-/.sci- layout of the SMS report. */

function AgentGlyph() {
  return <span className="sci-agent-glyph">{AgentStudioIcon()}</span>;
}

const TABS = [
  { key: "analysis", label: "Analysis", icon: "bar_chart" },
  { key: "info", label: "Call Info", icon: "call" },
  { key: "comments", label: "Comments", icon: "chat_bubble_outline" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* Call Info tab — the metadata cards, driven by the call's voiceInfo. */
function InfoField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="sci-field">
      <div className="sci-field-label">{label}</div>
      <div className="sci-field-value">{value || "—"}</div>
    </div>
  );
}
function CallInfoPanel({ info }: { info: VoiceInfo }) {
  return (
    <div className="sci-info-grid">
      <section className="sci-info-card">
        <h3>About This Call</h3>
        <div className="sci-fields">
          <InfoField label="CALL RECORD ID" value={info.callRecordId} />
          <InfoField label="CALL START TIME" value={info.callStartTime} />
          <InfoField label="DURATION" value={info.duration} />
          <InfoField label="DESTINATION PHONE NUMBER" value={info.destinationPhone} />
          <InfoField label="SOURCE" value={info.source} />
          <InfoField label="PROMO NUMBER DESCRIPTION" value={info.promoNumberDescription} />
          <InfoField label="CONNECTION STATUS" value={info.connectionStatus} />
        </div>
      </section>
      <section className="sci-info-card">
        <h3>Consumer Data</h3>
        <div className="sci-fields">
          <InfoField label="CALLER ID" value={info.callerId} />
          <InfoField label="REPEAT CALLER" value={info.repeatCaller} />
          <InfoField label="CITY" value={info.city} />
          <InfoField label="REGION" value={info.region} />
          <InfoField label="PHONE TYPE" value={info.phoneType} />
        </div>
        <h4 className="sci-subhead">Enhanced Caller Profile (Data Append)</h4>
        <div className="sci-fields">
          <InfoField label="DISPLAY NAME" value={info.displayName} />
          <InfoField label="FIRST NAME" value={info.firstName} />
          <InfoField label="LAST NAME" value={info.lastName} />
          <InfoField label="GENDER" value={info.gender} />
        </div>
      </section>
      <section className="sci-info-card">
        <h3>Marketing Data</h3>
        <div className="sci-fields">
          <InfoField label="DESTINATION TIME ZONE" value={info.destinationTimeZone} />
          <InfoField label="CONNECTION STATUS" value={info.connectionStatus} />
        </div>
      </section>
      <section className="sci-info-card">
        <h3>Campaign Data</h3>
        <div className="sci-fields">
          <InfoField label="FINAL CAMPAIGN" value={info.finalCampaign} />
          <InfoField label="FINAL CAMPAIGN ID" value={info.finalCampaignId} />
        </div>
      </section>
    </div>
  );
}

export function VoiceConversationIntelligence() {
  const { profile } = useProfile();
  const { capturedFor } = useVoiceCapture();
  const view = profile.reports.voiceConversationIntelligence;

  const captured = capturedFor(profile.id);
  const seed = view?.conversations ?? [];
  // Captured calls accumulate at the top (newest first); seed examples fill in
  // below. The list scrolls, so no hard cap.
  const conversations: VoiceConversation[] = [...captured, ...seed];

  const firstActive = conversations.find((c) => c.active) ?? conversations[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(firstActive?.id);
  const [tab, setTab] = useState<TabKey>("analysis");

  const selected = conversations.find((c) => c.id === selectedId) ?? firstActive;

  if (!view && captured.length === 0) {
    return (
      <div className="report-surface">
        <div className="placeholder"><h2>No voice conversations</h2>
          <p className="muted">This report isn't set up for {profile.customerName} yet.</p></div>
      </div>
    );
  }

  return (
    <div className="ci-page sci-page vci-page">
      <div className="breadcrumb">
        <Link to="/reports">My Reports</Link>
        <span className="sep">&rsaquo;</span>
        <span className="current">Interactions</span>
      </div>

      <div className="ci-header">
        <div className="ci-header-left">
          <h1 className="title ci-title">Interactions</h1>
          <div className="toolbar ci-toolbar">
            <div className="view-toggle">
              <div className="view-btn active"><span className="material-icons">grid_on</span></div>
              <div className="view-btn"><span className="material-icons">view_agenda</span></div>
            </div>
            <Pill>{`Custom:  ${view?.dateRange ?? "Aug 11, 2025 - Aug 16, 2025"}`}</Pill>
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
            <span className="ci-calls-count">{view?.countLabel ?? `${conversations.length} calls`}</span>
            <span className="ci-calls-sort">Call Start Time <span className="material-icons">arrow_downward</span></span>
          </div>
          <div className="ci-calls-list">
            {conversations.map((c) => (
              <button
                key={c.id}
                className={"ci-call" + (c.id === selectedId ? " active" : "") + (c.active ? "" : " sci-shell")}
                onClick={() => c.active && setSelectedId(c.id)}
              >
                <div className="ci-call-time">{c.time}</div>
                <div className="ci-call-id">{c.id}</div>
              </button>
            ))}
          </div>
          <div className="ci-calls-foot">
            <span className="ci-pagerlabel">{view?.pagerLabel ?? "1 of 31"}</span>
            <span className="ci-pager">
              <button className="ci-page-arrow"><span className="material-icons">chevron_left</span></button>
              <button className="ci-page-arrow"><span className="material-icons">chevron_right</span></button>
            </span>
          </div>
        </aside>

        {/* CENTER — call transcript */}
        <section className="ci-center">
          {selected?.active ? (
            <>
              <div className="ci-legend">
                <span className="ci-legend-item"><span className="material-icons ci-ic-caller">person</span> Consumer</span>
                <span className="ci-legend-item"><AgentGlyph /> AI Agent</span>
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
                {selected.date && <div className="sci-date-divider">{selected.date}</div>}
                {selected.signals.length === 0 && captured.some((c) => c.id === selected.id) && (
                  <div className="sci-analyzing-note">Analyzing call for signals…</div>
                )}
                {selected.transcript.map((turn, i) => (
                  <div className="ci-turn" key={i}>
                    <div className="ci-turn-side">
                      {turn.speaker === "agent"
                        ? <span className="ci-turn-ic sci-agent-glyph">{AgentStudioIcon()}</span>
                        : <span className="material-icons ci-turn-ic ci-ic-caller">person</span>}
                      <span className="ci-turn-time">{turn.time}</span>
                    </div>
                    <div className="ci-turn-text">{turn.text}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="sci-empty">Select a call to view its transcript.</div>
          )}
        </section>

        {/* RIGHT — Analysis / Call Info / Comments */}
        <aside className="ci-analysis">
          <div className="ci-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={"ci-tab" + (t.key === tab ? " active" : "")} onClick={() => setTab(t.key)}>
                <span className="material-icons">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          <div className="ci-analysis-body">
            {tab === "analysis" && (
              <>
                <div className="ci-section-head"><span className="ci-section-title">Signals</span><span className="material-icons ci-edit">edit</span></div>
                <div className="ci-sig-sub">MET SIGNALS</div>
                {selected?.signals.length ? (
                  selected.signals.map((s) => (
                    <div className="ci-signal" key={s.name}>
                      <span className="material-icons ci-sig-check">check_circle</span>
                      <span className="ci-sig-name">{s.name}</span>
                      {s.badges.map((b) => <span className="ci-badge" key={b}>{b}</span>)}
                      {s.count > 0 && <span className="ci-sig-count">{s.count}</span>}
                      {s.count > 0 && <span className="material-icons ci-sig-caret">expand_more</span>}
                    </div>
                  ))
                ) : (
                  <div className="sci-analyzing-note">Analyzing call for signals…</div>
                )}
              </>
            )}
            {tab === "info" && (selected?.voiceInfo ? <CallInfoPanel info={selected.voiceInfo} /> : <div className="sci-empty">No call info available.</div>)}
            {tab === "comments" && <div className="sci-empty">No comments on this call.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
