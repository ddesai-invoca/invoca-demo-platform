import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CenterModal from "./CenterModal";

/* =============================================================================
   EventSheetButton — connect an event's Google Sheet, from the Launch screen
   -----------------------------------------------------------------------------
   Asked for 10/8/2026 when the three options were put to the user: the sheet's
   address is **pasted in the app**, not set as an env var, so a second event gets
   its own sheet with no deploy and nobody needs Render access.

   ⚠️⚠️ **THE URL IS A SECRET AND THE SERVER DECIDES WHO SEES IT.** Anyone holding a
   deployed Apps Script /exec address can append to that sheet, so `GET /api/events`
   returns the address only to an admin and `PUT` refuses a non-admin outright. This
   component hides the control for everybody else — hidden rather than disabled, the
   same call the share button makes, because a greyed control invites "why not me?".
   A non-admin still sees the quiet "Sheet connected" chip, because an SE marking a
   demo deserves to know whether their rows are being recorded.
   ============================================================================= */

/** Where the script lives. ⚠️ ONE COPY, SERVED FROM `public/` — inlining it here
 *  would put a second version in the bundle, free to drift from the one the user
 *  actually pastes into their sheet. */
const SCRIPT_URL = "/event-sheet.gs";

export interface EventSheetState {
  key: string;
  wired: boolean;
  sheetWebhookUrl?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export default function EventSheetButton({
  event, label, admin, state, onSaved,
}: {
  event: string;
  label: string;
  admin: boolean;
  state?: EventSheetState;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Reopen shows what is stored, not whatever was typed last time. */
  useEffect(() => {
    if (open) { setUrl(state?.sheetWebhookUrl ?? ""); setErr(null); setCopied(false); }
  }, [open, state?.sheetWebhookUrl]);

  if (!admin) {
    return state?.wired
      ? <span className="evs-chip" title="Marks on this event are written to a Google Sheet">
          <span className="material-icons">table_chart</span>Sheet connected
        </span>
      : null;
  }

  async function save(next: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(event)}/sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || "That could not be saved."); return; }
      onSaved();
      setOpen(false);
    } catch {
      setErr("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function copyScript() {
    try {
      const text = await fetch(SCRIPT_URL).then((r) => r.text());
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* ⚠️ Clipboard access is refused outright in some contexts, so the link below
         is always there as the way through rather than this being the only route. */
      setErr("Could not copy — use “Open the script” and copy it from there.");
    }
  }

  return (
    <>
      <button
        type="button"
        className={"evs-trigger" + (state?.wired ? " evs-trigger--on" : "")}
        title={state?.wired ? "This event writes to a Google Sheet" : "Connect a Google Sheet to this event"}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <span className="material-icons">table_chart</span>
        {state?.wired ? "Sheet connected" : "Connect a sheet"}
      </button>

      {open && createPortal(
        <CenterModal
          title={label}
          width={620}
          onClose={() => setOpen(false)}
          footer={
            <>
              {state?.wired && (
                <button type="button" className="evs-unlink" disabled={busy}
                  onClick={() => save("")}>Disconnect</button>
              )}
              <button type="button" className="dmk-submit" disabled={busy || url.trim() === (state?.sheetWebhookUrl ?? "")}
                onClick={() => save(url)}>{busy ? "Saving…" : "Save"}</button>
            </>
          }
        >
          <div className="evs-body">
            <p className="evs-lede">
              Every time an SE submits the demo notes for a prospect in this event, a row is
              written here — one row per prospect, updated in place when the notes change.
            </p>
            <ol className="evs-steps">
              <li>Open the Google Sheet you want the rows in.</li>
              <li><strong>Extensions &rsaquo; Apps Script</strong>, then paste in the script.</li>
              <li><strong>Deploy &rsaquo; New deployment &rsaquo; Web app</strong> — execute as
                <strong> Me</strong>, access <strong>Anyone</strong>.</li>
              <li>Paste the <code>/exec</code> address it gives you below.</li>
            </ol>
            <div className="evs-script">
              <button type="button" className="evs-ghost" onClick={copyScript}>
                <span className="material-icons">content_copy</span>{copied ? "Copied" : "Copy the script"}
              </button>
              <a className="evs-ghost" href={SCRIPT_URL} target="_blank" rel="noopener noreferrer">
                <span className="material-icons">open_in_new</span>Open the script
              </a>
            </div>
            <label className="evs-label" htmlFor="evs-url">Web app URL</label>
            <input
              id="evs-url"
              ref={inputRef}
              className="evs-input"
              value={url}
              placeholder="https://script.google.com/macros/s/…/exec"
              spellCheck={false}
              onChange={(e) => { setUrl(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) save(url); }}
            />
            {/* ⚠️ The server validates this too, and its answer is the one that counts —
                this is a hint while typing, not the gate. */}
            <div className="evs-hint">
              Anyone with this address can append to the sheet, so it is stored server-side and
              shown only to admins. Re-deploy the script to rotate it.
            </div>
            {state?.updatedBy && (
              <div className="evs-hint">
                Last changed by {state.updatedBy}
                {state.updatedAt ? ` on ${new Date(state.updatedAt).toLocaleDateString()}` : ""}.
              </div>
            )}
            {err && <div className="evs-err">{err}</div>}
          </div>
        </CenterModal>,
        document.body,
      )}
    </>
  );
}
