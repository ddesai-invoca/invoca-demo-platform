/* =============================================================================
   sheetHook.ts — one row per prospect in the event's Google Sheet
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"everytime submit is click in the Demo notes modal, it
   creates a row for that prospect or updates a row if changes are made to a
   existing prospect."*

   ⚠️⚠️ **AN APPS SCRIPT WEB APP, NOT THE SHEETS API — the user's own choice when the
   three options were put to them, and it is the one that needs no credential on this
   server at all.** The alternatives both cost Cloud Console work: the Sheets API needs
   enabling plus either a new consent scope every signed-in user then sees, or a service
   account whose private key lives in Render's env. A deployed Apps Script is a URL and
   nothing more — exactly the reasoning `engine/alerts.ts` records for preferring a Slack
   incoming webhook ("SLACK IS A WEBHOOK URL AND NOTHING MORE, which is what keeps an
   approval off the critical path"). **An assistant's own Sheets connector is not this
   server's credential**, which is why none of this reads one.

   ⚠️⚠️ **THE UPSERT LIVES IN THE SCRIPT, AND `demoId` IS THE KEY.** This module posts a
   flat row and the script decides whether that key already has a line. Doing it the
   other way — read the sheet here, work out the row number, write it back — is three
   round trips racing every other SE marking at the same conference. The script is in
   `docs/event-sheet.gs` and the UI hands out a copy, so the half that is not in this
   repo is still version-controlled here.

   ⚠️ **IT CAN NEVER FAIL A MARK.** `postMarkRow` resolves rather than throws, the same
   contract `sendMail` has and for the same reason: the mark is already on disk by the
   time this runs, and losing an SE's note because somebody's sheet moved would be a far
   worse failure than a missing row.
   ============================================================================= */

import { eventSettings } from "./eventSettings.ts";
import { upsertRow, SheetsReconnectError, COLUMNS } from "./sheetsApi.ts";
import { appEnv } from "./appEnv.ts";
import type { DemoMark } from "./demoMarks.ts";

/** ⚠️ A conference laptop on hotel wifi should not hold the Submit button for a
 *  minute. The row is a side effect; the mark is the thing that mattered. */
const TIMEOUT_MS = 8_000;

export interface SheetRow {
  /** ⚠️ THE UPSERT KEY. Stable per prospect, which is what "updates a row if changes
   *  are made to an existing prospect" means. */
  demoId: string;
  prospect: string;
  website?: string;
  event: string;
  status: string;
  note?: string;
  attendees?: string;
  markedBy: string;
  markedByEmail: string;
  at: string;
  demoUrl?: string;
  /** "removed" when the SE cleared their mark, so the script can empty the row
   *  rather than leaving a status nobody stands behind. */
  action: "upsert" | "removed";
  /** ⚠️ WHICH DEPLOYMENT WROTE IT. A local dev server posts too (see below), and a
   *  row nobody can attribute to a test is a row somebody follows up on. */
  env: string;
}

export interface SheetResult {
  posted: boolean;
  /** Whether an existing row moved or a new one was added. API path only. */
  updated?: boolean;
  /** The grant is gone — the UI offers a Connect link rather than "try again". */
  reconnect?: boolean;
  /** Why not, for the UI to report honestly rather than implying a row appeared. */
  reason?: string;
}

/**
 * ⚠️⚠️ **NOT GATED ON PRODUCTION, UNLIKE `sendMail` AND THE ALERT FUNNEL — a deliberate
 * difference.** Those two reach OTHER PEOPLE (a colleague's inbox, a shared Slack
 * channel) from any environment that happens to hold the credential, so they default to
 * silence off production. This reaches exactly one sheet, which an admin wired by hand
 * for one event: configuring it IS the opt-in, and gating it would mean the feature
 * cannot be exercised anywhere it will actually be set up. The `env` column is what
 * keeps a local row identifiable.
 */
export async function postMarkRow(
  eventKey: string | undefined,
  row: Omit<SheetRow, "event" | "env">,
): Promise<SheetResult> {
  if (!eventKey) return { posted: false, reason: "This demo is not in an event." };
  const cfg = eventSettings(eventKey);
  const body: SheetRow = { ...row, event: eventKey, env: appEnv() };

  /* ⚠️⚠️ THE API PATH WINS WHEN BOTH ARE SET. It is the one a non-technical SE can
     actually finish (paste a link), so an event that has been moved onto it must not
     keep posting to a webhook somebody left behind. Neither save clears the other, so
     switching back is just reconnecting. */
  if (cfg.spreadsheetId && cfg.sheetOwner) {
    try {
      const res = await upsertRow(
        { email: cfg.sheetOwner, spreadsheetId: cfg.spreadsheetId, tab: eventKey },
        rowCells(body),
      );
      return { posted: true, updated: res.updated };
    } catch (e: unknown) {
      /* ⚠️ A REVOKED GRANT IS ITS OWN ANSWER. "Try again" would send somebody round a
         loop that cannot help; `reconnect` is what the UI turns into a Connect link. */
      if (e instanceof SheetsReconnectError) {
        return { posted: false, reconnect: true, reason: e.message };
      }
      return { posted: false, reason: (e as Error)?.message || "The sheet could not be written." };
    }
  }

  const url = cfg.sheetWebhookUrl;
  if (!url) return { posted: false, reason: "No sheet is connected to this event yet." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    /* ⚠️ `text/plain` IS NOT A MISTAKE. An Apps Script `doPost` receives the raw body in
       `e.postData.contents` whatever the type, and a cross-origin `application/json`
       POST is a PREFLIGHTED request — which Apps Script's own redirect chain answers
       badly. Plain text is the shape Google's own docs use for this. */
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: ctl.signal,
      /* Apps Script answers a 302 to googleusercontent.com; without following it the
         result is always a redirect rather than the script's own reply. */
      redirect: "follow",
    });
    if (!res.ok) return { posted: false, reason: `The sheet replied ${res.status}.` };
    return { posted: true };
  } catch (e: unknown) {
    const msg = (e as { name?: string })?.name === "AbortError"
      ? "The sheet did not answer in time."
      : (e as { message?: string })?.message || "The sheet could not be reached.";
    return { posted: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** The attendee list as one cell — "Sarah Chen (VP Ops), Marcus Webb". */
export const attendeeCell = (m: Pick<DemoMark, "attendees">): string =>
  (m.attendees ?? []).map((a) => (a.title ? `${a.name} (${a.title})` : a.name)).join(", ");

/** ⚠️ ONE MAPPING, so the API path and the Apps Script path put the same value under
 *  the same heading. The script reads these names off the payload; this turns the same
 *  payload into the same columns. Two tables would drift on the first added column. */
export function rowCells(b: SheetRow): Record<string, string> {
  const cleared = b.action === "removed";
  return {
    "Demo ID": b.demoId,
    "Prospect": b.prospect,
    "Website": b.website ?? "",
    "Status": cleared ? "" : b.status,
    "Notes": cleared ? "" : (b.note ?? ""),
    "Who was in the room": cleared ? "" : (b.attendees ?? ""),
    "Demoed by": cleared ? "" : b.markedBy,
    "Email": cleared ? "" : b.markedByEmail,
    "Marked at": b.at,
    "Event": b.event,
    "Open demo": b.demoUrl ?? "",
    "Source": b.env,
  } satisfies Record<(typeof COLUMNS)[number], string>;
}
