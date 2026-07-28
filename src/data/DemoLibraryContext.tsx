import { CustomerProfile } from "./schema";
import { useProfile } from "./ProfileContext";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* Client for the shared team demo library (server-backed — see engine/demoApi.ts).
   Demos live on the server so the whole team sees the same list; each one records
   who created it. Everyone can view any demo; only the creator can edit or delete
   theirs; anyone can duplicate someone else's to get an editable copy.

   Degrades gracefully: if the library API isn't reachable (offline, or a static
   host with no backend), `available` goes false and the app falls back to the
   local/bundled profiles it has always used. */

/* When we last cached each demo, keyed by id. Compared against the library's
   updatedAt to detect a server-side change the cache would otherwise hide. */
const LS_STAMPS = "invoca-demo:demo-stamps";

export interface DemoCreator { email: string; name: string }

export interface DemoSummary {
  id: string;
  prospect: string;
  websiteUrl: string;
  industry: string;
  creator: DemoCreator;
  createdAt: string;
  updatedAt: string;
}

export interface DemoCustomizations {
  overrides: Record<string, unknown>;
  tiles: Record<string, unknown[]>;
}

export interface LoadedDemo {
  demo: DemoSummary & { profile: unknown; customizations: DemoCustomizations };
  canEdit: boolean;
}

interface Ctx {
  me: DemoCreator | null;
  demos: DemoSummary[];
  loading: boolean;
  available: boolean;
  refresh: () => Promise<void>;
  isMine: (d: { creator?: DemoCreator }) => boolean;
  openDemo: (id: string) => Promise<LoadedDemo | null>;
  createDemo: (profile: unknown, customizations?: DemoCustomizations) => Promise<DemoSummary | null>;
  duplicateDemo: (id: string) => Promise<DemoSummary | null>;
  deleteDemo: (id: string) => Promise<boolean>;
  saveCustomizations: (id: string, customizations: DemoCustomizations) => Promise<boolean>;
}

const Ctx = createContext<Ctx | null>(null);

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    });
    if (!res.ok) {
      // 403 (not yours) is an expected outcome, not a crash — callers handle null.
      if (res.status !== 403) console.warn(`[library] ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[library] ${path} unreachable:`, e);
    return null;
  }
}

export function DemoLibraryProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<DemoCreator | null>(null);
  const [demos, setDemos] = useState<DemoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const data = await api<{ demos: DemoSummary[]; user: DemoCreator }>("/api/demos");
    if (!data) { setAvailable(false); setLoading(false); return; }
    setAvailable(true);
    setDemos(data.demos ?? []);
    if (data.user) setMe(data.user);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isMine = useCallback(
    (d: { creator?: DemoCreator }) => !!me && (d.creator?.email ?? "").toLowerCase() === me.email.toLowerCase(),
    [me],
  );

  const openDemo = useCallback((id: string) => api<LoadedDemo>(`/api/demos/${id}`), []);

  const createDemo = useCallback(async (profile: unknown, customizations?: DemoCustomizations) => {
    const r = await api<{ demo: DemoSummary }>("/api/demos", { method: "POST", body: JSON.stringify({ profile, customizations }) });
    if (r?.demo) await refresh();
    return r?.demo ?? null;
  }, [refresh]);

  const duplicateDemo = useCallback(async (id: string) => {
    const r = await api<{ demo: DemoSummary }>(`/api/demos/${id}/duplicate`, { method: "POST" });
    if (r?.demo) await refresh();
    return r?.demo ?? null;
  }, [refresh]);

  const deleteDemo = useCallback(async (id: string) => {
    const r = await api<{ ok: boolean }>(`/api/demos/${id}`, { method: "DELETE" });
    if (r) await refresh();
    return !!r?.ok;
  }, [refresh]);

  // Fire-and-forget from the caller's perspective; returns false when the server
  // rejected it (e.g. someone else's demo) so the UI can surface that.
  const saveCustomizations = useCallback(async (id: string, customizations: DemoCustomizations) => {
    const r = await api<{ demo: DemoSummary }>(`/api/demos/${id}`, { method: "PATCH", body: JSON.stringify({ customizations }) });
    return !!r?.demo;
  }, []);

  /* SELF-HEAL STALE CACHED PROFILES.
     ProfileContext caches profiles in localStorage so generated prospects
     survive a refresh, but that cache had no invalidation: it never asked
     whether the server's copy was newer. Opening a demo from the Launch screen
     always refetches, so it looked fine — but the top-bar switcher and a plain
     page reload read the cache, so a demo changed server-side (an AI edit from
     another browser, a server-side patch or migration) kept rendering the OLD
     content indefinitely, with no error anywhere.

     That cost real time four separate times: a workflow that "didn't appear", a
     local edit that "didn't work", a dash sweep that "didn't run", and a patched
     transcript that "wasn't there" — every one of them correct on the server and
     stale on screen.

     Fix: remember the updatedAt we cached each demo at, and when the library
     list says the server is newer, refetch that demo and replace the cached
     copy. Refetch rather than evict, so the ACTIVE demo heals in place instead
     of the app falling back to a different prospect mid-session. */
  const { profiles, addProfile } = useProfile();
  const healing = useRef(false);
  useEffect(() => {
    if (!demos.length || healing.current) return;
    const stamps: Record<string, string> = (() => {
      try { return JSON.parse(localStorage.getItem(LS_STAMPS) ?? "{}"); } catch { return {}; }
    })();
    const stale = demos.filter(
      (d) => profiles.some((p) => p.id === d.id) && stamps[d.id] !== d.updatedAt,
    );
    if (!stale.length) return;

    healing.current = true;
    (async () => {
      for (const d of stale) {
        const loaded = await openDemo(d.id);
        const parsed = loaded && CustomerProfile.safeParse(loaded.demo.profile);
        if (parsed?.success) {
          addProfile(parsed.data);
          stamps[d.id] = d.updatedAt;
        }
      }
      try { localStorage.setItem(LS_STAMPS, JSON.stringify(stamps)); } catch { /* ignore */ }
      healing.current = false;
    })();
  }, [demos, profiles, openDemo, addProfile]);

  return (
    <Ctx.Provider value={{ me, demos, loading, available, refresh, isMine, openDemo, createDemo, duplicateDemo, deleteDemo, saveCustomizations }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDemoLibrary(): Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemoLibrary must be used within DemoLibraryProvider");
  return v;
}
