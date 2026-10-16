/* =============================================================================
   agentWorkflowSync.ts — the workflow always matches what the agent does
   -----------------------------------------------------------------------------
   Asked for 10/14/2026: *"if any user uses the Ask AI button to make changes to the SMS or
   voice workflow… 100% make sure that the workflow always matches what the agent is doing.
   This is for now and the future also."*

   ⚠️⚠️ **WHY THIS EXISTS: SOME FACTS HAVE TWO HOMES, AND AN EDIT TO ONE LEFT THE OTHER STALE.**
   Measured (10/14/2026), every one of these drifted:
     • the SMS qualifying questions live on the Preview Agent (`smsPlaybook.qualifyingQuestions`,
       which the agent asks) AND in the workflow (the Qualify question, and the Inform box's
       "Ask these one at a time…" line, which the diagram shows);
     • the brand conversation rules live on the Preview Agent AND in the SMS Sales Inquiry drawer;
     • the voice greeting holds a question that is ALSO the Qualify drawer's question, its
       reprompt, and a copy inside the conversation rules.
   The rule this file enforces: when an edit changes one home, the other is rewritten to match
   in the same step. It runs inside `applyEdits`, so EVERY writer gets it: each Ask AI button,
   each drawer's Apply, the Details tab, and edits made by hand through the same path.

   ⚠️ PURE: it takes the before/after of the scope that was edited and a reader for the others,
   and returns whole new values for the scopes that must follow. No React, so it is tested by
   calling it (`audit:sync`).
   ============================================================================= */

export const PREVIEW_PATH = "/agent-studio/agent/preview";
export const SMS_WORKFLOW_PATHS = ["/agent-studio/agent/workflow/sms", "/agent-studio/agent/workflow/sms-test", "/agent-studio/agent/workflow/rcs"];
export const VOICE_WORKFLOW_PATHS = ["/agent-studio/agent/workflow/voice", "/agent-studio/agent/workflow/voice-test"];

import { GREETING_RULE_PREFIX } from "./voiceAgentSpec";

const BOOK_LEAD = "Ask these one at a time, in this order, skipping any they have already answered: ";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const get = (o: unknown, path: string[]): unknown => path.reduce<unknown>((c, k) => (isObj(c) ? c[k] : undefined), o);
function set(o: Obj, path: string[], v: unknown): Obj {
  const [k, ...rest] = path;
  const cur = isObj(o[k]) ? (o[k] as Obj) : {};
  return { ...o, [k]: rest.length ? set(cur, rest, v) : v };
}
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).map((s) => s.trim()).filter(Boolean) : [];

/** The Inform box's text with its question line rebuilt from `rest` (questions 2..n). */
export function bookWithQuestions(book: string, rest: string[]): string {
  const lines = (book ?? "").split("\n").filter((l) => !l.startsWith(BOOK_LEAD));
  return [...(rest.length ? [BOOK_LEAD + rest.join(" ")] : []), ...lines].join("\n");
}
/** The questions an Inform box's question line asks, or null when it has none. */
export function questionsInBook(book: string): string[] | null {
  const line = (book ?? "").split("\n").find((l) => l.startsWith(BOOK_LEAD));
  if (!line) return null;
  return line.slice(BOOK_LEAD.length).split(/(?<=\?)\s+/).map((q) => q.trim()).filter(Boolean);
}
/** The last question in a spoken line ("Hi… Are you booking, or…?" → "Are you booking, or…?"). */
export function lastQuestion(text: string): string | null {
  const m = (text ?? "").match(/([^.!?]*\?)\s*$/);
  return m ? m[1].trim() : null;
}

export interface SyncResult { key: string; data: Obj }

/**
 * What else has to change because `key` went from `before` to `after`.
 * Returns whole new values (the store's override for that key), including possibly `key`
 * itself when a fact has two homes inside one scope (the voice greeting and its question).
 */
export function syncAgentWorkflow(
  key: string,
  before: unknown,
  after: unknown,
  read: (key: string) => unknown,
): SyncResult[] {
  if (!isObj(after)) return [];
  const sep = key.indexOf("::");
  if (sep < 0) return [];
  const pid = key.slice(0, sep);
  const path = key.slice(sep + 2);
  const out: SyncResult[] = [];

  /* ── SMS: Preview Agent → every SMS workflow of this prospect ─────────────────────────── */
  if (path === PREVIEW_PATH) {
    const qPath = ["smsPlaybook", "qualifyingQuestions"];
    const rPath = ["brandConversationRules"];
    const qChanged = !same(get(before, qPath), get(after, qPath));
    const rChanged = !same(get(before, rPath), get(after, rPath));
    if (!qChanged && !rChanged) return [];
    const qs = strings(get(after, qPath));
    const rules = strings(get(after, rPath));
    for (const wp of SMS_WORKFLOW_PATHS) {
      const wk = `${pid}::${wp}`;
      const wf = read(wk);
      if (!isObj(wf) || !isObj(wf.sms)) continue;
      let next = wf;
      if (qChanged && qs.length) {
        next = set(next, ["sms", "qualify", "root", "question"], qs[0]);
        next = set(next, ["sms", "qualify", "root", "fallback"], `Sorry, I didn't quite catch that. ${qs[0]}`);
        const book = String(get(next, ["sms", "inform", "book"]) ?? "");
        next = set(next, ["sms", "inform", "book"], bookWithQuestions(book, qs.slice(1)));
      }
      if (rChanged) next = set(next, ["sms", "intents", "sales", "rules"], rules);
      if (next !== wf) out.push({ key: wk, data: next });
    }
    return out;
  }

  /* ── SMS: workflow → Preview Agent ─────────────────────────────────────────────────────── */
  if (SMS_WORKFLOW_PATHS.includes(path)) {
    const pk = `${pid}::${PREVIEW_PATH}`;
    const pv = read(pk);
    if (!isObj(pv)) return [];
    let next = pv;
    const curQs = strings(get(pv, ["smsPlaybook", "qualifyingQuestions"]));
    let qs = [...curQs];
    const rootB = get(before, ["sms", "qualify", "root", "question"]);
    const rootA = get(after, ["sms", "qualify", "root", "question"]);
    if (typeof rootA === "string" && rootA.trim() && !same(rootB, rootA)) qs = [rootA.trim(), ...qs.slice(1)];
    const bookB = String(get(before, ["sms", "inform", "book"]) ?? "");
    const bookA = String(get(after, ["sms", "inform", "book"]) ?? "");
    if (bookA !== bookB) {
      const rest = questionsInBook(bookA);
      if (rest) qs = [qs[0] ?? "", ...rest].filter(Boolean);
    }
    if (!same(qs, curQs) && qs.length) next = set(next, ["smsPlaybook", "qualifyingQuestions"], qs);
    const rB = get(before, ["sms", "intents", "sales", "rules"]);
    const rA = get(after, ["sms", "intents", "sales", "rules"]);
    if (Array.isArray(rA) && !same(rB, rA)) next = set(next, ["brandConversationRules"], strings(rA));
    if (next !== pv) out.push({ key: pk, data: next });
    return out;
  }

  /* ── Voice: the greeting and its question are one fact, kept in four places ───────────── */
  if (VOICE_WORKFLOW_PATHS.includes(path)) {
    const ga = get(after, ["agent", "greeting"]);
    const gb = get(before, ["agent", "greeting"]);
    const qa = get(after, ["agent", "qualifyQuestion"]);
    const qb = get(before, ["agent", "qualifyQuestion"]);
    let next = after;
    if (typeof ga === "string" && ga !== gb) {
      /* The greeting moved: its question becomes the Qualify question and its reprompt, and
         the greeting's copy in the rules follows. */
      const q = lastQuestion(ga);
      if (q && q !== qa) {
        next = set(next, ["agent", "qualifyQuestion"], q);
        next = set(next, ["agent", "qualifyFallback"], `I want to make sure I connect you with the right team. ${q}`);
      }
    } else if (typeof qa === "string" && qa.trim() && qa !== qb && typeof ga === "string") {
      /* The Qualify question moved: the question the greeting asks becomes it, so the caller
         hears the question the drawer shows. */
      const old = lastQuestion(ga);
      if (old) {
        next = set(next, ["agent", "greeting"], ga.slice(0, ga.lastIndexOf(old)) + qa.trim());
        next = set(next, ["agent", "qualifyFallback"], `I want to make sure I connect you with the right team. ${qa.trim()}`);
      }
    }
    const gNow = get(next, ["agent", "greeting"]);
    const rules = get(next, ["agent", "rules"]);
    if (typeof gNow === "string" && Array.isArray(rules)) {
      const fixed = rules.map((r) => (typeof r === "string" && r.startsWith(GREETING_RULE_PREFIX) ? GREETING_RULE_PREFIX + gNow : r));
      if (!same(fixed, rules)) next = set(next, ["agent", "rules"], fixed);
    }
    if (next !== after) out.push({ key, data: next });
    return out;
  }
  return out;
}

/* ── the tree's own rule: only a Qualify nests, and only two Qualify layers deep ──────────
   ⚠️ Ask AI on the Preview Agent and in the preview chats can now restructure the workflow
   (add a branch, change an action), which is what "the workflow always matches the agent"
   needs. The one thing it must not do is build a tree the diagram cannot draw: answers under
   a terminal action, or a fourth row. Checked on the RESULT of an edit, so it holds whatever
   path the model chose. */
type Node = { action?: unknown; actionKind?: unknown; paths?: unknown };
const isQualify = (n: Node) => n.actionKind === "qualify" || (!n.actionKind && /^qualify$/i.test(String(n.action ?? "").trim()));
const kids = (n: Node): Node[] => (Array.isArray(n.paths) ? (n.paths as Node[]) : []);

export function workflowShapeOk(data: unknown): boolean {
  if (!isObj(data) || !Array.isArray(data.branches)) return true;
  for (const b of data.branches as { leaves?: Node[] }[]) {
    for (const leaf of b.leaves ?? []) {
      if (kids(leaf).length && !isQualify(leaf)) return false;
      for (const p of kids(leaf)) {
        if (kids(p).length && !isQualify(p)) return false;
        for (const sub of kids(p)) if (kids(sub).length) return false;
      }
    }
  }
  return true;
}
