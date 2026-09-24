import { CustomerProfile } from "./schema";
import { useProfile } from "./ProfileContext";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* Client for the shared team demo library (server-backed — see engine/demoApi.ts).
   Demos live on the server so the whole team sees the same list; each one records
   who created it. Everyone can view any demo; only the creator can edit or delete
   theirs; anyone can duplicate someone else's to get an editable copy.

   PROJECT ADMINS can edit and delete anyone's demo. `admin` comes from the
   SERVER (it decides who is an admin, from DEMO_ADMIN_EMAILS) rather than being
   worked out here, because this flag only unlocks UI — the API enforces the rule
   independently, and a client that lied about it would just collect 403s.

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
  /* Set only when someone other than the creator (an admin) last edited it. */
  updatedBy?: DemoCreator;
  /* Event roster this demo belongs to, when it belongs to one — see
     src/data/eventDemos.ts. Flows through /api/demos for free, since the
     server's DemoSummary is the record minus the heavy payload. */
  event?: string;
  /* The verbatim name from the list this roster was built from, when it differs
     from `prospect` — searchable, so pasting the original still finds the row. */
  listedAs?: string;
}

export interface DemoCustomizations {
  overrides: Record<string, unknown>;
  tiles: Record<string, unknown[]>;
}

export interface LoadedDemo {
  demo: DemoSummary & { profile: unknown; customizations: DemoCustomizations };
  canEdit: boolean;
}

/** The three statuses an SE can put on a demo they delivered. Mirrors
 *  `MARK_STATUSES` in engine/demoMarks.ts — the server refuses anything else. */
export type MarkStatus = "demoed" | "follow-up" | "lead";

/** One person's mark on one demo, joined with that demo's own name by the API
 *  so a follow-up list reads as prospects rather than as ids. */
export interface DemoMark {
  demoId: string;
  email: string;
  name: string;
  status: MarkStatus;
  note?: string;
  at: string;
  prospect?: string;
  industry?: string;
  event?: string;
}

/** One Salesforce account owner — the AE on a prospect. Mirrors
 *  `RepCandidate` in engine/salesforceApi.ts. */
export interface Rep {
  accountId: string;
  accountName: string;
  website: string;
  ownerName: string;
  ownerEmail: string;
  ownerActive: boolean;
}

/** What the server found for one demo's website domain. `rep` is set only when
 *  it resolved to exactly one person; several owners come back as `candidates`
 *  for a human to choose between, and nothing is ever guessed. */
export interface RepLookup {
  domain: string;
  rep: Rep | null;
  candidates: Rep[];
  reason?: string;
}

/** What happened to the optional "tell the rep" half of a mark. */
export interface NotifyResult {
  sent: boolean;
  /** Which mailbox it left from — the SE's own when connected, the platform's
   *  otherwise. Reported rather than assumed, because "sent" hides the fallback. */
  sentAs?: string;
  to?: string;
  name?: string;
  reason?: string;
  candidates?: Rep[];
}

interface Ctx {
  me: DemoCreator | null;
  /** Project admin: may edit and delete every demo, not only their own. */
  admin: boolean;
  /** A one-time "you're now an admin" notice, true until this person dismisses it.
   *  See engine/adminNotices.ts — the server decides who is owed one and when it
   *  has been seen, the same "server decides, client just renders" split as `admin`
   *  itself. */
  adminNotice: boolean;
  dismissAdminNotice: () => Promise<void>;
  demos: DemoSummary[];
  loading: boolean;
  available: boolean;
  refresh: () => Promise<void>;
  isMine: (d: { creator?: DemoCreator }) => boolean;
  /** Mine OR I am an admin — i.e. the server will accept my writes. */
  canManage: (d: { creator?: DemoCreator }) => boolean;
  openDemo: (id: string) => Promise<LoadedDemo | null>;
  createDemo: (profile: unknown, customizations?: DemoCustomizations) => Promise<DemoSummary | null>;
  duplicateDemo: (id: string) => Promise<DemoSummary | null>;
  deleteDemo: (id: string) => Promise<boolean>;
  saveCustomizations: (id: string, customizations: DemoCustomizations) => Promise<boolean>;
  /** MY marks, newest first. The server never sends anyone else's here. */
  marks: DemoMark[];
  /** This demo's status for me, or null. */
  markFor: (demoId: string) => DemoMark | null;
  /** Set or replace my mark. Passing null removes it.
   *  `notify` opts into telling the prospect's Salesforce account owner — off
   *  unless asked for, per demo (see engine/demoApi.notifyRep for why). */
  setMark: (
    demoId: string,
    status: MarkStatus | null,
    note?: string,
    notify?: { accountId?: string },
  ) => Promise<{ ok: boolean; notified?: NotifyResult }>;
  /** Who owns this prospect's Salesforce account, so the panel can NAME them
   *  before an SE commits to emailing them. */
  lookupRep: (demoId: string) => Promise<RepLookup | null>;
  /** Has this SE connected their own mailbox, so notifications come FROM them
   *  and land in THEIR Sent folder? */
  gmailStatus: () => Promise<{ connected: boolean; address: string } | null>;
}

const Ctx = createContext<Ctx | null>(null);

/* ⚠️ RETRIES ARE GET-ONLY, AND THAT IS NOT A DETAIL. This one helper also carries
   createDemo, duplicateDemo, deleteDemo and saveCustomizations. A retried POST that
   actually succeeded server-side but looked like a network failure would duplicate a
   demo or re-send a delete, so only requests with no side effect are ever repeated.

   Why retry at all: a deploy takes the origin away for ~40s (a Render disk detaches
   before the new instance boots — CLAUDE.md TODO 0), and the first thing a freshly
   loaded page does is ask for the library. A short backoff rides out a blip; the
   longer outage is handled by the self-heal poll in the provider below, because
   blocking a page load for 40s would be worse than showing a state that recovers. */
const GET_RETRIES = 3;
const RETRY_BASE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const idempotent = !init?.method || init.method.toUpperCase() === "GET";
  const attempts = idempotent ? GET_RETRIES + 1 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    try {
      const res = await fetch(path, {
        ...init,
        headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
      });
      /* A 5xx during a deploy is the same situation as a refused connection — the
         instance is going away. 4xx is an answer, so it is never retried. */
      if (res.status >= 500 && !last) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        // 403 (not yours) is an expected outcome, not a crash — callers handle null.
        if (res.status !== 403) console.warn(`[library] ${path} → ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (e) {
      if (!last) { await sleep(RETRY_BASE_MS * 2 ** attempt); continue; }
      console.warn(`[library] ${path} unreachable:`, e);
      return null;
    }
  }
  return null;
}

export function DemoLibraryProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<DemoCreator | null>(null);
  const [admin, setAdmin] = useState(false);
  const [adminNotice, setAdminNotice] = useState(false);
  const [demos, setDemos] = useState<DemoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const data = await api<{ demos: DemoSummary[]; user: DemoCreator; admin?: boolean; adminNotice?: boolean }>("/api/demos");
    if (!data) { setAvailable(false); setLoading(false); return; }
    setAvailable(true);
    setDemos(data.demos ?? []);
    if (data.user) setMe(data.user);
    setAdmin(!!data.admin);
    setAdminNotice(!!data.adminNotice);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* SELF-HEAL AFTER A DEPLOY. The library being unreachable is almost always a deploy
     in progress (~40s of no origin while a Render disk moves — CLAUDE.md TODO 0), not a
     permanent failure. Without this, a page loaded inside that window stays stuck on the
     unavailable state until someone thinks to refresh — in front of a customer.
     Polling only while `available` is false, so a healthy session never polls at all.
     Bounded, because a genuinely dead backend should not be retried forever. */
  const healAttempts = useRef(0);
  useEffect(() => {
    if (available) { healAttempts.current = 0; return; }
    if (healAttempts.current >= 40) return;            // ~2 min at 3s
    const t = setTimeout(() => { healAttempts.current += 1; void refresh(); }, 3000);
    return () => clearTimeout(t);
  }, [available, refresh]);

  const isMine = useCallback(
    (d: { creator?: DemoCreator }) => !!me && (d.creator?.email ?? "").toLowerCase() === me.email.toLowerCase(),
    [me],
  );

  const canManage = useCallback(
    (d: { creator?: DemoCreator }) => admin || isMine(d),
    [admin, isMine],
  );

  const openDemo = useCallback((id: string) => api<LoadedDemo>(`/api/demos/${id}`), []);

  /* ⚠️ LOADED ONCE ALONGSIDE THE LIBRARY, NOT PER ROW. The Launch list renders
     hundreds of demos and each one needs to know whether I marked it; a request
     per row would be hundreds of round trips to draw a chip. One list, indexed
     by demo id below. The server sends only MY marks unless an admin asks for
     everyone's, so this can never hold a colleague's note. */
  const [marks, setMarks] = useState<DemoMark[]>([]);

  const refreshMarks = useCallback(async () => {
    const data = await api<{ marks: DemoMark[] }>("/api/marks");
    if (data) setMarks(data.marks ?? []);
  }, []);

  useEffect(() => { void refreshMarks(); }, [refreshMarks]);

  const markFor = useCallback(
    (demoId: string) => marks.find((m) => m.demoId === demoId) ?? null,
    [marks],
  );

  /* ⚠️ OPTIMISTIC, AND DELIBERATELY SO. This is a one-click action taken 25 times
     in an afternoon at a conference, often on hotel wifi — waiting on a round trip
     before the chip moves makes it feel broken and invites a second click, which
     would then be a second write. The local state moves first; a failed request
     rolls it back and reports false so the caller can say so. */
  const lookupRep = useCallback(
    (demoId: string) => api<RepLookup>(`/api/demos/${demoId}/rep`),
    [],
  );

  const gmailStatus = useCallback(
    () => api<{ connected: boolean; address: string }>("/api/gmail-status"),
    [],
  );

  const setMark = useCallback(async (
    demoId: string,
    status: MarkStatus | null,
    note?: string,
    notify?: { accountId?: string },
  ) => {
    const before = marks;
    const optimistic: DemoMark[] = status
      ? [
          { demoId, email: me?.email ?? "", name: me?.name ?? "", status, ...(note ? { note } : {}), at: new Date().toISOString() },
          ...marks.filter((m) => m.demoId !== demoId),
        ]
      : marks.filter((m) => m.demoId !== demoId);
    setMarks(optimistic);
    const r = status
      ? await api<{ mark: DemoMark; notified?: NotifyResult }>(`/api/demos/${demoId}/mark`, {
          method: "POST",
          /* ⚠️ THE ADDRESS IS NEVER SENT — only whether to notify, and which of
             the candidates the server itself resolved. See engine/demoApi.ts. */
          body: JSON.stringify({ status, note, ...(notify ? { notify: true, accountId: notify.accountId } : {}) }),
        })
      : await api<{ removed: boolean }>(`/api/demos/${demoId}/mark`, { method: "DELETE" });
    if (!r) { setMarks(before); return { ok: false }; }
    /* Re-read so the row carries the SERVER's timestamp and its joined prospect
       name, rather than the placeholder the optimistic entry was built with. */
    void refreshMarks();
    return { ok: true, notified: (r as { notified?: NotifyResult }).notified };
  }, [marks, me, refreshMarks]);

  /* ⚠️ CLEARED LOCALLY BEFORE THE REQUEST RESOLVES. The popup's own "Got it" click is
     the one moment nobody wants a network hiccup to leave the modal stuck on screen —
     dismissal is a one-way, idempotent fact from here on regardless of whether the ack
     reaches the server this second or on a retry. `api()`'s own retry-on-GET rule does
     not cover this POST, which is fine: worst case a slow ack means the notice can come
     back once on a reload, never that it fails to go away now. */
  const dismissAdminNotice = useCallback(async () => {
    setAdminNotice(false);
    await fetch("/api/admin-notice/ack", { method: "POST" }).catch(() => { /* best effort */ });
  }, []);

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
    <Ctx.Provider value={{ me, admin, adminNotice, dismissAdminNotice, demos, loading, available, refresh, isMine, canManage, openDemo, createDemo, duplicateDemo, deleteDemo, saveCustomizations, marks, markFor, setMark, lookupRep, gmailStatus }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDemoLibrary(): Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemoLibrary must be used within DemoLibraryProvider");
  return v;
}
