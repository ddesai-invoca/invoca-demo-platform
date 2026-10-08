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

/** ⚠️ COLUMN ORDER IS THE HEADER ROW, and `Demo ID` must stay first — it is the
 *  upsert key and `findRow` reads column A. Add a column by appending here. */
export const COLUMNS = [
  "Demo ID", "Prospect", "Website", "Status", "Notes", "Who was in the room",
  "Demoed by", "Email", "Marked at", "Event", "Open demo", "Source",
] as const;

export interface SheetTarget {
  /** Whose grant writes the rows. */
  email: string;
  spreadsheetId: string;
  /** The tab. One per event, so one spreadsheet can serve several. */
  tab: string;
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

async function ensureTab(t: SheetTarget): Promise<string[]> {
  const meta = await api(t.email, `/${t.spreadsheetId}?fields=sheets.properties.title`);
  const titles: string[] = (meta?.sheets ?? []).map((s: any) => String(s?.properties?.title ?? ""));
  if (!titles.includes(t.tab)) {
    await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t.tab } } }] }),
    });
  }
  /* ⚠️ READS THE EXISTING HEADER RATHER THAN IMPOSING ONE, so a column somebody added
     by hand ("Owner", "Next step") survives every later write — the same rule the Apps
     Script version needed, and the audit that caught it there still applies here. */
  const head = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!1:1`);
  const existing: string[] = (head?.values?.[0] ?? []).map(String);
  const missing = COLUMNS.filter((c) => !existing.includes(c));
  if (missing.length) {
    const next = [...existing, ...missing];
    await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!1:1?valueInputOption=RAW`, {
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
  const head = await ensureTab(t);
  const keyAt = head.indexOf("Demo ID");
  if (keyAt < 0) throw new Error("That sheet has no Demo ID column.");

  const col = colLetter(keyAt);
  const keys = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!${col}2:${col}`);
  const ids: string[] = (keys?.values ?? []).map((r: string[]) => String(r?.[0] ?? ""));
  const found = ids.findIndex((v) => v === values["Demo ID"]);

  const line = head.map((name) => values[name] ?? "");
  if (found >= 0) {
    const rowNo = found + 2;
    /* ⚠️ ONLY THE CELLS THIS POST CARRIES. Reading the row first is what makes a
       hand-added column — and a field a "mark cleared" post says nothing about —
       survive, which is the bug the Apps Script harness caught. */
    const cur = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!A${rowNo}:${colLetter(head.length - 1)}${rowNo}`);
    const existing: string[] = (cur?.values?.[0] ?? []);
    const merged = head.map((name, i) => (values[name] !== undefined ? values[name] : (existing[i] ?? "")));
    await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!A${rowNo}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [merged] }),
    });
    return { updated: true, row: rowNo };
  }

  await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(t.tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
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
