/* =============================================================================
   sheetsApi.ts — write an event's follow-up rows straight into a Google Sheet
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"connecting a sheet is too complicated for not technical
   people, what is the most seamless and easiest way to do this, ideally all i want
   users to do is paste the google sheet URL."*

   ⚠️⚠️ **THE UPSERT MOVED SERVER-SIDE, which is what buys the simpler setup.** The
   Apps Script path put it in a script the user had to paste and deploy; here it is
   two API calls — read the key column, then write one row by index. That is a real
   trade and worth naming: the script version was ONE request and could not race
   itself (it held a lock), where this reads and then writes. See `UPSERT RACE`
   below for what that costs and why it is acceptable.

   ⚠️ **NO SDK.** `googleapis` is ~20MB of generated clients for one endpoint pair;
   this is `fetch` against two REST paths, the same call `engine/driveApi.ts` and
   `engine/voicePreview.ts` already make for the same reason.
   ============================================================================= */

import { getSheetsToken } from "./sheetsTokens.ts";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The grant is gone or was revoked — the UI must say "reconnect", never "try again". */
export class SheetsReconnectError extends Error {}

/* ⚠️ KEYED ON THE CREDENTIAL THAT MINTED IT, not on the email alone. An event whose
   connector changes would otherwise keep writing as the previous one until a restart,
   with nothing on screen to say so — the exact fix `engine/salesforceApi.ts` records
   for its own token cache. */
const cache = new Map<string, { token: string; expires: number }>();

async function accessToken(email: string): Promise<string> {
  const refresh = getSheetsToken(email);
  if (!refresh) throw new SheetsReconnectError(`${email} has not connected Google Sheets.`);
  const key = `${email}:${refresh.slice(-12)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    /* ⚠️ `invalid_grant` IS REVOCATION, NOT A BLIP. Treated as its own class so the
       caller can say "reconnect" instead of sending somebody to debug their network. */
    if (body?.error === "invalid_grant") throw new SheetsReconnectError("That Google connection was revoked.");
    throw new Error(body?.error_description || body?.error || `Google refused the token (${res.status}).`);
  }
  const token = String(body.access_token);
  /* A minute of headroom, as driveApi does. */
  cache.set(key, { token, expires: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000 });
  return token;
}

async function api(email: string, path: string, init?: RequestInit): Promise<any> {
  const token = await accessToken(email);
  const res = await fetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 401) { cache.clear(); throw new SheetsReconnectError("That Google connection is no longer valid."); }
  if (res.status === 403) {
    /* The grant is fine; this account cannot open THAT sheet. A different message,
       because "reconnect" would send them round a loop that cannot help. */
    throw new Error("That Google account cannot edit this sheet — share it with them, or paste a sheet they own.");
  }
  if (res.status === 404) throw new Error("That sheet could not be found. Check the link.");
  if (!res.ok) throw new Error(body?.error?.message || `Google Sheets replied ${res.status}.`);
  return body;
}

/* ⚠️⚠️ **A SHEET URL IS PARSED, NEVER TRUSTED WHOLE.** Only the id is kept, so a
   pasted link carrying `#gid=`, `/edit`, a query string or somebody's `?usp=sharing`
   cannot reach an API path. Google ids are 20-60 chars of `[A-Za-z0-9-_]`. */
export function spreadsheetIdFrom(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const m = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  /* Somebody pasting the bare id is doing the right thing too. */
  if (/^[A-Za-z0-9_-]{20,}$/.test(t)) return t;
  return null;
}

export const sheetUrlFor = (id: string): string =>
  `https://docs.google.com/spreadsheets/d/${id}/edit`;

/* ⚠️⚠️ **TRIMMED TO SEVEN (10/8/2026), AND THE UPSERT KEY CHANGED WITH IT.** Asked for
   directly: drop Demo ID, Demoed by, Email, Source and Event. Demo ID was the key — the
   thing that made "update the row for an existing prospect" possible — so the key is now
   **Prospect**, the only remaining column that identifies one.
   ⚠️ **CONSEQUENCE, STATED: two demos with the SAME prospect name now share one row**,
   where the id kept them apart. That is likelier than it was, because everything also
   lands on ONE tab rather than one per event — so "AutoNation" marked under Dallas and
   again under Chicago is a single line. Within one conference roster the names are
   unique, which is the case this is for; if it ever bites, the fix is a hidden key
   column rather than a visible one. */
export const COLUMNS = [
  "Prospect", "Website", "Status", "Notes", "Audience", "Date/Time", "Open demo",
] as const;

/** ⚠️ ONE NAME, READ BY BOTH PATHS. The Apps Script keys on the same header. */
export const KEY_COLUMN = "Prospect";

/** ⚠️ ONE TAB FOR EVERYTHING, asked for directly — it was one per event. */
export const TAB_NAME = "Demo Notes";

export interface SheetTarget {
  /** Whose grant writes the rows. */
  email: string;
  spreadsheetId: string;
}

/** Confirms the sheet is reachable and returns its name, so the UI can show what
 *  was actually connected rather than echoing the URL back. */
export async function describeSheet(email: string, spreadsheetId: string): Promise<string> {
  const meta = await api(email, `/${spreadsheetId}?fields=properties.title`);
  return String(meta?.properties?.title ?? "Untitled sheet");
}

/** Makes a sheet for an event — the "no URL to paste at all" path. */
export async function createSheet(email: string, title: string): Promise<{ id: string; url: string }> {
  const made = await api(email, "", {
    method: "POST",
    body: JSON.stringify({ properties: { title } }),
  });
  const id = String(made?.spreadsheetId ?? "");
  if (!id) throw new Error("Google did not return a new sheet.");
  return { id, url: sheetUrlFor(id) };
}

/**
 * Resolves the one tab everything is written to, creating or renaming as needed.
 *
 * ⚠️⚠️ **THE FIRST SHEET, RENAMED — asked for directly** ("just do it on the first sheet and
 * call it Demo Notes"), where it used to add a tab per event.
 * ⚠️ **BUT IT WILL NOT RENAME A SHEET THAT ALREADY HOLDS SOMETHING.** Renaming somebody's
 * populated Sheet1 and writing a header into row 1 would overwrite real data in a document
 * they pasted rather than created — a one-way loss in somebody else's file. So: an existing
 * "Demo Notes" wins, else the first sheet is used when it is EMPTY, else a new tab is added
 * under that name. In the normal case (a sheet we created, or a fresh one) that is exactly
 * "the first sheet, called Demo Notes"; the guard only changes the case that would destroy
 * something.
 */
async function ensureSheet(t: SheetTarget): Promise<string[]> {
  const meta = await api(t.email, `/${t.spreadsheetId}?fields=sheets.properties`);
  const sheets: { title: string; id: number; index: number }[] = (meta?.sheets ?? []).map((x: any) => ({
    title: String(x?.properties?.title ?? ""),
    id: Number(x?.properties?.sheetId ?? 0),
    index: Number(x?.properties?.index ?? 0),
  }));

  let tab = sheets.find((x) => x.title === TAB_NAME)?.title;
  if (!tab) {
    const first = sheets.slice().sort((a, b) => a.index - b.index)[0];
    const used = first
      ? ((await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(first.title)}!A1:A1`))?.values?.length ?? 0) > 0
      : false;
    if (first && !used) {
      await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: [{ updateSheetProperties: {
          properties: { sheetId: first.id, title: TAB_NAME }, fields: "title",
        } }] }),
      });
    } else {
      await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB_NAME } } }] }),
      });
    }
    tab = TAB_NAME;
  }

  /* ⚠️ READS THE EXISTING HEADER RATHER THAN IMPOSING ONE, so a column somebody added by
     hand ("Owner", "Next step") survives every later write — and so do the five that were
     REMOVED from `COLUMNS`, which simply stop being written rather than being deleted out
     of a sheet somebody may still be reading. */
  const head = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(tab)}!1:1`);
  const existing: string[] = (head?.values?.[0] ?? []).map(String);
  const missing = COLUMNS.filter((c) => !existing.includes(c));
  if (missing.length) {
    const next = [...existing, ...missing];
    await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(tab)}!1:1?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [next] }),
    });
    return next;
  }
  return existing;
}

/**
 * One row per prospect, keyed on `Demo ID`. Returns whether a row was updated or added.
 *
 * ⚠️⚠️ **UPSERT RACE, STATED RATHER THAN HIDDEN.** This reads the key column and then
 * writes, so two SEs marking the SAME prospect within the same second could both see
 * "no row" and append two. The Apps Script version held a script lock and could not.
 * Accepted because the collision needs the same PROSPECT (not merely the same event) at
 * the same instant, and the outcome is a duplicate row rather than lost data — against a
 * setup that a non-technical SE can actually complete, which is what was asked for. If
 * it ever bites, the fix is a short server-side mutex keyed on `spreadsheetId:demoId`.
 */
export async function upsertRow(
  t: SheetTarget, values: Record<string, string>,
): Promise<{ updated: boolean; row: number }> {
  const head = await ensureSheet(t);
  const keyAt = head.indexOf(KEY_COLUMN);
  if (keyAt < 0) throw new Error(`That sheet has no ${KEY_COLUMN} column.`);

  const col = colLetter(keyAt);
  const keys = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!${col}2:${col}`);
  const ids: string[] = (keys?.values ?? []).map((r: string[]) => String(r?.[0] ?? ""));
  const found = ids.findIndex((v) => v === values[KEY_COLUMN]);

  const line = head.map((name) => values[name] ?? "");
  if (found >= 0) {
    const rowNo = found + 2;
    /* ⚠️ ONLY THE CELLS THIS POST CARRIES. Reading the row first is what makes a
       hand-added column — and a field a "mark cleared" post says nothing about —
       survive, which is the bug the Apps Script harness caught. */
    const cur = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A${rowNo}:${colLetter(head.length - 1)}${rowNo}`);
    const existing: string[] = (cur?.values?.[0] ?? []);
    const merged = head.map((name, i) => (values[name] !== undefined ? values[name] : (existing[i] ?? "")));
    await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A${rowNo}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [merged] }),
    });
    return { updated: true, row: rowNo };
  }

  await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [line] }),
  });
  return { updated: false, row: ids.length + 2 };
}

/** 0 -> A, 25 -> Z, 26 -> AA. ⚠️ A sheet with 27+ columns is ordinary once somebody
 *  adds their own, so the two-letter case is real rather than theoretical. */
export function colLetter(i: number): string {
  let n = i, out = "";
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}
