/* =============================================================================
   activityStore.ts — what a prospect actually DID with a shared demo
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"track… everytime a prospect opens a shared demo, and also
   everytime a prospect finishes an SMS demo or finishes a voice agent demo… if there
   are multiple users on the same prospect, add all of them as sublines for the main
   prospect instead of having multiple rows."*

   ⚠️⚠️ **THE SERVER OWNS THE DATA AND THE SHEET IS A RENDERING OF IT.** The alternative
   — appending a row per event and editing it in place — cannot produce the grouped
   shape that was asked for: a main row per prospect with a subline per person means
   rows MOVE as people are added, and incremental surgery on a live sheet is where that
   goes wrong. Holding the truth here and rewriting the tab makes the grouping, the
   ordering and the totals correct by construction, at the cost of one full write per
   event. A conference roster is a few hundred rows; that is affordable.

   ⚠️⚠️ **THE EMAIL IS SELF-DECLARED, AND THE SHEET SHOULD BE READ THAT WAY.** It is what
   somebody typed on the unlock page. They are not made to prove it — they could not be,
   because the password is derivable from that page, so receiving it proves nothing. This
   records who SAID they were opening the demo, which is worth having and is not an
   identity check.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, isValidId } from "./demoStore.ts";

const DIR = path.join(DATA_DIR, "activity");

/** The three things worth knowing about, and the only three recorded. */
export type ActivityKind = "opened" | "sms" | "voice";

export interface ActivityUser {
  /** Lower-cased, so one person is one subline however they typed it. */
  email: string;
  opened: number;
  sms: number;
  voice: number;
  firstAt: string;
  lastAt: string;
  /* ⚠️⚠️ **WHAT HAS ALREADY BEEN COUNTED, AND IT IS WHY THE NUMBERS MEAN ANYTHING.** The
     SMS capture upserts its conversation after EVERY turn, so a "they had an SMS demo"
     event arrives a dozen times for one thread — counting each would make the column a
     message count wearing a conversation's name. Keyed by the conversation's own id, so
     repeated reports of the SAME conversation count once and a genuinely new one counts
     again. The client may therefore fire liberally, which is what makes it reliable. */
  seen?: string[];
}

export interface ActivityRecord {
  demoId: string;
  prospect: string;
  users: ActivityUser[];
}

/** ⚠️ A bound on a file nobody prunes. A demo with more than this many distinct
 *  visitors has a different problem than a missing row. */
const USERS_MAX = 200;

/** Bounded for the same reason — a long demo day is still only so many conversations. */
const SEEN_MAX = 400;

/** Somebody opened the link without ever giving an address — see the header. */
export const ANONYMOUS = "(no email given)";

function fileFor(demoId: string): string | null {
  /* ⚠️ The id reaches this from a URL via the share record, so it is guarded before a
     path is built — the same rule `demoStore.fileFor` and `demoMarks.fileFor` apply. */
  return isValidId(demoId) ? path.join(DIR, `${demoId}.json`) : null;
}

function read(demoId: string): ActivityRecord | null {
  const file = fileFor(demoId);
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed?.demoId ? (parsed as ActivityRecord) : null;
  } catch {
    /* Absent is the normal case; corrupt degrades to "nothing recorded" rather than
       taking the unlock route down with it. */
    return null;
  }
}

function write(rec: ActivityRecord) {
  const file = fileFor(rec.demoId);
  if (!file) return;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Record one event. Returns the updated record, or null for an id it will not touch.
 *
 * ⚠️ **COUNTS, NOT A LOG.** "Opened 4 times" is what a follow-up list needs; every
 * individual open is noise nobody reads, and an append-only log is a file that grows
 * without bound on a link somebody leaves open. `firstAt`/`lastAt` keep the span.
 */
export function recordActivity(
  demoId: string, prospect: string, email: string, kind: ActivityKind,
  /** A conversation's own id. Repeats of the same one are ignored — see `seen`. */
  dedupeId?: string,
): ActivityRecord | null {
  if (!fileFor(demoId)) return null;
  const who = (email || "").trim().toLowerCase() || ANONYMOUS;
  const now = new Date().toISOString();
  const rec = read(demoId) ?? { demoId, prospect, users: [] };
  /* The prospect's name can be edited on the demo after a share was made; the latest
     wins so the sheet does not keep showing an old one. */
  rec.prospect = prospect || rec.prospect;

  const key = dedupeId ? `${kind}:${dedupeId}` : "";
  const found = rec.users.find((u) => u.email === who);
  if (found) {
    /* ⚠️ `lastAt` still moves on a repeat: they are still here, even if this
       conversation has already been counted. */
    found.lastAt = now;
    if (key && (found.seen ?? []).includes(key)) { write(rec); return rec; }
    if (key) found.seen = [...(found.seen ?? []), key].slice(-SEEN_MAX);
    found[kind] += 1;
  } else {
    if (rec.users.length >= USERS_MAX) return rec;
    rec.users.push({
      email: who, opened: 0, sms: 0, voice: 0, firstAt: now, lastAt: now,
      [kind]: 1, ...(key ? { seen: [key] } : {}),
    } as ActivityUser);
  }
  write(rec);
  return rec;
}

/** Every demo with any activity. Used to rebuild the Activity tab. */
export function listActivity(): ActivityRecord[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return null; } })
    .filter((r): r is ActivityRecord => !!r?.demoId && Array.isArray(r.users));
}

export function activityFor(demoId: string): ActivityRecord | null {
  return read(demoId);
}

/** Totals across a prospect's people — the main row. */
export function totals(rec: ActivityRecord) {
  return rec.users.reduce(
    (acc, u) => ({
      opened: acc.opened + u.opened,
      sms: acc.sms + u.sms,
      voice: acc.voice + u.voice,
      firstAt: !acc.firstAt || u.firstAt < acc.firstAt ? u.firstAt : acc.firstAt,
      lastAt: !acc.lastAt || u.lastAt > acc.lastAt ? u.lastAt : acc.lastAt,
    }),
    { opened: 0, sms: 0, voice: 0, firstAt: "", lastAt: "" },
  );
}
