import { useEffect, useRef, useState } from "react";

/* =============================================================================
   WorkflowRowMenu — the kebab on a CREATED workflow's row
   -----------------------------------------------------------------------------
   Asked for 8/27/2026 alongside listing created workflows: "also be able to delete".

   ⚠️ **ONE COMPONENT, TWO PLACEMENTS** — the Agent Studio table and the editor's left
   sub-nav both carry this row. Two copies would drift on the first fix, and the symptom
   would be delete working in one place and not the other. Same reasoning as `isProspect`
   and `voiceCopy` moving out of the screens that first needed them.

   ⚠️ **CREATED ROWS ONLY.** The Voice and SMS rows are DERIVED from the prospect — there is
   nothing to delete, and offering it would either do nothing or appear to remove a workflow
   that comes back on the next render. The built-in rows keep their inert kebab, exactly as
   the capture shows them.

   ⚠️ **IT CONFIRMS FIRST.** Deleting is the one irreversible thing here, and in the sub-nav
   this kebab sits INSIDE the row's `<Link>`, one stray click from the row itself. The Launch
   screen's delete sets the same precedent (trash -> "are you sure" -> remove).
   ============================================================================= */

export function WorkflowRowMenu({
  name,
  onDelete,
  className,
}: {
  name: string;
  onDelete: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE, the trap the sidebar flyout, the Insights combobox
     and the Create Workflow dropdown all document: on bubble, the same click that closes the
     menu here would be seen by the kebab and reopen it. */
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  useEffect(() => {
    if (!open && !confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setConfirm(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirm]);

  /* ⚠️ **THE SUB-NAV ROW IS A `<Link>` WRAPPING EVERYTHING**, so every handler here has to
     stop the event or opening the menu navigates to the workflow underneath it. */
  const eat = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <span className={"wrm" + (className ? ` ${className}` : "")} ref={ref}>
      <button type="button" className="wrm-kebab material-icons" aria-label={`More options for ${name}`}
        onClick={(e) => { eat(e); setOpen((v) => !v); }}>
        more_vert
      </button>
      {open && (
        <span className="wrm-menu" role="menu">
          <button type="button" className="wrm-item wrm-del" role="menuitem"
            onClick={(e) => { eat(e); setOpen(false); setConfirm(true); }}>
            <span className="material-icons">delete_outline</span>Delete
          </button>
        </span>
      )}
      {confirm && (
        <span className="wrm-root" role="presentation">
          <span className="wrm-backdrop" onClick={(e) => { eat(e); setConfirm(false); }} />
          <span className="wrm-paper" role="dialog" aria-modal="true" aria-label="Delete workflow">
            <span className="wrm-title">Delete this workflow?</span>
            {/* Naming it is the point: this is the same care the admin delete dialog takes. */}
            <span className="wrm-body">
              <b>{name}</b> and anything configured on it will be removed. This cannot be undone.
            </span>
            <span className="wrm-actions">
              <button type="button" className="wrm-cancel"
                onClick={(e) => { eat(e); setConfirm(false); }}>Cancel</button>
              <button type="button" className="wrm-confirm"
                onClick={(e) => { eat(e); setConfirm(false); onDelete(); }}>Delete</button>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
