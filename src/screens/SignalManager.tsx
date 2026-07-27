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

/* The hero illustrations are CSS sprites on the real page, not SVG — which is
   why they never turned up as <svg> or <img>. A later SingleFile capture inlined
   the sheet as a base64 PNG; these three are cropped straight out of it, so they
   are the actual artwork rather than a redraw:

     public/signal/card-bg.png      the shared pale streaks + sparkles
                                    (sprite x1412 y0, 256x236 @2x -> 128x118 css)
     public/signal/icon-upload.png  cloud + arrows   (x3974 y54, 128x128 -> 64x64)
     public/signal/icon-api.png     three cubes      (x3846 y58, 128x122 -> 64x61)

   The sheet is 4468x236 for a 118px-tall box, i.e. @2x, so every CSS
   background-position doubles to get the real pixel offset — that's what made
   the first crop attempt land on the wrong artwork.

   Composition mirrors the real rules: a 128x118 box carrying the streaks, with
   the 64px glyph centred on it (`margin: 27px auto`). */
function CardIcon({ glyph, size }: { glyph: string; size: { w: number; h: number } }) {
  return (
    <div className="sg-cardicon">
      <img src={glyph} alt="" width={size.w} height={size.h} />
    </div>
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

  /* The primary conversion always renders FIRST. It's the row the demo drills
     into, so it shouldn't be buried mid-list — a deliberate deviation from the
     real grid, which is purely name-sorted. Everything below it stays
     name-sorted like the real one.

     Sorting HERE rather than trusting the data order is what makes this a
     template for every prospect: a generated profile whose rows come back in
     some other order still leads with its conversion. */
  const rows = [...d.signals].sort((a, b) => {
    const rank = (r: typeof a) => (r.taggedAs === "Conversion" ? 0 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  return (
    <div className="sg-page">
      <h1 className="sg-title">{d.title}</h1>

      <div className="sg-heroes">
        <section className="sg-hero">
          <CardIcon glyph="/signal/icon-upload.png" size={{ w: 64, h: 64 }} />
          <div className="sg-hero-text">
            <h2>{d.uploadTitle}</h2>
            <p>{d.uploadBody}</p>
            <button className="sg-hero-link">UPLOAD</button>
          </div>
        </section>
        <section className="sg-hero">
          <CardIcon glyph="/signal/icon-api.png" size={{ w: 64, h: 61 }} />
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
            {rows.map((s) => (
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
