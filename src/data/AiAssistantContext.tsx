import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getByPath, isStructuralChange } from "./editGuard";

/* Global state for the "Ask AI" dashboard assistant. Holds:
   • the drawer open state + its FOCUS (whole dashboard, or one tile);
   • per-"<profileId>::<pathname>" EDITS to the dashboard's data (a non-destructive
     overlay — never rewrites the profile), AI-generated tiles, and a per-dashboard
     UNDO stack (one AI action = one undo step). All persisted to localStorage.

   The dashboard registers its BASE data via registerScope; the effective data
   shown/edited is (override ?? base). Edits are path-based ({path,value}); tiles
   are added/replaced/removed. Every mutation snapshots first so Undo can restore. */

export interface GeneratedTile {
  id: string;
  tileType: "kpi" | "line" | "bar" | "pie";
  title: string;
  note: string;
  kpis: { label: string; value: string }[];
  xLabels: string[];
  series: { name: string; values: number[] }[];
  slices: { label: string; value: number }[];
}

export interface AssistantFocus {
  scope: "dashboard" | "tile";
  tileKind?: "builtin" | "generated";
  id?: string;        // generated-tile id (tileKind "generated")
  label?: string;     // tile title
  preview?: string;   // short text preview of the tile
}

export interface AssistantEdit { path: string; value: string }

/* `questionPath` is an OPT-IN. Four screens register `agentConfig` as their scope,
   so every one of them has `smsPlaybook.qualifyingQuestions` sitting in its data;
   keying the drawer's question tools off "the data happens to contain a question
   list" would light them up on Agent Config, AI Recommendations and Knowledge
   Sources too. Only the page whose JOB is those questions passes this, which keeps
   the change to the one screen it was asked for. */
interface Scope { key: string; customerName: string; baseTitle: string; questionPath?: string }
interface Snapshot { override: unknown | undefined; tiles: GeneratedTile[] }

interface AiAssistantCtx {
  open: boolean;
  focus: AssistantFocus | null;
  openDrawer: (focus?: AssistantFocus) => void;
  closeDrawer: () => void;
  active: Scope | null;
  registerScope: (scope: { key: string; customerName: string; baseTitle: string; baseData: unknown; questionPath?: string }) => void;
  effectiveData: (key: string) => unknown;
  tilesFor: (key: string) => GeneratedTile[];
  applyEdits: (key: string, edits: AssistantEdit[]) => number;
  addTile: (key: string, tile: GeneratedTile) => void;
  replaceTile: (key: string, id: string, tile: Omit<GeneratedTile, "id">) => void;
  removeTile: (key: string, id: string) => void;
  undo: (key: string) => void;
  canUndo: (key: string) => boolean;
  undoDepth: (key: string) => number;
  /* Shared-library wiring: which demo is open, whether the signed-in user may
     edit it, and how to load one in. Null for built-in/local samples, which stay
     purely local and editable as before. */
  activeDemo: ActiveDemo | null;
  hydrateDemo: (id: string, customizations: DemoCustomizations, canEdit: boolean, creator: { name: string; email: string }) => void;
  readOnly: boolean;
}

export interface ActiveDemo { id: string; canEdit: boolean; creator: { name: string; email: string } }
export interface DemoCustomizations { overrides: Record<string, unknown>; tiles: Record<string, unknown[]> }

const Ctx = createContext<AiAssistantCtx | null>(null);

const LS = "invoca-demo:ai-state";
const UNDO_CAP = 50;

interface Persisted {
  overrides: Record<string, unknown>;
  tiles: Record<string, GeneratedTile[]>;
  undo: Record<string, Snapshot[]>;
}
function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    const o = raw ? JSON.parse(raw) : {};
    return { overrides: o.overrides ?? {}, tiles: o.tiles ?? {}, undo: o.undo ?? {} };
  } catch {
    return { overrides: {}, tiles: {}, undo: {} };
  }
}

/* Immutable deep-set: clones only along `path` (dot notation, numeric array
   indices) and sets the leaf. Never mutates the source (which may be React
   state). Returns the source unchanged if the path can't be traversed. */
function setByPath<T>(source: T, path: string, value: unknown): T {
  // Accept both dot and bracket notation ("a.0.b" or "a[0].b").
  const keys = path.replace(/\[(\w+)\]/g, ".$1").split(".").filter(Boolean);
  if (!keys.length) return source;
  const clone = (v: any) => (Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v);
  const root: any = clone(source);
  let cur: any = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur == null || typeof cur !== "object" || !(k in cur)) return source; // bad path → no-op
    cur[k] = clone(cur[k]);
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (cur == null || typeof cur !== "object") return source;
  cur[last] = value;
  return root;
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<AssistantFocus | null>(null);
  const [active, setActive] = useState<Scope | null>(null);
  const [store, setStore] = useState<Persisted>(() => load());
  const baseRef = useRef<Record<string, unknown>>({}); // base data per key (not persisted; re-registered on mount)
  const [activeDemo, setActiveDemo] = useState<ActiveDemo | null>(null);
  const lastSyncedRef = useRef<string>("");   // guards against saving what we just loaded

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify(store)); } catch { /* ignore */ }
  }, [store]);

  /* Pull one library demo's saved AI layer into the store. Server keys are bare
     pathnames ("/dashboards/marketing"); the store keys them "<demoId>::<path>". */
  const hydrateDemo = useCallback((id: string, c: DemoCustomizations, canEdit: boolean, creator: { name: string; email: string }) => {
    setStore((prev) => {
      const overrides = { ...prev.overrides };
      const tiles = { ...prev.tiles };
      for (const [p, v] of Object.entries(c?.overrides ?? {})) overrides[`${id}::${p}`] = v;
      for (const [p, v] of Object.entries(c?.tiles ?? {})) tiles[`${id}::${p}`] = v as GeneratedTile[];
      return { ...prev, overrides, tiles };
    });
    lastSyncedRef.current = JSON.stringify(c ?? {});
    setActiveDemo({ id, canEdit, creator });
  }, []);

  /* Persist the active demo's slice back to the shared library (owner only),
     debounced so a burst of edits is one write. */
  useEffect(() => {
    const demo = activeDemo;
    if (!demo?.canEdit) return;
    const prefix = `${demo.id}::`;
    const slice: DemoCustomizations = { overrides: {}, tiles: {} };
    for (const [k, v] of Object.entries(store.overrides)) if (k.startsWith(prefix)) slice.overrides[k.slice(prefix.length)] = v;
    for (const [k, v] of Object.entries(store.tiles)) if (k.startsWith(prefix)) slice.tiles[k.slice(prefix.length)] = v;
    const payload = JSON.stringify(slice);
    if (payload === lastSyncedRef.current) return;   // nothing new since the last save/load
    const t = setTimeout(() => {
      lastSyncedRef.current = payload;
      fetch(`/api/demos/${demo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizations: slice }),
      }).catch((e) => console.warn("[library] save failed:", e));
    }, 800);
    return () => clearTimeout(t);
  }, [store, activeDemo]);

  const openDrawer = useCallback((f?: AssistantFocus) => { setFocus(f ?? null); setOpen(true); }, []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  const registerScope = useCallback((s: { key: string; customerName: string; baseTitle: string; baseData: unknown; questionPath?: string }) => {
    baseRef.current[s.key] = s.baseData;
    setActive((prev) => (
      prev && prev.key === s.key && prev.baseTitle === s.baseTitle && prev.questionPath === s.questionPath
        ? prev
        : { key: s.key, customerName: s.customerName, baseTitle: s.baseTitle, questionPath: s.questionPath }
    ));
  }, []);

  const effectiveData = useCallback((key: string) => (key in store.overrides ? store.overrides[key] : baseRef.current[key]), [store.overrides]);
  const tilesFor = useCallback((key: string) => store.tiles[key] ?? [], [store.tiles]);
  const canUndo = useCallback((key: string) => (store.undo[key]?.length ?? 0) > 0, [store.undo]);
  const undoDepth = useCallback((key: string) => store.undo[key]?.length ?? 0, [store.undo]);

  /* Viewing someone else's library demo: everything is read-only. The server is
     the real authority (it 403s a PATCH from a non-owner) — this just stops the
     UI from showing changes that would never be saved. */
  const readOnly = !!activeDemo && !activeDemo.canEdit;

  // Push the current (override, tiles) as one undo step, then apply `mutate`.
  const mutate = useCallback((key: string, next: { override?: unknown | undefined; tiles?: GeneratedTile[] }) => {
    if (readOnly) return;
    setStore((prev) => {
      const snap: Snapshot = { override: key in prev.overrides ? prev.overrides[key] : undefined, tiles: prev.tiles[key] ?? [] };
      const undoStack = [...(prev.undo[key] ?? []), snap].slice(-UNDO_CAP);
      const overrides = { ...prev.overrides };
      if ("override" in next) {
        if (next.override === undefined) delete overrides[key];
        else overrides[key] = next.override;
      }
      const tiles = { ...prev.tiles };
      if (next.tiles) tiles[key] = next.tiles;
      return { overrides, tiles, undo: { ...prev.undo, [key]: undoStack } };
    });
  }, [readOnly]);

  /* RULE 2 IS ENFORCED HERE, not only asked for in the prompt.

     Every edit is checked against the value it replaces and dropped if it would
     change the page's SHAPE rather than its content — a different array length
     (which adds or removes a row, series, column or tile, and in places drives
     the CSS grid itself) or a type flip (which breaks the component rendering
     it). The prompt already forbids both; this is what makes it true when the
     model does not listen. Same instruct-then-enforce pairing the dash rule
     needed. See editGuard.ts. */
  const applyEdits = useCallback((key: string, edits: AssistantEdit[]): number => {
    const base = key in store.overrides ? store.overrides[key] : baseRef.current[key];
    if (base == null || readOnly) return 0;
    let nextData: unknown = base;
    let applied = 0, blocked = 0;
    for (const e of edits) {
      let val: unknown;
      try { val = JSON.parse(e.value); } catch { val = e.value; }
      const before = getByPath(nextData, e.path);
      if (isStructuralChange(before, val, e.path)) {
        blocked++;
        console.warn(`[ai] blocked a structural edit at "${e.path}" (data only — see editGuard.ts)`);
        continue;
      }
      const after = setByPath(nextData, e.path, val);
      if (after !== nextData) { nextData = after; applied++; }
    }
    if (blocked && !applied) console.warn(`[ai] all ${blocked} edit(s) were structural; nothing changed.`);
    if (applied) mutate(key, { override: nextData });
    return applied;
  }, [store.overrides, mutate, readOnly]);

  const addTile = useCallback((key: string, tile: GeneratedTile) => {
    mutate(key, { tiles: [...(store.tiles[key] ?? []), tile] });
  }, [store.tiles, mutate]);

  const replaceTile = useCallback((key: string, id: string, tile: Omit<GeneratedTile, "id">) => {
    mutate(key, { tiles: (store.tiles[key] ?? []).map((t) => (t.id === id ? { ...tile, id } : t)) });
  }, [store.tiles, mutate]);

  const removeTile = useCallback((key: string, id: string) => {
    mutate(key, { tiles: (store.tiles[key] ?? []).filter((t) => t.id !== id) });
  }, [store.tiles, mutate]);

  const undo = useCallback((key: string) => {
    if (readOnly) return;
    setStore((prev) => {
      const stack = prev.undo[key] ?? [];
      if (!stack.length) return prev;
      const snap = stack[stack.length - 1];
      const overrides = { ...prev.overrides };
      if (snap.override === undefined) delete overrides[key];
      else overrides[key] = snap.override;
      return { overrides, tiles: { ...prev.tiles, [key]: snap.tiles }, undo: { ...prev.undo, [key]: stack.slice(0, -1) } };
    });
  }, [readOnly]);

  return (
    <Ctx.Provider value={{ open, focus, openDrawer, closeDrawer, active, registerScope, effectiveData, tilesFor, applyEdits, addTile, replaceTile, removeTile, undo, canUndo, undoDepth, activeDemo, hydrateDemo, readOnly }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAiAssistant(): AiAssistantCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAiAssistant must be used within AiAssistantProvider");
  return v;
}
