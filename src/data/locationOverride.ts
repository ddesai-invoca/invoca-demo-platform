import { useCallback, useEffect, useState } from "react";
import type { ResolvedPlace } from "./prospectPlace";

/* =============================================================================
   "Use precise location" — the SE sets the search location by ZIP
   -----------------------------------------------------------------------------
   Asked for 9/8/2026, alongside the fix that made the location come from the prospect's own
   sites: *"for all prospects let add a feature, allow users to click on the 'Use precise
   location' button and give a zipcode to change the location."*

   ⚠️ **THIS IS THE ANSWER TO THE THREE PROSPECTS THAT NAME NO PLACE**, and to any prospect
   generated later whose location rows contain a city the table does not know. `companyPlace`
   is a static lookup over a hand-checked table; this is a real geocode of whatever the SE
   types, so it needs no table entry and cannot be ambiguous about which Greensboro is meant.

   ⚠️ **PER PROSPECT, AND PERSISTED — but per BROWSER, which is worth stating.** Keyed by
   profile id like the SMS and voice capture stores, so switching prospects mid-demo does not
   carry one company's ZIP onto another. It is localStorage, so it does NOT follow a demo to a
   colleague; that is right for what this is (an SE re-pointing the screen for one
   conversation), and if it ever needs to travel it belongs in the demo record.

   ⚠️ **NO TTL, unlike the capture stores.** A captured conversation is a session artifact; a
   deliberate location choice is a setting, and having it silently expire after seven days
   would read as the feature being broken.
   ============================================================================= */

const KEY = "invoca-demo:loc-override";

function read(profileId: string): ResolvedPlace | null {
  try {
    const raw = localStorage.getItem(`${KEY}::${profileId}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as ResolvedPlace;
    /* ⚠️ VALIDATED ON READ. This is a hand-editable store feeding MAP COORDINATES, and a
       malformed entry would put the pin in the ocean rather than fail visibly. */
    return p && typeof p.label === "string" && Array.isArray(p.ll) && p.ll.length === 2
      && Number.isFinite(p.ll[0]) && Number.isFinite(p.ll[1]) ? { ...p, source: "zip" } : null;
  } catch {
    return null;
  }
}

export interface LocationOverride {
  /** The SE's chosen place, or null when the prospect's own location is in use. */
  place: ResolvedPlace | null;
  /** Resolve a 5-digit ZIP and apply it. Returns an error message, or null on success. */
  apply: (zip: string) => Promise<string | null>;
  /** Back to the prospect's own location. */
  clear: () => void;
  busy: boolean;
}

export function useLocationOverride(profileId: string): LocationOverride {
  const [place, setPlace] = useState<ResolvedPlace | null>(() => read(profileId));
  const [busy, setBusy] = useState(false);

  /* Re-read on a prospect switch. Without this the previous prospect's ZIP stays on screen
     until something else re-renders — the same stale-state shape the Insights report's
     shared-route bug documents. */
  useEffect(() => { setPlace(read(profileId)); }, [profileId]);

  const apply = useCallback(async (zip: string): Promise<string | null> => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) return "Enter a 5-digit US ZIP code.";
    setBusy(true);
    try {
      const res = await fetch(`/api/zip?zip=${encodeURIComponent(z)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.place) return data?.error || `We could not find ZIP ${z}.`;
      const next: ResolvedPlace = {
        label: data.place.label, ll: data.place.ll, st: data.place.st, source: "zip",
      };
      try { localStorage.setItem(`${KEY}::${profileId}`, JSON.stringify({ ...next, zip: data.place.zip })); } catch { /* private window */ }
      setPlace(next);
      return null;
    } catch {
      return "Location lookup failed. Please try again.";
    } finally {
      setBusy(false);
    }
  }, [profileId]);

  const clear = useCallback(() => {
    try { localStorage.removeItem(`${KEY}::${profileId}`); } catch { /* ignore */ }
    setPlace(null);
  }, [profileId]);

  return { place, apply, clear, busy };
}
