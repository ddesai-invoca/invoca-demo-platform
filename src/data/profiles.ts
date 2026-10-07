import { CustomerProfile, type CustomerProfile as CustomerProfileT } from "./schema";
import { shadyBlinds } from "./profiles/shadyBlinds";

/* =============================================================================
   ⚠️⚠️ THE GENERATED PROFILES ARE NO LONGER BUNDLED (10/6/2026)
   -----------------------------------------------------------------------------
   They used to load through `import.meta.glob("./generated/*.json", { eager: true })`,
   which embeds every one of them in the single JS bundle. Measured on a real build:
   **15 real companies — Orlando Health, AutoNation, Marriott, Denver Health and the
   rest — shipped inside `dist/assets/index-*.js` with their full report data**,
   readable from devtools by anyone who loaded the app.

   That was tolerable only because the app is gated to `@invoca.com`. Building a
   PROSPECT-FACING share link removes that gate, and the fabricated numbers are not
   the sensitive part — the ASSOCIATION is. A prospect could enumerate which other
   companies Invoca is pitching. This repo already draws that exact line for
   `/api/status`: "a public endpoint implying they are Invoca prospects is the exact
   leak" is why that route carries counts and booleans only.

   So they are fetched from an AUTHENTICATED route now, exactly like library demos
   already are, and a prospect's bundle carries no prospect data at all.

   ⚠️ **SHADY BLINDS STAYS BUNDLED, AND THAT IS DELIBERATE.** It is a FICTIONAL
   reference customer, it is `DEFAULT_PROFILE_ID`, and something has to render before
   any fetch resolves — including on a share link, where the registry fetch is skipped
   entirely. A bundled fictional sample leaks nothing.

   ⚠️ **THIS IS A DATA FETCH, NOT CODE SPLITTING.** The single-bundle rule this repo
   keeps is about JS CHUNKS and the service worker ("a cached shell could ask for a
   lazy chunk that was never cached"). No chunk is added here; the bundle simply
   stops carrying a megabyte of someone else's data.
   ============================================================================= */

/* Seed profiles (hand-authored reference customers). */
const SEEDS: CustomerProfileT[] = [shadyBlinds];

/* Registry keyed by id. Starts as the seeds; `addFetchedProfiles` fills in the rest. */
export const PROFILES: Record<string, CustomerProfileT> = {};
for (const p of SEEDS) PROFILES[p.id] = p;

export const PROFILE_LIST: CustomerProfileT[] = Object.values(PROFILES);
export const DEFAULT_PROFILE_ID = shadyBlinds.id;

/* Seed (code-defined) profiles can't be deleted — they have no generated file
   and would just reload from source. The UI hides delete for these. */
export const SEED_IDS = new Set(SEEDS.map((p) => p.id));

/**
 * Fetch the generated profiles the server holds on disk.
 *
 * ⚠️ **VALIDATED HERE, exactly as the glob used to validate them**, and one bad file
 * is SKIPPED rather than thrown — a stale generated profile must not take the app
 * down, which is the behaviour the eager glob already had.
 * ⚠️ Returns [] on any failure (offline, 401 on a share link, a dev server with no
 * route). The app then runs on the seed, which is what it did before any of this.
 */
export async function fetchGeneratedProfiles(): Promise<CustomerProfileT[]> {
  try {
    const res = await fetch("/api/profiles", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const body = (await res.json()) as { profiles?: unknown[] };
    const out: CustomerProfileT[] = [];
    for (const raw of body.profiles ?? []) {
      const parsed = CustomerProfile.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
        console.error(`Skipping invalid generated profile:\n  ${issues.join("\n  ")}`);
        continue;
      }
      out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}
