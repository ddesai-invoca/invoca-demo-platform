import { useMemo, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { usePageData } from "../components/GeneratedTiles";

/* =============================================================================
   SignalAiStudio — the Signal flyout's "Signal AI Studio"
   -----------------------------------------------------------------------------
   Real page: /networks/2751/label_groups/manage
   Measured off the live page (8/17/2026), not guessed:

     page bg        rgb(246,247,249)
     h1             24px / 400 / rgb(21,36,62)
     New AI Model   rgb(38,102,249) bg, white, 14px / 500, radius 3px, pad 8/12
     info banner    bg rgb(212,224,254), ink rgb(17,34,140), 14px, radius 3px, pad 5/12
     row card       white, 1px rgb(231,233,235), radius 5px, shadow 0 2px 4px rgba(12,0,51,.2),
                    12px gap, ~89px tall
     model name     16px / 700       label line   16px / 400
     Round chip     bg rgb(231,233,235), ink rgb(91,101,119), 12px, radius 16px
     action button  OUTLINED: white, 1px rgba(38,102,249,.5), ink rgb(38,102,249),
                    12px / 500, pad 8/12, radius 3px, 32px tall

   THE LABELS RE-SKIN. On the capture (Home Services) they read
   `appointment_set`, `appointment_opportunity, appointment_scheduled` — machine
   labels built from that account's booking noun. So they are derived here from the
   prospect's own `bookingTerm` rather than copied, which is why a dealership shows
   `test_drive_set` and a plumber `service_appointment_set`. No schema change, no
   engine phase: everything comes from fields the profile already has.
   ============================================================================= */

/* "Service Appointment" -> "service_appointment". Snake_case of the WHOLE term, not
   its last word: "Test Drive" would otherwise become `drive_set`. */
const snake = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/* Dates are DERIVED, never `new Date()`. The page shows creation timestamps, and a
   demo whose "Created on" changes every time it is opened cannot be rehearsed
   against or screenshotted twice the same way. Hashed off the profile id so each
   prospect gets its own stable set. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 16;
}
/* Anchored to the demo's own window (the platform data is January 2026), so the
   models read as having been trained BEFORE the calls they scored. */
const ANCHOR = Date.UTC(2026, 0, 31);
function createdOn(seed: number, daysBack: number): string {
  const d = new Date(ANCHOR - daysBack * 86400000 - (seed % 9) * 3600000);
  const h24 = 9 + (seed % 8);
  const mins = (seed * 7) % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`
    + ` ${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
}

interface Model {
  id: string;
  title: string;
  round: number;
  labels: string[];
  /* Round 0 still needs its calls labelled; a model that has been round-tripped is
     waiting on verification. That is the only thing driving which button shows. */
  action: "Label Calls" | "Verify Labels";
}

export function SignalAiStudio() {
  const { profile } = useProfile();

  const base = useMemo(() => {
    const noun = snake(profile.bookingTerm || "appointment");
    const seed = hash(profile.id || profile.customerName || "x");
    return {
      title: "Signal AI Studio",
      models: [
        { id: "m1", title: `Created on ${createdOn(seed, 71)}`, round: 0,
          labels: ["sales_qualified_lead"], action: "Label Calls" as const },
        { id: "m2", title: `Created on ${createdOn(seed + 3, 191)}`, round: 0,
          labels: ["quote", "sales_call", "service_call"], action: "Label Calls" as const },
        { id: "m3", title: `Created on ${createdOn(seed + 7, 481)}`, round: 2,
          labels: [`${noun}_set`], action: "Verify Labels" as const },
        /* The capture's fourth row is named after the ACCOUNT rather than a
           timestamp, which is what a hand-named model looks like. */
        { id: "m4", title: profile.networkName || profile.customerName, round: 0,
          labels: [`${noun}_opportunity`, `${noun}_scheduled`], action: "Label Calls" as const },
      ] as Model[],
    };
  }, [profile]);

  /* Registers the page with Ask AI, so the model names and labels are editable
     like every other screen's data. */
  const data = usePageData(base);

  const [query, setQuery] = useState("");
  const [show, setShow] = useState("Active");
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const models: Model[] = data.models ?? [];
  const shown = query.trim()
    ? models.filter((m) =>
        (m.title + " " + m.labels.join(" ")).toLowerCase().includes(query.trim().toLowerCase()))
    : models;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="sas-page">
      <div className="sas-head">
        <h1 className="sas-h1">Signal AI Studio</h1>
        <button className="sas-new" type="button">
          <span className="material-icons">add</span>New AI Model
        </button>
      </div>

      {!dismissed && (
        <div className="sas-banner">
          <span className="material-icons sas-banner-i">info</span>
          <div>
            <b>Welcome to Signal AI Studio!</b>
            <br />
            Before you begin, we highly recommend speaking to an Invoca representative or{" "}
            <a href="#contact" onClick={(e) => e.preventDefault()}>contacting us</a>{" "}
            for guidance on best practices for Signal definition.
          </div>
          <button className="sas-banner-x" aria-label="Dismiss" onClick={() => setDismissed(true)}>
            <span className="material-icons">close</span>
          </button>
        </div>
      )}

      <div className="sas-toolbar">
        <span className="sas-search">
          <span className="material-icons">search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for an AI Model" />
        </span>
        <span className="sas-show">
          <label htmlFor="sas-show">Show:</label>
          <select id="sas-show" value={show} onChange={(e) => setShow(e.target.value)}>
            <option>Active</option>
            <option>Archived</option>
            <option>All</option>
          </select>
        </span>
      </div>

      <div className="sas-list">
        {shown.map((m) => (
          <article key={m.id} className="sas-card">
            <div className="sas-card-main">
              <div className="sas-card-top">
                <span className="sas-name">{m.title}</span>
                <span className="sas-round">Round {m.round}</span>
              </div>
              <div className="sas-labels">{m.labels.join(", ")}</div>
            </div>
            <div className="sas-card-actions">
              <button className="sas-kebab" aria-label="More actions">
                <span className="material-icons">more_vert</span>
              </button>
              <button className="sas-action" type="button">{m.action}</button>
              <button className={"sas-chev" + (open.has(m.id) ? " sas-chev-open" : "")}
                aria-label={open.has(m.id) ? "Collapse" : "Expand"}
                aria-expanded={open.has(m.id)}
                onClick={() => toggle(m.id)}>
                <span className="material-icons">expand_more</span>
              </button>
            </div>

            {/* The chevron is on the real page; what it reveals was not captured, so
                this shows only what the row already knows rather than inventing
                training statistics a prospect might ask us to explain. */}
            {open.has(m.id) && (
              <div className="sas-expand">
                <span className="sas-expand-label">Labels in this model</span>
                <span className="sas-chips">
                  {m.labels.map((l) => <span key={l} className="sas-chip">{l}</span>)}
                </span>
              </div>
            )}
          </article>
        ))}
        {shown.length === 0 && (
          <p className="sas-empty">No AI Model matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}
