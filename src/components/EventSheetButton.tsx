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
  /** The simple path: a real Google Sheet, written with the connector's grant. */
  sheetUrl?: string;
  sheetTitle?: string;
  sheetOwner?: string;
  /** The fallback: an Apps Script web app. */
  sheetWebhookUrl?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export default function EventSheetButton({
  event, label, admin, connected, connectedAs, state, onSaved,
}: {
  event: string;
  label: string;
  admin: boolean;
  /** Whether THIS admin has granted Sheets access — decides Connect vs the paste field. */
  connected: boolean;
  connectedAs?: string;
  state?: EventSheetState;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [hook, setHook] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* A restyle reports in place rather than closing, so it needs a channel of its own. */
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Reopen shows what is stored, not whatever was typed last time. */
  useEffect(() => {
    if (open) {
      setUrl(state?.sheetUrl ?? "");
      setHook(state?.sheetWebhookUrl ?? "");
      setErr(null); setCopied(false);
    }
  }, [open, state?.sheetUrl, state?.sheetWebhookUrl]);

  if (!admin) {
    return state?.wired
      ? <span className="evs-chip" title="Marks on this event are written to a Google Sheet">
          <span className="material-icons">table_chart</span>Sheet connected
        </span>
      : null;
  }

  async function put(path: string, payload: unknown) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(event)}/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || "That could not be saved."); return; }
      onSaved();
      /* ⚠️ A sheet that connected but could not be FORMATTED must say so and stay open.
         Closing on success would hide it, and the whole point of styling at connect time
         is that this is the moment somebody is looking at the sheet. */
      if (body?.styled === false) {
        setErr("Connected, but the formatting could not be applied. Try Restyle sheet.");
        return;
      }
      setOpen(false);
    } catch {
      setErr("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ⚠️⚠️ **IT STAYS OPEN AND REPORTS, WHERE `put` CLOSES.** The whole reason this action
   * exists is that a background styling failure says nothing; a version that closed the
   * dialog on success would reintroduce exactly that for the case it was built to expose.
   * Success names the tabs it styled, failure shows what Google actually said.
   */
  async function restyle() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(event)}/restyle`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || "That sheet could not be styled."); return; }
      const tabs: string[] = body?.tabs ?? [];
      setNote(tabs.length ? `Restyled ${tabs.join(" and ")}.` : "Nothing to style yet.");
    } catch {
      setErr("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  const saveLink = (next: string, create = false) =>
    put("sheet-link", create ? { create: true, title: label } : { url: next });
  const saveHook = (next: string) => put("sheet", { url: next });

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
                  /* ⚠️ Clears BOTH, so "disconnected" means it. Leaving the other set
                     would keep rows flowing somewhere the admin believes is off. */
                  onClick={() => { void saveLink(""); void saveHook(""); }}>Disconnect</button>
              )}
              <button type="button" className="dmk-submit"
                disabled={busy || !connected || url.trim() === (state?.sheetUrl ?? "")}
                onClick={() => void saveLink(url)}>{busy ? "Saving…" : "Save"}</button>
            </>
          }
        >
          <div className="evs-body">
            <p className="evs-lede">
              Every time somebody submits the demo notes for a prospect in this event, a row is
              written here — one row per prospect, updated in place when the notes change.
            </p>

            {/* ⚠️⚠️ **THE WHOLE FLOW IS A PASTED LINK (10/8/2026).** Reported: *"connecting
                a sheet is too complicated for not technical people… ideally all i want users
                to do is paste the google sheet URL."* The grant is asked for ONCE, by this
                admin, and every later event is URL-only — other SEs do nothing, because
                their marks are written with this grant rather than their own. */}
            {!connected ? (
              <div className="evs-connect">
                <p>
                  Connect Google once and you can point any event at a sheet just by pasting
                  its link. Everyone else's demo notes are written with your connection, so
                  they do not have to do anything.
                </p>
                <a className="dmk-submit evs-connect-btn" href="/auth/sheets">Connect Google Sheets</a>
              </div>
            ) : (
              <>
                <label className="evs-label" htmlFor="evs-url">Google Sheet link</label>
                <input
                  id="evs-url"
                  ref={inputRef}
                  className="evs-input"
                  value={url}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  spellCheck={false}
                  onChange={(e) => { setUrl(e.target.value); setErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !busy) void saveLink(url); }}
                />
                <div className="evs-row">
                  <button type="button" className="evs-ghost" disabled={busy}
                    onClick={() => void saveLink("", true)}>
                    <span className="material-icons">add</span>Or create one for this event
                  </button>
                  {state?.sheetTitle && (
                    <a className="evs-ghost" href={state.sheetUrl} target="_blank" rel="noopener noreferrer">
                      <span className="material-icons">open_in_new</span>{state.sheetTitle}
                    </a>
                  )}
                  {state?.wired && state?.sheetUrl && (
                    <button type="button" className="evs-ghost" disabled={busy}
                      title="Re-apply the Invoca formatting to both tabs now"
                      onClick={() => void restyle()}>
                      <span className="material-icons">format_paint</span>Restyle sheet
                    </button>
                  )}
                </div>
                {/* ⚠️⚠️ **IT MUST NAME THE ACCOUNT THAT ACTUALLY WRITES, WHICH IS THE ONE
                    THAT CONNECTED THIS EVENT — not whoever is reading the dialog.** Asked
                    directly: *"does that mean that i need to be added to even other people
                    sheets, or is that saying ddesai@invoca.com because that is my account"* —
                    and the first version said `me.email` unconditionally, so a second admin
                    opening an event somebody else wired was told to check THEIR access while
                    the rows went through the original connector's grant. One fact, two
                    sources: `sheetOwner` is what `sheetHook` writes with, so it is what this
                    reads. Falls back to the signed-in account only when nothing is connected
                    yet, because then they ARE the one about to become the owner. */}
                {state?.sheetOwner && state.sheetOwner !== connectedAs ? (
                  <div className="evs-hint">
                    Rows are written with <strong>{state.sheetOwner}</strong>'s connection, set up
                    when this event was wired — so that account needs edit access, not yours.
                    Saving a new link here switches it to {connectedAs ?? "your account"}.
                  </div>
                ) : (
                  <div className="evs-hint">
                    Rows are written with your connection ({connectedAs ?? "your account"}), so
                    that account needs edit access to this one sheet. Nobody else does — everyone
                    else's demo notes go through it too.
                  </div>
                )}
              </>
            )}

            {/* ⚠️ THE APPS SCRIPT PATH SURVIVES AS A FALLBACK, COLLAPSED. It needs no Google
                grant at all, which is the only thing that works for an org that will not
                enable the scope — but it is four steps including a code editor, so it must
                not be the first thing a non-technical SE meets. */}
            <details className="evs-alt">
              <summary>Can't connect Google? Use a script instead</summary>
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
              <input
                className="evs-input"
                value={hook}
                placeholder="https://script.google.com/macros/s/…/exec"
                spellCheck={false}
                onChange={(e) => { setHook(e.target.value); setErr(null); }}
              />
              <button type="button" className="evs-ghost" disabled={busy}
                onClick={() => void saveHook(hook)}>Use this script URL</button>
            </details>

            {state?.updatedBy && (
              <div className="evs-hint">
                Last changed by {state.updatedBy}
                {state.updatedAt ? ` on ${new Date(state.updatedAt).toLocaleDateString()}` : ""}.
              </div>
            )}
            {err && <div className="evs-err">{err}</div>}
            {note && <div className="evs-note">{note}</div>}
          </div>
        </CenterModal>,
        document.body,
      )}
    </>
  );
}
