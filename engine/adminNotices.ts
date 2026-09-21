/* =============================================================================
   adminNotices.ts — a one-time "you're now an admin" popup, shown on next login
   -----------------------------------------------------------------------------
   Asked for directly, alongside adding six new project admins: "show a pop up
   letting them know the next time they log in to the platform."

   ⚠️⚠️ **WHO GETS TOLD IS BAKED INTO CODE, NOT SEEDED INTO A STORE.** The obvious
   design writes a "notified" record for each of the six emails the moment they're
   added, then checks that record. That only reaches whichever disk the write ran
   against — this session can write to a LOCAL `.data` dir, never to Render's
   persistent disk, so a local seed would never surface the notice for anyone
   actually signing in on production. Making `NEW_ADMIN_EMAILS` a plain list in
   code sidesteps that entirely: the moment this deploys, the check below is true
   for all six on their very next `/api/demos` fetch, with nothing to seed and
   nowhere else it needs to run.

   ⚠️ **ONLY `seenAt` IS EVER PERSISTED**, and only once someone actually dismisses
   the popup — the store never records who was "told", only who has since said
   "got it". That is also what makes this safe to import from `demoApi.ts` on
   every request: the common case (nobody in `NEW_ADMIN_EMAILS` has signed in yet)
   touches the disk not at all.

   ⚠️ **A REAL ADMIN CHECK, NOT JUST "ON THIS LIST".** `isAdminEmail` is re-checked
   here rather than trusting `NEW_ADMIN_EMAILS` alone, so a name later removed from
   `ADMINS` (or never actually added) can never be told it has access it does not.
   `admins.ts` imports nothing, so importing it here carries no cycle risk — the
   same reasoning that moved `adminEmails`/`isAdminEmail` there in the first place.

   Same disk, same atomic-write shape as `alerts.ts` and `demoStore.ts`: one small
   JSON file under DATA_DIR, and a corrupt or missing file degrades to "nobody has
   dismissed anything yet" rather than taking a request down.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";
import { isAdminEmail } from "./admins.ts";

/**
 * The people this particular announcement is for. Added 9/21/2026, in the same
 * request that added them to `ADMINS`: "add all these people and make them
 * admins as well so they can see the support request for everyone... show a
 * pop up letting them know the next time they log in."
 *
 * A future round of new admins that also wants a one-time notice is a new list
 * (or an addition to this one) — the same manual-edit convention `ADMINS` itself
 * already documents ("to remove a built-in admin, edit this constant").
 */
const NEW_ADMIN_EMAILS = new Set(
  [
    "ddubinsky@invoca.com",
    "bmccarty@invoca.com",
    "djuengst@invoca.com",
    "kjellick@invoca.com",
    "kpaklaian@invoca.com",
    "mfidler@invoca.com",
  ].map((e) => e.trim().toLowerCase()),
);

const STATE_FILE = path.join(DATA_DIR, "admin-notices.json");

interface NoticeState { seen: Record<string, string> }   // email (lowercase) -> seenAt ISO
let state: NoticeState | null = null;

function load(): NoticeState {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as NoticeState;
    state = parsed && typeof parsed === "object" && parsed.seen
      ? { seen: parsed.seen } : { seen: {} };
  } catch {
    state = { seen: {} };
  }
  return state!;
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e: unknown) {
    console.error("[admin-notice] could not persist state:", (e as Error)?.message || e);
  }
}

const norm = (email: string | undefined | null) => (email ?? "").trim().toLowerCase();

/** True exactly once per person: a real admin, on this announcement's list, who
 *  has not yet dismissed it. */
export function pendingAdminNotice(email: string | undefined | null): boolean {
  const e = norm(email);
  if (!e || !NEW_ADMIN_EMAILS.has(e)) return false;
  if (!isAdminEmail(e)) return false;
  return !load().seen[e];
}

/** Mark this person's notice as seen, so it never shows again. */
export function ackAdminNotice(email: string | undefined | null): void {
  const e = norm(email);
  if (!e) return;
  const s = load();
  if (s.seen[e]) return;   // already acknowledged — no write needed
  s.seen[e] = new Date().toISOString();
  persist();
}

/** For the audit and for tests: drop the in-memory cache so a fresh read happens. */
export function reloadAdminNoticesForTest(): void {
  state = null;
}
