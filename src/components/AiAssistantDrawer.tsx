import { useEffect, useMemo, useRef, useState } from "react";
import { useAiAssistant } from "../data/AiAssistantContext";

/* The "Ask AI" drawer: slides in from the right over a dimmed backdrop. Scope is
   set by which sparkle opened it — the whole dashboard (header) or one tile
   (a tile's sparkle). The user can ask questions, edit data (numbers, trends,
   titles, the overall story), or generate/replace tiles. Data only — never CSS.
   Rendered once in AppShell. */

interface Msg { role: "user" | "assistant"; content: string; icon?: string }

export function AiAssistantDrawer() {
  const { open, closeDrawer, active, focus, effectiveData, applyEdits, addTile, replaceTile } = useAiAssistant();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const key = active?.key ?? "";

  const effTitle = useMemo(() => (active ? ((effectiveData(active.key) as any)?.title ?? active.baseTitle) : ""), [active, effectiveData]);
  const scopeLabel = focus?.scope === "tile" ? (focus.label || "This tile") : effTitle;

  // Fresh chat each time the drawer opens (scope may differ).
  useEffect(() => { if (open) { setMessages([]); setError(""); } }, [open, key, focus]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, closeDrawer]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy || !active) return;
    setInput(""); setError("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setBusy(true);
    try {
      const eff = effectiveData(active.key);
      let dataContext = "";
      try { const j = JSON.stringify(eff); dataContext = j.length > 12000 ? j.slice(0, 12000) + "…(truncated)" : j; } catch { /* ignore */ }
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: active.customerName, dashboardTitle: effTitle, dataContext, question: q, focus, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Assistant failed.");
      const r = data.result;
      const push = (content: string, icon?: string) => setMessages((prev) => [...prev, { role: "assistant", content, icon }]);

      if (r?.kind === "create" && r.tile) {
        addTile(active.key, { id: (crypto?.randomUUID?.() ?? String(Date.now())), ...normalizeTile(r.tile) });
        push(r.answer || `Added "${r.tile.title}" to the bottom of your dashboard.`, "add_chart");
      } else if (r?.kind === "editTile" && r.tile && focus?.id) {
        replaceTile(active.key, focus.id, normalizeTile(r.tile));
        push(r.answer || `Updated "${r.tile.title}".`, "auto_awesome");
      } else if (r?.kind === "editData" && Array.isArray(r.edits) && r.edits.length) {
        const n = applyEdits(active.key, r.edits);
        push(n ? (r.answer || `Updated ${n} value${n > 1 ? "s" : ""} on the dashboard.`) : "I couldn't map that change to the dashboard data — try naming the tile or metric.", "auto_awesome");
      } else {
        push(r?.answer || "…");
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const placeholder = focus?.scope === "tile" ? "Ask about or change this tile…" : "Ask, edit a tile, or reshape the story…";

  return (
    <div className={"aiad" + (open ? " aiad--open" : "")} aria-hidden={!open}>
      <div className="aiad-backdrop" onClick={closeDrawer} />
      <aside className="aiad-panel" role="dialog" aria-label="Ask AI">
        <header className="aiad-head">
          <div className="aiad-title">
            <span className="material-icons aiad-spark">auto_awesome</span>
            <div>
              <div className="aiad-title-main">Ask AI</div>
              <div className="aiad-title-sub">
                {focus?.scope === "tile" ? <span className="aiad-scope-chip"><span className="material-icons">crop_square</span>{scopeLabel}</span> : scopeLabel}
              </div>
            </div>
          </div>
          <span className="material-icons aiad-close" title="Close" onClick={closeDrawer}>close</span>
        </header>

        <div className="aiad-body" ref={listRef}>
          {messages.length === 0 && (
            <div className="aiad-empty">
              <span className="material-icons">auto_awesome</span>
              {focus?.scope === "tile" ? (
                <>
                  <p className="aiad-empty-title">Ask about this tile</p>
                  <p className="aiad-empty-sub">
                    Ask about "{scopeLabel}", or change it — "make Q4 trend up", "set the total to 1,200",
                    "rename this to Booked Consultations". I edit the data only, never the styling.
                  </p>
                </>
              ) : (
                <>
                  <p className="aiad-empty-title">Ask about this dashboard</p>
                  <p className="aiad-empty-sub">
                    Ask a question, add a tile ("add a bar chart of calls by source"), edit a named tile
                    ("bump Total Revenue to $1.2M"), or reshape the whole story ("show a strong Q4 turnaround").
                    Ask for scenario ideas and I'll suggest a few. I change data only, never the styling.
                  </p>
                </>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"aiad-msg aiad-msg--" + m.role}>
              {m.icon && <span className="material-icons aiad-msg-icon">{m.icon}</span>}
              <span>{m.content}</span>
            </div>
          ))}
          {busy && <div className="aiad-msg aiad-msg--assistant aiad-typing"><span /><span /><span /></div>}
          {error && <div className="aiad-error">{error}</div>}
        </div>

        <div className="aiad-input">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={1} placeholder={placeholder} />
          <button className="aiad-send" onClick={send} disabled={busy || !input.trim()} title="Send">
            <span className="material-icons">arrow_upward</span>
          </button>
        </div>
      </aside>
    </div>
  );
}

/* Coerce an assistant tile spec into a complete GeneratedTile payload. */
function normalizeTile(t: any) {
  return {
    tileType: t.tileType, title: t.title ?? "", note: t.note ?? "",
    kpis: t.kpis ?? [], xLabels: t.xLabels ?? [], series: t.series ?? [], slices: t.slices ?? [],
  };
}
