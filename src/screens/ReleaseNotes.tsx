import { useEffect } from "react";
import { Link } from "react-router-dom";
import { RELEASES, markReleasesSeen, type ChangeKind } from "../data/releaseNotes";

/* =============================================================================
   ReleaseNotes — /release-notes
   -----------------------------------------------------------------------------
   What has shipped, newest first, written for the people demoing with the tool
   rather than for whoever maintains it. Content and its provenance live in
   src/data/releaseNotes.ts; this file only renders it.

   Full-page and OUTSIDE the app shell, the same call FeedbackBoard makes: this
   is about the TOOL, not about a prospect's demo, so wrapping it in the Invoca
   replica chrome would misrepresent what you are looking at.
   ============================================================================= */

const KIND_LABEL: Record<ChangeKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

function when(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ReleaseNotes() {
  /* Opening the page IS reading it, so the menu's "New" chip clears here rather
     than needing a dismiss control of its own. */
  useEffect(() => { markReleasesSeen(); }, []);

  const counts = RELEASES.reduce(
    (acc, r) => { for (const c of r.changes) acc[c.kind]++; return acc; },
    { new: 0, improved: 0, fixed: 0 } as Record<ChangeKind, number>,
  );

  return (
    <div className="rn-page">
      <div className="rn-wrap">
        <div className="rn-top">
          <div>
            <p className="rn-eyebrow">Release notes</p>
            <h1 className="rn-h1">What&rsquo;s new</h1>
            <p className="rn-sub">
              {/* Stated rather than implied: the tool has no version numbers because
                  a push to main is the release, and an SE asking "am I on the latest?"
                  deserves a straight answer instead of a number that means nothing. */}
              Every change reaches the live site as it ships, so there are no versions to
              be on &mdash; the top entry is what you are using. {counts.new} additions,
              {" "}{counts.improved} improvements and {counts.fixed} fixes since{" "}
              {when(RELEASES[RELEASES.length - 1].date)}.
            </p>
          </div>
          <Link className="rn-back" to="/launch">&larr; Back to demos</Link>
        </div>

        <ol className="rn-list">
          {RELEASES.map((r) => (
            <li className="rn-rel" key={r.date}>
              <div className="rn-rel-head">
                <time className="rn-date" dateTime={r.date}>{when(r.date)}</time>
                <h2 className="rn-title">{r.title}</h2>
              </div>
              <ul className="rn-changes">
                {r.changes.map((c, k) => (
                  <li className="rn-change" key={k}>
                    <span className={`rn-kind rn-kind--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                    <span className="rn-text">{c.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {/* ⚠️ THE BACKFILL'S PROVENANCE IS ON SCREEN, not just in a code comment.
            Everything below the last few weeks was reconstructed from git history
            after the fact, and an SE reading a tidy list of 26 dated releases would
            otherwise reasonably assume it was written as the work happened. */}
        <p className="rn-foot">
          Entries before September were reconstructed from the project&rsquo;s commit history,
          so the earliest weeks are summarised at the feature level rather than change by change.
        </p>
      </div>
    </div>
  );
}
