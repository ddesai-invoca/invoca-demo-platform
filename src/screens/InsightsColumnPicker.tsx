import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { columnGroupsFor, sidebarFor, type ReportKind } from "../data/insightsColumns";
import { reportCaption, reportFooter, reportHeaders, reportRows, summaryRows } from "../data/insightsTileData";

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

   Our column totals run below that account's (240 vs 371) almost entirely in the
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
  /* ⚠️ EVERY GROUP OPEN BY DEFAULT. Measured on a capture of the live builder: all 20 column
     groups carry `aria-expanded="true"` and all 372 checkboxes are laid out at once. Ours
     opened only the first, so finding a column meant clicking through twenty accordions.
     They stay collapsible — this is the default state, not a removal of the control. */
  const allGroupNames = useMemo(() => grouped.map(([n]) => n), [grouped]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(allGroupNames));
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
    /* The open set is per report too — a group only one report has would otherwise stay
       collapsed after switching (Transactions adds RingPool Details to Details' twenty). */
    setOpen(new Set(allGroupNames));
  }, [kind, allGroupNames]);

  const q = query.trim().toLowerCase();
  const visible = (cols: string[]) => (q ? cols.filter((c) => c.toLowerCase().includes(q)) : cols);
  const has = (c: string) => picked.includes(c);
  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const setMany = (cols: string[], on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, ...cols])] : p.filter((x) => !cols.includes(x))));

  /* ---- drag to reorder ----------------------------------------------------
     ⚠️ THE REAL LIST IS DRAGGABLE, and ours only had an up-arrow nudge. Measured on the
     builder capture: every row is `role="button" tabindex="0"` with
     `aria-roledescription="sortable"`, `cursor: grab`, a 24px `drag_indicator` handle and an
     inline `transition: transform linear` — i.e. a dnd-kit sortable list.

     Implemented with POINTER EVENTS rather than a drag-and-drop library: the app ships as one
     bundle with no code splitting, so a dependency here lands on every screen (see the Leaflet
     note in CLAUDE.md), and this is ~20 lines. `setPointerCapture` means the drag survives the
     pointer leaving the row, which a naive mousemove listener does not.
     Reordering happens LIVE on move, as the real list's transform transition implies, rather
     than on drop. */
  const listRef = useRef<HTMLUListElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => setPicked((p) => {
    if (to < 0 || to >= p.length || from === to) return p;
    const n = [...p]; const [row] = n.splice(from, 1); n.splice(to, 0, row); return n;
  });

  /* Which row is the pointer over? Compared against each row's own midpoint, so a short drag
     into the top half of the next row already commits — the behaviour a sortable list needs to
     feel responsive. */
  const rowUnder = useCallback((clientY: number): number => {
    const ul = listRef.current;
    if (!ul) return -1;
    const items = Array.from(ul.children) as HTMLElement[];
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length - 1;
  }, []);

  const onDragStart = (i: number) => (e: React.PointerEvent<HTMLLIElement>) => {
    /* Left button / primary touch only, and never start a drag from the label text selection. */
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(i);
  };
  const onDragMove = (e: React.PointerEvent<HTMLLIElement>) => {
    if (dragIndex === null) return;
    const to = rowUnder(e.clientY);
    if (to >= 0 && to !== dragIndex) { move(dragIndex, to); setDragIndex(to); }
  };
  const onDragEnd = () => setDragIndex(null);

  /* Keyboard equivalent, because the real row is focusable and a drag is mouse-only. */
  const onRowKey = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (to < 0 || to >= picked.length) return;
    move(i, to);
    /* Keep focus on the row that moved, so repeated presses keep walking it. */
    requestAnimationFrame(() => {
      const el = listRef.current?.children[to] as HTMLElement | undefined;
      el?.focus();
    });
  };

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
                      <button type="button" onClick={() => setMany(shown, true)}>Select all</button>
                      <button type="button" onClick={() => setMany(shown, false)}>Deselect all</button>
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
          {/* Group By is a Summary-only control: a details row is already one call, so there
              is nothing to group.
              ⚠️ AND IT IS OPTIONAL. Create used to be disabled until a dimension was chosen,
              on the reasoning that "a summary has to aggregate by something". The Summary
              Report capture is a summary of NOTHING — seven measure columns, no dimension, a
              single row of totals — so an ungrouped summary is the product's own default and
              was unreachable here. The option now reads "None". */}
          {side.groupBy && (
            <div className="icp-groupby">
              <p className="icp-side-title">Group By</p>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">None</option>
                {groupByOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          <p className="icp-side-title">Reorder columns</p>
          {/* Order follows selection order, and each row can be nudged. Real drag and
              drop is not worth the risk on a demo screen: a dropped drag mid-pitch
              looks broken, while arrows always work. */}
          {/* The scroll box is the real one's: 320 wide, `overflow-y: auto`, so twenty chosen
              columns scroll here instead of stretching the page. */}
          <ul className="icp-order" ref={listRef}>
            {picked.map((c, i) => (
              <li key={c}
                role="button" tabIndex={0} aria-roledescription="sortable"
                aria-label={`${c}, position ${i + 1} of ${picked.length}. Drag, or use the arrow keys, to reorder.`}
                className={dragIndex === i ? "icp-order-row is-dragging" : "icp-order-row"}
                onPointerDown={onDragStart(i)}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onKeyDown={onRowKey(i)}>
                <span className="material-icons icp-grip">drag_indicator</span>
                <span className="icp-order-name">{c}</span>
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
            disabled={picked.length === 0}
            onClick={() => {
              /* A grouped summary leads with the thing it is grouped by, as the live
                 report does, so the aggregate reads left to right. */
              const cols = side.groupBy && groupBy ? [groupBy, ...picked.filter((c) => c !== groupBy)] : picked;
              /* ⚠️ A SUMMARY IS NOT A SLICE OF ROWS, IT IS THE AGGREGATE. Measured: seven
                 measure columns, ONE body row holding each measure's total, and the pinned
                 row repeating those same numbers under TOTAL. So it cannot go through
                 `reportRows`, which mints one row per call. */
              const rows = kind === "summary-report"
                ? summaryRows(profile, cols, groupBy || undefined)
                /* ⚠️ A TRANSACTION ROW IS NOT A CALL ROW. Rows are ordered by Transaction ID
                   and only one transaction per call carries the call leg, so the Total Call
                   Count column reads 0 or 1 rather than always 1. */
                : reportRows(profile, cols, { transactions: kind === "transactions-report" });
              addTile(`${profileId}::${DASH}`, {
                id: `t${Date.now()}`, tileType: "table", title: name,
                /* ⚠️ NO NOTE. The captured tile's header carries the title and nothing
                   else — `descriptionPresent` is false — where this printed
                   "12 columns" under it, which is our invention rather than the
                   product's. The column count is visible in the grid. */
                note: "",
                kpis: [], xLabels: [], series: [], slices: [],
                /* Headers are the AGGREGATED form of a measure ("Total Call Count"), which
                   is what the capture prints; rows and the footer are computed from the
                   picked names, since those are what the catalogue and `kindOf` know. */
                columns: reportHeaders(profile, cols), rows,
                /* The pinned aggregation row and the row caption are what make this read
                   as the real Report tile rather than a bare grid; both are measured. */
                reportFooter: reportFooter(profile, cols, rows),
                /* A summary shows every row it has, so the caption states the total and its
                   noun agrees: "Showing 1 of 1 row". A details grid shows a slice. */
                caption: kind === "summary-report"
                  ? reportCaption(rows.length, rows.length)
                  : reportCaption(rows.length),
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
