/* =============================================================================
   sheetActivity.ts — push the Activity tab after something happens
   -----------------------------------------------------------------------------
   The join between `activityStore` (the truth) and `sheetsApi` (the rendering).

   ⚠️⚠️ **IT RESOLVES THE SHEET FROM THE DEMO'S EVENT, exactly as a mark does.** Activity
   lands in the same spreadsheet an event's demo notes go to, which is the point of
   putting it on a second tab rather than in a file of its own. A demo in no event, or an
   event with no sheet, records activity server-side and writes nothing — the data is
   still there if a sheet is connected later.

   ⚠️⚠️ **IT NEVER THROWS AND IT NEVER BLOCKS THE THING THAT TRIGGERED IT.** A prospect
   unlocking a demo must not see an error because somebody's spreadsheet moved, and the
   open is already recorded by the time this runs — the same contract `postMarkRow` has,
   for the same reason.
   ============================================================================= */

import { getDemo } from "./demoStore.ts";
import { eventSettings } from "./eventSettings.ts";
import { listActivity, totals, type ActivityRecord } from "./activityStore.ts";
import { writeActivity, reportStyleFailure, ACTIVITY_TAB, type ActivityLine } from "./sheetsApi.ts";
import { centralTime } from "./sheetHook.ts";

/**
 * Build the grouped lines: a prospect, then its people.
 *
 * ⚠️ **MOST RECENT PROSPECT FIRST, and its people most recent first within it.** The
 * sheet is read to answer "who has been in this lately", so the useful row is at the top
 * rather than wherever the demo happens to sort alphabetically.
 */
export function activityLines(records: ActivityRecord[]): ActivityLine[] {
  const withTotals = records
    .filter((r) => r.users.length > 0)
    .map((r) => ({ r, t: totals(r) }))
    .sort((a, b) => b.t.lastAt.localeCompare(a.t.lastAt));

  const out: ActivityLine[] = [];
  for (const { r, t } of withTotals) {
    out.push({
      main: true, label: r.prospect, opened: t.opened, sms: t.sms, voice: t.voice,
      firstAt: centralTime(t.firstAt), lastAt: centralTime(t.lastAt),
    });
    for (const u of [...r.users].sort((a, b) => b.lastAt.localeCompare(a.lastAt))) {
      out.push({
        main: false, label: u.email, opened: u.opened, sms: u.sms, voice: u.voice,
        firstAt: centralTime(u.firstAt), lastAt: centralTime(u.lastAt),
      });
    }
  }
  return out;
}

/** Which sheet a demo's activity belongs in, or null. */
function targetFor(demoId: string): { email: string; spreadsheetId: string } | null {
  const demo = getDemo(demoId);
  if (!demo?.event) return null;
  const cfg = eventSettings(demo.event);
  return cfg.spreadsheetId && cfg.sheetOwner
    ? { email: cfg.sheetOwner, spreadsheetId: cfg.spreadsheetId }
    : null;
}

/* =============================================================================
   COALESCING, BECAUSE ONE SMS DEMO CAN BE TEN EVENTS
   -----------------------------------------------------------------------------
   ⚠️⚠️ **EVERY ACTIVITY REPORT USED TO REWRITE AND RE-STYLE THE WHOLE TAB, AND THE SMS
   CLIENT REPORTS LIBERALLY ON PURPOSE.** The capture is progressive — it fires after every
   turn so nothing is lost when the tab closes — and the SERVER is what dedupes a
   conversation down to one. That is the right split, and it meant a ten-turn conversation
   triggered ten full rewrites: measured at roughly **6 reads and 4 writes each**, against
   Google's quota of **60 writes a minute per user**. One prospect having one conversation
   could come close to exhausting it, and a 429 there costs the row AND the formatting.

   ⚠️⚠️ **A FIXED WINDOW, NOT A RESET-ON-EVERY-CALL DEBOUNCE.** The obvious shape clears
   the pending timer and schedules a new one, which STARVES under a steady stream: a demo
   producing an event every two seconds would never sync at all, and the tab would sit
   stale for exactly as long as somebody kept using it. The first event opens the window
   and later ones join it, so the wait is bounded at `COALESCE_MS` however busy it gets.

   ⚠️ **IN-PROCESS STATE, AND THE CONSEQUENCE IS STATED: a pending sync does not survive a
   restart.** The timer is `unref`'d so it cannot hold the SIGTERM drain open, and the
   activity itself is already on disk — so the worst case is a tab one event stale until
   the next event, never lost data. One web instance, so there is nothing to share.
   ============================================================================= */
export const COALESCE_MS = 3_000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
const dirty = new Set<string>();

/** Ask for a sync. Bursts collapse; the tab is never more than a few seconds behind. */
export function queueActivitySync(demoId: string): void {
  /* ⚠️ A sync already running must not be interrupted or doubled — mark it and re-queue
     once it lands, or the rewrite races itself and the row order can come out wrong. */
  if (inFlight.has(demoId)) { dirty.add(demoId); return; }
  if (pending.has(demoId)) return;
  const timer = setTimeout(() => { pending.delete(demoId); void drain(demoId); }, COALESCE_MS);
  timer.unref?.();
  pending.set(demoId, timer);
}

async function drain(demoId: string): Promise<void> {
  inFlight.add(demoId);
  try { await syncActivitySheet(demoId); } finally {
    inFlight.delete(demoId);
    if (dirty.delete(demoId)) queueActivitySync(demoId);
  }
}

/**
 * Rewrite the Activity tab of whichever sheet this demo's event is wired to.
 *
 * ⚠️ **EVERY PROSPECT IN THAT EVENT, not just this demo.** The tab is one view of the
 * whole event, and rewriting it from the full set is what keeps the grouping and the
 * ordering correct rather than patching one block.
 */
export async function syncActivitySheet(demoId: string): Promise<{ written: boolean; reason?: string }> {
  try {
    const target = targetFor(demoId);
    if (!target) return { written: false, reason: "No sheet is connected to this demo's event." };
    const demo = getDemo(demoId);
    /* Scope to the event, so two events sharing one spreadsheet do not overwrite each
       other's Activity tab with their own prospects. */
    const mine = listActivity().filter((r) => getDemo(r.demoId)?.event === demo?.event);
    await writeActivity(target, activityLines(mine));
    return { written: true };
  } catch (e: unknown) {
    /* ⚠️ Swallowed BY DESIGN — see the header. The activity itself is already on disk.
       ⚠️⚠️ **BUT NOT SILENTLY, which is the half that was missing.** Nothing reads the
       `reason` this returns, so for a prospect's open it went nowhere at all: a tab that
       could not be written looked exactly like one that had been. */
    await reportStyleFailure(ACTIVITY_TAB, e);
    return { written: false, reason: (e as Error)?.message || "The sheet could not be written." };
  }
}
