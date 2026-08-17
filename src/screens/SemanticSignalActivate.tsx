import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SEMANTIC_TEMPLATES } from "../data/semanticSignals";

/* =============================================================================
   SemanticSignalActivate — "New Semantic Signal", reached from the library's
   Activate button.
   -----------------------------------------------------------------------------
   Real page: /networks/1847/manage_signals/semantic_signal/new
              ?trackerId=146&standardDataFieldName=$.Ask+for+Appointment
   Measured off the LIVE page (8/14/2026), not guessed:

     left rail     296px, MUI vertical tabs, item min-height 48px, padding 12/16,
                   16px text, selected background rgb(212,224,254), 2px
                   rgb(38,102,249) indicator on the RIGHT edge, text never
                   uppercased (textTransform: none)
     h1            24px / weight 400 / rgb(21,36,62)
     field label   16px / weight 700 / rgb(21,36,62)
     text input    16px, padding 6px 8px, radius 3px, ~343px wide
     Phrases h2    20px / weight 700
     Save button   rgb(38,102,249), white, 14px / 500, padding 8px 12px, radius 3px

   THE LEFT RAIL SCROLLS, it does not swap panels. On the real page all three
   sections are on one long form and the tabs jump to them, which is why the
   whole form is rendered at once here and the rail is a scroll-spy rather than a
   router. Getting that wrong would look identical on load and behave wrong the
   moment anyone clicked.

   Nothing here is re-skinned per prospect: the stock library is identical in
   every Invoca account (see data/semanticSignals.ts), so the only thing the
   clicked card carries in is WHICH template.
   ============================================================================= */

const SECTIONS = [
  { id: "activation", label: "Activation" },
  { id: "phrases", label: "Phrases" },
  { id: "advanced", label: "Advanced Options" },
] as const;

export function SemanticSignalActivate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /* The real URL identifies the template by standardDataFieldName ("$.Ask for
     Appointment"), so that is what the Activate button passes and what a
     refresh or a shared link still resolves. Falls back to the first template
     rather than rendering an empty form. */
  const field = params.get("standardDataFieldName") ?? "";
  const wanted = field.replace(/^\$\./, "").trim();
  const tpl = useMemo(
    () => SEMANTIC_TEMPLATES.find((t) => t.name === wanted) ?? SEMANTIC_TEMPLATES[0],
    [wanted],
  );

  const [name, setName] = useState(tpl.name);
  const [desc, setDesc] = useState(tpl.body);
  const [campaigns, setCampaigns] = useState("All Campaigns");
  const [revenue, setRevenue] = useState("");
  const [tag, setTag] = useState("None");
  const [syndicated, setSyndicated] = useState(false);
  /* Every phrase starts enabled, exactly as the real page opens. */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  /* Switching template (a different card) must reset the form, or the previous
     signal's name and disabled phrases bleed into the next one. */
  useEffect(() => {
    setName(tpl.name); setDesc(tpl.body); setOff(new Set());
    setRevenue(""); setTag("None"); setSyndicated(false); setCampaigns("All Campaigns");
  }, [tpl]);

  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  /* The scrolling element is `.main` (AppShell), not the window: scrolling the
     window here moves nothing and the tabs would look inert. Resolved by walking
     up for a real overflow rather than hard-coding the class, so this still works
     if the shell changes. */
  const scroller = useCallback((): HTMLElement | null => {
    let el: HTMLElement | null = refs.current[SECTIONS[0].id];
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return null;
  }, []);

  function jumpTo(id: string) {
    const target = refs.current[id];
    const box = scroller();
    if (!target) return;
    setActive(id);
    if (!box) { target.scrollIntoView({ block: "start" }); return; }
    /* Offset by the container's own top so the heading lands just under it
       instead of behind it. */
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
    /* AN INSTANT JUMP, on purpose.

       Both animated routes were tried and both fail here: `scrollTo({behavior:
       "smooth"})` is a silent no-op on this container, CSS `scroll-behavior:
       smooth` additionally breaks plain `scrollTop` writes so nothing moves at
       all, and a rAF tween cannot be relied on either. A plain assignment is the
       one thing that provably always lands on the section, which is what the tabs
       are for. Clamped so the last section still selects when it sits inside the
       final viewport and cannot be scrolled to the top. */
    const max = box.scrollHeight - box.clientHeight;
    box.scrollTop = Math.max(0, Math.min(top, max));
  }

  /* SCROLL-SPY, so the rail reflects where you actually are. Without it the
     highlight only moves when clicked, and scrolling by hand leaves "Activation"
     selected while you read Advanced Options. */
  useEffect(() => {
    const onScroll = () => {
      /* Resolved on every event, not once. Resolving it in the effect ran before
         layout settled: nothing was yet taller than its container, no ancestor
         matched, the listener was never attached, and the rail silently stopped
         following the scroll. */
      const box = scroller();
      const top = box ? box.getBoundingClientRect().top : 0;
      let current: string = SECTIONS[0].id;   // widened: SECTIONS is `as const`
      for (const s of SECTIONS) {
        const el = refs.current[s.id];
        if (el && el.getBoundingClientRect().top - top <= 80) current = s.id;
      }
      /* AT THE BOTTOM, SELECT THE LAST SECTION.

         The final section starts inside the last viewport, so it can never be
         scrolled to the top and the rule above can never choose it: clicking
         "Advanced Options" jumped correctly and then the scroll event immediately
         re-selected "Phrases", which reads as the click having failed. Anchoring
         the end of the scroll to the last section is what makes the rail agree
         with what is on screen. */
      if (box && box.scrollTop >= box.scrollHeight - box.clientHeight - 4) {
        current = SECTIONS[SECTIONS.length - 1].id;
      }
      setActive(current);
    };
    /* CAPTURE at the document: scroll events do not bubble, so listening here is
       what catches them from whichever element actually scrolls, without having to
       know which one that is before layout exists. */
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [scroller]);

  const toggle = (p: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });

  const enabled = tpl.phrases.length - off.size;

  return (
    <div className="ssa-page">
      <div className="ssa-head">
        <h1 className="ssa-h1">New Semantic Signal</h1>
        <span className="ssa-about">
          <span className="material-icons">info</span>
          <a href="#about" onClick={(e) => e.preventDefault()}>About Activating Semantic Signals</a>
        </span>
      </div>

      <div className="ssa-body">
        <nav className="ssa-rail" role="tablist" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={active === s.id}
              className={"ssa-tab" + (active === s.id ? " ssa-tab-on" : "")}
              onClick={() => jumpTo(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="ssa-form">
          {/* ---- Activation ---- */}
          <div ref={(el) => { refs.current.activation = el; }}>
            <label className="ssa-label" htmlFor="ssa-name">Semantic Signal Name</label>
            <input id="ssa-name" className="ssa-input" value={name} maxLength={120}
              placeholder="Enter signal name" onChange={(e) => setName(e.target.value)} />

            <label className="ssa-label" htmlFor="ssa-desc">Description</label>
            <textarea id="ssa-desc" className="ssa-textarea" rows={4} value={desc}
              onChange={(e) => setDesc(e.target.value)} />

            <label className="ssa-label" htmlFor="ssa-campaigns">Apply this to</label>
            <select id="ssa-campaigns" className="ssa-select" value={campaigns}
              onChange={(e) => setCampaigns(e.target.value)}>
              <option>All Campaigns</option>
              <option>Selected Campaigns</option>
            </select>

            <div className="ssa-rule" />

            <p className="ssa-suggested">
              <b>Suggested Use:</b> {tpl.suggestedUse}
              <span className="material-icons ssa-i">info</span>
            </p>
          </div>

          {/* ---- Phrases ---- */}
          <div ref={(el) => { refs.current.phrases = el; }} className="ssa-section">
            <h2 className="ssa-h2">Phrases</h2>
            <p className="ssa-help">
              Phrases may be disabled by deselecting the checkbox next to each phrase.
              <br />
              Disabling phrases may impact the performance of the signal.
            </p>
            <ul className="ssa-phrases">
              {tpl.phrases.map((p) => (
                <li key={p}>
                  <label className="ssa-check">
                    <input type="checkbox" checked={!off.has(p)} onChange={() => toggle(p)} />
                    <span>{p}</span>
                  </label>
                </li>
              ))}
            </ul>
            {/* Not on the real page, but disabling phrases silently is worse than
                saying how many are left, and the help text above warns that it
                matters. */}
            {off.size > 0 && (
              <p className="ssa-count">{enabled} of {tpl.phrases.length} phrases enabled</p>
            )}
          </div>

          {/* ---- Advanced Options ---- */}
          <div ref={(el) => { refs.current.advanced = el; }} className="ssa-section">
            <h3 className="ssa-h3">Advanced Options</h3>

            <label className="ssa-label" htmlFor="ssa-rev">
              Auto Applied Revenue <span className="material-icons ssa-i">info</span>
            </label>
            <div className="ssa-money">
              <span className="ssa-money-sign">$</span>
              <input id="ssa-rev" className="ssa-input ssa-input-money" value={revenue}
                placeholder="Ex. 100.00" inputMode="decimal"
                onChange={(e) => setRevenue(e.target.value)} />
            </div>

            <label className="ssa-label" htmlFor="ssa-tag">
              Tag this Signal <span className="material-icons ssa-i">info</span>
            </label>
            <select id="ssa-tag" className="ssa-select ssa-select-wide" value={tag}
              onChange={(e) => setTag(e.target.value)}>
              <option>None</option>
              <option>Conversion</option>
              <option>Quality</option>
              <option>Segmentation</option>
            </select>

            <p className="ssa-label ssa-label-plain">Syndication</p>
            <label className="ssa-check ssa-check-loose">
              <input type="checkbox" checked={syndicated} onChange={() => setSyndicated((v) => !v)} />
              <span>Allow this signal to be shared across accounts.</span>
            </label>
          </div>
        </div>
      </div>

      <div className="ssa-foot">
        <button className="ssa-back" onClick={() => navigate("/signal/new/semantic")}>Back</button>
        <span className="ssa-foot-right">
          <button className="ssa-cancel" onClick={() => navigate("/signal/new/semantic")}>Cancel</button>
          {/* An activated signal lives in Manage Signals, so that is where this
              lands rather than back on the library it came from. */}
          <button className="ssa-save" onClick={() => navigate("/signal")}>Save &amp; Activate</button>
        </span>
      </div>
    </div>
  );
}
