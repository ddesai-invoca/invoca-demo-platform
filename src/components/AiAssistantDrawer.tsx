import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { columnEdits } from "../data/columnEdits";
import { getByPath , constrainToFocus } from "../data/editGuard";
import { QuestionListTools } from "./QuestionListTools";
import { stripGeneratedDashes, GREETING_PATH } from "../data/questionImport";
import { defaultGreeting, resolveGreeting } from "../data/smsBrain";
import { findTilePath } from "../data/findTilePath";
import { tileId } from "../data/tileId";

/* The "Ask AI" drawer: slides in from the right over a dimmed backdrop. Scope is
   set by which sparkle opened it — the whole PAGE (the top-bar sparkle, on every
   screen) or one tile (a tile's sparkle, on dashboards). The user can ask
   questions, edit data (numbers, trends, titles, names, signals, the overall
   story), or generate/replace tiles. Data only — never CSS or layout.
   Rendered once in AppShell.

   Edits are keyed per page, so nothing here can change another screen. */

interface Msg { role: "user" | "assistant"; content: string; icon?: string }


/* =============================================================================
   WHAT THIS PAGE ACTUALLY LETS YOU DO
   -----------------------------------------------------------------------------
   ⚠️ **THE EMPTY STATE USED TO PITCH DASHBOARD EDITS ON EVERY SCREEN** — "bump Total Revenue
   to $1.2M", "make Q4 trend up", "On a dashboard I can add a tile too". On a workflow diagram
   none of that is true: there is no revenue, no Q4 and no tile to add. The first thing an SE
   reads in the drawer was three examples that would all be declined, on the one screen where
   the feature is most capable.

   ⚠️ **KEYED ON THE PAGE'S DATA, NOT ITS PATHNAME.** A pathname test breaks when a route moves
   and says nothing about what is editable; the SHAPE of the registered slice is the same signal
   `engine/assistant.ts` uses to decide whether to describe the agent at all, so the drawer's
   promise and the model's instructions cannot drift apart.

   ⚠️ Returns null for everything else, so every other screen keeps its existing copy verbatim —
   the opt-in rule for anything shared by many screens.
   ============================================================================= */
type TreeShape = {
  agent?: unknown;
  branches?: { title?: string; leaves?: { title?: string; paths?: { title?: string }[] }[] }[];
};

/** Every use-case branch title on the tree, in the order they are drawn. */
function branchTitles(d: TreeShape | undefined): string[] {
  return (d?.branches ?? [])
    .flatMap((b) => b.leaves ?? [])
    .flatMap((l) => l.paths ?? [])
    .map((p) => (p?.title ?? "").trim())
    .filter(Boolean);
}

/**
 * "Marriott's" but "Comfort Keepers'".
 *
 * ⚠️ A blunt `+ "'s"` printed "Comfort Keepers's voice agent" — the prospect's own name, wrong,
 * in the first line of the drawer. Any name ending in s hits this, and several do.
 */
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

function pageHint(data: unknown, customerName: string): { title: string; body: ReactNode } | null {
  const d = data as TreeShape | undefined;
  if (!Array.isArray(d?.branches)) return null;

  /* ⚠️ **THE EXAMPLES NAME THIS PROSPECT'S OWN BRANCHES.** A first version listed invented ones
     — "a use case for loyalty members", "the billing branch", "ZIP codes 30097 and 30096" —
     which read as somebody else's agent and, on a prospect with none of those, as instructions
     that would not work. Reading the titles off the tree the SE is looking at makes every
     example true by construction, and it changes per prospect for free. */
  const titles = branchTitles(d);
  const last = titles[titles.length - 1];

  if (d?.agent) {
    /* ⚠️ **BUILT AS A LIST SO NO BRANCH IS NAMED TWICE.** With fixed slots, Comfort Keepers'
       two branches put "Interested in becoming a caregiver" in both the remove example and the
       route example — which reads as a typo rather than as two things you can do. A prospect
       with fewer branches simply gets fewer examples. */
    const ex: string[] = [];
    if (last) ex.push(`remove the ${last} branch`);
    ex.push(`add a use case under All Support Users`);
    if (titles[0] && titles[0] !== last) ex.push(`ask ${titles[0]} for their email as well`);
    if (titles.length > 2) ex.push(`route ${titles[1]} to a dedicated team`);
    ex.push(`open with Thanks for calling ${customerName}`);
    return {
      title: `Build ${possessive(customerName)} voice agent`,
      body: (
        <>
          Describe what you want the agent to do and I&apos;ll build the tree and configure it:
          {" "}{ex.map((e, i) => (
            <span key={e}>{i ? ", " : ""}&quot;{e}&quot;</span>
          ))}.
          {" "}The trigger, Conversation Start and the four nodes above the branches are
          Invoca&apos;s own and cannot be renamed.
        </>
      ),
    };
  }
  const group = (d?.branches?.[0]?.leaves?.[0]?.title ?? "the first group").trim();
  const ex = [
    `add a branch under ${group}`,
    ...(titles[0] ? [`rename ${titles[0]}`] : []),
    `collect their email too`,
    ...(last && last !== titles[0] ? [`drop ${last}`] : []),
  ];
  return {
    title: `Change ${possessive(customerName)} workflow`,
    body: (
      <>
        Reshape the diagram:
        {" "}{ex.map((e, i) => <span key={e}>{i ? ", " : ""}&quot;{e}&quot;</span>)}.
        {" "}The trigger, Conversation Start and the two intent nodes are Invoca&apos;s own and
        cannot be renamed. I change this diagram only, never the styling, and never another page.
      </>
    ),
  };
}

export function AiAssistantDrawer() {
  const { open, closeDrawer, active: registered, focus, effectiveData, applyEdits, addTile, replaceTile, hideTile, showTile, readOnly, activeDemo } = useAiAssistant();
  const { pathname } = useLocation();
  const { profileId, profile } = useProfile();

  /* THE SCOPE MUST MATCH THE PAGE YOU ARE ON.

     registerScope is only called by a screen that HAS editable data, and nothing
     clears it on navigation — so `registered` can still point at the last such
     screen. Left unchecked, opening this drawer from the top bar on a page with
     no data (My Reports, Manage Dashboards, a workflow) would happily edit the
     dashboard you were on two clicks ago. That is precisely the cross-page spill
     rule 1 forbids, and it is invisible when it happens.

     So the scope is only honoured when its key equals THIS page's key. Otherwise
     the drawer treats the page as having nothing to edit. */
  const pageKey = `${profileId}::${pathname}`;
  /* AN "AGENT" FOCUS BRINGS ITS OWN SCOPE.

     Opened by the sparkle inside a preview chat, not by the page's. The SMS agent is
     shared by both previews and is not the workflow page's data, so it cannot be the
     page scope: the page sparkle has to keep editing the diagram. Synthesising the
     scope here means everything downstream (the question tools, applyEdits, the undo
     stack, the model context) works unchanged and there is still only ever ONE scope
     in play per drawer opening. */
  const agentFocus = focus?.scope === "agent" && focus.key ? focus : null;
  const active = agentFocus
    ? { key: agentFocus.key!, customerName: profile.customerName,
        baseTitle: agentFocus.label ?? "SMS agent", questionPath: agentFocus.questionPath }
    : (registered && registered.key === pageKey ? registered : null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const key = active?.key ?? "";

  /* The empty state describes THIS page, from the slice it registered. Memoised on the same
     inputs as `effTitle` so it re-reads when an edit lands (a page that gains an `agent` slice
     should start describing it). */
  const hint = useMemo(
    () => (active ? pageHint(effectiveData(active.key), profile.customerName) : null),
    [active, effectiveData, profile.customerName],
  );
  const effTitle = useMemo(() => (active ? ((effectiveData(active.key) as any)?.title ?? active.baseTitle) : ""), [active, effectiveData]);

  /* THE QUESTION TOOLS ARE OPT-IN, and the opt-in is the scope's questionPath.
     Four screens register `agentConfig`, so all four carry a question list in
     their data; only the page that declared it owns those questions gets the
     tools. Read from the EFFECTIVE data so the list re-renders the moment the
     assistant or an import changes it. */
  const questionPath = focus?.scope === "tile" ? undefined : active?.questionPath;
  const qKey = active ? active.key : "";
  const questions = useMemo(() => {
    if (!active || !questionPath) return null;
    const v = getByPath(effectiveData(qKey), questionPath);
    return Array.isArray(v) ? (v as unknown[]).map(String) : null;
  }, [active, questionPath, qKey, effectiveData]);

  /* The SAME derivation the phone uses, so the row shows the text actually being
     sent rather than a second, subtly different version of it. */
  const greeting = useMemo(() => {
    if (!active || !questionPath) return null;
    const data = effectiveData(qKey) as any;
    /* RAW keeps the {name} token, which is what the model must edit and keep.
       DISPLAY resolves it, so the row reads as the text the phone actually sends.
       Showing the raw token would have the SE reading "Hi {name}," on screen;
       sending the resolved one would have the model bake a literal first name in. */
    const raw = (getByPath(data, GREETING_PATH) as string) || defaultGreeting(active.customerName, data?.smsPlaybook);
    return { raw, display: resolveGreeting(raw, profile) };
  }, [active, questionPath, qKey, effectiveData, profile]);
  const scopeLabel = focus?.scope === "tile" ? (focus.label || "This tile")
    : agentFocus ? (agentFocus.label || "SMS agent")
    : effTitle;

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
      let eff = effectiveData(active.key);
      /* SHOW THE MODEL THE GREETING IT CAN SEE ON SCREEN.

         `smsPlaybook.greeting` is optional and absent on every profile generated
         before it existed, so the page renders a DERIVED default while the data
         has no such key. Asked to change the opening message, the model looked for
         it, could not find it, and wrote the new greeting into
         `brandConversationRules.0` instead: the request appeared to succeed, the
         opener never changed, and a real brand rule was quietly overwritten.

         So the derived value is injected into the copy sent for context. The model
         then edits a field it can see, at the path it was told to use. Scoped to
         the opted-in page; every other page's context is untouched. */
      if (questionPath && greeting && eff && typeof eff === "object") {
        const cur = eff as any;
        /* On a page whose questions live elsewhere (the workflow diagram), the
           agent is not in this page's data at all, so the model would have nothing
           to edit. Fold the playbook in beside the page's own data: the model then
           sees both, and the paths it is told to use resolve. */
        const playbook = { ...(cur.smsPlaybook ?? {}) };
        if (!playbook.greeting) playbook.greeting = greeting.raw;
        eff = { ...cur, smsPlaybook: playbook };
      }
      let dataContext = "";
      try { const j = JSON.stringify(eff); dataContext = j.length > 12000 ? j.slice(0, 12000) + "…(truncated)" : j; } catch { /* ignore */ }
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* Tiles only exist where GeneratedTiles renders them — the platform
           dashboards. Without this the model answered "add a branch to the
           workflow" by creating a KPI tile, which that page never renders: the
           edit looked like it succeeded and nothing appeared. */
        body: JSON.stringify({ customerName: active.customerName, dashboardTitle: effTitle, dataContext, question: q, focus, history,
          /* The Reports tab renders GeneratedTiles too, so "add a tile" belongs there
             as well; it was gated to /dashboards/ only. Still false everywhere else,
             because a page that cannot render a generated tile must be told so or the
             model answers an "add" request with a tile nobody ever sees. */
          /* Insights & Analytics added: its dashboard renders DashAssistant with the ts-
             variant, so a tile created there is actually drawn. */
          canCreateTiles: pathname.startsWith("/dashboards/") || pathname.startsWith("/reports/")
            || pathname.startsWith("/insights/"),
          questionPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Assistant failed.");
      const r = data.result;
      const push = (content: string, icon?: string) => setMessages((prev) => [...prev, { role: "assistant", content, icon }]);

      /* Someone else's demo: still answer questions, but never mutate it. The
         server would reject the save anyway — this keeps the UI honest. */
      if (readOnly && (r?.kind === "create" || r?.kind === "editTile" || r?.kind === "editData" || r?.kind === "editColumn")) {
        push(`This demo belongs to ${activeDemo?.creator.name ?? "someone else"}, so I can't change it. Duplicate it from the launch screen and I'll edit your copy.`, "lock");
      } else if (r?.kind === "create" && r.tile) {
        addTile(active.key, { id: (crypto?.randomUUID?.() ?? String(Date.now())), ...normalizeTile(r.tile) });
        push(r.answer || `Added "${r.tile.title}" to the bottom of the page.`, "add_chart");
      } else if (r?.kind === "editTile" && r.tile && focus?.id) {
        replaceTile(active.key, focus.id, normalizeTile(r.tile));
        push(r.answer || `Updated "${r.tile.title}".`, "auto_awesome");
      } else if (r?.kind === "editColumn" && r.column && r.column.op !== "none") {
        /* THE APP does the splicing, not the model. It supplies only where the column
           goes and (for an insert) one value per row; every other cell is copied from
           the CURRENT effective data, so existing values cannot be paraphrased away.
           See AssistantColumnOp in engine/assistant.ts for why. */
        const edits = columnEdits(effectiveData(active.key), r.column, focus?.path);
        if (!edits) {
          push("This page's table doesn't support adding or removing columns.", "info");
        } else {
          const n = applyEdits(active.key, edits);
          /* AN EMPTY COLUMN MUST NOT READ AS SUCCESS. The model is inconsistent about
             filling `values`: the same request produced 20 values one run and NONE the
             next, which added a correctly-placed but entirely blank column. Silence
             there looks like the feature half-working, so say what actually landed and
             tell the user retrying is worth it. */
          const rowsFilled = r.column.op === "insert" ? (r.column.values ?? []).filter(Boolean).length : -1;
          const total = edits.length - 1;
          const msg = !n
            ? "I couldn't apply that column change."
            : rowsFilled === 0
              ? `Added the "${r.column.header || "new"}" column, but I didn't generate any values for it — ask me again and I'll fill it in.`
              : rowsFilled > 0 && rowsFilled < total
                ? `${r.answer || "Added the column."} I filled ${rowsFilled} of ${total} rows; ask again to complete the rest.`
                : (r.answer || "Updated the table's columns.");
          push(msg, "auto_awesome");
        }
      } else if (r?.visibility && (r.visibility.op === "hide" || r.visibility.op === "show")) {
        /* HIDE / SHOW A WHOLE TILE.

           The model returns the tile's HEADING; the id is resolved here with the same
           lookup rule 3 uses, so there is exactly one notion of "which tile" in the
           app. When the user is focused on a tile, that focus wins over the heading:
           "remove this tile" has no heading in it at all. */
        const target = r.visibility.target || focus?.label || "";
        const resolved = focus?.path ?? findTilePath(effectiveData(active.key), target);
        /* Falls back to the HEADING when no path resolves, which is exactly what a
           card with no path stamps as its own `data-tile`. Keeping the two in step is
           what makes every card hideable without threading a path through all ~35
           call sites; a mismatch here would silently hide nothing. */
        const id = tileId(resolved) ?? (target || undefined);
        if (!id) {
          push(`I couldn't tell which tile "${target}" is. Open that tile's own AI button and ask again, or name its heading exactly.`, "info");
        } else if (r.visibility.op === "hide") {
          hideTile(active.key, id);
          /* Says it is reversible, because "removed" sounds permanent and an SE needs
             to know the data is still there before doing this in front of a prospect. */
          push(`${r.answer || `Removed the "${target}" tile from this page.`} Undo, or ask me to put it back, and it returns with its data intact.`, "auto_awesome");
        } else {
          showTile(active.key, id);
          push(r.answer || `Put the "${target}" tile back.`, "auto_awesome");
        }
      } else if (r?.kind === "editData" && Array.isArray(r.edits) && r.edits.length) {
        /* INSTRUCT THEN ENFORCE, same as the agent's replies. The prompt asks for
           no dashes and the model mostly complies; "mostly" is not something you
           can demo on, so a question list the assistant wrote is cleaned here for
           real. A list the USER pasted never reaches this branch. */
        const edits = questionPath
          ? r.edits.map((e: any) => {
              if (e.path === GREETING_PATH) {
                try {
                  const v = JSON.parse(e.value);
                  return typeof v === "string" ? { ...e, value: JSON.stringify(stripGeneratedDashes(v)) } : e;
                } catch { return e; }
              }
              if (e.path !== questionPath) return e;
              try {
                const v = JSON.parse(e.value);
                if (!Array.isArray(v)) return e;
                return { ...e, value: JSON.stringify(v.map((q) => stripGeneratedDashes(String(q)))) };
              } catch { return e; }
            })
          : r.edits;
        /* PIN A FOCUSED EDIT TO THE FOCUSED TILE. The model reasons about the page
           as rendered, so wherever render order and array order disagree it returns
           a neighbouring index and silently rewrites the WRONG tile while reporting
           success. constrainToFocus remaps that onto the tile the user actually
           clicked and drops anything it cannot place. No-op for tiles that do not
           declare a path. */
        const pinned = constrainToFocus(edits, focus?.path, effectiveData(active.key));
        if (pinned.remapped) {
          console.warn(`[ai] remapped ${pinned.remapped} edit(s) onto the focused tile "${focus?.path}"`);
        }
        if (pinned.dropped) {
          console.warn(`[ai] dropped ${pinned.dropped} edit(s) that fell outside the focused tile "${focus?.path}"`);
        }
        const n = applyEdits(active.key, pinned.edits);
        /* Say when part of it was refused rather than reporting a clean success:
           the user is focused on ONE tile and an edit aimed elsewhere is exactly the
           bug this guard exists to stop. */
        /* "Couldn't map that" is the WRONG message when the truth is that the edits
           were refused for being outside the focused tile: it sends the user off
           rewording a request that was understood perfectly. Say which happened. */
        const note = !n && pinned.dropped
          ? `That change pointed outside the "${focus?.label ?? "focused"}" tile, so I didn't apply it. Ask from the page's own AI button to change something elsewhere.`
          : !n
          ? "I couldn't map that change to anything on this page — try naming the metric, title or row you mean."
          : pinned.dropped
            ? `${r.answer || `Updated ${n} value${n > 1 ? "s" : ""}.`} I left ${pinned.dropped} change${pinned.dropped > 1 ? "s" : ""} out because ${pinned.dropped > 1 ? "they were" : "it was"} outside this tile.`
            : (r.answer || `Updated ${n} value${n > 1 ? "s" : ""} on this page.`);
        push(note, "auto_awesome");
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
    <div className={"aiad" + (open ? " aiad--open" : "") + (focus?.side === "left" ? " aiad--left" : "")} aria-hidden={!open}>
      {/* No backdrop on the left-hand variant: it exists so the user can watch the
          thing it edits, and a backdrop would both dim that and swallow clicks on it.
          Escape and the close button still dismiss it. */}
      {focus?.side !== "left" && <div className="aiad-backdrop" onClick={closeDrawer} />}
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

        {readOnly && (
          <div className="aiad-readonly">
            <span className="material-icons">lock</span>
            <span>
              <strong>{activeDemo?.creator.name}</strong>'s demo — view only. Ask anything about it;
              duplicate it from the launch screen to make an editable copy.
            </span>
          </div>
        )}

        <div className="aiad-body" ref={listRef}>
          {/* Always visible while the drawer is open on this page, not just on the
              empty state: after the assistant rewrites a question the list below
              updates, which is the only confirmation that it actually landed. */}
          {questions && (
            <QuestionListTools
              greeting={greeting?.display ?? ""}
              greetingRaw={greeting?.raw ?? ""}
              questions={questions}
              readOnly={readOnly}
              onReplace={(next, note) => {
                const n = applyEdits(qKey, [{ path: questionPath!, value: JSON.stringify(next) }]);
                setMessages((prev) => [...prev, {
                  role: "assistant",
                  content: n ? `${note} The agent asks them from its next message.` : "I couldn't apply that list.",
                  icon: n ? "playlist_add_check" : "info",
                }]);
              }}
              onPrompt={(text) => { setInput(text); inputRef.current?.focus(); }}
            />
          )}
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
              ) : !active ? (
                /* No slice registered for this route — a list or template page.
                   Say so plainly rather than accepting a message that would
                   silently do nothing (send() returns early without a scope). */
                <>
                  <p className="aiad-empty-title">Nothing to edit on this page</p>
                  <p className="aiad-empty-sub">
                    This screen is a list or a template, so it has no demo data of its own.
                    Open a dashboard, a report, Call Review or Signal and I can change the
                    numbers, titles, names and signals there.
                  </p>
                </>
              ) : (
                <>
                  <p className="aiad-empty-title">
                    {questions ? "Change what this agent asks" : (hint?.title ?? "Ask about this page")}
                  </p>
                  <p className="aiad-empty-sub">{questions ? (
                    <>
                      Tap a question above to change it, paste or import a whole list, or pick a use
                      case and I'll rewrite them all. You can also just tell me: "drop the budget
                      question", "ask for their ZIP first", "add one about financing".
                    </>
                  ) : hint ? hint.body : (
                    <>
                    Ask a question, or change the data: "bump Total Revenue to $1.2M",
                    "rename this signal to Quote Booked", "make Q4 trend up". On a dashboard I can
                    add a tile too. I change this page's data only, never the styling, and never
                    another page.
                    </>
                  )}</p>
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
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={1}
            placeholder={active ? placeholder : "Nothing to edit on this page"} disabled={!active} />
          <button className="aiad-send" onClick={send} disabled={!active || busy || !input.trim()} title="Send">
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
