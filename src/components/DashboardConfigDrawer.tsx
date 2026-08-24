import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomerProfile } from "../data/schema";
import {
  defaultFor, marketingFieldOptions, metricOptions, type DashboardTemplate,
} from "../data/dashboardTemplates";

/* =============================================================================
   "Dashboard Configuration" — what clicking a DASHBOARD TEMPLATES card opens.
   -----------------------------------------------------------------------------
   Measured off the live page 8/24/2026, drawer open, every value read off the rendered
   DOM (Invoca's own React, same-origin, so no screenshot guessing):

     backdrop   rgba(0,0,0,.5)
     paper      800 wide, anchored RIGHT, white, elevation16,
                  transform 225ms cubic-bezier(0,0,.2,1)
     content    padding 24, scrolls; footer is a sibling, so it never scrolls away
     title      "Dashboard Configuration", Lato 20/28 #15243E
     Name       label 16/23, field 752 x 35, radius 3
     lede       "Select the data that best fits these categories.", 16/20
     category   label 700 16/20 (28 tall) · field 750 x 35 · help ITALIC 16/20 (24 tall)
     between    40px from one category's help to the next label
     footer     62 tall, padding 12px 24px, buttons right, 36 tall
     Cancel     outlined white, 1px rgba(38,102,249,.5), ink #2666F9
     Save       DISABLED on open: #E7E9EB on #A1A7B2
     dropdown   750 wide, max-height 374.4, radius 3, padding 8px 0,
                  option 32 tall, padding 6px 16px, 16/20
   ============================================================================= */

/* ⚠️ ITS OWN PREFIX (`.dcd-`), NOT the tile Configuration drawer's `.itc-`. Those two
   drawers are different screens with different measurements — this paper is 800 wide
   where that one is 452 — and the one-prefix-per-screen rule exists because the last
   two drawers that shared a prefix silently overrode each other's field widths. */
function OptionPicker({ value, options, onPick }: {
  value: string; options: string[]; onPick: (o: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const shown = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="dcd-combo" ref={wrap}>
      {/* ⚠️ TOGGLE ON MOUSEDOWN AND DO NOT OPEN ON FOCUS — the event order is
          mousedown -> focus -> click, so a focus handler opens the list and the click
          handler shuts it again, and the first click looks dead. Recorded twice already
          in this repo; the same contract as the tile Configuration drawer. */}
      <div className={"dcd-combo-field" + (open ? " dcd-combo-field--open" : "")}
        onMouseDown={() => setOpen((v) => !v)}>
        <input className="dcd-combo-input" value={open ? q : value} readOnly={!open}
          role="combobox" aria-expanded={open}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          /* A keyboard user gets no mousedown. */
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); setOpen(true); }
          }} />
        <span className="material-icons dcd-combo-caret">
          {open ? "arrow_drop_up" : "arrow_drop_down"}
        </span>
      </div>
      {open && (
        <div className="dcd-pop" role="listbox">
          {shown.map((o) => (
            <div key={o} role="option" aria-selected={o === value}
              className={"dcd-opt" + (o === value ? " dcd-opt--on" : "")}
              onMouseDown={(e) => { e.preventDefault(); onPick(o); setQ(""); setOpen(false); }}>
              {o}
            </div>
          ))}
          {shown.length === 0 && <div className="dcd-opt dcd-opt--empty">No match</div>}
        </div>
      )}
    </div>
  );
}

export function DashboardConfigDrawer({ template, profile, dashboardName, onCancel, onSave }: {
  /** null when closed. */
  template: DashboardTemplate | null;
  profile: CustomerProfile;
  /** The Name field opens pre-filled with the dashboard's own name, as the live one does. */
  dashboardName: string;
  onCancel: () => void;
  onSave: (name: string, picks: Record<string, string>) => void;
}) {
  const fields = template?.fields ?? [];
  const signals = useMemo(() => metricOptions(profile), [profile]);
  const marketing = useMemo(() => marketingFieldOptions(profile), [profile]);
  const optionsFor = (source: "signal" | "marketing") => (source === "signal" ? signals : marketing);

  const [name, setName] = useState(dashboardName);
  const [picks, setPicks] = useState<Record<string, string>>({});

  /* Re-seed whenever a different template opens, or the second card to be opened shows
     the first one's answers. */
  useEffect(() => {
    if (!template?.fields) return;
    setName(dashboardName);
    setPicks(Object.fromEntries(
      template.fields.map((f) => [f.label, defaultFor(f, optionsFor(f.source))]),
    ));
    /* optionsFor is derived from `profile`, which is in the deps via signals/marketing. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, dashboardName, signals, marketing]);

  useEffect(() => {
    if (!template) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [template, onCancel]);

  if (!template?.fields) return null;

  /* ⚠️ SAVE IS DISABLED UNTIL EVERY CATEGORY IS ANSWERED. Measured: the live Save is
     `disabled` with four of five empty. Whether ONE empty category is enough to disable
     it is not measured — five-of-five is the reading that matches the sample and the
     drawer's own instruction to pick data for "these categories". */
  const complete = name.trim().length > 0 && fields.every((f) => picks[f.label]);

  return (
    <div className="dcd-root" role="presentation">
      <div className="dcd-backdrop" onClick={onCancel} />
      <div className="dcd-paper" role="dialog" aria-modal="true" aria-label="Dashboard Configuration">
        {/* The body scrolls and the footer does not, which is why they are siblings
            rather than the footer sitting at the end of the scrolling content. */}
        <div className="dcd-body">
          <h2 className="dcd-title">Dashboard Configuration</h2>

          <span className="dcd-name-label">Name</span>
          <input className="dcd-name" value={name} onChange={(e) => setName(e.target.value)} />

          <p className="dcd-lede">Select the data that best fits these categories.</p>

          {fields.map((f) => (
            <div className="dcd-field" key={f.label}>
              <span className="dcd-label">{f.label}</span>
              <OptionPicker value={picks[f.label] ?? ""} options={optionsFor(f.source)}
                onPick={(o) => setPicks((p) => ({ ...p, [f.label]: o }))} />
              <span className="dcd-help">{f.help}</span>
            </div>
          ))}
        </div>

        <div className="dcd-foot">
          <button type="button" className="dcd-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="dcd-save" disabled={!complete}
            onClick={() => complete && onSave(name.trim(), picks)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
