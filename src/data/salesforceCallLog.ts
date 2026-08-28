import type { CustomerProfile } from "./schema";

/* =============================================================================
   Invoca Call Log — the Salesforce records the integration writes
   -----------------------------------------------------------------------------
   The custom object the Invoca package creates: one record per call, named by a
   Salesforce AUTO-NUMBER. That format is the whole content of this screen, and it
   is measured, not guessed — `reference/salesforce/call-log-v1.html` names its
   records `INVOCA-00001889`, and the Seller Home capture's own Recent Records row
   is `INVOCA-00001888`, i.e. a neighbour from the same block.

   ⚠️ **THIS FIXED A REAL CROSS-SCREEN BUG.** Seller Home built its call-log row as
   `INVOCA-${callId}` -> "INVOCA-0597627F", because the Invoca call id was the only
   id to hand when that screen was built. Both captures say the object is an
   8-digit auto-number, so the two screens disagreed about the same record's name
   in the same org. `newestCallLogName()` is exported for Seller Home to use, so
   the row it shows is genuinely the newest record in this list.

   ⚠️ THE ORDER IS "RECENTLY VIEWED", WHICH IS NOT NUMERIC, and reproducing that is
   the point. The capture reads 1889, 1875, 1872, 1888, 1884, 1887 ... — an SE's
   own viewing history, and its column header carries "Column sort is disabled".
   A tidy descending list would read as "sorted by name" and contradict that, so
   each record gets a derived last-viewed instant and the list is ordered by it.
   ============================================================================= */

export interface SfCallLogRecord {
  /** "INVOCA-00001889". */
  name: string;
  /** Sort key behind the Recently Viewed order. */
  viewedKey: number;
}

export interface SfCallLogView {
  records: SfCallLogRecord[];
  /** "50 items • Updated a few seconds ago" */
  statusLine: string;
}

/** Rendered rows. The capture says "50+ items"; see the note on the status line. */
const RECORD_COUNT = 50;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The block of auto-numbers this prospect's org has reached. Derived from the
 * profile id so it is stable across reloads — an SE can rehearse against the same
 * ids, and Seller Home and this screen cannot disagree.
 *
 * ⚠️ Anchored NEAR THE CAPTURE'S OWN BLOCK (1889) rather than at a round number:
 * an org whose call-log records start at INVOCA-00000001 has just been installed,
 * which is the opposite of the story ("you have been capturing calls for months").
 */
function topNumber(profileId: string): number {
  return 1500 + (hash(`calllog:${profileId}`) % 2600);
}

function record(profileId: string, n: number): SfCallLogRecord {
  return {
    name: `INVOCA-${String(n).padStart(8, "0")}`,
    /* A derived last-viewed instant: newer records are likelier to have been
       opened recently, so the order stays loosely descending — as the capture's
       does — without ever being exactly sorted. */
    viewedKey: n * 1000 + (hash(`viewed:${profileId}:${n}`) % 9000),
  };
}

export function salesforceCallLog(profile: CustomerProfile): SfCallLogView {
  const top = topNumber(profile.id);
  const records: SfCallLogRecord[] = [];
  for (let i = 0; i < RECORD_COUNT; i++) records.push(record(profile.id, top - i));
  records.sort((a, b) => b.viewedKey - a.viewedKey);

  const n = records.length;
  return {
    records,
    /* ⚠️ THE COUNT IS THE ROW COUNT, NOT THE CAPTURE'S "50+". Salesforce prints the
       "+" when there are more records than it fetched; printing it over exactly the
       rows we render would be claiming an unseen remainder. Same rule as the Leads
       list's "N items". */
    statusLine: `${n} item${n === 1 ? "" : "s"} • Updated a few seconds ago`,
  };
}

/**
 * The newest record in the Recently Viewed order — what Seller Home's Recent
 * Records row shows, so the two screens name the same record.
 */
export function newestCallLogName(profile: CustomerProfile): string {
  return salesforceCallLog(profile).records[0].name;
}
