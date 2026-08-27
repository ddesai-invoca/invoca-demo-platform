import { useCallback, useEffect, useState } from "react";

/* =============================================================================
   Workflows an SE creates in Agent Studio
   -----------------------------------------------------------------------------
   **Create Workflow** asks for a name and a channel, and what it builds is an EMPTY
   workflow — measured 8/27/2026 off a capture taken straight after creating one
   (`/networks/2751/ai_agents/edit/169/workflow/550`, kept at
   `reference/agent-workflow/create-workflow-built.html`). The user's words: "an empty
   template with just the starting tree without anything."

   These have to outlive the click, so they are stored here. Same shape and same reasoning
   as `insightsDashboards.ts`:

   ⚠️ **PER PROSPECT**, keyed by profile id. A workflow an SE built while demoing Marriott
   must not appear in Comfort Keepers' sub-nav — the rule the SMS/Voice capture stores and
   the Insights dashboard store already follow.

   ⚠️ **NO TTL.** A captured conversation is a session artifact that should expire; a
   workflow somebody named is not. It stays until removed.

   ⚠️ **A `storage` LISTENER**, because the app can be open in more than one tab (the
   Preview Agent already depends on that) — a workflow created in one should appear in the
   other's sub-nav rather than only after a reload.

   **Consequence, stated rather than discovered later:** localStorage means per BROWSER, so
   a created workflow does NOT follow a demo to a colleague. That matches the two capture
   stores and the Insights dashboards; move it into the demo record if sharing one matters.
   ============================================================================= */

/** The two channels the Create Workflow modal offers, in its own order. */
export type WorkflowChannel = "SMS" | "Voice";

export interface CreatedWorkflow {
  /** Stable id, and the `:id` the route addresses it by. */
  id: string;
  name: string;
  channel: WorkflowChannel;
  /** ISO string. Nothing prints it yet; it is what orders the list. */
  createdAt: string;
}

const KEY = "invoca-demo:agent-workflows";

type Store = Record<string, CreatedWorkflow[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Store) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    /* A corrupt or unavailable store must not take the whole sub-nav down with it. */
    return {};
  }
}

/* =============================================================================
   ⚠️⚠️ IN-PROCESS SUBSCRIBERS, BECAUSE `storage` DOES NOT FIRE IN THE TAB THAT WROTE
   -----------------------------------------------------------------------------
   This bit off a real bug, and the symptom pointed nowhere near the cause. `AgentStudioLayout`
   and `AgentWorkflow` each call the hook, so there are TWO instances of this state. Creating a
   workflow wrote localStorage and updated the LAYOUT's copy; the page was already mounted
   (the SE was on `/workflow/voice`), its own copy stayed stale, `byId` found nothing, and the
   created-workflow branch fell through to the SMS default — so clicking Create on a **Voice**
   workflow rendered "Agent Workflow: Marriott - SMS" while the URL, the store and the
   highlighted sub-nav row were all correct.

   The `storage` event is deliberately not delivered to the writing tab, so the cross-tab
   listener below could never have covered this. Writes now notify every mounted hook directly
   and the listener stays for the other tab. Same class as the two-voice-engines bug: two
   copies of one thing, working separately until one of them had to know about a change.
   ============================================================================= */
const subs = new Set<(items: Store) => void>();

function write(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota or private mode */ }
  /* AFTER the write, so a subscriber that re-reads sees the same thing either way. */
  subs.forEach((fn) => fn(s));
}

/** The route a created workflow lives at. */
export function createdWorkflowPath(id: string): string {
  return `/agent-studio/agent/workflow/new/${id}`;
}

export function useAgentWorkflows(profileId: string) {
  const [items, setItems] = useState<CreatedWorkflow[]>(() => read()[profileId] ?? []);

  useEffect(() => { setItems(read()[profileId] ?? []); }, [profileId]);

  /* Same-tab: every mounted hook hears every write (see the note above). */
  useEffect(() => {
    const fn = (s: Store) => setItems(s[profileId] ?? []);
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, [profileId]);

  /* Other tabs: `storage` fires there and only there. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setItems(read()[profileId] ?? []);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [profileId]);

  const create = useCallback((name: string, channel: WorkflowChannel): CreatedWorkflow => {
    const item: CreatedWorkflow = {
      id: `w${Date.now().toString(36)}`,
      name: name.trim(),
      channel,
      createdAt: new Date().toISOString(),
    };
    const s = read();
    /* ⚠️ APPENDED, not prepended. The capture shows the new row BELOW the existing
       workflow, which is also the only order that keeps the two built-in rows where an SE
       expects them — the Insights dashboard list is newest-first because ITS capture is. */
    s[profileId] = [...(s[profileId] ?? []), item];
    write(s);   /* notifies THIS hook too, so no local setItems */
    return item;
  }, [profileId]);

  const remove = useCallback((id: string) => {
    const s = read();
    s[profileId] = (s[profileId] ?? []).filter((w) => w.id !== id);
    write(s);
  }, [profileId]);

  const byId = useCallback((id: string) => items.find((w) => w.id === id), [items]);

  return { items, create, remove, byId };
}
