import { getDriveToken, removeDriveToken } from "./driveTokens.ts";
import { extractDriveFileId } from "./driveLink.ts";
import { extractDocText } from "./docText.ts";

/* =============================================================================
   driveApi.ts — read a PRIVATE Drive file, as the SE who connected their Drive
   -----------------------------------------------------------------------------
   The sibling of driveLink.ts's public-export path: where that one works with
   NO credential (a doc shared "Anyone with the link"), this one reads as the
   SIGNED-IN SE via their own stored refresh token (driveTokens.ts), which
   reaches whatever that SE can already open in Drive — an internal strategy
   doc included.

   Uses the Drive API v3 directly (fetch, no googleapis SDK): two calls, a
   files.get for the mimeType and name, then either files.export (a native
   Google Doc) or files.get?alt=media + the existing .docx/.txt reader
   (anything else an SE might have uploaded to Drive, e.g. a Word doc).
   ============================================================================= */

const OAUTH_ID = process.env.GOOGLE_CLIENT_ID || "";
const OAUTH_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** A "reconnect" error means the SE's stored token is dead (revoked, or the
 *  grant was removed on Google's side) — the doc-link endpoint must show this
 *  verbatim rather than silently falling back to the public path, because no
 *  amount of retrying fixes it without the SE reconnecting. */
export class DriveReconnectError extends Error {}

/* One cached access token per SE — mirrors mailer.ts's single cached token,
   widened to a Map because Drive is genuinely multi-tenant where Gmail sending
   is one shared account. Keyed by email; cleared whenever that SE disconnects
   or their refresh token turns out to be dead. */
const accessCache = new Map<string, { token: string; expiry: number }>();

async function accessTokenFor(email: string): Promise<string> {
  const cached = accessCache.get(email);
  if (cached && Date.now() < cached.expiry) return cached.token;

  const refreshToken = getDriveToken(email);
  if (!refreshToken) throw new DriveReconnectError("Google Drive isn't connected for this account.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OAUTH_ID, client_secret: OAUTH_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  const tok: any = await res.json();
  if (!tok?.access_token) {
    /* invalid_grant is Google's answer to a revoked or expired refresh token —
       the connection is dead, not merely slow, so the stored token is cleared
       rather than retried forever. */
    if (tok?.error === "invalid_grant") {
      removeDriveToken(email);
      throw new DriveReconnectError("Your Google Drive connection has expired. Reconnect it in Advanced settings.");
    }
    throw new Error(tok?.error_description || tok?.error || "Could not refresh the Google Drive token.");
  }
  accessCache.set(email, {
    token: tok.access_token,
    expiry: Date.now() + Math.max(0, (Number(tok.expires_in) || 3600) - 60) * 1000,
  });
  return tok.access_token;
}

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
/* Every other Google-native type (Sheets, Slides, Forms, folders…) has no plain
   text export a strategy doc would want, so those are refused by name rather
   than exporting something nonsensical. */
const UNSUPPORTED_NATIVE = new Set([
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.folder",
  "application/vnd.google-apps.drawing",
]);

export async function fetchPrivateGoogleDocText(url: string, email: string): Promise<{ label: string; text: string }> {
  const id = extractDriveFileId(url);
  if (!id) throw new Error("That doesn't look like a Google Docs or Drive link.");
  const token = await accessTokenFor(email);
  const auth = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(`${DRIVE_API}/files/${id}?fields=name,mimeType`, { headers: auth });
  if (metaRes.status === 401) {
    accessCache.delete(email);
    removeDriveToken(email);
    throw new DriveReconnectError("Your Google Drive connection has expired. Reconnect it in Advanced settings.");
  }
  if (!metaRes.ok) {
    throw new Error("Could not find that file in Drive, or this account doesn't have access to it.");
  }
  const meta: any = await metaRes.json();
  const name = String(meta?.name || "Google Drive file");
  const mimeType = String(meta?.mimeType || "");

  if (UNSUPPORTED_NATIVE.has(mimeType)) {
    throw new Error(`${name} is a Google ${mimeType.split(".").pop()}, not a document — only Docs and uploaded files can be read.`);
  }

  let text: string;
  if (mimeType === GOOGLE_DOC_MIME) {
    const exportRes = await fetch(`${DRIVE_API}/files/${id}/export?mimeType=text/plain`, { headers: auth });
    if (!exportRes.ok) throw new Error(`Could not export "${name}" from Drive.`);
    text = (await exportRes.text()).trim();
  } else {
    const dlRes = await fetch(`${DRIVE_API}/files/${id}?alt=media`, { headers: auth });
    if (!dlRes.ok) throw new Error(`Could not download "${name}" from Drive.`);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    text = extractDocText(buf, name);
  }

  if (!text.trim()) throw new Error(`${name} has no readable text in it.`);
  return { label: name, text };
}
