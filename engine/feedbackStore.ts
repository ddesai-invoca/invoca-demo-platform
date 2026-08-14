/* =============================================================================
   feedbackStore.ts — where feedback and feature requests live
   -----------------------------------------------------------------------------
   One JSON file per item under DATA_DIR/feedback/<id>.json, written atomically
   (temp file then rename), exactly like demoStore. Same disk, so it inherits the
   Render persistent mount and needs no new infrastructure.

   Deliberately not a database. The volume is a handful of items a week from one
   team; a directory of JSON is inspectable with `cat`, survives a deploy, and
   costs nothing to operate.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";

const FEEDBACK_DIR = path.join(DATA_DIR, "feedback");

export type FeedbackKind = "feedback" | "feature";

/* The workflow, in order. `STATUSES[0]` is where everything starts.

   TERMINAL is what triggers the submitter's email: reaching it is the moment the
   person who asked actually wants to hear from you. "Declined" is deliberately NOT
   terminal-with-email — a rejection is worth a conversation rather than an
   automated note; flip it by adding it to TERMINAL if you disagree. */
export const STATUSES = ["New", "In review", "Planned", "In progress", "Complete", "Declined"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];
export const TERMINAL: FeedbackStatus[] = ["Complete"];

export interface FeedbackUser { email: string; name: string }

export interface FeedbackRecord {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  /* Which screen they were on when they opened the form. Costs the submitter
     nothing and saves the "where did you see this?" round trip. */
  page?: string;
  submitter: FeedbackUser;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  /* Every status change, so the trail survives even though only the current
     status is shown. Also what stops a double-save re-sending the email. */
  history: { at: string; status: FeedbackStatus; by: FeedbackUser }[];
  /* Set once the completion email actually goes out, so re-saving a Complete
     item, or a deploy that replays anything, cannot mail the person twice. */
  notifiedAt?: string;
  /* Optional note from whoever triaged it; shown to the submitter. */
  note?: string;
}

function ensureDir() {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
}

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
export const isValidFeedbackId = (id: string) => VALID_ID.test(id) && id.length <= 64;

/** Sortable, collision-resistant, and readable in a directory listing. */
export function newFeedbackId(): string {
  const t = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
}

export function listFeedback(): FeedbackRecord[] {
  ensureDir();
  const out: FeedbackRecord[] = [];
  for (const f of fs.readdirSync(FEEDBACK_DIR)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(FEEDBACK_DIR, f), "utf8"))); }
    catch { /* a half-written file should not take the whole list down */ }
  }
  // newest first: the board is read top-down
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function getFeedback(id: string): FeedbackRecord | null {
  if (!isValidFeedbackId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(FEEDBACK_DIR, `${id}.json`), "utf8")); }
  catch { return null; }
}

export function saveFeedback(rec: FeedbackRecord): FeedbackRecord {
  ensureDir();
  const file = path.join(FEEDBACK_DIR, `${rec.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);   // atomic: a reader never sees a partial file
  return rec;
}

export function deleteFeedback(id: string): boolean {
  if (!isValidFeedbackId(id)) return false;
  try { fs.unlinkSync(path.join(FEEDBACK_DIR, `${id}.json`)); return true; }
  catch { return false; }
}
