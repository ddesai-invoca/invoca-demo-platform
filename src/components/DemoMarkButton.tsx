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

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDemoLibrary, type MarkStatus, type NotifyResult, type RepLookup } from "../data/DemoLibraryContext";

const LABEL: Record<MarkStatus, string> = {
  demoed: "Demoed",
  "follow-up": "Follow-up",
  lead: "Lead",
};

const ORDER: MarkStatus[] = ["demoed", "follow-up", "lead"];

export default function DemoMarkButton({ demoId, name }: { demoId: string; name: string }) {
  const { markFor, setMark, lookupRep, gmailStatus } = useDemoLibrary();
  const mark = markFor(demoId);
  const [open, setOpen] = useState(false);
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
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* ⚠️ FIXED AND PORTALLED, not absolute inside the row. The library list sits in
     its own scroll box, so a panel positioned inside it is CLIPPED at the box's
     edge — the same trap the Create Workflow channel popup and the sidebar flyout
     both document. Anchored to the trigger's own rect instead. */
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const W = 268;
    /* ⚠️⚠️ IT FLIPS ABOVE THE TRIGGER WHEN THERE IS NO ROOM BELOW, and that
       is not polish. The panel is `position: fixed`, so one hanging past the
       bottom of the viewport cannot be scrolled to at all — and the rows most
       likely to be marked are the LAST ones in a long list, which is exactly
       where that happens. Measured before the fix: 34px off screen on a
       one-row list, and far worse further down the Summit roster.
       The height is unknown until the panel has rendered, so the first pass
       uses a conservative estimate and the rAF pass below re-places it against
       the real box. */
    const h = panelRef.current?.getBoundingClientRect().height ?? 210;
    const below = b.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, b.top - 6 - h);
    const left = Math.max(8, Math.min(b.right - W, window.innerWidth - W - 8));
    /* ⚠️ BAILS WHEN NOTHING MOVED, and that is load-bearing rather than tidiness:
       a ResizeObserver fires once on `observe()`, so a `setRect` that always
       produced a fresh object would re-render, re-subscribe and fire again. */
    setRect((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    /* A second pass once the panel has actually rendered, so the flip above
       decides against the real height rather than the estimate. */
    const raf = requestAnimationFrame(place);
    /* Scroll does not bubble, so the listener is on the capture phase — the row's
       own scroll container is what moves, not the window. */
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  /* ⚠️⚠️ **THE PANEL GROWS AFTER IT IS PLACED, AND WITHOUT THIS IT FALLS BACK OFF
     THE SCREEN — the very defect the flip above exists to prevent, arriving through
     a later door.** Ticking "tell the account exec" resolves a rep a second later,
     and an ambiguous answer adds a row per candidate. Measured before this
     observer: a panel flipped above a trigger at y=889 sat at 715 while 168px
     tall, then grew to 288 and hung **39px past a 964px viewport** — unreachable,
     because it is `position: fixed`. The rAF pass above only covers the first
     render; anything arriving later has to re-place too.

     ⚠️ **ITS OWN EFFECT, KEYED ON THE PANEL BEING MOUNTED — and the first version
     was wrong for exactly the reason this comment exists.** Put in the effect
     above it observed nothing: on the render that sets `open`, `rect` is still
     null, so the panel is not in the DOM and `panelRef.current` is null. The
     effect does not re-run when `rect` arrives, so the observer was created,
     attached to nothing, and the bug it was written for still reproduced. */
  const placed = rect !== null;
  useEffect(() => {
    const el = panelRef.current;
    if (!open || !placed || !el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, placed, place]);

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE. On bubble, a click on the trigger while
     the panel is open closes it here and immediately reopens it in the button's
     own onClick, so the trigger can never dismiss its own panel — a trap this repo
     has already paid for on the Signal flyout and the workflow combobox. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(ev: React.MouseEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    setNote(mark?.note ?? "");
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

  async function commit(status: MarkStatus) {
    setSaving(true);
    const r = await setMark(
      demoId,
      status,
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

  async function choose(ev: React.MouseEvent, status: MarkStatus) {
    ev.stopPropagation();
    await commit(status);
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

      {open && rect && createPortal(
        <div
          ref={panelRef}
          className="dmk-panel"
          /* Read by the Launch library picker's outside-click handler: this
             panel lives on <body>, so without it the dropdown closes on the
             pointerdown that is picking a status. See the note there. */
          data-picker-safe=""
          style={{ top: rect.top, left: rect.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dmk-head">{name}</div>
          <div className="dmk-opts">
            {ORDER.map((s) => (
              <button
                key={s}
                className={"dmk-opt dmk-" + s + (mark?.status === s ? " dmk-opt--on" : "")}
                disabled={saving}
                onClick={(e) => void choose(e, s)}
              >
                {LABEL[s]}
              </button>
            ))}
          </div>
          <input
            className="dmk-note"
            value={note}
            placeholder="Optional — who you met, what they asked for"
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            /* Enter commits the status already on the demo, or Demoed when there
               is none — so a note can be typed and saved without reaching for the
               mouse, which is the whole point at conference pace. */
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void commit(mark?.status ?? "demoed");
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
            <span>Tell the account exec</span>
          </label>

          {notify && (
            <div className="dmk-rep">
              {repLoading && <span className="dmk-rep-msg">Looking up Salesforce…</span>}

              {!repLoading && chosen && (
                <span className="dmk-rep-msg dmk-rep-ok">
                  <span className="material-icons">mail_outline</span>
                  Emails <strong>{chosen.ownerName}</strong> — {chosen.accountName}
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
                ? `Emailed ${sent.name ?? sent.to}${sent.sentAs ? ` from ${sent.sentAs}` : ""}.`
                : `Marked, but nothing was emailed — ${sent.reason ?? "the send did not go through."}`}
            </div>
          )}
          {mark && (
            <button className="dmk-clear" onClick={(e) => void clear(e)}>Remove mark</button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
