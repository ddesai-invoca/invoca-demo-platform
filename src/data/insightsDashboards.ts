import { useCallback, useEffect, useState } from "react";

/* =============================================================================
   Dashboards an SE creates in Insights & Analytics.
   -----------------------------------------------------------------------------
   The "+ New" button on the Insights & Analytics list opens a New Dashboard modal
   (Name + Description) and lands on the new, empty dashboard. Those dashboards have
   to outlive the click, so they are stored here.

   ⚠️ PER PROSPECT, and keyed by the profile id. A dashboard an SE built while demoing
   one prospect must not appear in another's list — the same rule the SMS and Voice
   capture stores follow, and for the same reason.

   ⚠️ NO TTL, unlike those two. A captured conversation is a session artifact that
   should expire; a dashboard someone built and named is not. It stays until deleted.

   ⚠️ STORED UNDER ITS OWN KEY rather than in the AI-assistant store. That store holds
   the per-page override/tile layer and syncs to the server for library demos; a list of
   dashboards is a different thing with a different lifetime, and folding it in would mean
   a schema change to something the four standing AI rules depend on.
   Consequence, stated rather than discovered later: these live in localStorage, so they
   are per browser and do NOT follow a demo to a colleague. That matches the capture
   stores and is the right trade for a demo artifact; move it into the demo record if
   sharing a built dashboard ever matters.
   ============================================================================= */

/** The dashboard Add Tile came from, and the one a built tile belongs to. */
export const SUMMARY_DASH = "/insights/dashboard/Summary%20Dashboard";

/**
 * Read `?to=<path>` off an Add Tile URL, falling back to the Summary Dashboard.
 *
 * ⚠️ VALIDATED, NOT TRUSTED. The return value becomes half of a tile-store key
 * (`<profileId>::<path>`), so an unchecked parameter would let a hand-edited URL write
 * tiles against any key it liked — including another screen's. Only a path under
 * `/insights/dashboard/` with a name on the end is accepted; anything else falls back.
 */
export function dashboardFrom(search: string): string {
  const to = new URLSearchParams(search).get("to");
  if (!to) return SUMMARY_DASH;
  /* One decode, then re-encode the name, so `?to=` works whether the caller passed the
     path raw or encoded and the key matches `location.pathname` either way. */
  const m = /^\/insights\/dashboard\/([^/?#]+)$/.exec(decodeURIComponent(to));
  return m ? `/insights/dashboard/${encodeURIComponent(decodeURIComponent(m[1]))}` : SUMMARY_DASH;
}

export interface InsightsDashboard {
  /** Stable id; the route uses the NAME, so this is only for storage identity. */
  id: string;
  name: string;
  description: string;
  /** ISO string, so the list can print a Last Modified date. */
  createdAt: string;
}

const KEY = "invoca-demo:insights-dashboards";

type Store = Record<string, InsightsDashboard[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Store) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    /* A corrupt or unavailable store must not take the screen down with it. */
    return {};
  }
}

function write(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota or private mode */ }
}

/** `MM/DD/YYYY`, the format the list's Last Modified column prints. */
export function listDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
}

/**
 * The dashboards this prospect's demo has, plus create and remove.
 *
 * ⚠️ A `storage` LISTENER, because the app can be open in more than one tab — the Preview
 * Agent already relies on that, and a dashboard created in one tab should appear in the
 * other's list rather than only after a reload.
 */
export function useInsightsDashboards(profileId: string) {
  const [items, setItems] = useState<InsightsDashboard[]>(() => read()[profileId] ?? []);

  useEffect(() => { setItems(read()[profileId] ?? []); }, [profileId]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setItems(read()[profileId] ?? []);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [profileId]);

  const create = useCallback((name: string, description: string): InsightsDashboard => {
    const item: InsightsDashboard = {
      id: `d${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
    };
    const s = read();
    /* Newest first, which is what the capture's list shows for the two test dashboards. */
    s[profileId] = [item, ...(s[profileId] ?? [])];
    write(s);
    setItems(s[profileId]);
    return item;
  }, [profileId]);

  const remove = useCallback((id: string) => {
    const s = read();
    s[profileId] = (s[profileId] ?? []).filter((d) => d.id !== id);
    write(s);
    setItems(s[profileId]);
  }, [profileId]);

  /* Name lookup for the dashboard route, which addresses a report by name. */
  const byName = useCallback(
    (name: string) => items.find((d) => d.name.toLowerCase() === name.trim().toLowerCase()),
    [items],
  );

  return { items, create, remove, byName };
}
