import { useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import type { AiRecommendation, QaPair } from "../data/schema";

/* "Edit AI Generated Q&A" modal — the top ~20 Q&A pairs from call-transcript
   data, scrollable. Opened by clicking the Qa pairs card. */
function QaModal({ pairs, onClose }: { pairs: QaPair[]; onClose: () => void }) {
  return (
    <div className="qa-overlay" onClick={onClose}>
      <div className="qa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qa-modal-head"><h2>Edit AI Generated Q&amp;A</h2></div>
        <div className="qa-modal-body">
          {pairs.map((p, i) => (
            <div className="qa-pair" key={i}>
              <div className="qa-q">{p.question}</div>
              <div className="qa-a">{p.answer}</div>
            </div>
          ))}
        </div>
        <div className="qa-modal-foot">
          <button className="ag-save" onClick={onClose}>Cancel</button>
          <button className="ag-publish" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* Fallback recommendations for profiles missing their own — so the page always
   renders. Freshly generated prospects get their own from the engine. */
function defaultRecommendations(name: string): AiRecommendation[] {
  return [
    {
      title: "Qa pairs - 2026-03-11 13:12",
      updated: "07/09/2026 3:29 PM",
      enabled: true,
      payload: `{"task_data_type":"application/json","EXISTING_CUSTOMER":[{"topic":"Order Status","question":"When will my order arrive?","answer":"I can check that for you. Please confirm your full name and the phone number or email on the order and I'll pull up the latest status and estimated delivery."}]}`,
    },
    {
      title: "Intent follow up - 2026-03-11 13:12",
      updated: "07/09/2026 3:29 PM",
      enabled: false,
      payload: `{"task_data_type":"application/json","NEW_CUSTOMER":[{"intent":"Schedule Appointment","follow_up_message":"Great news! We've confirmed your appointment with ${name}. We'll send a confirmation text shortly with all the details."}]}`,
    },
  ];
}

export function AiRecommendations() {
  const { profile } = useProfile();
  const configured = profile.reports.agentConfig?.aiRecommendations ?? [];
  const initial = configured.length ? configured : defaultRecommendations(profile.customerName);
  const [items, setItems] = useState(initial);
  const [modalPairs, setModalPairs] = useState<QaPair[] | null>(null);

  function toggle(i: number) {
    setItems((prev) => prev.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)));
  }

  return (
    <AgentStudioLayout>
      <h2 className="ag-section-title">AI Recommendations</h2>
      <p className="ks-sub">These are AI generated Q&amp;A Recommendations using call transcripts data.</p>

      <div className="air-list">
        {items.map((r, i) => (
          <div className="air-item" key={r.title}>
            <button
              type="button"
              className={"ag-switch air-toggle" + (r.enabled ? " on" : "")}
              onClick={() => toggle(i)}
              aria-label={r.enabled ? "Disable" : "Enable"}
            />
            <div
              className={"air-card" + (r.enabled ? "" : " disabled") + (r.qaPairs?.length ? " air-clickable" : "")}
              onClick={r.qaPairs?.length ? () => setModalPairs(r.qaPairs!) : undefined}
            >
              <div className="air-card-head">
                <span className="material-icons air-spark">auto_awesome</span>
                <span className="air-title">{r.title}</span>
                <span className="air-updated">Updated {r.updated}</span>
              </div>
              <div className="air-payload">{r.payload}</div>
            </div>
          </div>
        ))}
      </div>

      {modalPairs && <QaModal pairs={modalPairs} onClose={() => setModalPairs(null)} />}
    </AgentStudioLayout>
  );
}
