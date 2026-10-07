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

/* ⚠️ ONE DEFINITION, in `src/data/markStatus.ts` — the client needs the same set
   and used to carry its own copy, which silently drifted the moment the statuses
   changed. Re-exported here so every existing `engine/` importer is unchanged.
   The `.ts` extension is required: this project is `module: nodenext`. */
export {
  MARK_STATUSES, LEGACY_MARK_STATUSES, MARK_LABEL, MARK_ORDER,
  isMarkStatus, isStoredMarkStatus, owesFollowUp,
} from "../src/data/markStatus.ts";
export type { MarkStatus, LegacyMarkStatus, StoredMarkStatus } from "../src/data/markStatus.ts";
import type { StoredMarkStatus as _Stored, MarkStatus as _Write } from "../src/data/markStatus.ts";

export interface DemoMark {
  email: string;
  name: string;
  status: _Stored;
  /** The SE's own ("met Sarah, wants pricing"). Optional by design — a required
   *  note is how a one-click action becomes one nobody performs. Length-capped
   *  only for sanity; see NOTE_MAX. */
  note?: string;
  /** ⚠️ WHO WAS IN THE ROOM (10/7/2026), asked for directly. Name is required for a
   *  row to survive; the title is optional, because "Sarah" is still worth recording
   *  when nobody caught her job title. Absent rather than `[]` when nobody was
   *  listed, so an untouched mark serialises exactly as it did before. */
  attendees?: Attendee[];
  at: string;
}

/** One person a demo was given to. */
export interface Attendee {
  name: string;
  /** Their role, as the SE heard it — "VP Ops", "Head of Digital". */
  title?: string;
}

/** A mark plus which demo it is on, for the list views. */
export interface MarkEntry extends DemoMark {
  demoId: string;
}

/* ⚠️⚠️ **THE 280 CAP IS GONE (10/7/2026), ASKED FOR DIRECTLY — "dont limit the
   number of characters".** What remains is a SANITY bound, not a word limit: this
   is free text from a browser that lands in a JSON file and is rendered into HTML
   email, so something has to stop a malformed or hostile payload growing the store
   until a read fails. 20,000 characters is ~4,000 words — far past any note anybody
   types between demos, so nobody meets it in practice, and the UI shows no counter
   and sets no `maxLength`. **Do not lower this back toward a human-sized number.** */
const NOTE_MAX = 20_000;

/* ⚠️ Attendees are bounded the same way and for the same reason — a list from a
   browser is a list that can arrive with ten thousand entries. A demo has a room,
   not a stadium; 24 is generous and still bounded. */
const ATTENDEE_MAX = 24;
const ATTENDEE_FIELD_MAX = 120;

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
  status: _Write,
  note?: string,
  attendees?: unknown,
): DemoMark | null {
  const file = fileFor(demoId);
  if (!file) return null;
  const clean = (note ?? "").trim().slice(0, NOTE_MAX);
  const people = cleanAttendees(attendees);
  const mark: DemoMark = {
    email: user.email,
    name: user.name,
    status,
    ...(clean ? { note: clean } : {}),
    ...(people.length ? { attendees: people } : {}),
    at: new Date().toISOString(),
  };
  const kept = readFile(demoId).filter((m) => !sameUser(m.email, user.email));
  ensureDir();
  writeAtomic(file, JSON.stringify({ demoId, marks: [...kept, mark] }, null, 2));
  return mark;
}

/** ⚠️ Validated HERE rather than at the route, so every caller gets the same rule.
 *  A row with no NAME is dropped — a title with nobody attached is not a person, and
 *  the form starts with an empty row, so blank rows are the normal case rather than
 *  an error to report. Same shape as the share dialog's blank-answer filtering. */
export function cleanAttendees(raw: unknown): Attendee[] {
  if (!Array.isArray(raw)) return [];
  const out: Attendee[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const name = String((a as Attendee).name ?? "").trim().slice(0, ATTENDEE_FIELD_MAX);
    if (!name) continue;
    const title = String((a as Attendee).title ?? "").trim().slice(0, ATTENDEE_FIELD_MAX);
    out.push({ name, ...(title ? { title } : {}) });
    if (out.length >= ATTENDEE_MAX) break;
  }
  return out;
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
