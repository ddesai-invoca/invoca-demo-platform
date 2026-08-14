import { useRef, useState } from "react";
import {
  parseQuestionList, isReadableQuestionFile, QUESTION_FILE_ACCEPT, MAX_QUESTIONS,
} from "../data/questionImport";

/* =============================================================================
   QuestionListTools — the four ways to change what the Preview Agent asks.
   -----------------------------------------------------------------------------
   Rendered inside the Ask AI drawer, but ONLY on a page that opted in by
   registering a `questionPath` (today: the Preview Agent tab). Every other
   screen's drawer is untouched.

   The four routes deliberately split down the middle:

     ONE BY ONE   -> the assistant. Clicking a question pre-fills the composer with
                     "Change question 3 to: ", so the model gets an unambiguous
                     index instead of having to guess which one "the budget one" is.
     BY USE CASE  -> the assistant. Judgement work: rewrite the whole list to fit
                     "book an appointment" or "nurture".
     PASTE A LIST -> local. No model call.
     IMPORT FILE  -> local. No model call.

   The bottom two are local because the user has already written the exact words.
   Sending them through a fast model to be echoed back is how you get a question
   quietly reworded between the SE typing it and the prospect seeing it. See the
   header of data/questionImport.ts.
   ============================================================================= */

/* Use cases worth one tap. Free text still works for anything else — these are a
   shortcut, not the menu. */
const USE_CASES = [
  { label: "Book an appointment", hint: "qualify, then lock in a day and time" },
  { label: "Nurture", hint: "no booking, keep them warm and learn their timeline" },
  { label: "Qualify and route", hint: "work out who they are, then hand to the right team" },
  { label: "Quote / estimate", hint: "gather what a price needs, then quote" },
];

export function QuestionListTools({ questions, readOnly, onReplace, onPrompt }: {
  questions: string[];
  readOnly: boolean;
  /** Apply a new list locally. `note` describes where it came from, for the log. */
  onReplace: (next: string[], note: string) => void;
  /** Hand a composed instruction to the assistant (fills the composer). */
  onPrompt: (text: string) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /* One place where a parsed list becomes an applied list, so a paste and a file
     import can never diverge in how they validate or what they report. */
  function commit(text: string, source: string) {
    const { questions: next, truncated } = parseQuestionList(text);
    if (!next.length) {
      setProblem("I couldn't find any questions in that. One per line, or a CSV with a question column.");
      return;
    }
    setProblem("");
    setPasting(false);
    setDraft("");
    /* Truncation is REPORTED, never silent: an import that quietly drops the tail
       looks like it worked right up until the demo. */
    const extra = truncated ? ` The first ${MAX_QUESTIONS} are in; ${truncated} more were left out.` : "";
    onReplace(next, `Replaced the agent's questions with ${next.length} from ${source}.${extra}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";                 // so picking the same file twice re-fires
    if (!file) return;
    if (!isReadableQuestionFile(file)) {
      setProblem(`I can't read ${file.name}. Use a .txt, .csv, .tsv or .md file.`);
      return;
    }
    file.text()
      .then((text) => commit(text, file.name))
      .catch(() => setProblem(`Couldn't read ${file.name}.`));
  }

  return (
    <div className="aiq">
      <div className="aiq-head">
        <span className="aiq-title">
          What the agent asks
          <span className="aiq-count">{questions.length}</span>
        </span>
        <span className="aiq-actions">
          <button className="aiq-btn" onClick={() => { setPasting((v) => !v); setProblem(""); }} disabled={readOnly}>
            <span className="material-icons">content_paste</span>Paste a list
          </button>
          <button className="aiq-btn" onClick={() => fileRef.current?.click()} disabled={readOnly}>
            <span className="material-icons">upload_file</span>Import a file
          </button>
          <input ref={fileRef} type="file" accept={QUESTION_FILE_ACCEPT} onChange={onFile} hidden />
        </span>
      </div>

      {pasting ? (
        <div className="aiq-paste">
          <textarea
            autoFocus rows={5} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={"Paste your questions, one per line.\n\nNumbering and bullets are fine, and so is a CSV with a question column."}
          />
          <div className="aiq-paste-foot">
            <button className="aiq-apply" onClick={() => commit(draft, "your pasted list")} disabled={!draft.trim()}>
              Replace the questions
            </button>
            <button className="aiq-cancel" onClick={() => { setPasting(false); setDraft(""); setProblem(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* ONE BY ONE. The index goes in the prompt so the model never has to work
              out which question the user meant. */}
          <ol className="aiq-list">
            {questions.map((q, i) => (
              <li key={i}>
                <button
                  className="aiq-q" disabled={readOnly}
                  title={readOnly ? "This demo is read-only" : `Change question ${i + 1}`}
                  onClick={() => onPrompt(`Change question ${i + 1} ("${q}") to: `)}
                >
                  <span className="aiq-num">{i + 1}</span>
                  <span className="aiq-text">{q}</span>
                  <span className="material-icons aiq-pencil">edit</span>
                </button>
              </li>
            ))}
            {questions.length === 0 && <li className="aiq-none">This agent has no qualifying questions yet.</li>}
          </ol>

          {/* BY USE CASE. One tap writes the instruction; the assistant rewrites
              the whole list to match. */}
          <div className="aiq-cases">
            <span className="aiq-cases-label">Or rewrite them all for a use case</span>
            <span className="aiq-chips">
              {USE_CASES.map((c) => (
                <button
                  key={c.label} className="aiq-chip" disabled={readOnly} title={c.hint}
                  onClick={() => onPrompt(
                    `Rewrite all of the agent's qualifying questions for this use case: ${c.label} (${c.hint}). ` +
                    `Keep them specific to this business and in a sensible order.`
                  )}
                >
                  {c.label}
                </button>
              ))}
            </span>
          </div>
        </>
      )}

      {problem && <p className="aiq-problem">{problem}</p>}
    </div>
  );
}
