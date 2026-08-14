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

/* Use cases worth one tap. Free text still works for anything else, so this is a
   shortcut rather than the menu.

   `brief` is what the assistant is actually told, and it carries the whole weight
   of the rewrite: a one-word label like "Nurture" means different things at
   different companies, and the model will happily invent the wrong one. NURTURE
   IN PARTICULAR: it is re-engagement, not a slow-burn newsletter. These people
   were interested once and then went quiet, and the goal is still a booking. The
   schema already says so for the extra nurture workflows ("re-engage prospects who
   went quiet after intake", schema.ts) and this now matches it. */
const USE_CASES = [
  {
    label: "Book an appointment",
    hint: "qualify, then lock in a day and time",
    brief: "A new inbound lead texting in for the first time. Qualify them on what they want, then drive to booking a specific day and time.",
  },
  {
    label: "Nurture / re-engage",
    hint: "they went quiet; check back in and win the booking",
    brief:
      "RE-ENGAGEMENT, not a cold opener. These people were interested at some point and then went quiet: " +
      "they stopped replying, or a rep could never reach them. The AI agent is now picking that thread back up. " +
      "So the questions should check whether they are STILL interested, find out what stalled it (timing, price, " +
      "they went elsewhere, they were just busy), and clear that obstacle. The goal is still to get an appointment " +
      "booked. Assume prior contact and reference it; never ask as though this were a first conversation.",
  },
  {
    label: "Qualify and route",
    hint: "work out who they are, then hand to the right team",
    brief: "Work out who this person is and what they need, so the conversation can be handed to the right team or location.",
  },
  {
    label: "Quote / estimate",
    hint: "gather what a price needs, then quote",
    brief: "Gather exactly what is needed to put a price together, then move toward giving them a quote.",
  },
];

export function QuestionListTools({ greeting, greetingRaw, questions, readOnly, onReplace, onPrompt }: {
  /* The agent's first text, with {name} already resolved, so this row reads as
     exactly what the phone sends. Either what someone set or the derived default. */
  greeting: string;
  /* The same text with the {name} TOKEN intact. This is what goes to the model:
     handing it the resolved version gets a literal first name baked into the
     stored greeting, which then addresses the wrong person on the next demo. */
  greetingRaw: string;
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
          {/* THE OPENING MESSAGE, above the numbered list and visually distinct.
              It is the one thing a prospect always sees, and it is not a question,
              so numbering it alongside them would misread the flow. Paste and
              import replace the QUESTIONS only, which is why this sits apart. */}
          <div className="aiq-greeting">
            <span className="aiq-greeting-label">Opening message</span>
            <button
              className="aiq-q aiq-q-greeting" disabled={readOnly}
              title={readOnly ? "This demo is read-only" : "Change the opening message"}
              onClick={() => onPrompt(`Change the agent's opening message (currently "${greetingRaw}", where {name} is the customer's first name) to: `)}
            >
              <span className="material-icons aiq-greeting-icon">sms</span>
              <span className="aiq-text">{greeting}</span>
              <span className="material-icons aiq-pencil">edit</span>
            </button>
          </div>

          {/* ONE BY ONE. The index goes in the prompt so the model never has to work
              out which question the user meant. */}
          <span className="aiq-then">then it asks</span>
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
                    `Rewrite this agent for a new use case: ${c.label}.\n${c.brief}\n` +
                    `Change BOTH the opening message and all of the qualifying questions so they fit that use case. ` +
                    `The opening message has to give it away on its own: someone reading only the first text should ` +
                    `be able to tell which situation this is. Keep everything specific to this business.`
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
