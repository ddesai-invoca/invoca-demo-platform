/* =============================================================================
   questionImport.ts — turning a pasted block or an uploaded file into the
   Preview Agent's qualifying questions.
   -----------------------------------------------------------------------------
   WHY THIS IS NOT A MODEL CALL.

   The other three ways of changing the questions ("change question 3", "make
   these a nurture flow") are judgement, and the assistant does them well. Pasting
   a list and importing a file are not judgement: the user has already written the
   exact words, and the only job left is to get them into the array unaltered.

   Handing that to the model is the same mistake engine/assistant.ts already
   documents for the report's column insert — asked to echo a list verbatim, a
   fast model paraphrases, re-orders, drops the tail, and "fixes" wording it finds
   odd. On a demo that an SE is about to present, a question that comes back
   subtly reworded is worse than one that fails loudly.

   So this path is pure, local and instant: parse, apply, done. No API call, no
   latency, and the words that appear in the agent are character-for-character the
   words the user supplied.

   Pure and dependency-free so it can be unit tested directly.
   ============================================================================= */

/** Where the Preview Agent's questions live inside that page's registered scope. */
export const QUESTIONS_PATH = "smsPlaybook.qualifyingQuestions";

/* An agent that asks more than a dozen questions stops being a demo and starts
   being a form, and the phone screen has nowhere to put them. We keep the first
   MAX and REPORT the rest rather than silently swallowing them — a truncation the
   user cannot see reads as "the import lost my questions". */
export const MAX_QUESTIONS = 12;

export interface ParsedQuestions {
  questions: string[];
  /** How many were dropped past MAX_QUESTIONS, so the UI can say so out loud. */
  truncated: number;
}

/* Leading list furniture people paste along with their questions:
   "1.", "1)", "(1)", "1 -", "Q1.", "Q:", "-", "*", bullet characters. */
const LEADER = /^\s*(?:[(\[]?\s*(?:q(?:uestion)?\s*)?\d+\s*[).\]:\-]+|[-*•–—·]|q\s*:)\s*/i;

/* A header line rather than a question. Matched only on the FIRST line, because
   "Questions" is a plausible heading but an implausible question. */
const HEADER = /^\s*(?:qualifying\s+)?questions?\s*:?\s*$/i;

/** Split one CSV/TSV line, honouring "quoted, fields" and "" escapes. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // "" is a literal quote
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/* Which column holds the questions, given a header row. Returns -1 when the first
   row is not a header, in which case every row is data and column 0 is the list. */
function questionColumn(cells: string[]): number {
  return cells.findIndex((c) => /^\s*"?\s*(?:question|prompt|ask)s?\s*"?\s*$/i.test(c));
}

function tidy(s: string): string {
  return s
    .replace(LEADER, "")
    .replace(/\s+/g, " ")          // a wrapped line arrives with newlines inside it
    .replace(/^["'“‘]+|["'”’]+$/g, "")   // stray wrapping quotes
    .trim();
}

/**
 * Parse pasted text or an uploaded file into an ordered question list.
 *
 * Handles, in this order: CSV/TSV with or without a header row, one question per
 * line with or without list markers, and a single run-on paragraph of questions
 * separated by "?".
 */
export function parseQuestionList(raw: string): ParsedQuestions {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { questions: [], truncated: 0 };

  let lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  /* ONE RUN-ON BLOCK. Someone pastes "What are you looking for? What's your
     budget? When are you free?" as a single line. Split after each "?" and keep
     the mark — without this the whole paragraph becomes one absurd question. */
  if (lines.length === 1 && (lines[0].match(/\?/g) ?? []).length > 1) {
    lines = lines[0].split(/(?<=\?)\s+/).map((l) => l.trim()).filter(Boolean);
  }

  /* CSV / TSV. Detected on the delimiter appearing on MOST lines, so a single
     question containing a comma does not send us down this path. */
  const delim = [",", "\t"].find((d) => {
    const withDelim = lines.filter((l) => l.includes(d)).length;
    return lines.length > 1 && withDelim >= Math.ceil(lines.length * 0.6);
  });
  if (delim) {
    const rows = lines.map((l) => splitDelimited(l, delim));
    const col = questionColumn(rows[0]);
    const body = col >= 0 ? rows.slice(1) : rows;
    const idx = col >= 0 ? col : 0;
    lines = body.map((r) => r[idx] ?? "").filter(Boolean);
  }

  if (lines.length && HEADER.test(lines[0])) lines = lines.slice(1);

  const seen = new Set<string>();
  const all: string[] = [];
  for (const line of lines) {
    const q = tidy(line);
    if (!q) continue;
    const dedupeKey = q.toLowerCase();
    if (seen.has(dedupeKey)) continue;      // the same question twice reads as a bug
    seen.add(dedupeKey);
    all.push(q);
  }

  return { questions: all.slice(0, MAX_QUESTIONS), truncated: Math.max(0, all.length - MAX_QUESTIONS) };
}

/** File types the import button accepts, and what the picker filters to. */
export const QUESTION_FILE_ACCEPT = ".txt,.csv,.tsv,.md,.text,text/plain,text/csv";

/** True for a file we can read as text. Guards against a dropped PDF or .docx. */
export function isReadableQuestionFile(file: File): boolean {
  return /\.(txt|csv|tsv|md|text)$/i.test(file.name) || /^text\//.test(file.type);
}

/* -----------------------------------------------------------------------------
   The no-dash rule, applied to questions the ASSISTANT wrote.

   engine/chat.ts strips dashes from the agent's live replies because a
   dash-joined clause is the clearest AI tell a prospect sees. A question the
   assistant authors is the same kind of text and was slipping through: a "Nurture"
   rewrite produced "What's the best way to stay in touch-text, email, or phone?"
   and it sat in the list looking machine-written.

   Deliberately NOT applied to a pasted or imported list. There the user typed the
   words, and silently rewriting their punctuation is the exact behaviour the local
   path exists to avoid. Generated text gets cleaned; the user's own text does not.

   Mirrors engine/chat.ts::stripDashes rather than importing it, because that
   module is server-side (it pulls in the Anthropic SDK) and must not be dragged
   into the browser bundle. Only SPACED and em/en dashes are touched, so
   "rear-ended" and "24-48h" survive. */
export function stripGeneratedDashes(s: string): string {
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/ +- +/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
