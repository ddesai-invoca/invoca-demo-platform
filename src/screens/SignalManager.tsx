import { useProfile } from "../data/ProfileContext";

/* Signal — the "Manage Signals" grid, matched to the real Invoca page
   (network 1847 /manage_signals). Two hero cards over a MUI DataGrid.

   The column widths below are the inline `style="width: …"` values read off the
   captured DOM, so the columns land where the real ones do:
     checkbox 50 · Name 200 · Status 100 · then five 123.833 columns ·
     Rules 197 · Created At 150 · Last Updated 150 · Actions 123.833
   Header row is 56px. Emotion's runtime CSS didn't serialise in the capture, so
   the colours come from our own tokens measured against the screenshot. */

const COLS: { key: string; label: string; width: number }[] = [
  { key: "check", label: "", width: 50 },
  { key: "name", label: "Name", width: 200 },
  { key: "status", label: "Status", width: 100 },
  { key: "types", label: "Type", width: 124 },
  { key: "usedIn", label: "Used In", width: 124 },
  { key: "description", label: "Description", width: 124 },
  { key: "taggedAs", label: "Tagged As", width: 124 },
  { key: "revenue", label: "Revenue", width: 124 },
  { key: "rules", label: "Rules", width: 197 },
  { key: "createdAt", label: "Created At", width: 150 },
  { key: "updatedAt", label: "Last Updated", width: 150 },
  { key: "actions", label: "Actions", width: 124 },
];

/* The hero illustrations are NOT in the capture — only three large SVGs exist
   across every bundle (300x189 / 300x204 / 320x220) and none is this pair, so
   they're fetched separately and "Webpage, Complete" missed them. These are
   redrawn from the screenshot: a cloud with an upload arrow, three isometric
   wireframe cubes, and the pale-blue diagonal streaks behind both that give the
   Invoca illustrations their look. Swap in the real SVGs if they turn up. */
function Streaks() {
  return (
    <g stroke="#b0cdff" strokeWidth="3" strokeLinecap="round">
      <path d="M6 30h16M2 42h9" />
      <path d="M98 74h16M110 62h9" />
    </g>
  );
}

function UploadArt() {
  return (
    <svg className="sg-art" viewBox="0 0 120 96" aria-hidden="true">
      <Streaks />
      {/* cloud */}
      <path d="M36 66a15 15 0 0 1 1.8-29.9A22 22 0 0 1 80 41.5 13 13 0 0 1 84 66Z"
        fill="#fff" stroke="#2666f9" strokeWidth="2.6" strokeLinejoin="round" />
      {/* upload arrow: head at the top, inside the cloud */}
      <path d="M60 79V50" fill="none" stroke="#2666f9" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M49.5 60.5 60 50l10.5 10.5" fill="none" stroke="#2666f9"
        strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M44 86h32" stroke="#2666f9" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function ApiArt() {
  /* One isometric wireframe cube at (cx, top): w = half-width, h = side height. */
  const cube = (cx: number, top: number, w: number, h: number) => (
    <g fill="#fff" stroke="#2666f9" strokeWidth="2.4" strokeLinejoin="round">
      <path d={`M${cx} ${top} ${cx + w} ${top + w / 2} ${cx + w} ${top + w / 2 + h} ${cx} ${top + w + h} ${cx - w} ${top + w / 2 + h} ${cx - w} ${top + w / 2}Z`} />
      <path d={`M${cx - w} ${top + w / 2} ${cx} ${top + w} ${cx + w} ${top + w / 2}`} fill="none" />
      <path d={`M${cx} ${top + w}v${h}`} fill="none" />
    </g>
  );
  return (
    <svg className="sg-art" viewBox="0 0 120 96" aria-hidden="true">
      <Streaks />
      {cube(40, 14, 15, 15)}
      {cube(80, 14, 15, 15)}
      {cube(60, 48, 15, 15)}
    </svg>
  );
}

export function SignalManager() {
  const { profile } = useProfile();
  const d = profile.reports.signalManager;

  if (!d) {
    return (
      <div className="sg-page">
        <h1 className="sg-title">Signal</h1>
        <p className="sg-empty">
          No Signal data for {profile.customerName}. Regenerate this prospect to include it.
        </p>
      </div>
    );
  }

  return (
    <div className="sg-page">
      <h1 className="sg-title">{d.title}</h1>

      <div className="sg-heroes">
        <section className="sg-hero">
          <UploadArt />
          <div className="sg-hero-text">
            <h2>{d.uploadTitle}</h2>
            <p>{d.uploadBody}</p>
            <button className="sg-hero-link">UPLOAD</button>
          </div>
        </section>
        <section className="sg-hero">
          <ApiArt />
          <div className="sg-hero-text">
            <h2>{d.apiTitle}</h2>
            <p>{d.apiBody}</p>
            <button className="sg-hero-link">VIEW</button>
          </div>
        </section>
      </div>

      <div className="sg-toolbar">
        <span className="sg-show">Show</span>
        <div className="sg-select">
          {d.filterLabel}
          <span className="material-icons">arrow_drop_down</span>
        </div>
        <div className="sg-search">
          <span className="material-icons">search</span>
          <input type="text" placeholder="" />
        </div>
        <div className="sg-toolbar-right">
          <button className="sg-new">
            <span className="material-icons">add</span>New Signal
          </button>
          <button className="sg-bulk" disabled>Bulk Actions</button>
        </div>
      </div>

      <p className="sg-selected">No rows selected.</p>

      <div className="sg-grid-wrap">
        <table className="sg-grid">
          <colgroup>
            {COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.key === "check" ? "sg-check" : undefined}>
                  {c.key === "check" ? <span className="sg-box" /> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.signals.map((s) => (
              <tr key={s.name}>
                <td className="sg-check"><span className="sg-box" /></td>
                <td><a className="sg-name" href="#" onClick={(e) => e.preventDefault()}>{s.name}</a></td>
                <td><span className="sg-chip">{s.status}</span></td>
                <td className="sg-wrap">{s.types}</td>
                <td>{s.usedIn}</td>
                <td className="sg-wrap">{s.description}</td>
                <td>{s.taggedAs && <span className="sg-tag">{s.taggedAs}</span>}</td>
                <td>{s.revenue}</td>
                <td className="sg-rules" title={s.rules}><span>{s.rules}</span></td>
                <td>{s.createdAt}</td>
                <td>{s.updatedAt}</td>
                <td className="sg-actions">
                  <span className="material-icons">more_vert</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sg-pager">
        <span>Rows per page:</span>
        <div className="sg-select sg-select-sm">
          {d.rowsPerPage}
          <span className="material-icons">arrow_drop_down</span>
        </div>
        <span className="sg-pager-count">{d.pagerLabel}</span>
        <span className="material-icons sg-pager-arrow sg-disabled">chevron_left</span>
        <span className="material-icons sg-pager-arrow sg-disabled">chevron_right</span>
      </div>
    </div>
  );
}
