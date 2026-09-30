import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CustomerProfile } from "./schema";
import { PROFILE_LIST, DEFAULT_PROFILE_ID } from "./profiles";
import { renameMarketingSources } from "./marketingSources";
import { withoutDefaultPricing, withoutReminderPromises } from "./agentDefaults";

interface ProfileCtx {
  profile: CustomerProfile;
  profileId: string;
  setProfileId: (id: string) => void;
  profiles: CustomerProfile[];         // all known customers (seeds + generated + session-added)
  addProfile: (p: CustomerProfile) => void;
  removeProfile: (id: string) => void; // delete a generated prospect (state + localStorage + on-disk JSON)
}

const Ctx = createContext<ProfileCtx | null>(null);

/* Generated customers are cached in localStorage so they survive a browser
   refresh (and appear instantly) without depending on a dev-server restart to
   re-scan src/data/generated. The JSON files on disk remain the durable record. */
const LS_PROFILES = "invoca-demo:profiles";
const LS_ACTIVE = "invoca-demo:activeId";

/* ⚠️⚠️ **THE CACHE IS BUDGETED, BECAUSE IT SILENTLY FILLED UP AND BROKE THE PREVIEW AGENT
   (reported 9/28/2026).** Measured on the reporter's own production browser: `invoca-demo:
   profiles` held **52 profiles at 4,624KB** and localStorage totalled **5,095KB** — at the
   ~5MB origin quota. So `addProfile`'s `setItem` was throwing `QuotaExceededError` on every
   new demo, the `catch { }` swallowed it, and the profile existed ONLY in the tab that opened
   it. Preview Agent opens a NEW TAB, which rebuilds this store from the cache, did not find
   the prospect, and fell back to the seed — Shady Blinds' conversation under Hiscox's name.

   ⚠️ **A BUDGET IN BYTES, NOT A COUNT.** Profiles vary from ~60KB to ~155KB, so "keep 20"
   either wastes the quota or blows it. And the write EVICTS AND RETRIES rather than failing,
   because the failure mode this replaces was invisible: nothing on screen, nothing in the
   console, and it only began once somebody had opened enough demos.
   ⚠️ Deliberately well under 5MB: the AI override layer, the SMS/voice capture stores and the
   `active-profile` mirror share this origin, and starving THEM would just move the bug. */
const MAX_CACHE_BYTES = 2_000_000;

/**
 * Write the profile cache, evicting oldest-first until it fits.
 * `keepId` is never evicted — it is the profile being added, and dropping the
 * one the caller just asked to cache is the one outcome that helps nobody.
 */
function persistCached(list: CustomerProfile[], keepId?: string): void {
  const out = [...list];
  for (;;) {
    const json = JSON.stringify(out);
    if (json.length <= MAX_CACHE_BYTES) {
      try { localStorage.setItem(LS_PROFILES, json); return; }
      catch { /* quota, despite the budget — another key grew. Evict and retry. */ }
    }
    const victim = out.findIndex((p) => p.id !== keepId);
    /* Nothing left to give up: clear rather than leave a stale oversized blob that
       can never be written again. */
    if (victim < 0) { try { localStorage.removeItem(LS_PROFILES); } catch { /* ignore */ } return; }
    out.splice(victim, 1);
  }
}

function loadCached(): CustomerProfile[] {
  try {
    const raw = localStorage.getItem(LS_PROFILES);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => CustomerProfile.safeParse(p)).filter((r) => r.success).map((r) => (r as any).data);
  } catch {
    return [];
  }
}

/* ⚠️⚠️ **ONE NORMALIZER, BOTH ENTRY POINTS.** A profile reaches the store either from the
   registry/cache at boot or through `addProfile` (a fresh generation, or a library demo).
   Applying a rule in one and not the other is how a library demo would behave differently
   from a bundled one with nothing on screen to say why — the note on `addProfile` already
   records that for `renameMarketingSources`, and `withoutDefaultPricing` has exactly the
   same requirement. Both are idempotent, so the cached copy being written normalized is
   harmless. */
const normalize = (p: CustomerProfile): CustomerProfile =>
  withoutReminderPromises(withoutDefaultPricing(renameMarketingSources(p)));

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<CustomerProfile[]>(() => {
    // Cached generated customers first, then the static registry (seeds + files
    // loaded at build time) — files/seeds win on id collisions so a regenerated
    // profile shows fresh, while cache still supplies anything the glob hasn't
    // re-scanned yet (e.g. generated this session before a restart).
    const merged: Record<string, CustomerProfile> = {};
    for (const p of [...loadCached(), ...PROFILE_LIST]) merged[p.id] = normalize(p);
    return Object.values(merged);
  });

  const [profileId, setProfileIdState] = useState<string>(() => {
    try { return localStorage.getItem(LS_ACTIVE) || DEFAULT_PROFILE_ID; } catch { return DEFAULT_PROFILE_ID; }
  });

  const byId = useMemo(() => {
    const m: Record<string, CustomerProfile> = {};
    for (const p of profiles) m[p.id] = p;
    return m;
  }, [profiles]);

  function setProfileId(id: string) {
    setProfileIdState(id);
    try { localStorage.setItem(LS_ACTIVE, id); } catch { /* ignore */ }
  }

  /* ⚠️⚠️ **THE TWO ENTRY POINTS ARE HERE AND THE INITIAL STATE ABOVE, AND BOTH MUST NORMALIZE.**
     A profile reaches the store either from the registry/cache at boot or through this
     function (a fresh generation, or a library demo opened by `DemoLibraryContext`). Renaming
     in one and not the other is how a library demo would render Facebook while a bundled one
     rendered Google LSA, with nothing on screen to say why. See `renameMarketingSources`; the
     cached copy is written renamed, which is harmless because the function is idempotent. */
  function addProfile(raw: CustomerProfile) {
    const p = normalize(raw);
    setProfiles((prev) => [...prev.filter((x) => x.id !== p.id), p]);
    persistCached([...loadCached().filter((x) => x.id !== p.id), p], p.id);
  }

  function removeProfile(id: string) {
    setProfiles((prev) => prev.filter((x) => x.id !== id));
    persistCached(loadCached().filter((x) => x.id !== id));
    if (profileId === id) setProfileId(DEFAULT_PROFILE_ID);
    // Delete the on-disk generated JSON so it doesn't reload on the next restart
    // (dev-only endpoint; ignore failures — the session copy is already gone).
    fetch("/api/delete-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => { /* dev-only */ });
  }

  /* ⚠️⚠️ **THIS USED TO CLOBBER THE ACTIVE ID, WHICH MADE THE BUG ABOVE WORSE AND SHARED IT
     BETWEEN TABS.** It read "keep a valid active id" and reset to the seed whenever the id was
     not in the store. But "not in the store" is exactly the state a freshly opened tab is in
     for a LIBRARY demo, and the reset was WRITTEN TO localStorage — so opening Preview Agent
     on Hiscox did not merely show the wrong prospect, it changed what the original tab
     thought was selected. The id is now kept, and the fetch below resolves it. Rendering
     already degrades safely on its own (see `profile` further down), so nothing dangles. */
  const tried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!profileId || byId[profileId] || tried.current.has(profileId)) return;
    /* ⚠️ THE SERVER IS THE SOURCE OF TRUTH FOR A LIBRARY DEMO; the cache is only a
       convenience. Attempted ONCE per id, so a genuinely unknown id (a deleted demo, a
       hand-typed URL) cannot loop, and a 401/404 simply leaves the render fallback in
       place. */
    tried.current.add(profileId);
    /* ⚠️⚠️ **NO `alive` CANCELLATION FLAG HERE, AND ITS ABSENCE IS DELIBERATE — the obvious
       version of this effect DID NOTHING IN DEV.** With one, StrictMode's double-mount
       cancels the first run (`alive = false`) while `tried` makes the second return early, so
       the fetch resolves into a discarded result and the profile is never added. Measured:
       exactly one request for the id, 200 OK, and an empty cache afterwards — the fix looked
       written and changed nothing.
       Dropping the flag is safe because the work is idempotent: `addProfile` replaces by id,
       and a setState after unmount is a no-op in React 18. `tried` still prevents any loop. */
    fetch(`/api/demos/${encodeURIComponent(profileId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const parsed = CustomerProfile.safeParse(d?.demo?.profile);
        if (parsed.success) addProfile(parsed.data);
      })
      .catch(() => { /* offline or gated — the render fallback stands */ });
  }, [byId, profileId]);

  const profile = byId[profileId] ?? byId[DEFAULT_PROFILE_ID] ?? profiles[0];

  // Mirror the ACTIVE profile to localStorage so the standalone static pages
  // (e.g. the Google Ads capture) can re-skin themselves to the current prospect
  // — works for seeds, generated, and build-bundled profiles alike.
  useEffect(() => {
    try { if (profile) localStorage.setItem("invoca-demo:active-profile", JSON.stringify(profile)); } catch { /* ignore quota */ }
  }, [profile]);

  return (
    <Ctx.Provider value={{ profile, profileId, setProfileId, profiles, addProfile, removeProfile }}>
      {children}
    </Ctx.Provider>
  );
}

/* Every screen calls useProfile() to read the active customer's data. */
export function useProfile(): ProfileCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfile must be used within ProfileProvider");
  return v;
}
