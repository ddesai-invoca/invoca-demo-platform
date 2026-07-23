import { CustomerProfile, type CustomerProfile as CustomerProfileT } from "./schema";
import { shadyBlinds } from "./profiles/shadyBlinds";

/* Seed profiles (hand-authored reference customers). */
const SEEDS: CustomerProfileT[] = [shadyBlinds];

/* Auto-load every profile the generation engine writes to ./generated/*.json.
   Each is validated at load so a malformed generated file fails loudly. */
const generatedModules = import.meta.glob<{ default: unknown }>("./generated/*.json", { eager: true });
const GENERATED: CustomerProfileT[] = Object.entries(generatedModules).flatMap(([file, mod]) => {
  const parsed = CustomerProfile.safeParse((mod as any).default);
  if (!parsed.success) {
    // Skip (don't throw) so one stale/malformed generated file can't take down the
    // whole app; log the first few issues legibly (path + message) to diagnose.
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
    console.error(`Skipping invalid generated profile ${file}:\n  ${issues.join("\n  ")}`);
    return [];
  }
  return [parsed.data];
});

/* Registry keyed by id. Generated profiles override seeds with the same id. */
export const PROFILES: Record<string, CustomerProfileT> = {};
for (const p of [...SEEDS, ...GENERATED]) PROFILES[p.id] = p;

export const PROFILE_LIST: CustomerProfileT[] = Object.values(PROFILES);
export const DEFAULT_PROFILE_ID = shadyBlinds.id;

/* Seed (code-defined) profiles can't be deleted — they have no generated file
   and would just reload from source. The UI hides delete for these. */
export const SEED_IDS = new Set(SEEDS.map((p) => p.id));
