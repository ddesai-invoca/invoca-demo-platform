import { useEffect, useRef, useState } from "react";
import { useAutoGrow } from "../data/useAutoGrow";

/* =============================================================================
   AdvancedSettings — the collapsed panel under the launch form
   -----------------------------------------------------------------------------
   Asked for 9/10/2026: a custom prompt, an Agent-Studio-only toggle, document
   attachment (incl. a private Google Drive doc, once connected), and context
   pulled from Gong / Slack.

   ⚠️ "PULL CONTEXT FROM" IS WHERE GONG BELONGS, AND THAT IS A DELIBERATE CALL,
   NOT WHERE IT STARTED. Gong (and, briefly, Drive) moved OUT of this section
   while being built, on the mechanical argument that neither is a plain
   toggle. Corrected on request: the point of every field in this whole panel
   — custom prompt, strategy document, Gong, Slack — is the SAME thing, going
   deeper than wording. It is what decides WHICH dashboard actually matters to
   this prospect, whether the story is an SMS or a voice agent, which report
   and which signals (including Signal AI Gold) the demo leads with. Gong's
   row here is a REAL control (a "Look up Gong" button, since there is no doc
   to point at — see engine/gongApi.ts for why it has to SEARCH by title), not
   the inert checkbox Slack still is; it renders through `.adv-lookup`, the
   same shape Drive's Connect/Disconnect line uses. Drive is the one exception
   that still lives elsewhere: it only ever reads ONE doc the SE explicitly
   points at via the Strategy document field, so its control stays there,
   next to that field, rather than in this section (see `driveStatus`).

   ⚠️ COLLAPSED BY DEFAULT, AND THAT IS THE POINT OF IT BEING "ADVANCED". The
   launch form is two fields and a button, and the overwhelming majority of
   generations want exactly that. Everything here is opt-in; a closed panel has
   to leave the default path byte-identical to what it was.

   ⚠️ THE DOCUMENT'S TEXT IS EXTRACTED ON ATTACH, NOT AT GENERATE TIME, and the
   character count is shown back. An upload that silently yielded nothing would
   otherwise look like it had been read — the same class of failure as a
   disabled control with no explanation. If extraction fails, the SE finds out
   while they can still paste the text instead, rather than after paying for a
   generation.

   ⚠️ THE INTEGRATION ROW IS HONEST ABOUT NOT BEING CONFIGURED, rather than
   hidden or silently inert. It follows the pattern the feedback board already
   set — "Email is not configured, set SMTP_USER and SMTP_APP_PASSWORD to turn
   it on" — naming the exact missing credential. The connectors an assistant has
   in a chat session do NOT reach this server; it needs its own. See
   docs/INTEGRATIONS.md.
   ============================================================================= */

/** `origin` is UI bookkeeping only — it decides which field's chip list a
 *  source renders under (Strategy document vs. Pull context from → Gong) and
 *  is never read by the server; `parseGenerationRequest` only ever looks at
 *  `label`/`text`. */
export interface DocSource { label: string; text: string; origin?: "file" | "link" | "gong" }

export interface AdvancedValue {
  steer: string;
  agentOnly: boolean;
  docs: DocSource[];
}

export const EMPTY_ADVANCED: AdvancedValue = { steer: "", agentOnly: false, docs: [] };

/** Which SERVICE-CREDENTIAL integrations are usable. All false until the
 *  credentials exist; reported by /api/status so the panel never claims one is
 *  available when the server cannot call it. Gong gets a real "Look up Gong"
 *  button below once `gong` is true; Slack stays an inert placeholder — it is
 *  the one integration this repo has not built. Drive is PER-USER and lives
 *  next to the Strategy document field instead — see `driveStatus` below. */
interface Integrations { gong: boolean; slack: boolean }

const PROVIDERS: { key: keyof Integrations; label: string; needs: string; why: string }[] = [
  { key: "slack", label: "Slack", needs: "a workspace app with search scopes",
    why: "Pull deal-channel context for this prospect" },
];

interface DriveStatus { enabled: boolean; connected: boolean }

export function AdvancedSettings({ value, onChange, disabled, prospectName, prospectUrl }: {
  value: AdvancedValue;
  onChange: (v: AdvancedValue) => void;
  disabled?: boolean;
  /** The two launch-form fields, read live so "Look up Gong" always searches
   *  whatever the SE has typed right now rather than a stale copy. */
  prospectName: string;
  prospectUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyDoc, setBusyDoc] = useState(false);
  const [docError, setDocError] = useState("");
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [busyDrive, setBusyDrive] = useState(false);
  const [docLink, setDocLink] = useState("");
  const [busyLink, setBusyLink] = useState(false);
  const [busyGong, setBusyGong] = useState(false);
  const [gongError, setGongError] = useState("");
  /* ⚠️ null means "follow the prospect name", NOT empty. That distinction is
     what lets the box track the launch form until the SE edits it and then
     stay theirs — the alternative (a useEffect copying prospectName into
     state) would clobber what they were typing on every keystroke upstairs.
     It is editable at all because Gong's own account naming does not always
     match what an SE types: a search that finds nothing wants a second guess
     ("ORMC", a shorter form), not a dead end. */
  const [gongQuery, setGongQuery] = useState<string | null>(null);
  const gongTerm = gongQuery ?? prospectName;
  const steerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useAutoGrow(steerRef, value.steer);

  /* If we just landed back from /auth/drive, open the panel so the SE actually
     sees the row flip to "Connected" rather than having to remember to reopen
     it, and strip the marker so a refresh doesn't reopen it forever. */
  useEffect(() => {
    if (!/(^|[?&])drive=connected(&|$)/.test(window.location.search)) return;
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("drive");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }, []);

  const refreshDriveStatus = () => {
    fetch("/api/drive-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDriveStatus({ enabled: !!d?.enabled, connected: !!d?.connected }))
      .catch(() => setDriveStatus({ enabled: false, connected: false }));
  };

  /* Both fetches are deferred to when the panel is opened — the launch screen
     is the first thing everyone loads and it should not spend a request on a
     panel nobody expanded. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!integrations) {
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          const i = d?.integrations ?? {};
          setIntegrations({ gong: !!i.gongConfigured, slack: !!i.slackConfigured });
        })
        /* Unreachable status means "assume nothing is configured", which shows
           the setup note rather than a control that would fail on use. */
        .catch(() => { if (alive) setIntegrations({ gong: false, slack: false }); });
    }
    if (!driveStatus) refreshDriveStatus();
    return () => { alive = false; };
  }, [open, integrations, driveStatus]);

  async function disconnectDrive() {
    setBusyDrive(true);
    try {
      await fetch("/api/drive/disconnect", { method: "POST" });
    } finally {
      setBusyDrive(false);
      refreshDriveStatus();
    }
  }

  const set = (patch: Partial<AdvancedValue>) => onChange({ ...value, ...patch });

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    setDocError("");
    setBusyDoc(true);
    const added: DocSource[] = [];
    const failed: string[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        const res = await fetch(`/api/generate/doc?name=${encodeURIComponent(f.name)}`, {
          method: "POST", body: f,
        });
        const d = await res.json();
        if (!res.ok) { failed.push(d?.error || `${f.name} could not be read.`); continue; }
        added.push({ label: d.label, text: d.text, origin: "file" });
      } catch {
        failed.push(`${f.name} could not be uploaded.`);
      }
    }
    setBusyDoc(false);
    setDocError(failed.join(" "));
    if (added.length) set({ docs: [...value.docs, ...added].slice(0, 4) });
  }

  async function attachLink() {
    const url = docLink.trim();
    if (!url) return;
    setDocError("");
    setBusyLink(true);
    try {
      const res = await fetch("/api/generate/doc-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await res.json();
      if (!res.ok) { setDocError(d?.error || "Could not read that link."); return; }
      set({ docs: [...value.docs, { label: d.label, text: d.text, origin: "link" as const }].slice(0, 4) });
      setDocLink("");
    } catch {
      setDocError("Could not reach that link.");
    } finally {
      setBusyLink(false);
    }
  }

  async function lookupGong() {
    const name = gongTerm.trim();
    if (!name) return;
    /* The URL is OPTIONAL here, deliberately: it is only used to cross-check a
       match against the CRM account's own website, and `gongLookup` already
       skips that check when there is no domain to compare. Requiring it made
       the button a dead end on a panel where neither field may be filled yet. */
    const url = prospectUrl.trim();
    setGongError("");
    setBusyGong(true);
    try {
      const res = await fetch("/api/gong-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      const d = await res.json();
      if (!res.ok) { setGongError(d?.error || "Could not search Gong."); return; }
      set({ docs: [...value.docs.filter((s) => s.origin !== "gong"), { label: d.label, text: d.text, origin: "gong" as const }].slice(0, 4) });
    } catch {
      setGongError("Could not reach Gong.");
    } finally {
      setBusyGong(false);
    }
  }

  const anyOn = !!(value.steer.trim() || value.agentOnly || value.docs.length);

  return (
    <div className="adv">
      <button type="button" className={"adv-toggle" + (open ? " adv-toggle-on" : "")}
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="material-icons adv-caret">{open ? "expand_more" : "chevron_right"}</span>
        Advanced settings
        {/* So a collapsed panel cannot hide the fact that it will change the
            generation — the trap of an options panel you forgot you touched. */}
        {!open && anyOn && <span className="adv-on-dot" title="Advanced settings are in use" />}
      </button>

      {open && (
        <div className="adv-body">
          <label className="adv-field">
            <span className="adv-label">Custom prompt</span>
            <span className="adv-hint">
              Steers wording and what the demo emphasises. Structure stays the same.
            </span>
            <textarea
              ref={steerRef} rows={1} disabled={disabled}
              value={value.steer}
              onChange={(e) => set({ steer: e.target.value })}
              placeholder="e.g. Use healthcare language instead of sales. Lead with the SMS agent."
            />
          </label>

          <label className="adv-check">
            <input type="checkbox" checked={value.agentOnly} disabled={disabled}
              onChange={(e) => set({ agentOnly: e.target.checked })} />
            <span>
              <span className="adv-label">Generate Agent Studio Only</span>
            </span>
          </label>

          <div className="adv-field">
            <span className="adv-label">Strategy document</span>
            <span className="adv-hint">
              Read to decide which signals, which agent channel and which dashboards to lead with.
              .docx, .txt, .md, .csv, or a Google Doc link.
            </span>
            <div className="adv-doclink">
              <input
                type="url" disabled={disabled || busyLink}
                value={docLink}
                onChange={(e) => setDocLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); attachLink(); } }}
                placeholder="Paste a Google Doc / Drive link"
              />
              <button type="button" className="adv-attach" disabled={disabled || busyLink || !docLink.trim()}
                onClick={attachLink}>
                <span className="material-icons">link</span>
                {busyLink ? "Reading…" : "Add link"}
              </button>
            </div>
            {/* Public link ("Anyone with the link") always works with no setup. Connecting
                Drive additionally reaches a PRIVATE, internal doc — this is the one place
                that control lives, since it's the field it actually affects. */}
            {driveStatus?.enabled && (
              <div className="adv-lookup">
                {driveStatus.connected ? (
                  <>
                    <span className="material-icons adv-lookup-ic">check_circle</span>
                    <span className="adv-hint">Connected — can also read a private, internal doc.</span>
                    <button type="button" className="adv-prov-btn" disabled={disabled || busyDrive}
                      onClick={disconnectDrive}>
                      {busyDrive ? "…" : "Disconnect"}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="adv-hint">Only a doc shared "Anyone with the link" works right now.</span>
                    <a className="adv-prov-btn adv-prov-btn--primary" href="/auth/drive">
                      Connect Google Drive to read private docs
                    </a>
                  </>
                )}
              </div>
            )}
            <div className="adv-docs">
              <button type="button" className="adv-attach" disabled={disabled || busyDoc}
                onClick={() => fileRef.current?.click()}>
                <span className="material-icons">attach_file</span>
                {busyDoc ? "Reading…" : "Attach a document"}
              </button>
              <input ref={fileRef} type="file" hidden multiple
                accept=".docx,.txt,.md,.markdown,.csv,.tsv,.json"
                onChange={(e) => { const f = e.target.files; e.target.value = ""; attach(f); }} />
              {value.docs.filter((d) => d.origin !== "gong").map((d, i) => (
                <span className="adv-doc" key={i}>
                  <span className="material-icons adv-doc-ic">description</span>
                  <span className="adv-doc-name">{d.label}</span>
                  {/* The count is the proof it was actually read. */}
                  <span className="adv-doc-n">{d.text.length.toLocaleString()} chars</span>
                  <button type="button" className="adv-doc-x" aria-label={`Remove ${d.label}`}
                    onClick={() => set({ docs: value.docs.filter((s) => s !== d) })}>
                    <span className="material-icons">close</span>
                  </button>
                </span>
              ))}
            </div>
            {docError && <span className="adv-err">{docError}</span>}
          </div>

          <div className="adv-field">
            <span className="adv-label">Pull context from</span>
            <span className="adv-hint">
              Decides which dashboard, which report, which signals — including Signal AI Gold —
              and whether the story is an SMS or a voice agent, from what this prospect has
              actually discussed with Invoca.
            </span>
            <div className="adv-provs">
              {/* Gong: a real control (there's no doc to point at, so it SEARCHES —
                  see engine/gongApi.ts) — not the inert checkbox Slack below still is.
                  It carries its OWN search box: Gong's account naming does not always
                  match what an SE typed upstairs, and a button with nothing to type
                  into is a dead end when neither launch field is filled yet. */}
              <div className="adv-lookup">
                <span className="material-icons adv-lookup-ic">
                  {value.docs.some((d) => d.origin === "gong") ? "check_circle" : "search"}
                </span>
                <input
                  className="adv-lookup-input" type="text"
                  disabled={disabled || busyGong || !integrations?.gong}
                  value={gongTerm}
                  onChange={(e) => setGongQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupGong(); } }}
                  placeholder="Company name as Gong titles it"
                />
                <button type="button" className="adv-prov-btn"
                  disabled={disabled || busyGong || !integrations?.gong || !gongTerm.trim()}
                  onClick={lookupGong}>
                  {busyGong ? "Searching…" : "Look up Gong"}
                </button>
              </div>
              <span className="adv-hint">
                {!integrations
                  ? "Checking…"
                  : !integrations.gong
                  ? "Not connected — needs GONG_ACCESS_KEY and GONG_SECRET."
                  : gongTerm.trim()
                  ? "Searches recent call titles for this name, then reads what was actually discussed."
                  : "Type the prospect's name (or fill it in above) to search Gong for their calls."}
              </span>
              {value.docs.filter((d) => d.origin === "gong").map((d, i) => (
                <span className="adv-doc" key={i}>
                  <span className="material-icons adv-doc-ic">description</span>
                  <span className="adv-doc-name">{d.label}</span>
                  <span className="adv-doc-n">{d.text.length.toLocaleString()} chars</span>
                  <button type="button" className="adv-doc-x" aria-label={`Remove ${d.label}`}
                    onClick={() => set({ docs: value.docs.filter((s) => s !== d) })}>
                    <span className="material-icons">close</span>
                  </button>
                </span>
              ))}
              {/* A cold prospect with no recorded Gong calls is expected, not an error —
                  docs/INTEGRATIONS.md says so plainly, and this says so too. */}
              {gongError && <span className="adv-err">{gongError}</span>}

              {PROVIDERS.map((p) => {
                const on = !!integrations?.[p.key];
                return (
                  <div className={"adv-prov" + (on ? "" : " adv-prov--off")} key={p.key}>
                    <input type="checkbox" disabled checked={false} id={`prov-${p.key}`} />
                    <label htmlFor={`prov-${p.key}`}>
                      <span className="adv-prov-name">{p.label}</span>
                      <span className="adv-hint">{on ? p.why : `Not connected — needs ${p.needs}.`}</span>
                    </label>
                  </div>
                );
              })}
            </div>
            {integrations && !integrations.slack && (
              <span className="adv-note">
                <span className="material-icons">info</span>
                <span>
                  Slack isn't connected yet, so it's read-only for now — it needs a workspace app
                  with search scopes on the server, see <code>docs/INTEGRATIONS.md</code>. Until
                  then, paste the relevant notes into the custom prompt above; it reaches the
                  generation the same way.
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
