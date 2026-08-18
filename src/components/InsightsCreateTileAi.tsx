import { useEffect, useRef, useState } from "react";
import type { CustomerProfile } from "../data/schema";
import {
  explainChoice, questionsFor, resolveQuestion, type TileChoices,
} from "../data/insightsQuestions";

/* =============================================================================
   InsightsCreateTileAi — the drawer behind "Build With AI" on Add Tile.
   -----------------------------------------------------------------------------
   Scoped `.icta-`. Checked against every prefix already in app.css and ts.css
   before choosing it, per the one-prefix-per-screen rule; `ica-`, `icd-`, `icp-`,
   `iad-`, `iat-` and `itc-` were all taken and any of them would have produced the
   same silent style collision the config drawer hit.

   ⚠️ PROVENANCE: THIS ONE IS FROM A SCREENSHOT, NOT A CAPTURE. The HTML supplied
   with the request turned out to be the earlier Data Display Options capture
   (byte-identical, 845,047 bytes) and contains no "Create Tile with AI" markup at
   all. So the LAYOUT and COPY here are read off the screenshot, while every COLOUR,
   FONT and RADIUS comes from the measured `--ts-var-*` tokens, which are exact.
   Values that are screenshot-derived and therefore approximate:

     panel width ~814 of a 1919 viewport   hero title ~30px/700
     title row   ~34 from the top          sub-copy 15px, two centred lines
     composer    a rounded well pinned to the bottom with Reset above the field
     send button ~36px circle, --ts-var-button--primary-background

   Re-measure from a real capture with the drawer OPEN when one exists; the numbers
   above are the honest best reading of an image, not computed style.

   THE EMPTY STATE IS DELIBERATELY BARE. The screenshot shows the hero and the
   composer and nothing else, so there are no example-question chips here even
   though the standing architecture asks for a browsable question list. That list
   lives in `insightsQuestions.ts` and is surfaced behind "Need ideas?", which
   collapses by default so the resting state still matches the real page.
   ============================================================================= */

export interface InsightsCreateTileAiProps {
  open: boolean;
  profile: CustomerProfile;
  onClose: () => void;
  /** Called with a resolved template choice; the caller builds and registers it. */
  onCreate: (choice: TileChoices) => void;
}

interface Turn { q: string; choice: TileChoices | null }

export function InsightsCreateTileAi({
  open, profile, onClose, onCreate,
}: InsightsCreateTileAiProps) {
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ideas, setIdeas] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const categories = questionsFor(profile);

  /* Focus the field on open, after the slide, so the caret does not appear
     mid-transition. Matches how the Configuration drawer focuses its Name field. */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    const choice = resolveQuestion(profile, text);
    setTurns((t) => [...t, { q: text, choice }]);
    setValue("");
    inputRef.current?.focus();
  };

  const reset = () => { setTurns([]); setValue(""); inputRef.current?.focus(); };
  const empty = turns.length === 0;

  return (
    <>
      <div className={"icta-backdrop" + (open ? " icta-backdrop--on" : "")}
        onClick={onClose} aria-hidden="true" />
      <aside className={"icta" + (open ? " icta--open" : "")} role="dialog" aria-modal="true"
        aria-label="Create Tile with AI" inert={!open}>
        <div className="icta-head">
          <h1 className="icta-title">Create Tile with AI</h1>
          <button className="icta-close" type="button" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="icta-body">
          {empty ? (
            <div className="icta-hero">
              <h2 className="icta-hero-title">
                <AiSparkle />
                Create and Discover with AI
              </h2>
              <p className="icta-hero-sub">
                Use AI to quickly find insights and build dashboard tiles from your data.
                Simply enter a business question to get started.
              </p>
            </div>
          ) : (
            <ul className="icta-turns">
              {turns.map((t, i) => (
                <li className="icta-turn" key={i}>
                  <div className="icta-q">{t.q}</div>
                  {t.choice ? (
                    <div className="icta-a">
                      <p className="icta-a-line">
                        Here is a <strong>{t.choice.template}</strong> built from your data.
                      </p>
                      <p className="icta-a-why">{explainChoice(t.choice)}</p>
                      <button className="icta-add" type="button"
                        onClick={() => onCreate(t.choice as TileChoices)}>
                        Add to dashboard
                      </button>
                    </div>
                  ) : (
                    /* "I could not map that" is NOT the same as "I refused", and the
                       wording says which. Reporting confusion where the truth is a
                       failed match sends the SE off rewording a good question. */
                    <div className="icta-a icta-a--none">
                      <p className="icta-a-line">
                        I could not match that to a measure in this account's data.
                      </p>
                      <p className="icta-a-why">
                        Try naming a metric and a breakdown, for example
                        "Call Count by Marketing Medium".
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Not in the screenshot's resting state, so it stays collapsed. It exists
            because an SE cannot guess which of 121 measures this account has. */}
        <div className="icta-ideas">
          <button className="icta-ideas-toggle" type="button" onClick={() => setIdeas((v) => !v)}>
            <span className="material-icons">{ideas ? "expand_more" : "chevron_right"}</span>
            Need ideas?
          </button>
          {ideas && (
            <div className="icta-ideas-body">
              {categories.map((c) => (
                <div className="icta-cat" key={c.label}>
                  <div className="icta-cat-head">
                    <span className="material-icons">{c.icon}</span>{c.label}
                  </div>
                  <div className="icta-chips">
                    {c.questions.map((q) => (
                      <button className="icta-chip" type="button" key={q} onClick={() => ask(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="icta-composer">
          <button className="icta-reset" type="button" onClick={reset} disabled={empty}>
            <span className="material-icons">refresh</span>Reset
          </button>
          <div className="icta-field">
            <input ref={inputRef} className="icta-input" value={value}
              placeholder="Enter your question"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(value); }} />
            <button className="icta-send" type="button" onClick={() => ask(value)}
              disabled={!value.trim()} aria-label="Ask">
              <span className="material-icons">send</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/* The gradient sparkle, same treatment as the Add Tile picker's Build With AI icon:
   Material's auto_awesome path painted with a linearGradient rather than a flat
   fill. A flat purple looks plausible alone and clearly duller side by side. */
function AiSparkle() {
  return (
    <svg className="icta-sparkle" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="icta-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#66ebd7" />
          <stop offset="50%" stopColor="#7da3fb" />
          <stop offset="100%" stopColor="#a182e5" />
        </linearGradient>
      </defs>
      <path fill="url(#icta-grad)" d="m19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z" />
    </svg>
  );
}
