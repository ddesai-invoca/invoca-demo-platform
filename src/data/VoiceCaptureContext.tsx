import { createContext, useContext, useEffect, useState, type ReactNode, useRef } from "react";
import { reportShareActivity, sendSharedConversation } from "./shareActivity";
import { isShareMode } from "./shareMode";
import { useProfile } from "./ProfileContext";
import type { VoiceConversation } from "./schema";

/* Holds AI-voice calls captured live from the Preview Agent, keyed by prospect
   id. Ending a Preview-Agent voice call PREPENDS the just-had call here; the AI
   Voice Conversation Intelligence report reads it and shows it at the top of the
   queue. Sibling of SmsCaptureContext.

   Persisted to localStorage with a 7-DAY TTL, so captures accumulate (each new
   one adds to the top) and survive reloads for a week. */

const LS_KEY = "invoca-demo:voice-captures";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/* ⚠️⚠️ **A SHARED DEMO KEEPS EVERY CONVERSATION (10/14/2026).** Asked for directly: a prospect's
   own voice conversations stay in their report however many there are. The 7-day TTL and the 25
   cap are for an SE's rehearsal captures; on a share they would quietly drop a prospect's
   eighth-day return visit or their 26th conversation, which reads as the report losing data.
   The share link's own expiry is what ends the demo. Signed-in behaviour is unchanged.
   ⚠️ Still per BROWSER: a prospect on a second device starts with an empty list. */
const KEEP_ALL = isShareMode();
const MAX_PER_PROFILE = KEEP_ALL ? Number.POSITIVE_INFINITY : 25;

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
      const fresh = (arr ?? []).filter((e) => e && typeof e.savedAt === "number" && (KEEP_ALL || now - e.savedAt < WEEK_MS));
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

  /* On a shared demo, every conversation is also sent to the server (10/21/2026), so the event
     sheet can link to it. Only ones that changed since they were last sent, a second after the
     latest change, so a burst of turns and the signals that follow go as one. */
  /* ⚠️ ONLY THE SHARED DEMO'S OWN CONVERSATIONS. The store is per browser and keyed by
     prospect, so an Invoca employee testing a link in their own browser also holds captures
     from other demos; sending every key filed one prospect's conversation under another. */
  const { profileId } = useProfile();
  const sent = useRef(new Map<string, string>());
  useEffect(() => {
    if (!isShareMode()) return;
    const t = setTimeout(() => {
      for (const e of store[profileId] ?? []) {
        const json = JSON.stringify(e.conv);
        if (sent.current.get(e.conv.id) === json) continue;
        sent.current.set(e.conv.id, json);
        sendSharedConversation("voice", e.conv);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [store, profileId]);

  const capturedFor = (profileId: string) => (store[profileId] ?? []).map((e) => e.conv);
  const addCaptured = (profileId: string, conv: VoiceConversation) => {
    /* ⚠️ A voice call has a real end — this runs when one is captured. Still deduped on
       the call's own id server-side, so a re-capture cannot double it. */
    reportShareActivity("voice", conv.id);
    setStore((prev) => ({
      ...prev,
      [profileId]: [{ savedAt: Date.now(), conv }, ...(prev[profileId] ?? [])].slice(0, MAX_PER_PROFILE),
    }));
  };
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
