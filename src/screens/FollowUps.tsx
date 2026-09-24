/* =============================================================================
   FollowUps — the list the marking exists for
   -----------------------------------------------------------------------------
   The SE's own words: *"I have delivered about 25 custom demonstrations... I
   can't remember who all I did the demo for."* So this page is the DELIVERABLE
   and the marking is the input, not the other way round. It answers one question
   — who do I still owe a follow-up — and it answers it without a filter to set.

   ⚠️ **GROUPED BY EVENT, because that is the unit of work.** A conference is a
   burst of demos over two days and the follow-ups are worked through as one
   batch; a flat reverse-chronological list mixes them with the ordinary week.
   Demos with no event fall under "Other", never hidden.

   ⚠️ **NOTHING HERE IS ANOTHER PERSON'S.** The server sends only the caller's own
   marks (see demoMarks.listMarks), so there is no client-side filter to get
   wrong. The admin view over everyone's is a separate, later surface.
   ============================================================================= */

import { Link } from "react-router-dom";
import { useDemoLibrary, type DemoMark, type MarkStatus } from "../data/DemoLibraryContext";

const LABEL: Record<MarkStatus, string> = {
  demoed: "Demoed",
  "follow-up": "Follow-up",
  lead: "Lead",
};

/* Follow-up and Lead are the ones that OWE something, so they lead the page —
   "demoed and done" is a record, not a task. */
const ORDER: MarkStatus[] = ["lead", "follow-up", "demoed"];

const EVENT_LABEL: Record<string, string> = { "dallas-2026": "2026 Dallas Invoca Summit" };

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function FollowUps() {
  const { marks, loading, setMark } = useDemoLibrary();

  /* Group by event, preserving the server's newest-first order inside each. */
  const groups = new Map<string, DemoMark[]>();
  for (const m of marks) {
    const key = m.event ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const owing = marks.filter((m) => m.status !== "demoed").length;

  return (
    <div className="fup-page">
      <div className="fup-wrap">
        <Link className="fup-back" to="/launch">← Back to demos</Link>

        <h1 className="fup-title">My follow-ups</h1>
        <p className="fup-sub">
          {loading
            ? "Loading…"
            : marks.length === 0
              ? "Nothing marked yet. Use the flag on a demo in the library once you've delivered it."
              : `${marks.length} marked${owing ? ` · ${owing} still owe a follow-up` : ""}`}
        </p>

        {[...groups.entries()].map(([event, rows]) => (
          <section className="fup-group" key={event || "other"}>
            <h2 className="fup-group-head">
              {EVENT_LABEL[event] ?? (event ? event : "Other demos")}
              <span className="fup-group-n">{rows.length}</span>
            </h2>

            {[...rows]
              .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at.localeCompare(a.at))
              .map((m) => (
                <div className="fup-row" key={m.demoId}>
                  <span className={"fup-chip fup-" + m.status}>{LABEL[m.status]}</span>
                  <div className="fup-text">
                    <div className="fup-name">{m.prospect ?? m.demoId}</div>
                    {m.note && <div className="fup-note">{m.note}</div>}
                  </div>
                  <span className="fup-when">{when(m.at)}</span>
                  {/* Clearing it here matters as much as setting it: this page is
                      a worklist, and a task you cannot tick off stops being one. */}
                  <button
                    className="fup-done"
                    title={`Clear the mark on ${m.prospect ?? m.demoId}`}
                    onClick={() => void setMark(m.demoId, null)}
                  >
                    <span className="material-icons">check_circle_outline</span>
                  </button>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
