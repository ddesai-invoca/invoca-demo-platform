import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/* =============================================================================
   InboxButton — the admin's way into the feedback board
   -----------------------------------------------------------------------------
   Renders NOTHING unless the signed-in user is an admin, so it never clutters a
   normal SE's launch page. The badge is the point as much as the button: an open
   count sitting in the corner is a passive signal that something is waiting,
   which is the difference between a board you check and one you forget.

   Deliberately its own component and one line in LaunchCorner, because this
   placement is provisional. Folding it into the Support button as a split control
   (the other option on the table) means deleting that line and adding a chevron
   there; nothing else in the feature knows where this lives.

   It asks for `?summary=1`, not the full list: the launch page needs two numbers,
   and downloading everyone's submissions to render a badge would grow with the
   backlog for no reason.
   ============================================================================= */

interface Summary { admin: boolean; total: number; open: { feedback: number; feature: number } }

export function InboxButton() {
  const [sum, setSum] = useState<Summary | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    fetch("/api/feedback?summary=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.admin) setSum(d); })
      /* A failure here means no button, which is the right degradation: the board
         is still at /feedback and nothing else on the launch page is affected. */
      .catch(() => { /* stay hidden */ });
    return () => { alive = false; };
  }, []);

  if (!sum) return null;

  const open = sum.open.feedback + sum.open.feature;
  const title = open
    ? `${open} open (${sum.open.feedback} feedback, ${sum.open.feature} feature) of ${sum.total}`
    : `Nothing open, ${sum.total} in total`;

  return (
    <button className="inbox-fab" onClick={() => navigate("/feedback")} title={title}>
      <span className="material-icons">inbox</span>
      Inbox
      {/* Only when something is actually waiting. A permanent "0" is noise that
          trains you to stop reading the badge. */}
      {open > 0 && <span className="inbox-n">{open}</span>}
    </button>
  );
}
