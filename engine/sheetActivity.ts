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
