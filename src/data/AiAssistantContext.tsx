import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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

interface Scope { key: string; customerName: string; baseTitle: string }
interface Snapshot { override: unknown | undefined; tiles: GeneratedTile[] }

interface AiAssistantCtx {
  open: boolean;
  focus: AssistantFocus | null;
  openDrawer: (focus?: AssistantFocus) => void;
  closeDrawer: () => void;
  active: Scope | null;
  registerScope: (scope: { key: string; customerName: string; baseTitle: string; baseData: unknown }) => void;
  effectiveData: (key: string) => unknown;
  tilesFor: (key: string) => GeneratedTile[];
  applyEdits: (key: string, edits: AssistantEdit[]) => number;
  addTile: (key: string, tile: GeneratedTile) => void;
  replaceTile: (key: string, id: string, tile: Omit<GeneratedTile, "id">) => void;
  removeTile: (key: string, id: string) => void;
  undo: (key: string) => void;
  canUndo: (key: string) => boolean;
  undoDepth: (key: string) => number;
}

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

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify(store)); } catch { /* ignore */ }
  }, [store]);

  const openDrawer = useCallback((f?: AssistantFocus) => { setFocus(f ?? null); setOpen(true); }, []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  const registerScope = useCallback((s: { key: string; customerName: string; baseTitle: string; baseData: unknown }) => {
    baseRef.current[s.key] = s.baseData;
    setActive((prev) => (prev && prev.key === s.key && prev.baseTitle === s.baseTitle ? prev : { key: s.key, customerName: s.customerName, baseTitle: s.baseTitle }));
  }, []);

  const effectiveData = useCallback((key: string) => (key in store.overrides ? store.overrides[key] : baseRef.current[key]), [store.overrides]);
  const tilesFor = useCallback((key: string) => store.tiles[key] ?? [], [store.tiles]);
  const canUndo = useCallback((key: string) => (store.undo[key]?.length ?? 0) > 0, [store.undo]);
  const undoDepth = useCallback((key: string) => store.undo[key]?.length ?? 0, [store.undo]);

  // Push the current (override, tiles) as one undo step, then apply `mutate`.
  const mutate = useCallback((key: string, next: { override?: unknown | undefined; tiles?: GeneratedTile[] }) => {
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
  }, []);

  const applyEdits = useCallback((key: string, edits: AssistantEdit[]): number => {
    const base = key in store.overrides ? store.overrides[key] : baseRef.current[key];
    if (base == null) return 0;
    let nextData: unknown = base;
    let applied = 0;
    for (const e of edits) {
      let val: unknown;
      try { val = JSON.parse(e.value); } catch { val = e.value; }
      const after = setByPath(nextData, e.path, val);
      if (after !== nextData) { nextData = after; applied++; }
    }
    if (applied) mutate(key, { override: nextData });
    return applied;
  }, [store.overrides, mutate]);

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
    setStore((prev) => {
      const stack = prev.undo[key] ?? [];
      if (!stack.length) return prev;
      const snap = stack[stack.length - 1];
      const overrides = { ...prev.overrides };
      if (snap.override === undefined) delete overrides[key];
      else overrides[key] = snap.override;
      return { overrides, tiles: { ...prev.tiles, [key]: snap.tiles }, undo: { ...prev.undo, [key]: stack.slice(0, -1) } };
    });
  }, []);

  return (
    <Ctx.Provider value={{ open, focus, openDrawer, closeDrawer, active, registerScope, effectiveData, tilesFor, applyEdits, addTile, replaceTile, removeTile, undo, canUndo, undoDepth }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAiAssistant(): AiAssistantCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAiAssistant must be used within AiAssistantProvider");
  return v;
}
