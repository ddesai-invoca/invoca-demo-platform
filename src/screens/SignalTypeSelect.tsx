import { useNavigate } from "react-router-dom";

/* Signal -> New: pick the source that will track the Signal.
   `/signal/new` (the real one is /manage_signals/type-select), matched to the capture
   "Signal /new signal.html" and its screenshot.

   MEASURED, not eyeballed — this page is Invoca's own MUI markup and serialises in full:
     heading   -> 24px/36px, rgb(81,133,250), 32px below
     card      -> 3px radius, 1px border, no shadow, equal height, three across
     ribbon    -> 110x110 clip, band rotated -45deg, #5185fa, 700 15px/1, uppercase
     icon      -> 128x118 splash + the per-type glyph, from one sprite (see below)
     SELECT    -> a text button in the primary blue
     Cancel    -> outlined, below a full-width hairline divider

   THE ILLUSTRATIONS come from Invoca's own icon sprite, lifted out of the capture to
   public/signal-sprite.png (4468x236, drawn at background-size 2234px, i.e. 2x). Using
   the sprite with the real background-positions is pixel-exact and avoids cropping four
   images by hand; the same sprite carries the rest of the platform's illustrations if a
   later screen needs one.

   NOT re-skinned per prospect on purpose: every word here is Invoca product copy
   describing Invoca features, the same reason "Marketing Source" and "UNIQUE COUNT" stay
   verbatim. Nothing on this screen is customer data. */

interface SignalType {
  key: string;
  title: string;
  body: string;
  /* The sprite class carrying this type's glyph. */
  glyph: string;
  ribbon?: string;
  /* Where SELECT goes. Only Semantic Signal has its next screen built. */
  to: string;
}

const TYPES: SignalType[] = [
  {
    key: "semantic",
    title: "Semantic Signal",
    body: "Calls are auto-categorized using semantic keyword match technology and large language models.",
    glyph: "sig-semantic",
    ribbon: "NEW!",
    to: "/signal/new/semantic",
  },
  {
    key: "ai-studio",
    title: "Signal AI Studio (Recommended)",
    body: "Calls are auto-categorized using Invoca's latest machine learning technology.",
    glyph: "sig-ai",
    to: "/signal",
  },
  {
    key: "rules",
    title: "Rule-based Signal",
    body: "Calls are auto-categorized using predefined rules for the call and caller.",
    glyph: "sig-rules",
    to: "/signal",
  },
];

export function SignalTypeSelect() {
  const navigate = useNavigate();

  return (
    <div className="sts-page">
      <div className="sts-head">
        <h1 className="sts-title">Signal</h1>
      </div>

      <div className="sts-body">
        <section className="sts-card">
          <h2 className="sts-lede">Select which source you&rsquo;ll be using to track your Signal.</h2>

          <div className="sts-grid">
            {TYPES.map((t) => (
              <article className="sts-type" key={t.key} data-testid={t.key}>
                {t.ribbon && (
                  <div className="sts-ribbon"><span>{t.ribbon}</span></div>
                )}
                <div className="sts-icon sig-sprite sig-splash">
                  <span className={`sig-sprite ${t.glyph}`} />
                </div>
                <div className="sts-type-body">
                  <div className="sts-type-content">
                    <h3 className="sts-type-title">{t.title}</h3>
                    <p className="sts-type-text">{t.body}</p>
                  </div>
                  <div className="sts-type-actions">
                    {/* Semantic Signal opens its template library. The other two builders
                        are not built yet, so they return to Manage Signals rather than dead
                        ending; point each at its builder as those screens arrive. */}
                    <button className="sts-select" type="button"
                      onClick={() => navigate(t.to)}>SELECT</button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="sts-divider" />
          <button className="sts-cancel" type="button" onClick={() => navigate("/signal")}>
            Cancel
          </button>
        </section>
      </div>
    </div>
  );
}
