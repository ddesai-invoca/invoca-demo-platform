import { useEffect, useRef, useState } from "react";

/* =============================================================================
   "New Dashboard" — what the + New button on Insights & Analytics opens.
   -----------------------------------------------------------------------------
   Measured off the capture (8/23/2026), every value read off the rendered dialog:

     backdrop      rgba(0,0,0,.5)
     paper         500 x 422, white, radius 3, MUI elevation shadow
     title         "New Dashboard", Lato 20/400 #15243E, at 12,12
     divider       1px #E7E9EB under the title band; content starts at y=52
     label         Lato 16/700 #15243E, 2px below itself
     field         384 wide, radius 3, 1px #E7E9EB
                     Name        40 tall, padding 8.5px 14px
                     Description 56 tall, padding 16.5px 14px
     footer        buttons 36 tall at y=374

   ⚠️ THE TWO BUTTONS ARE THE PLATFORM'S PAIR, not new values: Cancel is OUTLINED
   white (`1px rgba(38,102,249,.5)`, ink `#2666F9`) and a disabled primary is
   `#E7E9EB` on `#A1A7B2` — the same measurements Verify Labels already records.
   ⚠️ CREATE IS DISABLED UNTIL THE NAME HAS CONTENT. Measured: the capture's Create is
   `disabled` with both fields empty. Description is optional.
   ============================================================================= */

export function NewDashboardModal({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  /* Focus the first field on open, and let Escape close — a modal that traps the
     keyboard with no way out reads as broken mid-demo. */
  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canCreate = name.trim().length > 0;
  const submit = () => { if (canCreate) onCreate(name, desc); };

  return (
    /* Clicking the backdrop cancels, which is what a MUI dialog does; the click is
       stopped on the paper so a click inside never closes it. */
    <div className="ndm-backdrop" onClick={onCancel} role="presentation">
      <div className="ndm-paper" role="dialog" aria-modal="true" aria-label="New Dashboard"
        onClick={(e) => e.stopPropagation()}>
        <p className="ndm-title">New Dashboard</p>

        <div className="ndm-body">
          <label className="ndm-label" htmlFor="ndm-name">Name</label>
          <input id="ndm-name" ref={nameRef} className="ndm-field" type="text"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />

          <label className="ndm-label ndm-label--desc" htmlFor="ndm-desc">Description</label>
          {/* A `textarea`, where the capture uses a 56px-tall input: the control is two
              lines high and holds a sentence, so a textarea is the honest element for it
              and behaves the same at this size. */}
          <textarea id="ndm-desc" className="ndm-field ndm-field--desc"
            value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>

        <div className="ndm-foot">
          <button type="button" className="ndm-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="ndm-create" disabled={!canCreate} onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
