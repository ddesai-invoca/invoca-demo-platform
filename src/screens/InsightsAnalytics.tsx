import { useProfile } from "../data/ProfileContext";
import { useDemoLibrary } from "../data/DemoLibraryContext";
import { Link } from "react-router-dom";

/* Insights & Analytics — Invoca's newer landing list for saved dashboards, which
   sits ABOVE Dashboards in the nav (network 1847 /insights). Matched to the
   capture: title, search, blue "+ New", then a Name / Views / Author / Last
   Modified table with a rows-per-page pager.

   Deliberately reuses the .md-* styles from Manage Dashboards rather than
   inventing a parallel set: the two screens are the same table with different
   columns, and the real pair look the same too.

   Rows are the THREE Insights reports below — this screen is its own set of saved
   reports, not a second index of the platform dashboards (which is what it used to
   be, duplicating Manage Dashboards). The AUTHOR is the
   signed-in user (useDemoLibrary().me) rather than a hardcoded name — the real
   capture shows real Invoca employees, which would be wrong to bake into every
   prospect's demo. */

/* THE THREE Insights reports. This list previously mirrored the six platform
   dashboards, which duplicated the Manage Dashboards page — Insights & Analytics is
   its own set of saved reports, not a second index of the same things.

   Each name becomes the route (/insights/dashboard/<name>), so these are the only
   three reports this screen offers. Contents are defined per report; until each one
   has its own, they all open the same Insights-style dashboard. */
const REPORTS = [
  { name: "Summary Dashboard" },
  { name: "Details Report" },
  { name: "Connect AI" },
];

/* View counts are derived from the prospect id so they're stable per demo (an SE
   revisiting sees the same numbers) but differ between prospects. Deliberately not
   round, matching the platform-wide rule.

   ⚠️ The hash has to AVALANCHE. The first version was `h = h*31 + ch` mod a prime,
   and since the only difference between the seeds is the trailing index digit, the
   outputs came out CONSECUTIVE — AutoNation's three reports read 137, 138, 139, and
   four of five prospects did the same. Sequential view counts on a list of saved
   reports read as generated just as plainly as round numbers do. FNV-1a plus a
   final mixing step scatters adjacent indices. */
function views(seed: string, i: number): number {
  let h = 2166136261;
  for (const ch of `${seed}#${i}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  const v = 12 + (Math.abs(h) % 180);
  return v % 10 === 0 ? v + 3 : v;
}

export function InsightsAnalytics() {
  const { profile } = useProfile();
  const { me } = useDemoLibrary();
  const author = me?.name ?? "Demo User";

  /* Dates walk backwards from the most recently touched, so the list reads like
     something that has been used rather than all-created-at-once. */
  const dates = ["07/28/2026", "07/28/2026", "07/27/2026", "07/24/2026", "07/21/2026", "07/16/2026"];

  const rows = REPORTS.map((d, i) => ({
    ...d, views: views(profile.id, i), author, modified: dates[i] ?? "07/16/2026",
  }));

  return (
    <div className="md-page ia-page">
      <div className="md-head">
        <h1 className="md-title">Insights &amp; Analytics</h1>
        <button className="md-new"><span className="material-icons">add</span>New</button>
      </div>

      <div className="md-search">
        <span className="material-icons">search</span>
        <input type="text" aria-label="Search insights" />
      </div>

      <table className="md-table ia-table">
        <thead>
          <tr>
            <th className="md-col-name">Name</th>
            <th>Views</th>
            <th>Author</th>
            <th>Last Modified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              {/* Opens the Insights-style saved dashboard, which is what the real
                  list does, rather than jumping to the platform dashboard. */}
              <td className="md-col-name">
                <Link to={`/insights/dashboard/${encodeURIComponent(r.name)}`}>{r.name}</Link>
              </td>
              <td>{r.views}</td>
              <td>{r.author}</td>
              <td>{r.modified}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ia-pager">
        <span>Rows per page:</span>
        <span className="ia-rpp">50<span className="material-icons">arrow_drop_down</span></span>
        <span className="ia-count">1&ndash;{rows.length} of {rows.length}</span>
        <span className="material-icons ia-arrow ia-disabled">chevron_left</span>
        <span className="material-icons ia-arrow ia-disabled">chevron_right</span>
      </div>
    </div>
  );
}
