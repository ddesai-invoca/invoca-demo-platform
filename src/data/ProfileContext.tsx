import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CustomerProfile } from "./schema";
import { PROFILE_LIST, DEFAULT_PROFILE_ID } from "./profiles";

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

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<CustomerProfile[]>(() => {
    // Cached generated customers first, then the static registry (seeds + files
    // loaded at build time) — files/seeds win on id collisions so a regenerated
    // profile shows fresh, while cache still supplies anything the glob hasn't
    // re-scanned yet (e.g. generated this session before a restart).
    const merged: Record<string, CustomerProfile> = {};
    for (const p of [...loadCached(), ...PROFILE_LIST]) merged[p.id] = p;
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

  function addProfile(p: CustomerProfile) {
    setProfiles((prev) => [...prev.filter((x) => x.id !== p.id), p]);
    try {
      const cached = loadCached().filter((x) => x.id !== p.id);
      localStorage.setItem(LS_PROFILES, JSON.stringify([...cached, p]));
    } catch { /* ignore */ }
  }

  function removeProfile(id: string) {
    setProfiles((prev) => prev.filter((x) => x.id !== id));
    try {
      const cached = loadCached().filter((x) => x.id !== id);
      localStorage.setItem(LS_PROFILES, JSON.stringify(cached));
    } catch { /* ignore */ }
    if (profileId === id) setProfileId(DEFAULT_PROFILE_ID);
    // Delete the on-disk generated JSON so it doesn't reload on the next restart
    // (dev-only endpoint; ignore failures — the session copy is already gone).
    fetch("/api/delete-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => { /* dev-only */ });
  }

  // Keep a valid active id if the stored one isn't known.
  useEffect(() => {
    if (!byId[profileId]) setProfileId(DEFAULT_PROFILE_ID);
  }, [byId, profileId]);

  const profile = byId[profileId] ?? byId[DEFAULT_PROFILE_ID] ?? profiles[0];

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
