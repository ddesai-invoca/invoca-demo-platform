import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEMANTIC_TEMPLATES, type SemanticTemplate } from "../data/semanticSignals";

/* Signal → New → Semantic Signal → the template library, and the detail drawer a tile opens.
   `/signal/new/semantic` (the real one is /manage_signals/semantic_signal/template), matched
   to the captures "Semantic Signals｜ Invoca For Telecom 2.0" (the grid) and "Semantic
   Signals 2" (the drawer), both 8/6/2026.

   MEASURED — these pages are Invoca's own MUI markup and serialise in full:
     grid   -> 1 / 2 / 3 columns at 0 / 600 / 900px, 24px gap
     card   -> min-height 280, max-height 400, 3px radius, 1px border, elevation-1 shadow
     hover  -> translateY(-0.25rem) AND a rgb(212,224,254) tint; active rgb(176,205,255)
     drawer -> right-anchored 500px paper (drawer-width-sm), 24px padding, 225ms slide,
               50% black scrim, then title / publisher / description / Spoken By /
               Suggested Use / a bordered phrase list / a sticky Close + Activate footer

   The 15 templates and their phrases live in src/data/semanticSignals.ts — read the
   provenance note there before trusting a phrase list, because it is uneven. */

function AgentIcon() {
  return (
    <svg className="ssl-speaker-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.22C21 6.73 16.74 3 12 3c-4.69 0-9 3.65-9 9.28-.6.34-1 .98-1 1.72v2c0 1.1.9 2 2 2h1v-6.1c0-3.87 3.13-7 7-7s7 3.13 7 7V19h-8v2h8c1.1 0 2-.9 2-2v-1.22c.59-.31 1-.92 1-1.64v-2.3c0-.7-.41-1.31-1-1.62" />
      <circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" />
      <path d="M18 11.03C17.52 8.18 15.04 6 12.05 6c-3.03 0-6.29 2.51-6.03 6.45 2.47-1.01 4.33-3.21 4.86-5.89 1.31 2.63 4 4.44 7.12 4.47" />
    </svg>
  );
}
function CallerIcon() {
  return (
    <svg className="ssl-speaker-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4" />
    </svg>
  );
}
/* The publisher badge. The capture ships it as a base64 SVG <img>; inlined here so it needs
   no asset. #02B388 is its own green. */
function InvocaMark({ className = "ssl-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" fill="#02B388" d="M12.8779 8.39542C12.8779 9.54004 12.0523 10.4889 11.0033 10.5988L11.1478 12.3968L8.44582 10.6116H5.20149C4.05818 10.6116 3.12179 9.61493 3.12179 8.39542V5.53665C3.12179 4.31715 4.05818 3.32047 5.20149 3.32047H10.7979C11.9439 3.32047 12.8779 4.31715 12.8779 5.53665V8.39542ZM10.7979 0H5.20149C2.33406 0 0 2.48275 0 5.53668V8.39549C0 10.4735 1.08024 12.2857 2.67432 13.2313L0.147753 16L6.99288 13.9322H10.7979C13.6662 13.9322 16 11.449 16 8.39549V5.53668C16 2.48275 13.6662 0 10.7979 0Z" />
    </svg>
  );
}

/* The right-hand detail drawer. Same chrome as the Insights interaction drawer (both are the
   platform's MuiDrawer) but the SMALL width token — 500px against that one's 800px. */
function TemplateDrawer({ t, onClose, onActivate }: {
  t: SemanticTemplate; onClose: () => void; onActivate: () => void;
}) {
  /* Escape closes, which the real MUI drawer does for free. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sdr-root" role="presentation">
      <div className="sdr-backdrop" onClick={onClose} />
      <aside className="sdr-panel" role="dialog" aria-modal="true" aria-label={t.name}>
        <div className="sdr-scroll">
          <h2 className="sdr-title">{t.name}</h2>
          <div className="sdr-publisher"><InvocaMark className="sdr-mark" /><span>Invoca</span></div>
          <p className="sdr-desc">{t.body}</p>
          <div className="sdr-row">
            <span className="sdr-label">Spoken By:</span>
            <span className="sdr-value">{t.speaker}</span>
          </div>
          <div className="sdr-row sdr-row-use">
            <span className="material-icons sdr-info">info</span>
            <span className="sdr-label">Suggested Use:</span>
            <span className="sdr-value">{t.suggestedUse}</span>
          </div>

          <h3 className="sdr-phrases-head">Phrases</h3>
          <ul className="sdr-phrases">
            {t.phrases.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>

        {/* Sticky footer, as the capture has it — the phrase list scrolls under it. */}
        <div className="sdr-foot">
          <button className="sdr-close" type="button" onClick={onClose}>Close</button>
          <button className="sdr-activate" type="button" onClick={onActivate}>Activate</button>
        </div>
      </aside>
    </div>
  );
}

export function SemanticSignalLibrary() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SemanticTemplate | null>(null);

  /* The search box is real: it filters on name AND description, which is what a template
     search is for — "resistance" should find Objection Handling. A title-only filter
     would be a prop. */
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return SEMANTIC_TEMPLATES;
    return SEMANTIC_TEMPLATES.filter((x) =>
      x.name.toLowerCase().includes(t) || x.body.toLowerCase().includes(t));
  }, [q]);

  return (
    <div className="ssl-page">
      <div className="ssl-head">
        <h1 className="ssl-title">Semantic Signal Library</h1>
        <a className="ssl-about" href="#about" onClick={(e) => e.preventDefault()}>
          <span className="material-icons">info_outline</span>About Semantic Signals
        </a>
      </div>

      <div className="ssl-body">
        <div className="ssl-search">
          <span className="material-icons">search</span>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search for a template" aria-label="Search for a template" />
        </div>

        <div className="ssl-grid">
          {shown.map((t) => (
            /* The WHOLE tile opens the drawer — the real card is cursor:pointer end to end,
               not just its title. Activate is stopPropagation'd so it does not also open
               the drawer on its way past. */
            <article className="ssl-card" key={t.name} onClick={() => setOpen(t)}>
              <div className="ssl-card-content">
                <div className="ssl-card-head">
                  <h2 className="ssl-card-title">{t.name}</h2>
                  {t.speaker === "Agent" ? <AgentIcon /> : <CallerIcon />}
                  <span className="ssl-speaker">{t.speaker}</span>
                </div>
                <div className="ssl-publisher">
                  <InvocaMark /><span>Invoca</span>
                </div>
                <p className="ssl-card-text">{t.body}</p>
              </div>
              <div className="ssl-card-actions">
                {/* ONLY THE CAPTURED TEMPLATES ACTIVATE.

                    Gated on `t.captured`, which today is exactly the top row (Ask for
                    Appointment, Ask for Sale, Competitor Mention) — the three whose
                    phrase lists came out of a real capture. The other twelve carry
                    phrases AUTHORED IN THIS REPO (see data/semanticSignals.ts), and
                    opening a form full of invented Invoca content in front of a
                    prospect is worse than a button that politely declines.

                    Deliberately the FLAG, not a list of three names: capture a real
                    phrase list for another template, flip `captured: true`, and its
                    button starts working with no change here.

                    Matches the real link either way: the template is identified by
                    standardDataFieldName ("$.Ask for Appointment"), so a refresh or a
                    shared URL still resolves to the same signal. */}
                <button
                  className={"ssl-activate" + (t.captured ? "" : " ssl-activate-off")}
                  type="button"
                  disabled={!t.captured}
                  title={t.captured
                    ? `Activate ${t.name}`
                    : "Not available in this demo yet"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!t.captured) return;
                    navigate(`/signal/new/semantic/activate?trackerId=146&standardDataFieldName=${encodeURIComponent("$." + t.name)}`);
                  }}>Activate</button>
              </div>
            </article>
          ))}
        </div>

        {shown.length === 0 && (
          <p className="ssl-empty">No templates match &ldquo;{q}&rdquo;.</p>
        )}
      </div>

      {open && (
        <TemplateDrawer t={open} onClose={() => setOpen(null)}
          onActivate={() => { setOpen(null); navigate("/signal"); }} />
      )}
    </div>
  );
}
