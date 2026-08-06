import { useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout } from "./AgentStudioLayout";
import type { AiRecommendation, QaPair } from "../data/schema";
import { usePageData } from "../components/GeneratedTiles";

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

/* ---- the fallback, and why it now carries real Q&A ------------------------

   `agentConfig.aiRecommendations` is OPTIONAL in the schema, so a generation whose
   model simply omitted it passes Zod with no error at all. The page then fell back
   to two hardcoded cards — and the "Qa pairs" card had NO qaPairs, so it rendered
   looking exactly like a working one and did nothing when clicked. That is the
   reported "I can't click the QA pair": not a broken click handler, a card with
   nothing behind it and no way to tell.

   So the fallback now DERIVES its pairs from the prospect's own data. Every profile
   already carries the product categories, locations, booking term and customer noun
   these questions need, so the card is clickable for every prospect on disk — no
   regeneration — and the content is on-brand rather than generic filler. A freshly
   generated prospect still uses the engine's own 20 pairs when it has them. */

interface DerivedFacts {
  name: string; booking: string; noun: string; nounLower: string;
  categories: string[]; locations: string[]; domain: string;
}

function facts(profile: ReturnType<typeof useProfile>["profile"]): DerivedFacts {
  const md = profile.reports.marketingDashboard;
  const catRow = (md?.breakdowns ?? []).find((b) => /product category/i.test(b.title));
  const categories = (catRow?.rows ?? []).map((r) => r.name).filter(Boolean).slice(0, 4);
  const locRows = profile.reports.opsDashboard?.locationHandling?.rows ?? [];
  const locations = locRows.map((r) => String(r.cells?.[0] ?? "")).filter(Boolean).slice(0, 4);
  const noun = profile.customerNoun || "Customer";
  return {
    name: profile.customerName,
    booking: profile.bookingTerm || "Appointment",
    noun,
    nounLower: noun.toLowerCase(),
    categories,
    locations,
    domain: profile.brandDomain || "",
  };
}

/* Questions a real caller asks, filled with THIS prospect's own vocabulary. Answers
   follow the same rules the engine's prompt sets for generated pairs: 1–2 sentences,
   steer toward booking, never quote an exact price. */
function deriveQaPairs(f: DerivedFacts): QaPair[] {
  const cat = f.categories[0] ?? "our products";
  const cat2 = f.categories[1] ?? cat;
  const loc = f.locations[0] ?? "our main location";
  const pairs: QaPair[] = [
    { question: `What are your hours?`,
      answer: `${loc} is open seven days a week, and I can also book you outside standard hours if that is easier. Would you like me to set up a ${f.booking.toLowerCase()}?` },
    { question: `How do I book a ${f.booking.toLowerCase()}?`,
      answer: `I can do that right now. I just need your name, the best number to reach you, and a day that works. It takes about a minute.` },
    { question: `How much does it cost?`,
      answer: `Pricing depends on what you need, so we confirm it during the ${f.booking.toLowerCase()} rather than quoting a number that might not hold. I can get you in with a specialist who will walk you through the options.` },
    { question: `Do you have ${cat} available?`,
      answer: `${cat} is one of our most requested categories and availability moves quickly. If you tell me what you are after I will check current stock and hold it for your ${f.booking.toLowerCase()}.` },
    { question: `What is the difference between ${cat} and ${cat2}?`,
      answer: `They suit different needs, and a specialist can compare them side by side with you. I can book a ${f.booking.toLowerCase()} so you see both before deciding.` },
    { question: `Where are you located?`,
      answer: f.locations.length > 1
        ? `We have several locations, including ${f.locations.slice(0, 3).join(", ")}. Which is most convenient for you?`
        : `We are at ${loc}. I can send directions along with your ${f.booking.toLowerCase()} confirmation.` },
    { question: `Can I speak to someone about an existing order?`,
      answer: `Absolutely. If you give me the name on the order and the phone number or email you used, I will pull up the latest status and connect you to the right team.` },
    { question: `Do you offer financing?`,
      answer: `We do have options, and the details depend on what you are looking at. A specialist can go through them with you on the ${f.booking.toLowerCase()}.` },
    { question: `How long does the process take?`,
      answer: `Most ${f.nounLower}s are done in a single visit, and we will tell you up front if anything needs longer. Shall I find you a time?` },
    { question: `Are you able to help if I am not a ${f.nounLower} yet?`,
      answer: `Of course, most people start exactly here. I will take a few details and set up a ${f.booking.toLowerCase()} with the right specialist.` },
    { question: `Do I need an appointment or can I walk in?`,
      answer: `Walk-ins are welcome, though booking means someone is ready for you and you will not wait. I can reserve a slot now if you like.` },
    { question: `Can you email me more information first?`,
      answer: `Yes, give me the best email and I will send it over${f.domain ? `, and you can browse ${f.domain} in the meantime` : ""}. I can also pencil in a ${f.booking.toLowerCase()} you are free to move.` },
    { question: `Who will I be speaking with?`,
      answer: `One of our ${cat} specialists, matched to what you need. I will note your details so they are prepared before you arrive.` },
    { question: `What if I need to reschedule?`,
      answer: `Not a problem at all. Reply to the confirmation text or call us and we will move it. There is no charge to change a ${f.booking.toLowerCase()}.` },
  ];
  return pairs;
}

/* Fallback recommendations for profiles whose generation omitted their own — so the
   page always renders AND the Qa pairs card always opens. Freshly generated prospects
   use the engine's own pairs when present. */
function defaultRecommendations(profile: ReturnType<typeof useProfile>["profile"]): AiRecommendation[] {
  const f = facts(profile);
  const qaPairs = deriveQaPairs(f);
  /* The payload is the truncated JSON shown on the card face. Built from the first
     derived pairs so the preview matches what the modal opens, instead of showing a
     generic order-status example for a business that does not take orders. */
  const preview = {
    task_data_type: "application/json",
    EXISTING_CUSTOMER: qaPairs.slice(6, 8).map((p) => ({
      topic: p.question, question: p.question, answer: p.answer,
    })),
  };
  return [
    {
      title: "Qa pairs - 2026-03-11 13:12",
      updated: "07/09/2026 3:29 PM",
      enabled: true,
      payload: JSON.stringify(preview),
      qaPairs,
    },
    {
      title: "Intent follow up - 2026-03-11 13:12",
      updated: "07/09/2026 3:29 PM",
      enabled: false,
      payload: JSON.stringify({
        task_data_type: "application/json",
        NEW_CUSTOMER: [{
          intent: `Schedule ${f.booking}`,
          follow_up_message: `Great news! We've confirmed your ${f.booking.toLowerCase()} with ${f.name}. We'll send a confirmation text shortly with all the details.`,
        }],
      }),
    },
  ];
}

export function AiRecommendations() {
  const { profile } = useProfile();
  /* Registers this page as the AI scope and returns agentConfig with any
     edits made ON THIS PAGE overlaid. */
  const ac = usePageData(profile.reports.agentConfig);
  const configured = ac?.aiRecommendations ?? [];
  const initial = configured.length ? configured : defaultRecommendations(profile);
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
