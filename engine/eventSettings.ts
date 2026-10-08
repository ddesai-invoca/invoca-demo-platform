/* =============================================================================
   eventSettings.ts — per-event configuration, server-side
   -----------------------------------------------------------------------------
   Asked for 10/8/2026 alongside the 2026 Invoca Chicago Summit: *"I want to be
   able to add a google sheet to it so that everytime submit is click in the Demo
   notes modal, it creates a row for that prospect or updates a row if changes are
   made to a existing prospect."* When asked where the sheet's address should live
   the answer was **paste it in the app**, not an env var — so a second event gets
   its own sheet with no deploy and nobody needs Render access.

   ⚠️⚠️ **ITS OWN STORE, NOT A FIELD ON A DEMO AND NOT AN ENV VAR.** An event is not
   a demo (its config must outlive any one record, and the Chicago roster is empty
   today), and an env var would put a per-event URL behind a deploy — the thing the
   answer above explicitly rejected. Same disk, same atomic write and the same
   "absent is the normal case" degradation as `demoMarks.ts`.

   ⚠️ **THE KEY IS THE EVENT'S STORED KEY** (`EventDef.key`, e.g. "chicago-2026"),
   never its section id — the section id is the Launch screen's own and is safe to
   rename, which would silently orphan every settings file named after it.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";
import { EVENTS } from "../src/data/eventDemos.ts";

const DIR = path.join(DATA_DIR, "event-settings");

export interface EventSettings {
  /* ⚠️⚠️ TWO WAYS TO WIRE AN EVENT, AND THE SIMPLE ONE IS FIRST (10/8/2026). Reported:
     *"connecting a sheet is too complicated for not technical people… ideally all i want
     users to do is paste the google sheet URL."* So `spreadsheetId` + `sheetOwner` is the
     path the UI leads with — paste a link, done — and the Apps Script webhook stays as the
     fallback for an org that will not grant the scope. `sheetHook` prefers the API when
     both are set; neither is ever filled in by the other's save, so switching is explicit. */
  /** The sheet itself, written with `sheetOwner`'s stored Google grant. */
  spreadsheetId?: string;
  /** WHOSE grant writes the rows. One grant serves every SE — see sheetsTokens.ts. */
  sheetOwner?: string;
  /** Shown back so the UI can name what was connected rather than echo a URL. */
  sheetTitle?: string;
  /** The Apps Script web-app URL the mark rows are POSTed to. The older, no-credential path. */
  sheetWebhookUrl?: string;
  /** For the UI to show "wired by X on Y" rather than a bare field. */
  updatedAt?: string;
  updatedBy?: string;
}

/** ⚠️ ONLY A KEY THAT IS A REAL EVENT. The key reaches this from a URL, so an
 *  unchecked one is a path built from user input — the guard `demoStore.fileFor`
 *  and `demoMarks.fileFor` both apply, expressed here as an allow-list because the
 *  set of events is small, known and already enumerated. */
export const isEventKey = (key: string): boolean => EVENTS.some((e) => e.key === key);

const fileFor = (key: string): string | null =>
  isEventKey(key) ? path.join(DIR, `${key}.json`) : null;

export function eventSettings(key: string): EventSettings {
  const file = fileFor(key);
  if (!file) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as EventSettings) : {};
  } catch {
    /* Absent is the normal case — most events are never wired to a sheet — and a
       corrupt file degrades to "not wired" rather than taking the mark route down
       with it, exactly as `marksFor` degrades to "nobody marked it". */
    return {};
  }
}

/* ⚠️⚠️ **ONLY AN APPS SCRIPT WEB-APP URL IS ACCEPTED, AND THAT IS A SECURITY RULE
   RATHER THAN TIDINESS.** This value is pasted by a human and the server then POSTs
   to it, with the prospect's name, the SE's note and who was in the room in the
   body — so an unvalidated field is a way to make this server send real customer
   data to any host somebody can type. Google's own deployment host is the whole
   allow-list; `https` is implied by it and asserted anyway. */
/* ⚠️ TWO REAL SHAPES, AND THE WORKSPACE ONE PUTS ITS DOMAIN IN THE MIDDLE:
     https://script.google.com/macros/s/<id>/exec
     https://script.google.com/a/macros/<domain>/s/<id>/exec
   The first version of this had the optional segment in the wrong place and refused
   every Workspace deployment — which is the shape an invoca.com account produces, i.e.
   the only one that would ever have been pasted here. Caught by the audit, not by
   reading it. */
const APPS_SCRIPT =
  /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;

export function isSheetWebhookUrl(raw: string): boolean {
  return APPS_SCRIPT.test(raw.trim());
}

/** Returns null for an unknown event key or a URL that is not an Apps Script
 *  deployment, so the caller answers 400 rather than storing something unusable. */
export function setEventSheet(
  key: string, rawUrl: string, by: string,
): EventSettings | null {
  const file = fileFor(key);
  if (!file) return null;
  const url = rawUrl.trim();
  /* An empty string is how the UI UNWIRES a sheet — distinct from an invalid one. */
  if (url && !isSheetWebhookUrl(url)) return null;
  const next: EventSettings = {
    ...(url ? { sheetWebhookUrl: url } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  write(file, next);
  return next;
}

function write(file: string, next: EventSettings) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Connect (or disconnect) the event's real Google Sheet.
 *
 * ⚠️ `owner` IS STORED BESIDE THE ID because the grant is a person's. Reading the two
 * apart — the id here, the signed-in user at write time — is how an event silently
 * starts writing with whoever happens to be marking, which is exactly the per-SE model
 * this design rejects.
 */
export function setEventSpreadsheet(
  key: string, spreadsheetId: string, owner: string, title: string, by: string,
): EventSettings | null {
  const file = fileFor(key);
  if (!file) return null;
  const next: EventSettings = {
    ...(spreadsheetId ? { spreadsheetId, sheetOwner: owner, sheetTitle: title } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  write(file, next);
  return next;
}

/** Every event plus whether it is wired, for the Launch screen's own control.
 *  ⚠️ The URL is returned only to an ADMIN — see the route. */
export function listEventSettings(): { key: string; wired: boolean; settings: EventSettings }[] {
  return EVENTS.map((e) => {
    const s = eventSettings(e.key);
    return { key: e.key, wired: !!(s.spreadsheetId || s.sheetWebhookUrl), settings: s };
  });
}
