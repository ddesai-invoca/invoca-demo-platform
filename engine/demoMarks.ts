/* =============================================================================
   demoMarks.ts — "I demoed this", per demo AND per person
   -----------------------------------------------------------------------------
   Asked for by an SE who delivered ~25 demos at the Dallas Summit: *"I can't
   remember who all I did the demo for, and would love an opportunity to easily
   mark something as a lead or follow-up required."* So the point of this store
   is the FOLLOW-UP LIST, not analytics — the tracking is a side effect.

   ⚠️⚠️ **A MARK BELONGS TO A (DEMO, PERSON) PAIR, NOT TO A DEMO.** The Dallas
   roster is 76 demos owned by ONE account and presented by several SEs, so two
   people can legitimately demo the same prospect record. Keying by demo alone
   would have one SE's mark overwrite another's, and the person who lost theirs
   would have no way to know.

   ⚠️⚠️ **ITS OWN STORE, DELIBERATELY NOT A FIELD ON `DemoRecord`.** Two reasons,
   and the second is the one that bites:
     • the roster demos belong to somebody else, and marking one must not rewrite
       a record its owner is responsible for;
     • CLAUDE.md's standing rule is that any server-side write to a demo bumps
       `updatedAt`, and `DemoLibraryContext` refetches whenever that moves — so
       marks on the record would refetch the library for everyone with a tab open.

   ⚠️ A RE-MARK REPLACES, IT DOES NOT APPEND. This is a STATUS ("where did this
   one get to"), not a log — an SE who marks Demoed and later upgrades to Lead
   means the latter, and a list showing both rows would be a list to reconcile
   rather than one to work through.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, isValidId, type DemoCreator } from "./demoStore.ts";

const MARKS_DIR = path.join(DATA_DIR, "demo-marks");

/** The three the SE asked for, in the words they used. Anything else is refused
 *  at the boundary rather than stored and rendered as an unknown chip. */
export const MARK_STATUSES = ["demoed", "follow-up", "lead"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const isMarkStatus = (v: unknown): v is MarkStatus =>
  typeof v === "string" && (MARK_STATUSES as readonly string[]).includes(v);

export interface DemoMark {
  email: string;
  name: string;
  status: MarkStatus;
  /** One line, the SE's own ("met Sarah, wants pricing"). Optional by design —
   *  a required note is how a one-click action becomes one nobody performs. */
  note?: string;
  at: string;
}

/** A mark plus which demo it is on, for the list views. */
export interface MarkEntry extends DemoMark {
  demoId: string;
}

/* ⚠️ THE NOTE IS CAPPED AND THE FIELD IS TRIMMED. It is free text from a browser
   that is rendered back into a list, and an unbounded string in a JSON file is
   the shape that quietly grows until a read fails. */
const NOTE_MAX = 280;

function ensureDir() {
  fs.mkdirSync(MARKS_DIR, { recursive: true });
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** ⚠️ `isValidId` BEFORE ANY PATH IS BUILT — the id arrives from a URL, and this
 *  is the same guard `demoStore.fileFor` applies for the same reason. */
function fileFor(demoId: string): string | null {
  if (!isValidId(demoId)) return null;
  return path.join(MARKS_DIR, `${demoId}.json`);
}

function readFile(demoId: string): DemoMark[] {
  const file = fileFor(demoId);
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.marks) ? (parsed.marks as DemoMark[]) : [];
  } catch {
    /* Absent is the normal case (most demos are never marked); corrupt degrades
       to "nobody marked it" rather than taking the endpoint down, exactly as
       listDemos skips a demo it cannot parse. */
    return [];
  }
}

const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every mark on one demo. */
export function marksFor(demoId: string): DemoMark[] {
  return readFile(demoId);
}

/** Set (or replace) this person's mark on this demo. Returns null for an id that
 *  is not a valid demo id, so the caller can answer 400 rather than write a file
 *  with a hand-built name. */
export function markDemo(
  demoId: string,
  user: DemoCreator,
  status: MarkStatus,
  note?: string,
): DemoMark | null {
  const file = fileFor(demoId);
  if (!file) return null;
  const clean = (note ?? "").trim().slice(0, NOTE_MAX);
  const mark: DemoMark = {
    email: user.email,
    name: user.name,
    status,
    ...(clean ? { note: clean } : {}),
    at: new Date().toISOString(),
  };
  const kept = readFile(demoId).filter((m) => !sameUser(m.email, user.email));
  ensureDir();
  writeAtomic(file, JSON.stringify({ demoId, marks: [...kept, mark] }, null, 2));
  return mark;
}

/** Remove this person's mark. Returns whether one was actually there, so the
 *  caller can tell "unmarked" from "there was nothing to unmark". */
export function unmarkDemo(demoId: string, email: string): boolean {
  const file = fileFor(demoId);
  if (!file) return false;
  const all = readFile(demoId);
  const kept = all.filter((m) => !sameUser(m.email, email));
  if (kept.length === all.length) return false;
  ensureDir();
  writeAtomic(file, JSON.stringify({ demoId, marks: kept }, null, 2));
  return true;
}

/**
 * Every mark in the store, newest first.
 *
 * ⚠️⚠️ **`email` IS THE VISIBILITY BOUNDARY AND IT IS APPLIED HERE, BEFORE
 * ANYTHING IS SERIALISED.** A regular SE may only see their own; an admin passes
 * no email and sees all. Filtering in the browser instead would leave a
 * colleague's follow-up notes sitting in the payload — the same rule
 * `feedbackApi` already follows, and for the same reason.
 */
export function listMarks(email?: string): MarkEntry[] {
  ensureDir();
  const out: MarkEntry[] = [];
  for (const name of fs.readdirSync(MARKS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const demoId = name.replace(/\.json$/, "");
    for (const m of readFile(demoId)) {
      if (email && !sameUser(m.email, email)) continue;
      out.push({ ...m, demoId });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
