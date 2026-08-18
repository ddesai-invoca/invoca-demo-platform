import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { columnGroupsFor, sidebarFor, type ReportKind } from "../data/insightsColumns";
import { reportRows } from "../data/insightsTileData";

/* =============================================================================
   InsightsColumnPicker — what the three Report templates open.
   -----------------------------------------------------------------------------
   NOT the Configuration drawer. Captured on the live account (8/18/2026): clicking
   Details Report navigates to a FULL PAGE at
   /networks/2160/insights/dashboard/<id>/new_tile/details-report, titled
   "New Tile - Details Report", with:

     "Choose Your Columns"        section heading
     a "Search columns" box
     "Select All Columns" / "Deselect All Columns"
     20 accordion groups, each with its own Select All / Deselect All and a
       three-column grid of checkboxes — 371 columns in total
     a "Reorder columns" sidebar on the right, seeded with Call Record ID
     Back | Cancel | Create

   THE THREE REPORTS ARE NOT THE SAME SCREEN, which the first build got wrong by
   giving all three one universe and one sidebar. Measured off saved captures of all
   three live builders:

     Details       20 groups, sidebar Reorder columns, seeded with Call Record ID
     Summary       11 groups of MEASURES ONLY, and it adds a GROUP BY control,
                   because a summary has to aggregate by something
     Transactions  21 groups (Details + RingPool Details), seeded with
                   Call Record ID AND Transaction ID

   Group membership now comes from insightsColumns, extracted from those captures
   rather than inferred from column names. The old keyword rules put Agent under
   Contact Center Metrics and a third of the catalogue into "Short Text Fields";
   both are wrong on the real page.

   Our column totals run below that account's (233 vs 371) almost entirely in the
   Signals group: it has 75 configured signals paired with (T/F) twins, and a prospect
   has however many its own profile generated. That gap is the feature.
   ============================================================================= */

const TITLES: Record<string, string> = {
  "details-report": "Details Report",
  "summary-report": "Summary Report",
  "transactions-report": "Transactions Report",
};

export function InsightsColumnPicker() {
  const navigate = useNavigate();
  const { report } = useParams();
  const { profile, profileId } = useProfile();
  const { addTile } = useAiAssistant();
  const name = TITLES[report ?? ""] ?? "Details Report";
  const DASH = "/insights/dashboard/Summary%20Dashboard";

  const kind = (report ?? "details-report") as ReportKind;
  const side = sidebarFor(kind);

  const grouped = useMemo(
    () => columnGroupsFor(profile, kind).map((g) => [g.name, g.columns] as const),
    [profile, kind],
  );

  /* Seeded from the live page: Details starts with Call Record ID, Transactions with
     Call Record ID and Transaction ID, Summary with nothing selected. */
  const [picked, setPicked] = useState<string[]>(side.seeded);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set([grouped[0]?.[0] ?? ""]));
  /* Summary Report only: what the aggregate is broken out by. Dimensions come from
     the Categories group, which is what the live Group By offers. */
  const groupByOptions = useMemo(
    () => columnGroupsFor(profile, "details-report")
      .find((g) => g.name === "Categories")?.columns ?? [],
    [profile],
  );
  const [groupBy, setGroupBy] = useState("");

  /* ⚠️ The three reports share one route pattern, so React Router reuses this component
     when only :report changes and `useState(side.seeded)` never re-runs. Without this,
     opening Transactions after Details showed Details' single seeded column and Summary
     showed one it should not have at all. Reset everything the report owns when it
     changes; the seed is per report, not per mount. */
  useEffect(() => {
    setPicked(sidebarFor(kind).seeded);
    setGroupBy("");
    setQuery("");
  }, [kind]);

  const q = query.trim().toLowerCase();
  const visible = (cols: string[]) => (q ? cols.filter((c) => c.toLowerCase().includes(q)) : cols);
  const has = (c: string) => picked.includes(c);
  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const setMany = (cols: string[], on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, ...cols])] : p.filter((x) => !cols.includes(x))));

  const allCols = grouped.flatMap(([, c]) => c);

  return (
    <div className="icp-page">
      <h1 className="icp-h1">New Tile - {name}</h1>

      <div className="icp-body">
        <section className="icp-main">
          <p className="icp-section">Choose Your Columns</p>

          <div className="icp-search">
            <span className="material-icons">search</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search columns" />
          </div>

          <div className="icp-bulk">
            <button type="button" onClick={() => setMany(allCols, true)}>Select All Columns</button>
            <button type="button" onClick={() => setMany(allCols, false)}>Deselect All Columns</button>
          </div>

          {grouped.map(([group, cols]) => {
            const shown = visible(cols);
            /* While searching, groups with no match collapse away entirely rather than
               leaving a row of empty accordions to scroll past. */
            if (q && shown.length === 0) return null;
            const isOpen = q ? true : open.has(group);
            return (
              <div className="icp-group" key={group}>
                <button className="icp-group-head" type="button"
                  onClick={() => setOpen((p) => {
                    const n = new Set(p); n.has(group) ? n.delete(group) : n.add(group); return n;
                  })}>
                  <span>{group}</span>
                  <span className="material-icons">{isOpen ? "expand_less" : "expand_more"}</span>
                </button>
                {isOpen && (
                  <>
                    <div className="icp-bulk icp-bulk--group">
                      <button type="button" onClick={() => setMany(shown, true)}>Select All</button>
                      <button type="button" onClick={() => setMany(shown, false)}>Deselect All</button>
                    </div>
                    <div className="icp-cols">
                      {shown.map((c) => (
                        <label className="icp-col" key={c}>
                          <input type="checkbox" checked={has(c)} onChange={() => toggle(c)} />
                          <span>{c}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>

        <aside className="icp-side">
          {/* Group By is a Summary-only control. A details row is already one call, so
              there is nothing to group; a summary has to aggregate by something. */}
          {side.groupBy && (
            <div className="icp-groupby">
              <p className="icp-side-title">Group By</p>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">Select a dimension</option>
                {groupByOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          <p className="icp-side-title">Reorder columns</p>
          {/* Order follows selection order, and each row can be nudged. Real drag and
              drop is not worth the risk on a demo screen: a dropped drag mid-pitch
              looks broken, while arrows always work. */}
          <ul className="icp-order">
            {picked.map((c, i) => (
              <li key={c}>
                <span className="material-icons icp-grip">drag_indicator</span>
                <span className="icp-order-name">{c}</span>
                <button className="icp-nudge" type="button" disabled={i === 0}
                  aria-label={`Move ${c} up`}
                  onClick={() => setPicked((p) => {
                    const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
                  })}>
                  <span className="material-icons">arrow_upward</span>
                </button>
              </li>
            ))}
            {picked.length === 0 && <li className="icp-order-empty">No columns chosen yet.</li>}
          </ul>
        </aside>
      </div>

      <div className="icp-foot">
        <button className="icp-back" type="button" onClick={() => navigate("/insights/add-tile")}>Back</button>
        <span className="icp-foot-right">
          <button className="icp-cancel" type="button" onClick={() => navigate(DASH)}>Cancel</button>
          <button className="icp-create" type="button"
            disabled={picked.length === 0 || (side.groupBy && !groupBy)}
            onClick={() => {
              /* A grouped summary leads with the thing it is grouped by, as the live
                 report does, so the aggregate reads left to right. */
              const cols = side.groupBy && groupBy ? [groupBy, ...picked.filter((c) => c !== groupBy)] : picked;
              addTile(`${profileId}::${DASH}`, {
                id: `t${Date.now()}`, tileType: "table", title: name,
                note: side.groupBy && groupBy
                  ? `by ${groupBy}, ${cols.length} column${cols.length === 1 ? "" : "s"}`
                  : `${cols.length} column${cols.length === 1 ? "" : "s"}`,
                kpis: [], xLabels: [], series: [], slices: [],
                columns: cols, rows: reportRows(profile, cols),
              });
              navigate(DASH);
            }}>
            Create
          </button>
        </span>
      </div>
    </div>
  );
}
