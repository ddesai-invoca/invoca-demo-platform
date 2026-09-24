import { inflateRawSync } from "node:zlib";

/* =============================================================================
   docText.ts — pull the readable text out of an uploaded strategy document
   -----------------------------------------------------------------------------
   Feeds engine/genContext.ts: an SE attaches the strategy doc for a prospect and
   the generation reads it to decide which signals, which agent channel and which
   dashboards the demo should lead with.

   ⚠️ NO DEPENDENCY, AND THAT WAS A CLOSE CALL. `mammoth` is the obvious choice
   and does this properly, but a .docx is a ZIP holding one XML file and all we
   need is its text — so this reads the ZIP's CENTRAL DIRECTORY (not a scan for
   local headers, which is the version that breaks: a streamed zip can write
   compressedSize 0 there and defer it to a data descriptor) and inflates the one
   entry. Verified against a real Word-exported .docx from this project, matched
   character-for-character against Python's `zipfile` on the same file.
   If this ever needs .pdf, add a library rather than growing this — PDF text
   extraction is not a 60-line problem and pretending otherwise produces
   plausible-looking garbage, which is worse here than refusing.

   ⚠️ TEXT ONLY, NEVER A ROUND TRIP. Nothing here reconstructs formatting,
   tables or images. The output is fed to a model as background context, so
   paragraph breaks are the only structure worth keeping.
   ============================================================================= */

/** What we can actually read. Anything else is refused by name rather than
 *  silently producing an empty document, which would look like a working upload
 *  that changed nothing about the demo. */
const PLAIN = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json"]);

export const DOC_ACCEPT = ".docx,.txt,.md,.markdown,.csv,.tsv,.json";
export const MAX_DOC_BYTES = 8 * 1024 * 1024;

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

/* ---- the minimal ZIP reader ------------------------------------------------
   Only what a .docx needs: locate one named entry via the central directory and
   return its bytes. */
function zipEntry(buf: Buffer, want: string): Buffer | null {
  /* End-of-central-directory, scanned BACKWARD: the comment field at the end is
     variable-length, so the signature's position is not fixed. 22 is the record's
     own size and 0xFFFF the largest comment it can carry. */
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);          // start of the central directory

  for (let k = 0; k < entries; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    if (name === want) {
      /* The local header repeats the name and extra fields, and its extra field
         length can DIFFER from the central one — so the data offset has to be
         computed from the local header, not from the central directory's copy. */
      if (buf.readUInt32LE(localAt) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localAt + 26);
      const lExtraLen = buf.readUInt16LE(localAt + 28);
      const start = localAt + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(raw);          // stored
      if (method === 8) return inflateRawSync(raw);       // deflate
      return null;                                        // anything exotic
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/* ---- docx → text ----------------------------------------------------------- */

const XML_ENT: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};

function docxToText(buf: Buffer): string {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("That .docx could not be read — it may be corrupt, or password protected.");
  return xml.toString("utf8")
    /* Paragraph and explicit line breaks become newlines BEFORE tags are
       stripped, or the whole document collapses into one run-on line and the
       model loses every heading and bullet boundary. */
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => XML_ENT[m.toLowerCase()] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Extract readable text from an uploaded document.
 * Throws with a message meant for the SE — an upload that quietly contributes
 * nothing is the failure this avoids.
 */
export function extractDocText(buf: Buffer, filename: string): string {
  if (buf.length > MAX_DOC_BYTES) {
    throw new Error(`${filename} is over ${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB.`);
  }
  const ext = extOf(filename);
  if (ext === ".docx") return docxToText(buf);
  if (PLAIN.has(ext)) return buf.toString("utf8").trim();
  if (ext === ".doc") {
    throw new Error("Legacy .doc isn't supported — re-save it as .docx, or paste the text.");
  }
  if (ext === ".pdf") {
    /* Refused deliberately: see the header. A bad extractor here would hand the
       model confident nonsense and there would be nothing on screen to say so. */
    throw new Error("PDF isn't supported yet — paste the text, or attach the .docx.");
  }
  throw new Error(`${filename}: only ${DOC_ACCEPT} can be read.`);
}
