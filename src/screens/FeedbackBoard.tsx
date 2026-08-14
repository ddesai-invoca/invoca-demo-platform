import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

/* =============================================================================
   FeedbackBoard — /feedback
   -----------------------------------------------------------------------------
   Two audiences, one screen, decided by the server:

     • A submitter sees THEIR items and where each one stands. That is the whole
       reason to show them anything: the alternative is feedback disappearing into
       a void, which teaches people to stop sending it.
     • An admin sees everything and can move an item along. Reaching "Complete"
       emails the person who asked.

   The filtering is the SERVER's (feedbackApi), never a client-side hide: another
   person's text must not be in the payload at all.
   ============================================================================= */

interface Item {
  id: string; kind: "feedback" | "feature"; title: string; body: string;
  page?: string; status: string; createdAt: string; updatedAt: string;
  submitter: { name: string; email: string };
  note?: string; notifiedAt?: string;
}

const TONE: Record<string, string> = {
  "New": "fbb-new", "In review": "fbb-review", "Planned": "fbb-planned",
  "In progress": "fbb-progress", "Complete": "fbb-done", "Declined": "fbb-declined",
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function FeedbackBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<string>("All");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback");
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not load.");
      setItems(d.items ?? []);
      setStatuses(d.statuses ?? []);
      setAdmin(!!d.admin);
      setEmailEnabled(!!d.emailEnabled);
    } catch (e: any) { setError(e?.message || "Could not load."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(item: Item, status: string) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not update.");
      setItems((prev) => prev.map((x) => (x.id === item.id ? d.item : x)));
      /* Say what actually happened with the email rather than assuming it went.
         An admin who thinks the person was told, when they were not, is worse off
         than one who knows the credential is missing. */
      if (d.mailed) {
        setToast(d.mailed.sent
          ? `Emailed ${item.submitter.name.split(/\s+/)[0]} that it's done.`
          : `Marked complete, but the email did not send (${d.mailed.reason}).`);
        setTimeout(() => setToast(""), 6000);
      }
    } catch (e: any) { setError(e?.message || "Could not update."); }
    finally { setBusyId(""); }
  }

  const shown = filter === "All" ? items : items.filter((i) => i.status === filter);
  const counts = statuses.map((s) => [s, items.filter((i) => i.status === s).length] as const);

  return (
    <div className="fbb-page">
      <div className="fbb-wrap">
        <div className="fbb-top">
          <div>
            <p className="fbb-eyebrow">{admin ? "All submissions" : "What you've sent"}</p>
            <h1 className="fbb-h1">Feedback &amp; feature requests</h1>
          </div>
          <Link className="fbb-back" to="/">Back to the launch page</Link>
        </div>

        {admin && !emailEnabled && (
          <div className="fbb-warn">
            <span className="material-icons">info</span>
            <span>
              Email is not configured, so marking something Complete will not notify anyone.
              Set <code>SMTP_USER</code> and <code>SMTP_APP_PASSWORD</code> to turn it on.
            </span>
          </div>
        )}

        {statuses.length > 0 && items.length > 0 && (
          <div className="fbb-filters">
            <button className={"fbb-chip" + (filter === "All" ? " fbb-chip-on" : "")}
              onClick={() => setFilter("All")}>All <b>{items.length}</b></button>
            {counts.filter(([, n]) => n > 0).map(([s, n]) => (
              <button key={s} className={"fbb-chip" + (filter === s ? " fbb-chip-on" : "")}
                onClick={() => setFilter(s)}>{s} <b>{n}</b></button>
            ))}
          </div>
        )}

        {error && <p className="fbb-error">{error}</p>}
        {loading && <p className="fbb-empty">Loading…</p>}

        {!loading && items.length === 0 && (
          <div className="fbb-empty-card">
            <span className="material-icons">campaign</span>
            <p className="fbb-empty-title">Nothing here yet</p>
            <p className="fbb-empty-sub">
              Use the Feedback button on the launch page to send something. You'll see it here,
              and {emailEnabled ? "you'll get an email once it's done." : "its status will update here."}
            </p>
          </div>
        )}

        <div className="fbb-list">
          {shown.map((i) => (
            <article key={i.id} className="fbb-card">
              <div className="fbb-card-top">
                <span className={"fbb-kind " + (i.kind === "feature" ? "fbb-kind-feat" : "fbb-kind-fb")}>
                  {i.kind === "feature" ? "Feature request" : "Feedback"}
                </span>
                <span className={"fbb-status " + (TONE[i.status] || "fbb-new")}>{i.status}</span>
                {i.notifiedAt && <span className="fbb-notified" title={`Submitter emailed ${when(i.notifiedAt)}`}>
                  <span className="material-icons">mark_email_read</span></span>}
              </div>

              <h2 className="fbb-card-title">{i.title}</h2>
              <p className="fbb-card-body">{i.body}</p>

              <div className="fbb-meta">
                {admin && <span className="fbb-who">{i.submitter.name}</span>}
                <span>{when(i.createdAt)}</span>
                {i.page && i.page !== "/" && <span className="fbb-page">from <code>{i.page}</code></span>}
              </div>

              {i.note && <p className="fbb-note"><b>Note:</b> {i.note}</p>}

              {admin && (
                <div className="fbb-admin">
                  <label>
                    Status
                    <select value={i.status} disabled={busyId === i.id}
                      onChange={(e) => void setStatus(i, e.target.value)}>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  {busyId === i.id && <span className="fbb-busy">saving…</span>}
                  {i.status === "Complete" && !i.notifiedAt && emailEnabled &&
                    <span className="fbb-hint">not emailed</span>}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {toast && <div className="fbb-toast" role="status">{toast}</div>}
    </div>
  );
}
