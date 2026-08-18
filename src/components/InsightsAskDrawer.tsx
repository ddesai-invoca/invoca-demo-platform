import { useEffect, useRef, useState } from "react";

/* =============================================================================
   InsightsAskDrawer — what the "Ask" button on Insights & Analytics opens.
   -----------------------------------------------------------------------------
   Real page: /networks/2160/insights/dashboard/<id>, drawer captured 8/17/2026.

   Measured off the SingleFile save, not the screenshot:
     panel     position: fixed; right: 0; top: 0; z-index: 1200; width 800px
               (header and body both measure 800 at a 1134 viewport, so it is a
               FIXED width, not a percentage)
     surface   #fff, no radius, MUI elevation-16 shadow
               (rgba(0,0,0,.2) 0 8px 10px -5px, ...)
     backdrop  rgba(0,0,0,.5)
     header    flex, 72px tall, padding 16px 24px, NO bottom border
     h2        "Create Tile with AI" 20px/400 #15243e
     close     40x40, ink #8a919e

   THE FONT IS INVOCA'S, NOT THOUGHTSPOT'S. Insights & Analytics is an embedded
   ThoughtSpot surface and the rest of that screen is styled from --ts-var-* tokens
   in optimo-plain, so the obvious assumption is that this drawer is too. It is not:
   the drawer is Invoca's own MUI chrome and computes to Lato. Only its BODY is a
   second iframe (800x892) holding the ThoughtSpot embed.

   That iframe is also why the inner content here is built from the screenshot: the
   save did not preserve the embedded document, so the empty state and composer are
   reproduced visually rather than measured, and this comment is the record of which
   parts are which.
   ============================================================================= */

interface Msg { role: "user" | "ai"; text: string }

export function InsightsAskDrawer({
  open, onClose, pageTitle, data, customerName,
}: {
  open: boolean;
  onClose: () => void;
  pageTitle: string;
  data: unknown;
  customerName: string;
}) {
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Esc closes, and focus lands in the composer on open: this drawer exists to be
     typed into, so making an SE click the field first is a wasted beat on stage. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 260);   // after the slide
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [open, onClose]);

  async function send() {
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      let dataContext = "";
      try { const j = JSON.stringify(data); dataContext = j.length > 12000 ? j.slice(0, 12000) + "…(truncated)" : j; } catch { /* ignore */ }
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* canCreateTiles is FALSE on purpose. This screen registers its data but does
           not render GeneratedTiles, so a tile "created" here would be stored and
           never drawn — the silent success that the Reports tab had. Until the tile
           surface exists on this screen, the drawer answers the question instead of
           pretending to build something. */
        body: JSON.stringify({
          customerName, dashboardTitle: pageTitle, dataContext,
          question: text, focus: null, history: [], canCreateTiles: false,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Ask failed.");
      setMsgs((m) => [...m, { role: "ai", text: d?.result?.answer || "…" }]);
    } catch (e: unknown) {
      setMsgs((m) => [...m, { role: "ai", text: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Rendered even when closed so the panel can TRANSITION out; `inert` keeps a
          closed drawer off the tab order and away from screen readers. */}
      <div className={"iad-backdrop" + (open ? " iad-backdrop--on" : "")} onClick={onClose} aria-hidden="true" />
      {/* `inert={!open}` — React 19 takes a boolean here. The spread-an-empty-string
          form silently rendered NO attribute, which left the closed drawer's input and
          send button in the tab order: tabbing across the dashboard walked into a panel
          nobody can see. */}
      <aside className={"iad" + (open ? " iad--open" : "")} role="dialog" aria-modal="true"
        aria-label="Create Tile with AI" inert={!open}>
        <div className="iad-head">
          <h2 className="iad-title">Create Tile with AI</h2>
          <button className="iad-close" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="iad-body">
          {msgs.length === 0 ? (
            <div className="iad-empty">
              <p className="iad-empty-h">
                <span className="material-icons iad-spark">auto_awesome</span>
                Create and Discover with AI
              </p>
              <p className="iad-empty-sub">
                Use AI to quickly find insights and build dashboard tiles from your data.
                <br />
                Simply enter a business question to get started.
              </p>
            </div>
          ) : (
            <div className="iad-thread">
              {msgs.map((m, i) => (
                <p key={i} className={"iad-msg iad-msg--" + m.role}>{m.text}</p>
              ))}
              {busy && <p className="iad-msg iad-msg--ai iad-msg--busy">Thinking…</p>}
            </div>
          )}
        </div>

        <div className="iad-composer">
          <button className="iad-reset" onClick={() => { setMsgs([]); setQ(""); }} disabled={!msgs.length && !q}>
            <span className="material-icons">refresh</span>Reset
          </button>
          <div className="iad-field">
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask a business question" aria-label="Ask a business question" />
            <button className="iad-send" onClick={send} disabled={!q.trim() || busy} aria-label="Send">
              <span className="material-icons">send</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
