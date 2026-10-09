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
import { alert } from "./alerts.ts";

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

/** The second tab: who opened a shared demo and what they did in it. */
export const ACTIVITY_TAB = "Activity";

/** ⚠️ **THE INDENT IS THE SUBLINE, AND IT IS ONE DEFINITION READ BY TWO SIDES.** Sheets has
 *  no row hierarchy that survives a rewrite cleanly, and an outline group would have to be
 *  deleted and re-added every time; a leading arrow reads as a child at a glance. The
 *  styling pass then recovers "is this a person?" from this same string, so the two cannot
 *  drift — change it here and both the writer and the reader move together. */
export const INDENT = "    \u21b3  ";

export const ACTIVITY_COLUMNS = [
  "Prospect / Person", "Opened", "SMS demos", "Voice demos", "First seen", "Last seen",
] as const;

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

/* =============================================================================
   The sheet's own look, and the Activity tab (10/8/2026)
   -----------------------------------------------------------------------------
   Asked for: *"make it look really nice… should not just look like a white generic
   sheet"*, and a second tab grouping each prospect's people under one row.

   ⚠️⚠️ **THE ACTIVITY TAB IS REWRITTEN WHOLE, NOT APPENDED TO.** Its shape is a main
   row per prospect with a subline per person, so adding somebody MOVES rows — and
   editing rows in place around a moving target is where incremental sheet writing
   goes wrong. The server owns the data (`activityStore`), this renders it. Demo Notes
   is still an upsert, because there a row never moves.
   ============================================================================= */

/* ============================================================================
   THE INVOCA HOUSE PALETTE, NOT A PALETTE INVENTED FOR A SPREADSHEET.

   ⚠️⚠️ **EVERY VALUE HERE IS ONE THIS REPO ALREADY SHIPS**, so the sheet reads as
   part of the product rather than as a tool that happens to write to Google. It is
   the same set `src/artifacts/salesPlaybook.ts` uses and the same pairing
   `engine/mailer.ts` sends: brand green `#00b388` on white, with `#f8faf1`/`#f4fbf8`
   beside it, `#15243e` as the platform's title ink and `#e7e9eb` as the hairline.
   Do not reach for a colour that is not in one of those two files.

   ⚠️ **`#00624d` IS A SEPARATE TOKEN FROM `#00b388` AND BOTH ARE NEEDED.** The brand
   green is a GROUND colour — as 10pt text on white it sits near 2.3:1, which is below
   anything readable — so text that wants to read as green takes the deeper `#00624d`,
   exactly as the playbook's own `--g-ink` does. A single green used for both is how a
   count column comes out technically on-brand and practically unreadable.
   ============================================================================ */
/* ⚠️⚠️ **`red`/`green`/`blue`, NEVER `r`/`g`/`b` — THIS IS THE BUG THAT MADE THE WHOLE
   THEME A NO-OP, AND IT WAS EVERY COLOUR, NOT ONE.** Google's `Color` message names its
   fields in full, and the API rejects an unknown field outright rather than ignoring it:
   `Unknown name "r" ... Cannot find field`. One abbreviated key therefore 400s the entire
   batchUpdate, so the header band, the tab colour, the hairlines and the body ink all died
   together and the sheet came out a plain white grid.
   ⚠️ It survived a check against Google's own discovery document because that check
   validated the CONTAINERS — `CellFormat`, `Border`, `TextFormat` — and never opened the
   `Color` leaf inside them. Validate the shape of the VALUES, not just the names of the
   fields you put them in. `audit:share` now walks every colour in a real payload. */
const rgb = (hex: number) => ({
  red: ((hex >> 16) & 0xff) / 255,
  green: ((hex >> 8) & 0xff) / 255,
  blue: (hex & 0xff) / 255,
});

const BRAND = rgb(0x00b388); // grounds: the header band and the tab
const GREEN_INK = rgb(0x00624d); // green TEXT, which the brand green is too light for
const INK = rgb(0x15243e); // titles
const BODY = rgb(0x343a40); // body text
const MUTED = rgb(0x5b6577); // secondary
const WASH = rgb(0xf4fbf8); // the pale green under a prospect row
const RULE = rgb(0xe7e9eb); // hairline
const WHITE = rgb(0xffffff);

/** ⚠️ **LATO, NOT INTER.** Lato is the platform's own face — it is what `tokens.css`
 *  bundles, what every replica screen renders in, and what ThoughtSpot's own embed
 *  config names for the Insights tab. Inter is nobody's font here. */
const FONT = "Lato";

/**
 * The numeric id of a tab, by name.
 *
 * ⚠️⚠️ **`sheetId` IS ABSENT FROM THE RESPONSE WHEN IT IS 0, AND THAT BROKE THE FIRST TAB
 * OF EVERY SHEET.** Google serialises protobuf to JSON and omits zero-valued integers, so
 * the first sheet in a spreadsheet — which is always `sheetId: 0`, and which is always our
 * **Demo Notes** tab — comes back as `{ properties: { title: "Demo Notes" } }` with no id
 * at all. The old `Number(hit.properties.sheetId)` therefore returned **NaN**, `NaN === null`
 * is false so the caller sailed on, `JSON.stringify` turned it into `"sheetId": null`, and
 * Google 400'd the WHOLE batch. Every style request for Demo Notes was lost that way, from
 * the day it shipped, and nothing anywhere said so.
 * ⚠️ So the absent field means ZERO, never "missing": `?? 0`, and the only null is a tab
 * that genuinely is not there.
 */
async function sheetIdFor(t: SheetTarget, title: string): Promise<number | null> {
  const meta = await api(t.email, `/${t.spreadsheetId}?fields=sheets.properties`);
  const hit = (meta?.sheets ?? []).find((x: any) => String(x?.properties?.title ?? "") === title);
  if (!hit) return null;
  const raw = hit.properties?.sheetId;
  const id = raw === undefined || raw === null ? 0 : Number(raw);
  return Number.isFinite(id) ? id : null;
}

/** How many rows of the tab actually hold something, header included. */
async function usedRows(t: SheetTarget, title: string): Promise<number> {
  const got = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(title)}!A:A`);
  return got?.values?.length ?? 0;
}

/**
 * The house style, applied to a tab.
 *
 * ⚠️⚠️ **THE FORMATTING STOPS AT THE DATA, AND THAT IS A DESIGN DECISION RATHER THAN
 * THRIFT.** An unbounded body range paints a hairline under all 1,000 rows of an empty
 * grid, so the sheet reads as ruled notebook paper with a handful of rows at the top —
 * which is most of what made the first version look unfinished. `rows` is the number of
 * rows that hold something; everything below them is left clean.
 *
 * ⚠️ **IT NEVER TOUCHES CELL VALUES**, only formatting and widths — so it is safe to run
 * on every write, and safe on a sheet somebody has added their own columns to.
 * ⚠️ `widths` is applied from the LEFT and stops at the end of the list, so a hand-added
 * column past the known ones keeps whatever width its owner gave it.
 *
 * ⚠️⚠️ **IT THROWS ON A MISSING TAB RATHER THAN RETURNING QUIETLY.** The old version
 * returned `void` when the lookup failed, so a sheet that could not be styled was
 * indistinguishable from one that had been — which is exactly how this shipped broken and
 * stayed broken. A caller that must not fail still catches it; it just has something to
 * catch now, and something to report.
 */
async function applyTheme(
  t: SheetTarget,
  title: string,
  widths: number[],
  opts: { rows?: number; wrapCol?: number; freezeCols?: number; numberCols?: [number, number] } = {},
): Promise<void> {
  const sheetId = await sheetIdFor(t, title);
  if (sheetId === null) throw new Error(`The sheet has no "${title}" tab to style.`);
  const rows = opts.rows ?? (await usedRows(t, title));
  /* The body is rows 2..rows. A tab holding only its header has no body to paint. */
  const bodyEnd = Math.max(1, rows);

  const requests: unknown[] = [
    /* ⚠️ The tab itself carries the brand green, and the default grid is turned OFF.
       Both are deliberate and both are visible the instant you open the file: the
       gridlines are replaced by our own hairlines, which is what makes it read as a
       designed table rather than a spreadsheet somebody typed into, and a coloured tab
       is the one signal that tells you at a glance the theme actually landed. */
    { updateSheetProperties: {
      properties: {
        sheetId,
        tabColor: BRAND,
        gridProperties: {
          frozenRowCount: 1,
          frozenColumnCount: opts.freezeCols ?? 0,
          hideGridlines: true,
        },
      },
      fields: "tabColor,gridProperties(frozenRowCount,frozenColumnCount,hideGridlines)",
    } },

    /* The header band is the brand green, which is the same treatment the playbook's
       own section bars and its contents heading carry: white bold on `#00b388`. */
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: {
        backgroundColor: BRAND,
        textFormat: { bold: true, fontSize: 11, foregroundColor: WHITE, fontFamily: FONT },
        verticalAlignment: "MIDDLE",
        padding: { top: 6, bottom: 6, left: 12, right: 12 },
      } },
      fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)",
    } },
    { updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 38 }, fields: "pixelSize",
    } },
  ];

  if (bodyEnd > 1) {
    requests.push(
      /* The body: readable size, top-aligned so a long note does not centre itself, and
         separated by a hairline per row rather than by a grid or a banded fill — which is
         how every table in the playbook is set, and it is the lighter of the two.
         ⚠️ **NOT `addBanding`.** That creates a persistent banded-range OBJECT on the tab,
         which would have to be found and deleted on every rewrite of the Activity sheet;
         a per-row border is a format, so it is replaced in place like everything else. */
      { repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: bodyEnd },
        cell: { userEnteredFormat: {
          backgroundColor: WHITE,
          textFormat: { fontSize: 10, foregroundColor: BODY, fontFamily: FONT, bold: false },
          verticalAlignment: "TOP",
          padding: { top: 8, bottom: 8, left: 12, right: 12 },
          borders: { bottom: { style: "SOLID", color: RULE } },
        } },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding,borders)",
      } },
      /* The first column is the row's subject, so it is set like one. */
      { repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: bodyEnd, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: INK } } },
        fields: "userEnteredFormat.textFormat(bold,foregroundColor)",
      } },
      { updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: bodyEnd },
        properties: { pixelSize: 30 }, fields: "pixelSize",
      } },
    );
    if (opts.numberCols) {
      const [from, to] = opts.numberCols;
      /* ⚠️ A count is an integer. Without a pattern Sheets is free to render a stored 1 as
         "1" here and "1.0" in the next column, which reads as two different measurements. */
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: bodyEnd, startColumnIndex: from, endColumnIndex: to },
        cell: { userEnteredFormat: {
          horizontalAlignment: "CENTER",
          numberFormat: { type: "NUMBER", pattern: "0" },
        } },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      } });
    }
    if (opts.wrapCol !== undefined) {
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: bodyEnd, startColumnIndex: opts.wrapCol, endColumnIndex: opts.wrapCol + 1 },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      } });
    }
  }

  widths.forEach((px, i) => requests.push({ updateDimensionProperties: {
    range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
    properties: { pixelSize: px }, fields: "pixelSize",
  } }));

  await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
    method: "POST", body: JSON.stringify({ requests }),
  });
}

/** Demo Notes: the notes column wraps, the prospect column is frozen, the rest are
 *  sized to what they hold. */
export async function themeNotes(t: SheetTarget): Promise<void> {
  await applyTheme(t, TAB_NAME, [220, 230, 120, 420, 240, 180, 150], {
    wrapCol: 3, freezeCols: 1,
  });
}

/**
 * Make a freshly connected sheet look like ours, before anything is marked.
 *
 * ⚠️⚠️ **THE HEADER ROW IS THE FIRST DATA, SO THIS IS WHAT "STYLED AS SOON AS DATA LANDS"
 * MEANS FOR A NEW SHEET.** Without it an admin connects a sheet, opens it to check, and
 * finds an untouched default grid — the formatting only arriving whenever somebody
 * happened to mark a demo. Connecting is the moment they are looking at it.
 * ⚠️ **IT REUSES `ensureSheet`, which is the one definition of "claim a tab and seed the
 * columns".** A second copy here would be free to disagree with the upsert about which tab
 * to rename or which headers to write, and the symptom would be a sheet whose first mark
 * silently lands on a different tab from the one that was styled.
 */
export async function prepareSheet(t: SheetTarget): Promise<void> {
  await ensureSheet(t);
  await themeNotes(t);
}

/**
 * Re-apply the house style to both tabs on demand.
 *
 * ⚠️⚠️ **THIS EXISTS BECAUSE A BACKGROUND STYLING FAILURE IS INVISIBLE, AND THAT COST A
 * SHIPPED-BROKEN SHEET.** Styling runs after a row lands and is swallowed so it can never
 * cost somebody their data — correct, and it means the only report of a failure was a sheet
 * that quietly looked wrong. This is the same work as a foreground action, so whatever
 * Google says comes back to the person who asked instead of to nobody.
 * ⚠️ Demo Notes is required; Activity is only styled if the tab exists, because a sheet
 * that has had marks but no shared-demo activity legitimately has no Activity tab yet.
 */
export async function restyleSheets(t: SheetTarget): Promise<{ tabs: string[] }> {
  const done: string[] = [];
  await themeNotes(t);
  done.push(TAB_NAME);
  if ((await sheetIdFor(t, ACTIVITY_TAB)) !== null) {
    await themeActivity(t, await usedRows(t, ACTIVITY_TAB));
    done.push(ACTIVITY_TAB);
  }
  return { tabs: done };
}

export interface ActivityLine {
  /** A prospect's own row, or one of its people. */
  main: boolean;
  label: string;
  opened: number;
  sms: number;
  voice: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Rewrite the Activity tab from the lines given.
 *
 * ⚠️⚠️ **CLEARED FIRST, over a range WIDER than what is written.** Rebuilding without
 * clearing leaves the tail of a previously longer sheet sitting under the new content —
 * rows for people who are still listed above, which reads as duplicates nobody can
 * explain. It clears to the old last row, not to a guess.
 */
export async function writeActivity(t: SheetTarget, lines: ActivityLine[]): Promise<void> {
  const title = ACTIVITY_TAB;
  await ensureNamedSheet(t, title);
  const values = [
    [...ACTIVITY_COLUMNS],
    ...lines.map((l) => [
      l.main ? l.label : `${INDENT}${l.label}`,
      l.opened || "", l.sms || "", l.voice || "",
      l.firstAt, l.lastAt,
    ]),
  ];

  const meta = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(title)}!A:A`);
  const was = (meta?.values?.length ?? 0);
  if (was > values.length) {
    await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(title)}!A${values.length + 1}:Z${was}:clear`,
      { method: "POST", body: "{}" });
  }
  await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(title)}!A1?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values }),
  });

  await themeActivity(t, values.length);
}

/**
 * Activity's own emphasis, on top of the house style: a prospect reads as a heading and
 * its people as detail under it.
 *
 * ⚠️⚠️ **WHICH ROWS ARE PROSPECTS IS READ BACK OFF THE SHEET, NOT PASSED IN — one source
 * of truth, two callers.** A write knows its own lines and a restyle does not, so handing
 * the flags in would mean the restyle needed a second way to work them out, and the two
 * would disagree the first time the indent changed. The indent IS the marker, it is
 * already in the data, and `INDENT` is the one definition both the writer and this reader
 * use. Verified by `audit:share` against the real strings rather than by eye.
 */
async function themeActivity(t: SheetTarget, rows: number): Promise<void> {
  await applyTheme(t, ACTIVITY_TAB, [320, 95, 115, 125, 185, 185], {
    rows, numberCols: [1, 4],
  });
  const sheetId = await sheetIdFor(t, ACTIVITY_TAB);
  if (sheetId === null) throw new Error(`The sheet has no "${ACTIVITY_TAB}" tab to style.`);
  if (rows < 2) return;

  const got = await api(t.email, `/${t.spreadsheetId}/values/${encodeURIComponent(ACTIVITY_TAB)}!A2:A${rows}`);
  const labels: string[] = (got?.values ?? []).map((r: unknown[]) => String(r?.[0] ?? ""));

  const requests: unknown[] = [];
  labels.forEach((label, i) => {
    /* ⚠️ Compared against the ARROW, not the whole indent: Sheets is free to hand back a
       value with its leading spaces trimmed, and a test on the padded string would then
       call every person a prospect and paint the whole tab as headings. */
    const main = !label.trimStart().startsWith(INDENT.trim());
    const r = i + 1;
    requests.push({ repeatCell: {
      range: { sheetId, startRowIndex: r, endRowIndex: r + 1 },
      cell: { userEnteredFormat: {
        backgroundColor: main ? WASH : WHITE,
        textFormat: {
          bold: main, fontSize: main ? 11 : 10, fontFamily: FONT,
          foregroundColor: main ? INK : MUTED,
        },
        /* ⚠️ Every row keeps the body hairline UNDER it; a prospect additionally gets one
           ABOVE, which is what opens each block. Writing `borders: {}` for a subline
           would CLEAR the bottom rule the base format just set, because `borders` is in
           the field mask — so the quiet rows have to restate it rather than omit it. */
        borders: main
          ? { top: { style: "SOLID", color: RULE }, bottom: { style: "SOLID", color: RULE } }
          : { bottom: { style: "SOLID", color: RULE } },
      } },
      fields: "userEnteredFormat(backgroundColor,textFormat,borders)",
    } });
    /* ⚠️ The thick green edge down a prospect's first cell is the product's own action-card
       treatment — the 5px left edge every tinted workflow node carries. It is what makes a
       block read as a block without a heavy grid, and it is the one place the brand green
       is allowed to be a line rather than a ground. */
    if (main) {
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { borders: {
          left: { style: "SOLID_THICK", color: BRAND },
          top: { style: "SOLID", color: RULE },
          bottom: { style: "SOLID", color: RULE },
        } } },
        fields: "userEnteredFormat.borders",
      } });
    }
  });
  /* The three count columns carry the deep green, so the numbers are what the eye finds.
     ⚠️ `GREEN_INK`, not `BRAND` — see the palette note: the brand green is a ground and
     is close to illegible as 10pt text on white. */
  requests.push({ repeatCell: {
    range: { sheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 1, endColumnIndex: 4 },
    cell: { userEnteredFormat: { textFormat: { foregroundColor: GREEN_INK, bold: true } } },
    fields: "userEnteredFormat.textFormat(foregroundColor,bold)",
  } });
  /* The two timestamps are context, not the subject — they take the quiet ink even on a
     prospect row, where everything else is the loud one. */
  requests.push({ repeatCell: {
    range: { sheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 4, endColumnIndex: 6 },
    cell: { userEnteredFormat: { textFormat: { foregroundColor: MUTED, bold: false, fontSize: 10 } } },
    fields: "userEnteredFormat.textFormat(foregroundColor,bold,fontSize)",
  } });
  await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
    method: "POST", body: JSON.stringify({ requests }),
  });
}

/**
 * Say that the styling failed, to somewhere a human will actually look.
 *
 * ⚠️⚠️ **THE SWALLOW IS RIGHT AND THE SILENCE WAS NOT, AND THE DIFFERENCE IS THIS
 * FUNCTION.** Styling must never cost somebody a row that already landed, so both callers
 * catch — but the old bare catch with a "cosmetic only" note meant a sheet that could not
 * be styled and a sheet that had been were indistinguishable from the outside. That is how
 * a broken theme shipped and stayed broken until somebody opened the file and said so.
 * ⚠️ That note is spelled out rather than quoted, because a comment-opener inside a comment
 * is the landmine this repo already paid for once in `server.ts`'s route list.
 * ⚠️ **`record`, NOT `page`.** It is cosmetic: it belongs in the count on `/api/status`,
 * where `sheet-style:<tab>` with a number beside it is the whole diagnosis, and not in a
 * Slack message at 2am. The signature carries the TAB and never the sheet id or the
 * owner's address, because that endpoint is public.
 */
export async function reportStyleFailure(tab: string, e: unknown): Promise<void> {
  const message = (e as Error)?.message || String(e);
  console.error(`[sheets] styling failed for "${tab}": ${message}`);
  await alert({
    key: `sheet-style:${tab}`,
    title: `Google Sheet styling failed on the ${tab} tab`,
    detail: message,
    level: "record",
    context: { tab },
  });
}

/** Create a tab by name if it is missing. ⚠️ Never renames anything — unlike the
 *  Demo Notes resolver, which may claim an empty first sheet. */
async function ensureNamedSheet(t: SheetTarget, title: string): Promise<void> {
  if ((await sheetIdFor(t, title)) !== null) return;
  await api(t.email, `/${t.spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}
