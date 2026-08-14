import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* =============================================================================
   FeedbackButton — the "Support" button, beside Read.Me on the launch form
   -----------------------------------------------------------------------------
   Opens a small form rather than routing away: someone with a thought about the
   tool has it WHILE they are using it, and making them leave the page to file it
   is how you get no feedback at all.

   Submitter identity is never asked for. It comes from the Google session on the
   server, so there is no name or email field to fill in, nothing to mistype, and
   the completion email has a real address to reach.
   ============================================================================= */

type Kind = "feedback" | "feature";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("feedback");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [attachWarning, setAttachWarning] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  /* An admin opening the board sees EVERYONE's, so "See what I've sent" is wrong
     for them. Same fetch that tells us about email tells us this. */
  const [admin, setAdmin] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  /* Ask the server whether a completion email can actually be sent, so the form
     never promises one that will not arrive. */
  useEffect(() => {
    if (!open) return;
    fetch("/api/feedback?summary=1").then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        if (typeof d.emailEnabled === "boolean") setEmailEnabled(d.emailEnabled);
        setAdmin(!!d.admin);
      })
      .catch(() => { /* leave the optimistic default */ });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => titleRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open]);

  function close() {
    setOpen(false); setError("");
    /* Reset only after a successful send. A failed submit keeps what they typed,
       because losing a paragraph of considered feedback to a network blip is the
       fastest way to never receive it again. */
    if (sent) { setTitle(""); setBody(""); setFiles([]); setSent(false); setKind("feedback"); }
  }

  async function submit() {
    if (busy) return;
    if (!title.trim()) { setError("A short title helps."); return; }
    if (!body.trim()) { setError("Tell me a bit more."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: title.trim(), body: body.trim(), page: location.pathname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not send that.");

      /* Files go up AFTER the item exists, one raw-bytes POST each. Deliberately
         not base64 in the JSON: it inflates by a third and a couple of screenshots
         would blow the body limit. A file that fails to attach does NOT fail the
         submission, because losing the written report to a flaky upload is the
         worse outcome; the failures are named instead. */
      const failed: string[] = [];
      for (const f of files) {
        try {
          const q = `name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || "application/octet-stream")}`;
          const up = await fetch(`/api/feedback/${data.item.id}/files?${q}`, { method: "POST", body: f });
          if (!up.ok) failed.push(f.name);
        } catch { failed.push(f.name); }
      }
      setAttachWarning(failed.length ? `Sent, but ${failed.join(", ")} did not attach.` : "");
      setSent(true);
      setTitle(""); setBody(""); setFiles([]);
    } catch (e: any) {
      setError(e?.message || "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="fb-fab" onClick={() => setOpen(true)}
        title="Get support, send feedback, or request a feature">
        <span className="material-icons">support_agent</span>
        Support
      </button>

      {open && (
        <div className="fb-overlay" onClick={close}>
          <div className="fb-modal" role="dialog" aria-modal="true" aria-label="Support"
            onClick={(e) => e.stopPropagation()}>
            <div className="fb-head">
              <span className="fb-title">{sent ? "Thanks, got it" : "Support"}</span>
              <button className="fb-x" onClick={close} aria-label="Close">
                <span className="material-icons">close</span>
              </button>
            </div>

            {sent ? (
              <div className="fb-done">
                <span className="material-icons fb-done-icon">check_circle</span>
                <p>
                  {emailEnabled
                    ? "You'll get an email from me when it's done."
                    : "I'll pick it up from the board."}
                </p>
                {attachWarning && <p className="fb-warn-line">{attachWarning}</p>}
                <div className="fb-done-actions">
                  <button className="fb-secondary" onClick={() => { setSent(false); }}>Send another</button>
                  <button className="fb-primary" onClick={() => { setOpen(false); setSent(false); navigate("/feedback"); }}>
                    {admin ? "See all submissions" : "See what I've sent"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="fb-kind" role="radiogroup" aria-label="What kind">
                  {([["feedback", "Feedback / Support", "Something is broken, confusing, or you need a hand"],
                     ["feature", "Feature request", "Something you wish it did"]] as const).map(([k, label, hint]) => (
                    <button key={k} role="radio" aria-checked={kind === k}
                      className={"fb-kind-btn" + (kind === k ? " fb-kind-on" : "")}
                      onClick={() => setKind(k as Kind)}>
                      <span className="fb-kind-label">{label}</span>
                      <span className="fb-kind-hint">{hint}</span>
                    </button>
                  ))}
                </div>

                <label className="fb-field">
                  <span>Title</span>
                  <input ref={titleRef} value={title} maxLength={140}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={kind === "feature" ? "e.g. Let me duplicate a demo into another vertical"
                                                    : "e.g. The Signal tab loads slowly on a big demo"} />
                </label>

                <label className="fb-field">
                  <span>Details</span>
                  <textarea rows={5} value={body} maxLength={4000}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={kind === "feature" ? "What would it do, and when would you use it?"
                                                    : "What happened, what did you expect, and where?"} />
                </label>

                {/* ATTACHMENTS. A screenshot is the most useful thing someone can
                    give you for "this looks wrong", so it is one click away. */}
                <div className="fb-files">
                  <button className="fb-attach" onClick={() => fileRef.current?.click()}>
                    <span className="material-icons">attach_file</span>
                    Attach a file or screenshot
                  </button>
                  <input
                    ref={fileRef} type="file" multiple hidden
                    accept="image/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      e.target.value = "";               // so the same file can be re-picked
                      const tooBig = picked.filter((f) => f.size > 10 * 1024 * 1024);
                      if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")}: over 10MB.`);
                      const ok = picked.filter((f) => f.size <= 10 * 1024 * 1024);
                      setFiles((prev) => [...prev, ...ok].slice(0, 5));
                    }}
                  />
                  {files.length > 0 && (
                    <ul className="fb-file-list">
                      {files.map((f, i) => (
                        <li key={i}>
                          {f.type.startsWith("image/")
                            ? <img src={URL.createObjectURL(f)} alt="" className="fb-thumb" />
                            : <span className="material-icons fb-file-icon">description</span>}
                          <span className="fb-file-name">{f.name}</span>
                          <span className="fb-file-size">{(f.size / 1024).toFixed(0)} KB</span>
                          <button className="fb-file-x" aria-label={`Remove ${f.name}`}
                            onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                            <span className="material-icons">close</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {files.length >= 5 && <p className="fb-file-cap">Up to 5 files.</p>}
                </div>

                {error && <p className="fb-error">{error}</p>}

                <div className="fb-actions">
                  <a className="fb-link" href="/feedback"
                    onClick={(e) => { e.preventDefault(); setOpen(false); navigate("/feedback"); }}>
                    {admin ? "See all submissions" : "See what I've sent"}
                  </a>
                  <span className="fb-actions-right">
                    <button className="fb-secondary" onClick={close}>Cancel</button>
                    <button className="fb-primary" onClick={submit} disabled={busy}>
                      {busy ? "Sending…" : "Send"}
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
