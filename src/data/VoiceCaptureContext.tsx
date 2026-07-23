import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { VoiceConversation } from "./schema";

/* Holds AI-voice calls captured live from the Preview Agent, keyed by prospect
   id. Ending a Preview-Agent voice call PREPENDS the just-had call here; the AI
   Voice Conversation Intelligence report reads it and shows it at the top of the
   queue. Sibling of SmsCaptureContext.

   Persisted to localStorage with a 7-DAY TTL, so captures accumulate (each new
   one adds to the top) and survive reloads for a week. */

const LS_KEY = "invoca-demo:voice-captures";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_PROFILE = 25;

interface Entry { savedAt: number; conv: VoiceConversation }
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

interface VoiceCaptureCtx {
  capturedFor: (profileId: string) => VoiceConversation[];
  addCaptured: (profileId: string, conv: VoiceConversation) => void;
  patchCaptured: (profileId: string, id: string, patch: Partial<VoiceConversation>) => void;
}

const Ctx = createContext<VoiceCaptureCtx | null>(null);

export function VoiceCaptureProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(() => load());

  // Persist on every change (and prune-on-load already ran in load()).
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* ignore quota */ }
  }, [store]);

  const capturedFor = (profileId: string) => (store[profileId] ?? []).map((e) => e.conv);
  const addCaptured = (profileId: string, conv: VoiceConversation) =>
    setStore((prev) => ({
      ...prev,
      [profileId]: [{ savedAt: Date.now(), conv }, ...(prev[profileId] ?? [])].slice(0, MAX_PER_PROFILE),
    }));
  const patchCaptured = (profileId: string, id: string, patch: Partial<VoiceConversation>) =>
    setStore((prev) => ({
      ...prev,
      [profileId]: (prev[profileId] ?? []).map((e) => (e.conv.id === id ? { ...e, conv: { ...e.conv, ...patch } } : e)),
    }));

  return <Ctx.Provider value={{ capturedFor, addCaptured, patchCaptured }}>{children}</Ctx.Provider>;
}

export function useVoiceCapture(): VoiceCaptureCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoiceCapture must be used within VoiceCaptureProvider");
  return v;
}
