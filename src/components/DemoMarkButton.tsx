/* =============================================================================
   DemoMarkButton — "I delivered this one", from the library row
   -----------------------------------------------------------------------------
   Asked for by an SE who gave ~25 demos in a day at the Dallas Summit and could
   not afterwards reconstruct who to follow up with. So the design constraint is
   SPEED AT VOLUME, not completeness: one click from the row they are already
   scrolling, no navigation, no required fields.

   ⚠️⚠️ **THE ROW IS THE SURFACE BECAUSE OPENING EACH DEMO TO MARK IT WOULD NOT
   HAPPEN.** Twenty-five demos means twenty-five loads of a heavy profile to click
   one button. The Launch list already groups the Summit roster under its own
   dropdown, which is exactly the set being worked through.

   ⚠️ **EVERY HANDLER STOPS PROPAGATION.** The row itself has an `onClick` that
   OPENS the demo, so a click that reaches it costs a full profile load and throws
   the SE onto a dashboard mid-conference. Verified on the popover too, not only
   the trigger.
   ============================================================================= */

import { useRef, useState } from "react";
import CenterModal from "./CenterModal";
import { useDemoLibrary, type MarkStatus, type NotifyResult, type RepLookup } from "../data/DemoLibraryContext";
/* ⚠️ Labels and the offered set come from the one shared module — this component
   used to declare its own copy, which is how it kept offering statuses the server
   had stopped accepting. `MARK_STATUSES` is the WRITE set, so a retired status is
   rendered on the flag (via MARK_LABEL) but can never be chosen again. */
import { MARK_STATUSES, MARK_LABEL as LABEL } from "../data/markStatus";

export default function DemoMarkButton({ demoId, name }: { demoId: string; name: string }) {
  const { markFor, setMark, lookupRep, gmailStatus } = useDemoLibrary();
  const mark = markFor(demoId);
  const [open, setOpen] = useState(false);
  /* ⚠️⚠️ **NOTHING SAVES UNTIL SUBMIT (10/7/2026).** Picking a status used to write
     immediately and close, so there was no moment at which a note and a status
     existed together — the note had to be typed first and committed by Enter, which
     is not discoverable. The panel now holds a DRAFT and `submit()` is the only
     writer, which is also what makes the note worth enlarging. */
  const [draft, setDraft] = useState<MarkStatus | null>(null);
  const [note, setNote] = useState("");
  /* ⚠️⚠️ **OFF BY DEFAULT, AND THAT IS THE FEATURE.** Marking happens ~25 times
     in an afternoon; a notification on every one is a burst a colleague filters
     away, and one stray click would tell them about an account that is not
     theirs. So telling the AE is a second, deliberate action. */
  const [notify, setNotify] = useState(false);
  const [rep, setRep] = useState<RepLookup | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  /* What actually happened to the email, shown in place after committing —
     "the panel closed" is not evidence anybody was told. */
  const [sent, setSent] = useState<NotifyResult | null>(null);
  const [saving, setSaving] = useState(false);
  /* Whether THIS SE has connected their own mailbox. Null while unknown, so the
     row says nothing rather than flashing "not connected" and correcting itself. */
  const [gmail, setGmail] = useState<{ connected: boolean; address: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  /* ⚠️⚠️ **NO ANCHORING, AND THAT IS WHY ~60 LINES WENT.** This used to measure the
     trigger, flip above it when there was no room below, re-place on a rAF once the
     real height was known, re-place again from a ResizeObserver when a rep lookup
     grew it, and listen for scroll in the capture phase. Every one of those fixed a
     real bug — a `position: fixed` panel hanging past the viewport cannot be
     scrolled to. A CENTRED modal cannot have that bug, so the defence is gone with
     the defect. `CenterModal` owns the backdrop, Escape and `data-picker-safe`. */

  function toggle(ev: React.MouseEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    setNote(mark?.note ?? "");
    /* ⚠️ A RETIRED status cannot be re-selected, so a legacy mark opens with no
       status chosen rather than with a button that does not exist highlighted.
       Submit then requires a deliberate pick, which is the honest outcome. */
    setDraft(mark && (MARK_STATUSES as readonly string[]).includes(mark.status) ? (mark.status as MarkStatus) : null);
    /* Every opening starts clean: an outcome left over from the last demo marked
       would read as a report about THIS one. */
    setNotify(false);
    setRep(null);
    setPicked(null);
    setSent(null);
    setOpen((v) => !v);
  }

  /* ⚠️ THE LOOKUP FIRES ON THE TICK, NOT ON OPEN. It is a live SOQL query, and
     opening a flag to read a note must not spend one — nor should scrolling a
     76-row roster with a stray click in it. */
  async function toggleNotify(on: boolean) {
    setNotify(on);
    if (!on || rep || repLoading) return;
    setRepLoading(true);
    /* Both questions at once — who to tell, and which mailbox it would leave
       from. They are independent, and asking in sequence would show the panel
       growing twice. */
    const [r, g] = await Promise.all([lookupRep(demoId), gmailStatus()]);
    setRepLoading(false);
    setRep(r ?? { domain: "", rep: null, candidates: [], reason: "Could not reach the server." });
    setGmail(g);
  }

  async function submit() {
    if (!draft || saving) return;
    setSaving(true);
    const r = await setMark(
      demoId,
      draft,
      note.trim() || undefined,
      notify ? { accountId: picked ?? undefined } : undefined,
    );
    setSaving(false);
    /* ⚠️ THE PANEL STAYS OPEN WHEN SOMETHING WAS MEANT TO BE SENT, because this is
       the one moment the SE needs to know WHO was told — or why nobody was. With
       notify off it closes immediately, exactly as before. */
    if (r.ok && notify) setSent(r.notified ?? { sent: false, reason: "The server said nothing about the email." });
    else setOpen(false);
  }

  /* Selects only. The write is `submit()`. */
  function choose(ev: React.MouseEvent, status: MarkStatus) {
    ev.stopPropagation();
    setDraft((cur) => (cur === status ? null : status));
  }

  async function clear(ev: React.MouseEvent) {
    ev.stopPropagation();
    setOpen(false);
    await setMark(demoId, null);
  }

  /* Several owners matched the domain — ask, never guess. Choosing one only
     names WHICH candidate; the server still resolves the address itself. */
  const ambiguous = !!rep && !rep.rep && rep.candidates.length > 0;
  const chosen = rep?.rep ?? rep?.candidates.find((c) => c.accountId === picked) ?? null;

  return (
    <>
      <button
        ref={btnRef}
        className={"dmk-btn" + (mark ? ` dmk-btn--on dmk-${mark.status}` : "")}
        title={mark ? `${LABEL[mark.status]} — click to change` : `Mark ${name} as delivered`}
        aria-label={mark ? `${name}: ${LABEL[mark.status]}` : `Mark ${name} as delivered`}
        onClick={toggle}
      >
        <span className="material-icons">{mark ? "flag" : "outlined_flag"}</span>
        {mark && <span className="dmk-btn-label">{LABEL[mark.status]}</span>}
      </button>

      {open && (
        <CenterModal
          title={name}
          width={600}
          onClose={() => setOpen(false)}
          /* ⚠️ The actions sit in the footer so the primary button is anchored
             while the rep-lookup results grow the body above it. */
          footer={
            <>
              {mark && (
                <button type="button" className="dmk-clear" onClick={(e) => void clear(e)}>Remove mark</button>
              )}
              <button
                type="button"
                className="dmk-submit"
                disabled={!draft || saving}
                title={draft ? undefined : "Pick a status first"}
                onClick={(e) => { e.stopPropagation(); void submit(); }}
              >
                {saving ? "Saving…" : "Submit"}
              </button>
            </>
          }
        >
          {/* ⚠️ A LABEL ON EACH GROUP. Three unlabelled buttons and a bare box read
              as a form you have to decode; naming them costs one line each and is
              what makes the dialog scannable at conference pace. */}
          <div className="dmk-label">How did it go?</div>
          <div className="dmk-opts">
            {MARK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={"dmk-opt dmk-" + s + (draft === s ? " dmk-opt--on" : "")}
                aria-pressed={draft === s}
                disabled={saving}
                onClick={(e) => choose(e, s)}
              >
                {/* ⚠️ The dot is what makes an UNSELECTED row meaningful. Without it
                    the three are identical white rectangles and the colour only
                    appears after you have already chosen — too late to help. */}
                <span className="dmk-dot" aria-hidden="true" />
                {LABEL[s]}
              </button>
            ))}
          </div>
          {/* ⚠️ A TEXTAREA, NOT AN INPUT (10/7/2026): asked for directly, because a
              one-line box is hard to take notes in. `maxLength` stays 280 — the
              store and the notification email are both built around a short note —
              and the box SCROLLS past that rather than growing without limit.
              ⚠️ Enter inserts a newline now; it used to commit, which a multi-line
              box cannot also mean. Cmd/Ctrl+Enter submits, the usual pairing. */}
          <div className="dmk-label dmk-label--notes">
            <span>Notes</span>
            {/* A quiet counter: the cap is 280 and hitting it silently is the
                kind of thing you only notice after losing a sentence. */}
            <span className={"dmk-count" + (note.length > 240 ? " dmk-count--near" : "")}>
              {note.length}/280
            </span>
          </div>
          <textarea
            className="dmk-note"
            value={note}
            placeholder="Optional — who you met, what they asked for"
            maxLength={280}
            rows={4}
            onChange={(e) => setNote(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />

          {/* ⚠️ THE NOTIFY ROW IS A SECOND, DELIBERATE ACTION — see the note on
              `notify` above. It names the person BEFORE anything is sent, because
              "email the rep" without saying which rep is a click nobody should
              have to take on trust. */}
          <label className="dmk-notify" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => { e.stopPropagation(); void toggleNotify(e.target.checked); }}
            />
            <span>Notify the Rep</span>
          </label>

          {notify && (
            <div className="dmk-rep">
              {repLoading && <span className="dmk-rep-msg">Looking up Salesforce…</span>}

              {!repLoading && chosen && (
                <span className="dmk-rep-msg dmk-rep-ok">
                  <span className="material-icons">mail_outline</span>
                  Emails <strong>{chosen.ownerName}</strong>
                  {/* ⚠️ The manager is NAMED before anything is sent, for the same
                      reason the rep is: copying somebody in without saying who is a
                      click nobody should have to take on trust. Salesforce lists no
                      manager for plenty of reps, and that says so rather than
                      implying one was told. */}
                  {chosen.managerName
                    ? <> and their manager <strong>{chosen.managerName}</strong></>
                    : <> (no manager listed in Salesforce)</>}
                  {" — "}{chosen.accountName}
                </span>
              )}

              {/* ⚠️ SEVERAL OWNERS MATCHED THE DOMAIN, SO IT ASKS. Duplicate accounts
                  with different owners are real (measured: two "Aptive Environmental"
                  records owned by two different AEs), and guessing there tells the
                  wrong colleague about an account that is not theirs. */}
              {!repLoading && ambiguous && !chosen && (
                <>
                  <span className="dmk-rep-msg">{rep?.reason} Pick one:</span>
                  {rep?.candidates.map((c) => (
                    <button
                      key={c.accountId}
                      className="dmk-rep-pick"
                      onClick={(e) => { e.stopPropagation(); setPicked(c.accountId); }}
                    >
                      <strong>{c.ownerName}</strong> · {c.accountName}
                    </button>
                  ))}
                </>
              )}

              {!repLoading && !chosen && !ambiguous && rep && (
                <span className="dmk-rep-msg dmk-rep-no">{rep.reason}</span>
              )}

              {/* ⚠️⚠️ **NO CONNECT STEP — the grant rides the ordinary sign-in**
                  (see googleAuth's /auth/login). Asked for directly: *"it should
                  automatically just be sent as that user, they dont need to click
                  anything"*. So the normal case simply STATES the sender rather
                  than asking for anything.
                  ⚠️ The second branch is TRANSITIONAL, not a gate: somebody whose
                  session predates the widened scope has no token yet, and it
                  heals itself the next time they sign in. It says so instead of
                  demanding a click, and the link is a shortcut for anyone who
                  wants it now. */}
              {!repLoading && gmail && chosen && (
                gmail.connected ? (
                  <span className="dmk-rep-msg">Sends from you ({gmail.address}).</span>
                ) : (
                  <span className="dmk-rep-msg">
                    Sends from the platform mailbox until your next sign-in.{" "}
                    <a
                      className="dmk-rep-link"
                      href="/auth/gmail-connect"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Fix now
                    </a>
                  </span>
                )
              )}
            </div>
          )}

          {/* What actually happened, reported in place. A closed panel is not
              evidence a colleague was told, and `sendMail` legitimately declines
              on a non-production server or with no mailer configured. */}
          {sent && (
            <div className={"dmk-sent" + (sent.sent ? " dmk-sent--ok" : " dmk-sent--no")}>
              {sent.sent
                ? `Emailed ${sent.name ?? sent.to}${sent.ccName ? ` and ${sent.ccName}` : ""}${sent.sentAs ? ` from ${sent.sentAs}` : ""}.`
                : `Marked, but nothing was emailed — ${sent.reason ?? "the send did not go through."}`}
            </div>
          )}
          {/* ⚠️⚠️ **SUBMIT IS THE ONLY WRITER (10/7/2026).** It lives in the modal's
              FOOTER now (see the prop above) so it stays put while the rep lookup
              grows the body — but it is still the one path to `setMark`, and it is
              disabled until a status is chosen, because a note with no status is
              not a mark the store can hold. */}
        </CenterModal>
      )}
    </>
  );
}
