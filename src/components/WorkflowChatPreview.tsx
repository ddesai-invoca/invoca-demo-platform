import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { buildSmsBrain, askSmsAgent, resolveGreeting, previewAgentBase, smsWorkflowScopePath, SMS_AGENT_SCOPE_PATH, SMS_WORKFLOW_SCOPE_PATH, type SmsWorkflowAgent } from "../data/smsBrain";
import { extraTree } from "../data/workflowChrome";
import { smsWorkflowFlow } from "../data/workflowDrawers";
import { effectiveSmsConfig, repairSalesShape, twoPathGreeting } from "../data/smsTemplate";
import { isCopySlug, isRcsSlug, workflowPath } from "../data/builtInCopies";
import { parseRcs, cardReply } from "../data/rcs";
import { diagCatalog, diagRequest, parseRawDiag, validateDiag, fieldRows, UNDETERMINED, type TurnDiag } from "../data/turnDiagnostics";
import { builtInWorkflowBase } from "../data/workflowBase";
import { QUESTIONS_PATH } from "../data/questionImport";
import type { AgentConfigView } from "../data/schema";
import { useExtraWorkflows } from "../data/quoteWorkflow";

/* =============================================================================
   WorkflowChatPreview — the "Preview Workflow" chat drawer on an SMS workflow
   -----------------------------------------------------------------------------
   Matched to the real Invoca page (network 1847, /ai_agents/edit/25/workflow/114)
   from a SingleFile capture. It is an EMBEDDED CHAT WIDGET, not a platform
   component, so its own stylesheet is the source of truth and its values are
   measured, not guessed:

     panel        400px wide (.cloud { width: 400px })
     header       50px tall, bg rgb(231,233,235), text rgb(21,36,62), top radius 6px
     host bubble  white bg, rgb(21,36,62), radius 6px, 16px, 8px/16px padding,
                  8px from a 40px round avatar, row margin-right 50px
     guest bubble bg rgb(231,233,235), same text/radius, right-aligned,
                  row margin-left 50px
     input        textarea min-height 56px / max 128px, 16px, resize:none,
                  placeholder "Type your question"
     footer       "Last Updated: <date>", 13px, rgb(48,50,53), centred
     avatar       a speech bubble in #2c3951 with a sparkle

   ⚠️ IT TESTS THE SAME AGENT AS THE PREVIEW AGENT SCREEN. Both build their brain
   from buildSmsBrain(), so the questions, order and rules are identical by
   construction — an SE who tunes the questions on the iPhone screen and then opens
   this drawer must not be shown a different agent.

   ⚠️ IT MUST NOT CALL usePageData. The workflow page has ALREADY registered its
   DIAGRAM as the AI scope, and registerScope is last-write-wins, so a second
   registration here would silently repoint that page's sparkle from the tree to
   the agent config — breaking the "add a branch" feature with no visible cause.
   It reads the Preview Agent page's EFFECTIVE config through effectiveData()
   instead, which registers nothing and still picks up edits made over there.

   ⚠️ It deliberately does NOT capture to the SMS Conversation Intelligence report.
   The iPhone Preview Agent does that, and it is the demo's headline move; a second
   capture source would file the same conversation twice. This drawer is a test
   bench, not a demo beat.
   ============================================================================= */

interface Msg { role: "user" | "assistant"; content: string;
  /* A scripted opener never went through the model, so it has no reasoning to show; the
     capture draws no "Show Reasoning" under its first line for the same reason. */
  scripted?: boolean; }
/* One "Show Reasoning" per agent reply, fetched only when somebody opens it. */
interface Reasoning { status: "loading" | "ready" | "error"; diag?: TurnDiag }

/* The widget's own MUI glyphs, copied verbatim from the capture (preview-chat-v2.html). */
const ICON = {
  menu: "M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z",
  newChat: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8m0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  chevron: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  send: "m4 12 1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z",
  /* The reasoning panel's own glyphs, also verbatim from the capture. */
  missing: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8",
  collected: "M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8",
  done: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z",
  web: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2m6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56M12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96M4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56m2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8M12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96M14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2m.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56M16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2z",
  /* Material's InsertDriveFile, for a document source (the capture only shows a web one). */
  doc: "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm7 7V3.5L18.5 9z",
};
function Glyph({ d, style }: { d: string; style?: React.CSSProperties }) {
  return <svg className="wcp-glyph" viewBox="0 0 24 24" aria-hidden="true" style={style}><path d={d} /></svg>;
}

/* The widget's measured size (380 x 782) and where it opens: below the page header, 16px
   off the right edge, never taller than the window allows. */
const W0 = 380, H0 = 782, TOP0 = 96, EDGE = 16, MIN_W = 370, MIN_H = 420;

export function WorkflowChatPreview({ workflowName, wfSlug, wfAgent, minimal, onClose }: {
  workflowName: string;
  wfSlug?: string | null;
  /* THE WORKFLOW PAGE'S OWN `agent` HALF, already resolved through its override.
     ⚠️ **PASSED IN RATHER THAN LOOKED UP, because this component may not register a scope.**
     The page has registered its diagram (with `agent` merged into the same object) and
     `registerScope` is last-write-wins, so reading it here with `usePageData` would silently
     repoint the page's sparkle away from the tree. Absent for the built-in SMS workflow and
     for a created one, in which case the brain falls back to the authored data exactly as
     before. */
  wfAgent?: SmsWorkflowAgent;
  onClose: () => void;
  /* An empty workflow: greet, classify, hand off. Absent means the configured agent. */
  minimal?: boolean;
}) {
  const { profile, profileId } = useProfile();
  /* Includes any workflow created by an LSA quote request submitted during this demo,
     newest first — one definition, so a slug that lists here also resolves elsewhere. */
  const extraWfs = useExtraWorkflows(profile);
  const { effectiveData, registerBase, openDrawer, undo, canUndo, readOnly } = useAiAssistant();

  /* The SMS agent's questions live under the PREVIEW AGENT page's scope, so an
     edit made there governs this drawer too. Falls back to the profile's own
     config when that page has never been opened (nothing registered, no
     override). Never registers a scope — see the header note. */
  /* The scope the SMS agent's data lives under. Owned by the Preview Agent tab, but
     the agent is the same one either preview talks to, so this drawer's sparkle
     edits it too. */
  const agentKey = `${profileId}::${SMS_AGENT_SCOPE_PATH}`;
  /* applyEdits refuses a key with no base, so an SE who opens this chat without ever
     visiting the Preview Agent tab would make edits that silently did nothing.
     registerBase fills that gap WITHOUT making it the active scope, which a second
     registerScope would do, repointing this page's sparkle away from the diagram. */
  /* Only once the profile is the one the key names (see the note in PhonePreview). */
  useEffect(() => { if (profile.id === profileId) registerBase(agentKey, previewAgentBase(profile)); },
    [agentKey, profile, profileId, registerBase]);

  const agentConfig = useMemo(() => {
    const edited = effectiveData(agentKey) as
      (AgentConfigView & { title?: string }) | undefined;
    return (edited ?? profile.reports.agentConfig) as AgentConfigView | undefined;
  }, [effectiveData, agentKey, profile.reports.agentConfig]);

  /* A built-in COPY reads its own tree, like the original; it is not an extra workflow. */
  const copyPath = isCopySlug(wfSlug) ? workflowPath(wfSlug) : null;
  const wf = wfSlug && !copyPath
    ? extraWfs.find((w) => w.slug === wfSlug)
    : undefined;
  /* ⚠️ **A MINIMAL PREVIEW MUST NOT INHERIT THE CONFIGURED AGENT.** Same reasoning as
     `useBrain`'s minimal branch on the voice side: the prospect's playbook, questions and
     offer are all correct for the configured workflow and all wrong for one with no actions.
     `voiceMinimal` picks the empty-workflow flow in `buildSystem` for either channel. */
  /**
   * ⚠️ THE BUILT-IN WORKFLOW'S OWN CONFIG, read from the page this drawer is opened FROM — so
   * "Preview Workflow" obeys the diagram beside it. Same read as the Preview Agent tab does
   * cross-page, through the one shared key, rather than a prop threaded down for one field.
   */
  /* ⚠️ A COPY FALLS BACK THE WAY ITS PAGE DOES (10/13/2026): its own saved tree, else the
     original's, else the template. Its starting state is the page's BASE, which only exists
     while that page is open, so a Preview Agent tab opened on its own found nothing and the
     agent got no workflow at all. */
  const wfTree = !wf
    ? ((effectiveData(`${profileId}::${(copyPath ?? SMS_WORKFLOW_SCOPE_PATH)}`)
        ?? (copyPath ? effectiveData(`${profileId}::${SMS_WORKFLOW_SCOPE_PATH}`) : undefined)
        ?? builtInWorkflowBase(profile, true)) as
        { branches?: unknown[]; sms?: unknown } | undefined)
    : undefined;
  const flow = useMemo(() => {
    if (!wfTree?.branches?.length) return null;
    const cfg = effectiveSmsConfig(profile, wfTree.sms as object | undefined);
    try {
      const branches = repairSalesShape(wfTree.branches as never, profile);
      return smsWorkflowFlow(profile, { ...wfTree, branches } as never, cfg);
    } catch { return null; }
  }, [profile, wfTree]);

  const brain = useMemo(
    () => (minimal
      /* ⚠️ `steps` IS CLEARED HERE TOO. A minimal preview drops `customSystem` and `playbook`
         for the reason above, and the workflow's own flow is part of that same playbook —
         leaving it in would have an empty workflow work through a flow its diagram shows
         nothing of, which is the exact mismatch this branch exists to prevent. */
      ? { ...buildSmsBrain(profile, agentConfig, wf, wfAgent), voiceMinimal: true, openingMessage: undefined,
          customSystem: undefined, playbook: undefined, steps: undefined, workflow: undefined }
      : buildSmsBrain(profile, agentConfig, wf, wfAgent, flow, {
          /* Every built-in SMS workflow, not only the copies (10/20/2026); see PhonePreview. */
          workflowLeads: !wf,
          rcs: isRcsSlug(wfSlug),
          greeting: !wf ? (String((wfTree?.sms as { greeting?: string } | undefined)?.greeting ?? "").trim() || twoPathGreeting(profile)) : undefined,
          /* An extra workflow's diagram reaches its agent, the same expression Preview Agent uses. */
          extraBranches: wf
            ? ((effectiveData(`${profileId}::${smsWorkflowScopePath(wf.slug)}`) as { branches?: unknown } | undefined)?.branches
                ?? extraTree(wf).branches)
            : undefined,
        })),
    [minimal, profile, agentConfig, wf, wfAgent, flow, effectiveData, profileId, wfSlug],
  );

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /* Guards the opening greeting against StrictMode's double-effect, and lets the
     reset button deliberately re-run it. */
  const greeted = useRef(false);
  const [resetKey, setResetKey] = useState(0);
  /* Brief, above the composer. Same reasoning as the iPhone preview: a thread that
     vanishes silently reads as a lost conversation rather than a picked-up edit. */
  const [restarted, setRestarted] = useState(false);

  /* RESTART WHEN THE AGENT CHANGES. The greeting effect deliberately does not
     depend on `brain` (that would re-greet on every render), so this compares a
     serialised copy instead and restarts only when the substance moves: the
     questions, the greeting, the rules. Without it an SE could edit the questions
     from this very drawer and watch the chat carry on asking the old ones. */
  const brainSig = useMemo(() => JSON.stringify(brain), [brain]);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === null) { lastSig.current = brainSig; return; }
    if (lastSig.current === brainSig) return;
    lastSig.current = brainSig;
    setMessages([]); setInput(""); setError(null); setBusy(false);
    greeted.current = false;
    setResetKey((k) => k + 1);
    setRestarted(true);
    const t = setTimeout(() => setRestarted(false), 3200);
    return () => clearTimeout(t);
  }, [brainSig]);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    (async () => {
      /* An extra workflow scripts its own opening line — a nurture agent's first
         message has to read identically every time an SE runs the demo. */
      if (brain.openingMessage) {
        setMessages([{ role: "assistant", content: resolveGreeting(brain.openingMessage, profile), scripted: true }]);
        return;
      }
      setBusy(true);
      try { setMessages([{ role: "assistant", content: await askSmsAgent(brain, []) }]); }
      catch (e: any) { setError(e?.message ?? "Chat failed."); }
      finally { setBusy(false); }
    })();
    // brain is intentionally not a dep: re-greeting on every config change would
    // wipe a conversation in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);
  /* The field grows with what is typed, as MUI's multiline does, up to its max-height. */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "23px";
    ta.style.height = `${Math.min(120, Math.max(23, ta.scrollHeight))}px`;
  }, [input]);

  /* "Aptive - RCS": the drawer previews the same RCS conversation as the phone, so its replies
     carry the same suggested replies and cards, drawn in this widget's own style. */
  const rcs = isRcsSlug(wfSlug);
  async function send(typed?: string) {
    const text = (typed ?? input).trim();
    if (!text || busy) return;
    if (typed === undefined) setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    /* `scripted` is ours; the model API refuses unknown message fields, so only role + content go. */
    try { setMessages([...next, { role: "assistant", content: await askSmsAgent(brain, next.map(({ role, content }) => ({ role, content }))) }]); }
    catch (e: any) { setError(e?.message ?? "Chat failed."); }
    finally { setBusy(false); }
  }

  function reset() {
    setMessages([]); setInput(""); setError(null); setBusy(false);
    greeted.current = false;
    setResetKey((k) => k + 1);
  }

  /* ---- "Show Reasoning" (10/20/2026) ---------------------------------------------------
     Five sections per agent reply, matched to the live widget (see src/data/turnDiagnostics.ts
     for what is real and what is invented). Produced in the BACKGROUND right after each reply,
     on the user's choice, so opening one is instant: the same agent describes its reply as JSON
     (`brain.diagnose`), picking only from this workflow's own catalogs. */
  const diagBranches = useMemo(() => {
    if (wf) return ((effectiveData(`${profileId}::${smsWorkflowScopePath(wf.slug)}`) as { branches?: unknown } | undefined)?.branches
      ?? extraTree(wf).branches) as never[];
    const b = (wfTree?.branches ?? []) as never[];
    try { return repairSalesShape(b as never, profile) as never[]; } catch { return b; }
  }, [wf, wfTree, effectiveData, profileId, profile]);
  const knowledge = agentConfig?.knowledgeSources ?? [];
  const catalog = useMemo(() => diagCatalog(diagBranches as never,
    (profile.reports.signalManager?.signals ?? []).map((x) => x.name), knowledge.map((k) => k.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagBranches, profile.reports.signalManager, knowledge.map((k) => k.name).join("|")]);
  /* A web source links to the page the prospect actually publishes (engine/siteLinks.ts, the
     same lookup Knowledge Sources uses), else the homepage. A failure is silent: the fallback
     is already a real page. */
  const home = profile.websiteUrl || `https://${profile.brandDomain}`;
  const [kbLinks, setKbLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    const labels = knowledge.filter((k) => k.type === "Web Link").map((k) => k.name);
    if (!labels.length) return;
    let alive = true;
    fetch("/api/site-links", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: home, labels }) })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.links) setKbLinks(d.links); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const [why, setWhy] = useState<Record<number, Reasoning>>({});
  const [whyOpen, setWhyOpen] = useState<Record<number, boolean>>({});
  /* Each section's open state, keyed "<turn>:<section>". Classification opens by default and the
     rest start closed, as the capture's markup has them. */
  const [secOpen, setSecOpen] = useState<Record<string, boolean>>({});
  const asked = useRef(new Set<number>());
  /* What the turns so far established, handed to the next request so values stay put. */
  const foldedRef = useRef<{ known: Record<string, string>; fired: string[] }>({ known: {}, fired: [] });
  useEffect(() => { setWhy({}); setWhyOpen({}); setSecOpen({}); asked.current = new Set(); foldedRef.current = { known: {}, fired: [] }; }, [resetKey]);
  useEffect(() => {
    messages.forEach((m, i) => {
      if (m.role !== "assistant" || m.scripted || asked.current.has(i)) return;
      asked.current.add(i);
      setWhy((w) => ({ ...w, [i]: { status: "loading" } }));
      const history = messages.slice(0, i + 1).map(({ role, content }) => ({ role, content }));
      const prior = foldedRef.current;
      void askSmsAgent({ ...brain, diagnose: true }, [...history, { role: "user", content: diagRequest(catalog, prior.known, prior.fired) }])
        .then((text) => setWhy((w) => ({ ...w, [i]: { status: "ready", diag: validateDiag(parseRawDiag(text), catalog) } })))
        .catch(() => setWhy((w) => ({ ...w, [i]: { status: "error" } })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  /* Fields and tool calls are CUMULATIVE in the capture, and green marks what changed since the
     previous turn, so every turn is read against the turns before it. */
  const folded = useMemo(() => {
    const out: Record<number, { d: TurnDiag; known: Record<string, string>; prevKnown: Record<string, string>;
      tools: string[]; segNew: boolean; actNew: boolean }> = {};
    let known: Record<string, string> = {}, tools: string[] = [], seg = UNDETERMINED, act = "Qualify";
    const fired = new Set<string>();
    Object.keys(why).map(Number).sort((a, b) => a - b).forEach((i) => {
      const raw = why[i]?.diag;
      if (!raw) return;
      /* A copy, never the stored turn: this memo re-runs, and filtering the state in place would
         compound on every pass. */
      const d: TurnDiag = { ...raw, signals: [...raw.signals] };
      const prevKnown = known;
      known = { ...known, ...d.fields };
      /* A signal fires once, on the turn it first triggers; the capture shows 0 on later turns. */
      d.signals = d.signals.filter((x) => !fired.has(x));
      d.signals.forEach((x) => fired.add(x));
      tools = [...tools, ...d.tools.filter((t) => !tools.includes(t))];
      out[i] = { d, known, prevKnown, tools, segNew: d.segment !== seg, actNew: d.action !== act };
      seg = d.segment; act = d.action;
    });
    foldedRef.current = { known, fired: [...fired] };
    return out;
  }, [why]);
  const toggleSec = (k: string, dflt: boolean) => setSecOpen((o) => ({ ...o, [k]: !(o[k] ?? dflt) }));

  /* Plain functions, not components: a component declared inside render is a new type every
     render, so React would remount its DOM and drop focus on each click. */
  function section({ turn, id, title, count, dflt, empty, children }: {
    turn: number; id: string; title: string; count?: string; dflt?: boolean; empty?: string; children?: React.ReactNode;
  }) {
    const k = `${turn}:${id}`, open = secOpen[k] ?? !!dflt;
    return (
      <div className={"wcp-sec" + (open ? " wcp-sec-open" : "")}>
        <button type="button" className="wcp-sec-head" aria-expanded={open} onClick={() => toggleSec(k, !!dflt)}>
          <span className="wcp-sec-title">{title}</span>
          {count !== undefined && <span className="wcp-sec-count">{count}</span>}
          <Glyph d={ICON.chevron} style={{ transform: open ? "rotate(180deg)" : "none", marginLeft: "auto" }} />
        </button>
        {open && <div className="wcp-sec-body">{count === "0" ? <span className="wcp-sec-empty">{empty}</span> : children}</div>}
      </div>
    );
  }

  function diagnostics(turn: number) {
    const r = why[turn];
    if (!r || r.status === "loading") return <div className="wcp-diag wcp-diag-wait">Gathering the reasoning for this reply…</div>;
    const f = folded[turn];
    if (r.status === "error" || !f) return <div className="wcp-diag wcp-diag-wait">The reasoning for this reply could not be loaded.</div>;
    const { d } = f;
    const rows = fieldRows(d, f.known, f.prevKnown);
    const got = rows.filter((x) => x.status !== "missing").length;
    const kb = knowledge.find((k) => k.name === d.knowledge);
    const kbUrl = kb && kb.type === "Web Link" ? (kbLinks[kb.name] ?? home) : "";
    return (
      <div className="wcp-diag">
        {section({ turn: turn, id: "class", title: "Classification", dflt: true, children: (<>
<div className="wcp-chips">
            <span className={"wcp-dchip" + (f.segNew ? " wcp-dchip-new" : "")}><span>Segment:</span><b>{d.segment}</b></span>
            <span className={"wcp-dchip" + (f.actNew ? " wcp-dchip-new" : "")}><span>Action:</span><b>{d.action}</b></span>
          </div>
</>) })}
        {section({ turn: turn, id: "kb", title: "Knowledge Source", count: kb ? "1" : "0", empty: "No knowledge sources used this turn.", children: (<>
{kb && (
            <div className="wcp-row-src">
              <Glyph d={kbUrl ? ICON.web : ICON.doc} />
              {kbUrl ? <a href={kbUrl} target="_blank" rel="noopener noreferrer">{kbUrl}</a> : <span>{kb.name}</span>}
            </div>
          )}
</>) })}
        {section({ turn: turn, id: "fields", title: "Data fields", count: rows.length ? `${got}/${rows.length}` : "0", empty: "No data fields were requested or captured on this turn.", children: (<>
{rows.length > 0 && rows.map((x) => (
            <div key={x.name} className={`wcp-drow wcp-drow-${x.status}`}>
              <Glyph d={x.status === "missing" ? ICON.missing : x.status === "new" ? ICON.done : ICON.collected} />
              <span className="wcp-drow-name">{x.name}</span>
              <span className="wcp-drow-val">{x.value ?? "Not yet collected"}</span>
            </div>
          ))}
</>) })}
        {section({ turn: turn, id: "signals", title: "Signals", count: d.signals.length ? `${d.signals.length}/${d.signals.length}` : "0", empty: "No signal is configured for this action.", children: (<>
{d.signals.length > 0 && d.signals.map((x) => (
            <div key={x} className="wcp-drow wcp-drow-new">
              <Glyph d={ICON.done} /><span className="wcp-drow-name">{x}</span><span className="wcp-drow-val">Fired</span>
            </div>
          ))}
</>) })}
        {section({ turn: turn, id: "tools", title: "Tool calls", count: String(f.tools.length), empty: "No tools called this turn.", children: (<>
{f.tools.length > 0 && (
            <div className="wcp-chips">
              {f.tools.map((t) => <span key={t} className="wcp-dchip wcp-tool" title={t}><b>{t}</b></span>)}
            </div>
          )}
</>) })}
      </div>
    );
  }

  /* ---- A floating card you can move and resize, as the widget is -----------------------
     The capture is react-draggable (header is the handle, buttons are not) plus a corner grip
     on each corner. Kept inside the window so it can never be dragged out of reach. */
  const [box, setBox] = useState(() => {
    const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
    const vh = typeof window === "undefined" ? 900 : window.innerHeight;
    const w = Math.min(W0, vw - 2 * EDGE), h = Math.max(MIN_H, Math.min(H0, vh - TOP0 - EDGE));
    return { x: Math.max(EDGE, vw - w - EDGE), y: Math.min(TOP0, Math.max(EDGE, vh - h - EDGE)), w, h };
  });
  const clampBox = useCallback((b: typeof box) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(b.w, vw - 2 * EDGE)), h = Math.max(MIN_H, Math.min(b.h, vh - 2 * EDGE));
    return { w, h, x: Math.min(Math.max(EDGE, b.x), vw - w - EDGE), y: Math.min(Math.max(EDGE, b.y), vh - h - EDGE) };
  }, []);
  useEffect(() => {
    const onResize = () => setBox((b) => clampBox(b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampBox]);
  function track(e: React.PointerEvent, move: (dx: number, dy: number, start: typeof box) => typeof box) {
    if (e.button !== 0 || e.pointerType === "touch") return;
    e.preventDefault();
    const start = box, sx = e.clientX, sy = e.clientY;
    const onMove = (ev: PointerEvent) => setBox(clampBox(move(ev.clientX - sx, ev.clientY - sy, start)));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); document.body.classList.remove("wcp-dragging"); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("wcp-dragging");
  }
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".wcp-no-drag")) return;
    track(e, (dx, dy, b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
  };
  const startResize = (corner: "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => track(e, (dx, dy, b) => {
    const left = corner.includes("w"), top = corner.includes("n");
    const w = Math.max(MIN_W, b.w + (left ? -dx : dx)), h = Math.max(MIN_H, b.h + (top ? -dy : dy));
    return { w, h, x: left ? b.x + (b.w - w) : b.x, y: top ? b.y + (b.h - h) : b.y };
  });

  const status = minimal ? "Draft" : "Live";

  return (
    <div className="wcp-drawer" role="dialog" aria-modal="false"
      aria-label={`Preview Chat - ${workflowName} (${status})`}
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}>
      <div className="wcp-head" onPointerDown={startDrag}>
        <div className="wcp-head-l">
          {/* ⚠️ INERT: the session-history rail it opens is not in the capture (it was closed). */}
          <button className="wcp-ib wcp-no-drag wcp-ib-inert" type="button" aria-label="Show session history"
            aria-expanded={false} tabIndex={-1}>
            <Glyph d={ICON.menu} />
          </button>
          <span className="wcp-title">Preview</span>
          <span className={"wcp-chip" + (minimal ? " wcp-chip-draft" : "")}>{status}</span>
        </div>
        <div className="wcp-head-r wcp-no-drag">
          {/* THIS chat's AI, not the page's. It edits what the SMS agent says, and through the
              link the workflow it previews. Ours, so hidden until the header is hovered. */}
          <span className="wcp-tools">
          <button
            className="wcp-icon wcp-icon-ai wcp-icon-hover"
            onClick={() => openDrawer({ scope: "agent", key: agentKey, questionPath: QUESTIONS_PATH,
                                        /* The workflow this chat previews, so "add a branch" or
                                           "switch that box to Inform & Route" lands on the diagram. */
                                        ...(!wf ? { linkKey: `${profileId}::${copyPath ?? SMS_WORKFLOW_SCOPE_PATH}`, linkAs: "workflow" } : {}),
                                        label: `${profile.customerName} SMS agent`, side: "left" })}
            title="Ask AI - change what this agent says"
            aria-label="Ask AI to change what this agent says"
          >
            <span className="material-icons">auto_awesome</span>
          </button>
          <button
            className={"wcp-icon wcp-icon-hover" + (canUndo(agentKey) && !readOnly ? "" : " wcp-icon-off")}
            onClick={() => canUndo(agentKey) && !readOnly && undo(agentKey)}
            disabled={!canUndo(agentKey) || readOnly}
            title={canUndo(agentKey) && !readOnly ? "Undo the last AI change to this agent" : "Nothing to undo"}
            aria-label="Undo the last AI change to this agent"
          >
            <span className="material-icons">undo</span>
          </button>
          </span>
          <button className="wcp-newchat" type="button" onClick={reset}>
            <Glyph d={ICON.newChat} />New chat
          </button>
          <button className="wcp-ib" type="button" onClick={onClose} aria-label="Close preview chat">
            <Glyph d={ICON.close} />
          </button>
        </div>
      </div>

      <div className="wcp-view" ref={scrollRef}>
        {messages.map((m, i) => m.role === "assistant" ? (() => {
          const r = rcs ? parseRcs(m.content) : null;
          const latest = i === messages.length - 1;
          return (
            <div key={i} className="wcp-turn wcp-turn-bot">
              <div className="wcp-msg wcp-msg-bot"><span>{r ? r.text : m.content}</span></div>
              {r && r.cards.length > 0 && (
                <div className="wcp-rcs-cards">
                  {r.cards.map((c, j) => (
                    <div key={j} className="wcp-rcs-card">
                      <b>{c.title}</b>{c.subtitle && <span>{c.subtitle}</span>}
                      <button disabled={!latest || busy} onClick={() => void send(cardReply(c))}>{c.action}</button>
                    </div>
                  ))}
                </div>
              )}
              {r && latest && r.chips.length > 0 && (
                <div className="wcp-rcs-chips">
                  {r.chips.map((c) => <button key={c} disabled={busy} onClick={() => void send(c)}>{c}</button>)}
                </div>
              )}
              {!m.scripted && (
                <div className="wcp-why">
                  <button type="button" className="wcp-why-btn" aria-expanded={!!whyOpen[i]}
                    onClick={() => setWhyOpen((o) => ({ ...o, [i]: !o[i] }))}>
                    <span>{whyOpen[i] ? "Hide reasoning" : "Show reasoning"}</span>
                    <Glyph d={ICON.chevron} style={{ transform: whyOpen[i] ? "none" : "rotate(-90deg)" }} />
                  </button>
                  {whyOpen[i] && diagnostics(i)}
                </div>
              )}
            </div>
          );
        })() : (
          <div className="wcp-turn wcp-turn-user" key={i}>
            <div className="wcp-msg wcp-msg-user"><span>{m.content}</span></div>
          </div>
        ))}
        {busy && (
          <div className="wcp-turn wcp-turn-bot">
            <div className="wcp-msg wcp-msg-bot wcp-typing" aria-label="Agent is typing"><i /><i /><i /></div>
          </div>
        )}
        {error && <div className="wcp-error">{error}</div>}
      </div>

      {restarted && (
        <div className="wcp-restart" role="status">
          <Glyph d={ICON.newChat} />
          Agent updated, chat restarted
        </div>
      )}

      <div className="wcp-input">
        <div className="wcp-field">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              /* Enter sends, Shift+Enter is a newline — what anyone typing in a chat box expects. */
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            placeholder="Send a test message"
            rows={1}
          />
        </div>
        <button className="wcp-send" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Send">
          <Glyph d={ICON.send} />
        </button>
      </div>

      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <span key={c} className={`wcp-grip wcp-grip-${c}`} onPointerDown={startResize(c)} aria-hidden="true" />
      ))}
    </div>
  );
}
