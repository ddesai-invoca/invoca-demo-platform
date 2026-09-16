import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/* Holds the quote requests submitted from the Google Local Services Ad's "Get quote"
   dialog, keyed by prospect id — the SMS/Voice capture contexts' third sibling, and
   deliberately the same shape as both so there is one pattern for "something the SE did
   during the demo that now shows up inside the platform".

   Two screens read it, and that is the whole point of the beat:
     • the Salesforce LEADS tab shows the submission as a new lead at the top, the same
       way a booked voice call already does (`liveQuoteLead` in salesforceLiveLead.ts);
     • Agent Studio gains an SMS WORKFLOW whose opener and follow-ups are written from
       what was typed in the form (`quoteWorkflow` in quoteWorkflow.ts).

   Persisted to localStorage with a 7-DAY TTL. Writes are SYNCHRONOUS so they survive the
   tab closing, and a `storage` listener syncs the change into any other open tab — the
   Google Search screen is often a separate tab from the platform, so without that the
   lead and the workflow would not appear until a manual refresh. */

const LS_KEY = "invoca-demo:lsa-quotes";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_PROFILE = 10;

export interface LsaQuote {
  id: string;
  /** ISO, for the lead's Created Date and the workflow's own ordering. */
  iso: string;
  /** The business the request was sent to — the prospect. */
  business: string;
  name: string;
  message: string;
  /** "" when the SE left the optional Service field alone. */
  service: string;
  how: "sms" | "email";
  contact: string;
  /**
   * The city the ad was served in — Google's LSA lead payload carries one and the form does
   * not ask for it, so it comes from the search screen's own location (the same value the
   * unit prints as "Serves <city>").
   *
   * ⚠️ OPTIONAL because the store is persisted: a quote captured before this field existed is
   * still in localStorage for up to seven days, and the payload renders an absent value as an
   * empty slot exactly as the real one does. See `lsaLeadMessage`.
   */
  location?: string;
  /**
   * Where the request came from. "lsa" is the Google Local Services ad's Get quote dialog;
   * "web" is a form submitted on the prospect's own REPLICATED booking page (see
   * `replicaPages.ts`).
   *
   * ⚠️ OPTIONAL AND DEFAULTING TO "lsa", because the store is persisted for seven days and a
   * quote captured before this existed must keep behaving exactly as it did — the LSA payload
   * and opener are measured against a real capture and must not move.
   */
  source?: "lsa" | "web";
}

interface Entry { savedAt: number; quote: LsaQuote }
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

interface Ctx {
  /** Newest first. */
  capturedFor: (profileId: string) => LsaQuote[];
  add: (profileId: string, quote: LsaQuote) => void;
  clear: (profileId: string) => void;
}

const QuoteCaptureCtx = createContext<Ctx | null>(null);

export function QuoteCaptureProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(() => (typeof localStorage === "undefined" ? {} : load()));

  /* Another tab submitted one (the search screen is usually its own tab), so pick it up
     without a refresh. The `storage` event is NOT delivered to the tab that wrote it,
     which is why `add` updates local state itself. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY) setStore(load()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value: Ctx = {
    capturedFor: (profileId) => (store[profileId] ?? []).map((e) => e.quote),
    add: (profileId, quote) => {
      setStore((prev) => {
        const next: Store = { ...prev };
        const arr = [{ savedAt: Date.now(), quote }, ...(next[profileId] ?? [])].slice(0, MAX_PER_PROFILE);
        next[profileId] = arr;
        /* Written synchronously rather than in an effect: the dialog that calls this often
           lives in a tab the SE closes immediately afterwards. */
        persist(next);
        return next;
      });
    },
    clear: (profileId) => {
      setStore((prev) => {
        const next = { ...prev };
        delete next[profileId];
        persist(next);
        return next;
      });
    },
  };

  return <QuoteCaptureCtx.Provider value={value}>{children}</QuoteCaptureCtx.Provider>;
}

/** Safe outside the provider: returns an empty store rather than throwing, so a screen
 *  rendered on its own (or a test) still works. */
export function useQuoteCaptures(): Ctx {
  return useContext(QuoteCaptureCtx) ?? {
    capturedFor: () => [],
    add: () => {},
    clear: () => {},
  };
}
