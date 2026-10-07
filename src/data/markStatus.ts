/* =============================================================================
   markStatus — ONE definition of what a demo mark can say
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THIS FILE EXISTS BECAUSE THERE WERE TWO.** `engine/demoMarks.ts` declared
   the status set and `src/data/DemoLibraryContext.tsx` declared its own copy as a
   string union. Changing the statuses on 10/7/2026 edited one and `tsc -b --force`
   stayed SILENT — the client happily kept offering values the server had stopped
   accepting, which is the duplicated-field failure this repo has already paid for
   three times (the voice greeting, the SMS brain, the drawer fallback).

   ⚠️ **DOM-FREE ON PURPOSE**, like `src/data/shareDefaults.ts`: the engine project
   compiles with no DOM lib, so anything reaching `location` or `document` here
   breaks that build. Imported from `engine/` with an explicit `.ts` extension,
   because that project is `module: nodenext` (same as `signalTiers.ts`).
   ============================================================================= */

/** The three the SE asked for, in their own words, ordered MOST URGENT FIRST —
 *  which is also the order the follow-up list works through them. */
export const MARK_STATUSES = ["urgent-lead", "lead", "no-interest"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

/** ⚠️⚠️ **READ WIDER THAN YOU WRITE.** The set changed from Demoed / Follow-up /
 *  Lead on 10/7/2026 and real marks on disk still carry the old values — `lead`
 *  survived, `demoed` and `follow-up` did not. Neither has an honest equivalent
 *  in the new set ("demoed" means *I showed them*, not *they are not interested*),
 *  so remapping would relabel somebody's own judgement and deleting would destroy
 *  notes taken at a conference. They stay READABLE and are simply never offered
 *  again. Retire one only once nothing on disk uses it. */
export const LEGACY_MARK_STATUSES = ["demoed", "follow-up"] as const;
export type LegacyMarkStatus = (typeof LEGACY_MARK_STATUSES)[number];

/** What may appear on a stored mark: the offerable three plus the retired two. */
export type StoredMarkStatus = MarkStatus | LegacyMarkStatus;

/** WRITE gate — only a currently-offered status may be set. A legacy value arriving
 *  on a new request is a client that has not reloaded, not something to store. */
export const isMarkStatus = (v: unknown): v is MarkStatus =>
  typeof v === "string" && (MARK_STATUSES as readonly string[]).includes(v);

/** READ gate — what we accept off disk and are willing to render. */
export const isStoredMarkStatus = (v: unknown): v is StoredMarkStatus =>
  isMarkStatus(v) || (typeof v === "string" && (LEGACY_MARK_STATUSES as readonly string[]).includes(v));

/** Covers legacy too, so an old mark never renders as a raw slug. */
export const MARK_LABEL: Record<StoredMarkStatus, string> = {
  "urgent-lead": "Urgent lead",
  lead: "Lead",
  "no-interest": "No interest",
  /* retired 10/7/2026, still on disk */
  "follow-up": "Follow-up",
  demoed: "Demoed",
};

/** The order the follow-up list sorts by: what owes you most, first. The two
 *  legacy values sit where they always did relative to the rest. */
export const MARK_ORDER: StoredMarkStatus[] = ["urgent-lead", "lead", "follow-up", "no-interest", "demoed"];

/** ⚠️ WHICH STATUSES OWE SOMETHING, which is what the follow-up count and the
 *  menu badge both mean. "No interest" is a decision and "Demoed" is a record —
 *  neither is a task, so neither is counted. Keyed as a SET rather than
 *  `!== "no-interest"`, or adding a status silently makes it owe. */
const OWING = new Set<StoredMarkStatus>(["urgent-lead", "lead", "follow-up"]);
export const owesFollowUp = (s: StoredMarkStatus): boolean => OWING.has(s);
