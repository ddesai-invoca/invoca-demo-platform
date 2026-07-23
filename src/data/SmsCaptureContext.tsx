import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SmsConversation } from "./schema";

/* Holds SMS conversations captured live from the Preview Agent, keyed by prospect
   id. The Preview Agent (now its OWN browser tab) upserts the just-had chat here
   as it happens; the AI SMS Conversation Intelligence report reads it and shows
   it at the top of the queue.

   Persisted to localStorage with a 7-DAY TTL. Writes are SYNCHRONOUS (so they
   survive the preview tab closing) and a `storage` listener syncs the change into
   ANY other open tab (so the report tab updates live — no refresh needed). */

const LS_KEY = "invoca-demo:sms-captures";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_PROFILE = 25;

interface Entry { savedAt: number; conv: SmsConversation }
type Store = Record<string, Entry[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Store;
    const now = Date.now();
    const pruned: Store = {};
    for (const [pid, arr] of Object.entries(data)) {
      const fresh = (arr ?? []).filter((e) => e && typeof e.savedAt === "number" && now - e.savedAt < WEEK_MS);
      if (fresh.length) pruned[pid] = fresh;
    }
    return pruned;
  } catch {
    return {};
  }
}

function persist(store: Store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* ignore quota */ }
}

interface SmsCaptureCtx {
  capturedFor: (profileId: string) => SmsConversation[];
  addCaptured: (profileId: string, conv: SmsConversation) => void;
  upsertCaptured: (profileId: string, conv: SmsConversation) => void;   // add-or-replace by conv.id
  patchCaptured: (profileId: string, id: string, patch: Partial<SmsConversation>) => void;
}

const Ctx = createContext<SmsCaptureCtx | null>(null);

export function SmsCaptureProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(() => load());

  // Compute the next store, write it to localStorage SYNCHRONOUSLY (so it survives
  // an immediate tab close), and update state. No persist-on-change effect — that
  // would ping-pong with the storage listener below across tabs.
  const mutate = (fn: (prev: Store) => Store) =>
    setStore((prev) => { const next = fn(prev); persist(next); return next; });

  // Live cross-tab sync: when another tab (e.g. the Preview Agent) writes captures,
  // reload so the report updates without a manual refresh.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY) setStore(load()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const capturedFor = (profileId: string) => (store[profileId] ?? []).map((e) => e.conv);

  const addCaptured = (profileId: string, conv: SmsConversation) =>
    mutate((prev) => ({ ...prev, [profileId]: [{ savedAt: Date.now(), conv }, ...(prev[profileId] ?? [])].slice(0, MAX_PER_PROFILE) }));

  const upsertCaptured = (profileId: string, conv: SmsConversation) =>
    mutate((prev) => {
      const arr = prev[profileId] ?? [];
      const idx = arr.findIndex((e) => e.conv.id === conv.id);
      if (idx >= 0) { const next = arr.slice(); next[idx] = { ...arr[idx], conv }; return { ...prev, [profileId]: next }; }
      return { ...prev, [profileId]: [{ savedAt: Date.now(), conv }, ...arr].slice(0, MAX_PER_PROFILE) };
    });

  const patchCaptured = (profileId: string, id: string, patch: Partial<SmsConversation>) =>
    mutate((prev) => ({ ...prev, [profileId]: (prev[profileId] ?? []).map((e) => (e.conv.id === id ? { ...e, conv: { ...e.conv, ...patch } } : e)) }));

  return <Ctx.Provider value={{ capturedFor, addCaptured, upsertCaptured, patchCaptured }}>{children}</Ctx.Provider>;
}

export function useSmsCapture(): SmsCaptureCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSmsCapture must be used within SmsCaptureProvider");
  return v;
}
