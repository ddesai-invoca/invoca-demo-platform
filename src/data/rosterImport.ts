/* =============================================================================
   rosterImport.ts — a filled-in template becomes a list of prospects to build
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"have a mass generate option (maybe they can download a
   template and fill in the information and then upload it) and also allow them to
   pick which event they want to add it to."*

   ⚠️⚠️ **PARSED LOCALLY, NO MODEL CALL.** The user already typed the exact names and
   URLs; sending them through a model to be echoed is the mistake `parseQuestionList`
   records at length ("it paraphrases, reorders, drops the tail"). Same reasoning, same
   answer: this is a parser.

   ⚠️ **EVERY REFUSAL IS REPORTED, NEVER SILENT.** A roster row that is dropped is a
   prospect somebody expected to be generated, and finding out two hours later that 7
   of 40 never ran is the failure this is written to avoid. `ParsedRoster.skipped`
   carries the line number and the reason for every one.
   ============================================================================= */

export interface RosterRow {
  name: string;
  url: string;
}

export interface RosterSkip {
  /** 1-based line in the uploaded file, so the message can name it. */
  line: number;
  text: string;
  reason: string;
}

export interface ParsedRoster {
  rows: RosterRow[];
  skipped: RosterSkip[];
}

/** ⚠️ A ROSTER IS A CONFERENCE LIST, NOT A DATABASE DUMP. Each prospect is ~2-3
 *  minutes of generation, so 60 rows is already a long afternoon; a 5,000-row paste
 *  is a mistake, and accepting it would queue weeks of work behind one click. */
export const ROSTER_MAX = 120;

/** The file the Download template button produces. ⚠️ The header row is what makes
 *  an uploaded file self-describing, and the parser reads it rather than assuming
 *  column order — somebody will reorder these two columns. */
export const ROSTER_TEMPLATE =
  "name,website\n" +
  "Acme Plumbing,https://www.acmeplumbing.com\n" +
  "Northwind Health,https://northwindhealth.org\n";

/* ⚠️ ONE ROW AT A TIME, HONOURING QUOTES — "Smith, Jones & Co" is a real company
   name and a naive split on commas turns it into two broken rows. A doubled quote
   inside a quoted field is an escaped quote, which is what every spreadsheet emits. */
function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_NAME = /^(name|prospect|company|customer|account)$/i;
const HEADER_URL = /^(website|url|site|domain|web\s*site)$/i;

/** ⚠️ ACCEPTS WHAT A SPREADSHEET ACTUALLY EXPORTS: a .csv saved from Excel, Numbers
 *  or Sheets, or a .tsv pasted straight out of one. The separator is whichever of the
 *  two the first line has more of, decided per file rather than per line. */
export function parseRoster(raw: string): ParsedRoster {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.find((l) => l.trim()) ?? "";
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";

  const rows: RosterRow[] = [];
  const skipped: RosterSkip[] = [];
  const seen = new Set<string>();
  let nameAt = 0;
  let urlAt = 1;
  let headerSeen = false;

  lines.forEach((line, i) => {
    const text = line.trim();
    if (!text) return;
    const cells = splitRow(line, sep);

    /* The header is identified, not assumed to be line 1 — a file can open with a
       title row, and a file with NO header still parses on the default order. */
    if (!headerSeen) {
      const n = cells.findIndex((c) => HEADER_NAME.test(c));
      const u = cells.findIndex((c) => HEADER_URL.test(c));
      if (n !== -1 && u !== -1) { nameAt = n; urlAt = u; headerSeen = true; return; }
    }

    const name = (cells[nameAt] ?? "").trim();
    const url = (cells[urlAt] ?? "").trim();
    if (!name && !url) return;
    if (!name) { skipped.push({ line: i + 1, text, reason: "no prospect name" }); return; }
    if (!url) { skipped.push({ line: i + 1, text, reason: "no website" }); return; }

    const normalized = normalizeUrl(url);
    if (!normalized) { skipped.push({ line: i + 1, text, reason: `"${url}" is not a web address` }); return; }

    /* ⚠️ DE-DUPED ON THE NAME, because the same prospect twice is two full
       generations and two library rows nobody asked for. */
    const key = name.toLowerCase();
    if (seen.has(key)) { skipped.push({ line: i + 1, text, reason: "already in this list" }); return; }
    seen.add(key);

    if (rows.length >= ROSTER_MAX) {
      skipped.push({ line: i + 1, text, reason: `past the ${ROSTER_MAX}-row limit` });
      return;
    }
    rows.push({ name, url: normalized });
  });

  return { rows, skipped };
}

/** ⚠️ A BARE DOMAIN IS WHAT PEOPLE TYPE INTO A SPREADSHEET, so `acme.com` is accepted
 *  and becomes `https://acme.com`. A hostname with no dot is a typo rather than an
 *  intranet host — the same rule the Book-online override already applies, and finding
 *  out mid-generation is far worse than being told now. */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
