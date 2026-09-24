/* =============================================================================
   driveLink.ts — read a PUBLICLY SHARED Google Doc from its link, no credential
   -----------------------------------------------------------------------------
   Feeds engine/genContext.ts, alongside docText.ts: an SE pastes a Google
   Drive/Docs strategy-doc link instead of (or beside) attaching a .docx.

   ⚠️ THIS IS NOT THE PER-USER OAUTH DRIVE INTEGRATION docs/INTEGRATIONS.md
   describes — that one is still unbuilt and needs GOOGLE_DRIVE_ENABLED. This is
   a SEPARATE, credential-free path: Google serves a Doc's plain-text export at a
   public URL when the doc is shared "Anyone with the link can view", and this
   server can just fetch that URL like any other HTTP resource. No Drive API, no
   OAuth, no server credential — so it works today, for exactly the docs an SE
   would actually paste a shareable link to.

   ⚠️ A DOC THAT IS NOT SHARED PUBLICLY REDIRECTS TO A GOOGLE SIGN-IN PAGE, and
   that redirect is the ONLY signal available that the doc could not be read —
   there is no 401/403, just a 200 HTML login page. Detected by the final URL's
   host, not by inspecting the body.
   ============================================================================= */

const ID_RE = /\/(?:document|file|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/;

export function extractDriveFileId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(u.hostname) && !/(^|\.)drive\.google\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(ID_RE);
  if (m) return m[1];
  const idParam = u.searchParams.get("id");
  return idParam || null;
}

export async function fetchPublicGoogleDocText(url: string): Promise<{ label: string; text: string }> {
  const id = extractDriveFileId(url);
  if (!id) throw new Error("That doesn't look like a Google Docs or Drive link.");
  const exportUrl = `https://docs.google.com/document/d/${id}/export?format=txt`;
  let res: Response;
  try {
    res = await fetch(exportUrl, { redirect: "follow" });
  } catch {
    throw new Error("Could not reach Google to read that doc.");
  }
  const finalUrl = res.url || exportUrl;
  if (!res.ok || /accounts\.google\.com/.test(finalUrl)) {
    throw new Error(
      'That Google Doc isn\'t shared with "Anyone with the link." Change its sharing, paste the text into the custom prompt, or attach it as a .docx.'
    );
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error("That Google Doc has no readable text in it.");
  return { label: `Google Doc (${id.slice(0, 8)}…)`, text };
}
