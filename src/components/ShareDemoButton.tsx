import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SHARE_DAYS } from "../data/shareDefaults";
import { createPortal } from "react-dom";

/* =============================================================================
   ShareDemoButton — the SE's half: make a prospect link, then manage it
   -----------------------------------------------------------------------------
   ⚠️ **ONE ROW, ONE DEMO.** Every call carries the demo id this row is for, and the
   server re-checks ownership with the demo library's own `canWrite` — so this
   control being rendered is never what decides whether a link can be made.

   ⚠️ **REVOKE IS THE SAFETY VALVE AND IT IS ONE CLICK.** The password defaults to the
   prospect's name, which anyone holding the link can guess; the link itself is the
   secret. So the honest answer to "this went to the wrong inbox" is killing it, not
   a stronger password, and the control has to be right here rather than buried.
   ============================================================================= */

interface ShareSummary {
  token: string; prospect: string; createdAt: string; days: number;
  expiresAt: string; expired: boolean; active: boolean; revokedAt?: string;
  opens?: number; lastOpenedAt?: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ShareDemoButton({ demoId, name }: { demoId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [days, setDays] = useState(DEFAULT_SHARE_DAYS);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  /* ⚠️⚠️ **PORTALLED AND `position: fixed`, BECAUSE THE DEMO PICKER IS A SCROLL BOX.**
     Reported as "the box gets cut off": `.lib-list` is `overflow-y: auto`, so a panel
     positioned inside it is clipped at its edge. Identical to the Create Workflow
     channel popup, which had to escape `.cwm-content` for the same reason. */
  const W = 360;
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    /* The height is unknown until it has rendered, so the first pass estimates and the
       rAF pass below re-places against the real box. */
    const h = panelRef.current?.getBoundingClientRect().height ?? 300;
    const below = b.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, b.top - 6 - h);
    const left = Math.max(8, Math.min(b.right - W, window.innerWidth - W - 8));
    /* ⚠️ Bails when nothing moved: a ResizeObserver fires once on observe(), so an
       always-fresh object would re-render, re-subscribe and fire again. */
    setRect((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, []);

  useEffect(() => {
    if (!open) { setRect(null); return; }
    place();
    const raf = requestAnimationFrame(place);
    /* Scroll does not bubble, and it is the demo LIST that scrolls, not the window. */
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  /* ⚠️ The panel GROWS as links load, so it must re-place — the same late-growth
     defect DemoMarkButton records, where a flipped panel ended 39px off screen. Its
     own effect keyed on the panel being mounted: on the render that sets `open`,
     `rect` is still null and `panelRef.current` is null, so an observer created in
     the effect above would attach to nothing. */
  const placed = rect !== null;
  useEffect(() => {
    const el = panelRef.current;
    if (!open || !placed || !el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, placed, place]);

  async function load() {
    setErr("");
    const res = await fetch(`/api/demos/${encodeURIComponent(demoId)}/shares`);
    if (!res.ok) { setErr("Could not load the links for this demo."); setShares([]); return; }
    setShares((await res.json()).shares ?? []);
  }
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  /* ⚠️ Capture-phase pointerdown, the trap this repo records three times: on bubble,
     a second click of the trigger closes the panel here and reopens it in the
     button's own onClick, so it can never dismiss itself. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/demos/${encodeURIComponent(demoId)}/shares`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        /* ⚠️ An empty password means "use the prospect's name" — the server applies
           that default, so the rule lives in one place rather than here and there. */
        body: JSON.stringify({ days, password: password.trim(), prospect: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || "Could not create the link."); return; }
      setPassword("");
      await load();
    } finally { setBusy(false); }
  }

  async function act(token: string, method: "DELETE" | "PATCH") {
    setBusy(true);
    try {
      await fetch(`/api/shares/${token}`, {
        method, headers: { "Content-Type": "application/json" },
        /* ⚠️ The same constant the link was created with, so the button's LABEL and what
           the server actually adds cannot drift — they were two literals a moment ago. */
        body: method === "PATCH" ? JSON.stringify({ addDays: DEFAULT_SHARE_DAYS }) : undefined,
      });
      await load();
    } finally { setBusy(false); }
  }

  const linkFor = (t: string) => `${location.origin}/share/${t}`;

  return (
    <span className="shr-wrap">
      <button
        ref={btnRef}
        className="shr-trigger"
        title={`Share ${name} with the prospect`}
        aria-label={`Share ${name} with the prospect`}
        /* ⚠️ Every handler stops propagation: the ROW's own click opens the demo, and a
           stray click here would cost a full profile load mid-conference. */
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="material-icons">ios_share</span>
      </button>

      {/* ⚠️⚠️ **`data-picker-safe` IS WHY "Create link" NOW DOES ANYTHING.** The demo
          picker closes on a document MOUSEDOWN whose target is not inside its own
          subtree — and a portalled panel is outside by DOM and inside by intent. So the
          picker closed on the very mousedown that was pressing the button, the row
          unmounted, and the click never fired. Reported as "nothing happens when I click
          create link"; this repo hit the identical bug on the demo-mark panel. */}
      {open && rect && createPortal(
        <div
          className="shr-panel"
          ref={panelRef}
          data-picker-safe=""
          style={{ top: rect.top, left: rect.left, width: W }}
          /* ⚠️⚠️ **`stopPropagation` ONLY — NEVER `preventDefault` HERE.** A React portal
             bubbles through the REACT tree, not the DOM, so a click inside this panel
             still reaches the row's handler and has to be stopped. But `preventDefault`
             on an ancestor cancels the click's DEFAULT ACTION, and for the submit button
             below that IS submitting the form — so "Create link" fired no request at all.
             Reported as "nothing happens when I click create link"; the picker-safe fix
             above was only half of it, and this half was my own. */
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="shr-head">Share with {name}</div>
          <form className="shr-form" onSubmit={create}>
            <label className="shr-label">Days of access
              <input className="shr-input" type="number" min={1} max={365} value={days}
                onChange={(e) => setDays(Number(e.target.value))} />
            </label>
            <label className="shr-label">Password
              <input className="shr-input" type="text" value={password} placeholder={name}
                onChange={(e) => setPassword(e.target.value)} />
            </label>
            <p className="shr-hint">Leave the password blank to use “{name}”.</p>
            {err && <p className="shr-err">{err}</p>}
            <button className="shr-btn" type="submit" disabled={busy}>
              {busy ? "Working…" : "Create link"}
            </button>
          </form>

          <div className="shr-list">
            {shares === null && <p className="shr-hint">Loading…</p>}
            {shares?.length === 0 && <p className="shr-hint">No links yet.</p>}
            {shares?.map((s) => (
              <div className={"shr-item" + (s.active ? "" : " shr-item-off")} key={s.token}>
                <div className="shr-item-top">
                  <span className="shr-state">
                    {s.revokedAt ? "Turned off" : s.expired ? "Expired" : `Active until ${fmt(s.expiresAt)}`}
                  </span>
                  {/* Opens is the only signal an SE gets that the prospect looked. */}
                  <span className="shr-opens">{s.opens ? `${s.opens} open${s.opens > 1 ? "s" : ""}` : "Not opened yet"}</span>
                </div>
                <div className="shr-item-row">
                  <input className="shr-link" readOnly value={linkFor(s.token)}
                    onFocus={(e) => e.currentTarget.select()} />
                  <button className="shr-mini" type="button" onClick={async () => {
                    try { await navigator.clipboard.writeText(linkFor(s.token)); setCopied(s.token); setTimeout(() => setCopied(""), 1500); }
                    catch { /* clipboard can be refused; the field is selectable either way */ }
                  }}>{copied === s.token ? "Copied" : "Copy"}</button>
                </div>
                <div className="shr-item-row">
                  <button className="shr-mini" type="button" disabled={busy} onClick={() => act(s.token, "PATCH")}>+{DEFAULT_SHARE_DAYS} days</button>
                  {s.active && <button className="shr-mini shr-danger" type="button" disabled={busy} onClick={() => act(s.token, "DELETE")}>Turn off</button>}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
