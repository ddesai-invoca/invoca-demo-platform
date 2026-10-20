/* =============================================================================
   turnDiagnostics — what "Show Reasoning" shows under each agent reply in the
   Preview Chat (10/20/2026).

   Matched to the live Invoca widget (reference/agent-workflow/preview-chat-reasoning.html,
   a Greenix capture): five sections per turn, CLASSIFICATION (segment + action),
   KNOWLEDGE SOURCE, DATA FIELDS, SIGNALS, TOOL CALLS, with green marking what changed
   on that turn. Asked for: "where we are, how the answer is coming, the reasoning
   behind it… Feel free to make things up as well to better show the demo."

   ⚠️⚠️ WHAT IS TRUE AND WHAT IS INVENTED, so nobody has to guess later:
     • the SEGMENT is a real node path of THIS workflow's diagram, and the ACTION is
       read off that node, never off the model, so the panel and the diagram cannot
       disagree;
     • the DATA FIELD names are that node's own collect chips (plus three demo fields),
       and the values are what the customer actually said;
     • the SIGNALS are the prospect's own Signal Manager names;
     • the KNOWLEDGE SOURCE is one of the prospect's own knowledge sources;
     • the TOOL CALLS are invented integration actions (no prospect has these APIs),
       named plainly on the user's choice rather than the capture's "Serviceability
       Zip Greenft" style.
   One fast model call per reply picks among those catalogs; everything it returns is
   validated here, so an invented segment, field or signal simply does not render.
   ============================================================================= */

import type { TreePath } from "../components/WorkflowTree";
import { actionKindOf } from "./workflowChrome";

export const DIAG_ACTIONS = { qualify: "Qualify", inform: "Inform", informRoute: "Inform & Route",
  escalate: "Support & Escalate", callback: "Schedule Callback" } as const;

/** Fields every conversation can fill, beside the box's own chips. Invented for the demo,
 *  in the same spirit as the capture's "Consumer Lead Score" and "Disposition". */
export const DEMO_FIELDS = ["Customer Type", "Lead Score", "Disposition"] as const;

/** Plain integration actions the agent "calls". Invented; see the header. */
export const DIAG_TOOLS = [
  "Check Service Area", "Look Up Customer", "Get Calendar Availability", "Create Appointment",
  "Update Customer Record", "Get Billing History", "Create Support Ticket", "Send Confirmation Text",
] as const;

export const UNDETERMINED = "Undetermined";

export interface DiagSegment { segment: string; action: string; chips: string[] }
export interface DiagCatalog {
  segments: DiagSegment[];
  fields: string[];
  signals: string[];
  tools: string[];
  knowledge: string[];
}

/** What the model returns for one turn, before validation. */
export interface RawDiag {
  segment?: unknown; knowledge?: unknown; fields?: unknown; signals?: unknown; tools?: unknown;
}
/** One turn, validated. Cumulative fields/tools are folded in `foldDiags`. */
export interface TurnDiag {
  segment: string; action: string; chips: string[];
  knowledge: string;                  // a knowledge source NAME, or ""
  fields: Record<string, string>;     // everything known so far, as the model saw it
  signals: string[];                  // fired this turn
  tools: string[];                    // called up to and including this turn
}

type Node = { title: string; action?: string; actionKind?: TreePath["actionKind"]; chips?: string[]; paths?: Node[] };
type Branch = { title?: string; leaves?: Node[] };

const actionLabel = (n: Node | undefined): string => {
  const k = actionKindOf(n as never);
  return k ? DIAG_ACTIONS[k] : "Qualify";
};

/** Every node path the diagram draws, "Leaf:Path:Sub" as the widget writes it. */
export function diagSegments(branches: Branch[] | undefined): DiagSegment[] {
  const out: DiagSegment[] = [];
  const walk = (n: Node, prefix: string, inherited: string[]) => {
    const segment = prefix ? `${prefix}:${n.title}` : n.title;
    const chips = [...new Set([...inherited, ...(n.chips ?? [])].filter((c) => c && c !== "..."))];
    out.push({ segment, action: actionLabel(n), chips });
    for (const p of n.paths ?? []) walk(p, segment, chips);
  };
  for (const b of branches ?? []) for (const l of b.leaves ?? []) walk(l, "", []);
  return out;
}

export function diagCatalog(branches: Branch[] | undefined, signals: string[], knowledge: string[]): DiagCatalog {
  const segments = diagSegments(branches);
  const fields = [...new Set([...segments.flatMap((s) => s.chips), ...DEMO_FIELDS])];
  return { segments, fields, signals: [...new Set(signals.filter(Boolean))], tools: [...DIAG_TOOLS],
    knowledge: [...new Set(knowledge.filter(Boolean))] };
}

/** The request the agent answers in diagnostics mode (engine/chat.ts `DIAGNOSE`). */
export function diagRequest(c: DiagCatalog, known: Record<string, string> = {}, fired: string[] = []): string {
  return [
    "(Preview diagnostics request from the person testing this agent, not the customer.)",
    "Describe your previous reply as ONE JSON object with exactly these keys:",
    `"segment": the workflow path the conversation is on now, copied exactly from SEGMENTS, or "${UNDETERMINED}" if it is not yet clear;`,
    `"knowledge": the KNOWLEDGE source name your previous reply drew on to answer a question about the business, or "" if it did not;`,
    `"fields": an object of every FIELDS name whose value is known so far in the whole conversation, mapped to a short value (what the customer said, or for Customer Type "New" or "Existing", for Lead Score "Hot", "Warm", "Cold" or "Disqualified", for Disposition "In Progress", "Appointment Booked", "Support Escalated" or "Resolved");`,
    `"signals": the SIGNALS names whose condition was clearly met for the FIRST time on your previous reply's turn (usually none; one that has already fired never fires again);`,
    `"tools": the TOOLS you would have called so far in the conversation, in order (for example Check Service Area once a ZIP code is given, Get Calendar Availability before offering times, Create Appointment once a time is confirmed, Look Up Customer once an existing customer identifies themselves).`,
    `SEGMENTS: ${JSON.stringify(c.segments.map((s) => s.segment))}`,
    `FIELDS: ${JSON.stringify(c.fields)}`,
    `SIGNALS: ${JSON.stringify(c.signals)}`,
    `TOOLS: ${JSON.stringify(c.tools)}`,
    `KNOWLEDGE: ${JSON.stringify(c.knowledge)}`,
    /* ⚠️ Without these the model re-derived every value each turn and they flip-flopped (a
       category read "Common Household Pests", then "Ants"), lighting rows green that had not
       changed. A value only moves when the customer changes it. */
    `KNOWN SO FAR (keep these values exactly unless the customer has since changed them): ${JSON.stringify(known)}`,
    `ALREADY FIRED (never list these again): ${JSON.stringify(fired)}`,
  ].join("\n");
}

/** Pull the first JSON object out of a reply that may carry stray text or fences. */
export function parseRawDiag(text: string): RawDiag | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(text.slice(a, b + 1)); return v && typeof v === "object" ? v as RawDiag : null; }
  catch { return null; }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const pick = (v: unknown, from: string[]): string | undefined => {
  if (typeof v !== "string") return undefined;
  return from.find((x) => norm(x) === norm(v));
};

/** Keep only what the catalogs allow. The action always comes from the node. */
export function validateDiag(raw: RawDiag | null, c: DiagCatalog, prevTools: string[] = []): TurnDiag {
  const seg = c.segments.find((s) => norm(s.segment) === norm(String(raw?.segment ?? "")));
  const fields: Record<string, string> = {};
  if (raw?.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)) {
    for (const [k, v] of Object.entries(raw.fields as Record<string, unknown>)) {
      const name = pick(k, c.fields);
      const val = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v).trim() : "";
      if (name && val) fields[name] = val;
    }
  }
  const list = (v: unknown, from: string[]) =>
    (Array.isArray(v) ? v : []).map((x) => pick(x, from)).filter((x): x is string => !!x);
  /* Tool calls are cumulative in the capture (a later turn still lists the earlier ones), so
     the previous turn's are kept in front whatever the model remembers. */
  const tools = [...prevTools];
  for (const t of list(raw?.tools, c.tools)) if (!tools.includes(t)) tools.push(t);
  return {
    segment: seg?.segment ?? UNDETERMINED,
    action: seg?.action ?? "Qualify",
    chips: seg?.chips ?? [],
    knowledge: pick(raw?.knowledge, c.knowledge) ?? "",
    fields,
    signals: [...new Set(list(raw?.signals, c.signals))],
    tools,
  };
}

/** One row of the DATA FIELDS section. */
export interface FieldRow { name: string; value?: string; status: "missing" | "collected" | "new" }

/**
 * The DATA FIELDS rows for a turn: the node's own fields first if not yet collected, then
 * everything collected, matching the capture's order ("Not yet collected" rows lead).
 * `prev` is the previous turn's known values; a value that is new or changed is "new"
 * (the green row).
 */
export function fieldRows(d: TurnDiag, known: Record<string, string>, prev: Record<string, string>): FieldRow[] {
  const missing = d.chips.filter((f) => !known[f]).map((name) => ({ name, status: "missing" as const }));
  const collected = Object.entries(known).map(([name, value]) => ({
    name, value, status: (prev[name] === value ? "collected" : "new") as FieldRow["status"],
  }));
  return [...missing, ...collected];
}
