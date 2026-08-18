import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { buildCatalog, COLUMN_GROUPS } from "../data/insightsCatalog";
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

   THE COLUMN UNIVERSE IS BOTH CATALOGUES COMBINED. 371 is exactly 250 dimensions +
   121 measures, which is what let me stop guessing: the picker offers everything the
   drawers offer, grouped differently. Ours is 338 for the same reason the catalogues
   are 231/109 — that account's own custom signals are not imported.
   ============================================================================= */

const TITLES: Record<string, string> = {
  "details-report": "Details Report",
  "summary-report": "Summary Report",
  "transactions-report": "Transactions Report",
};

/* Which accordion a column belongs to. Keyword rules over the combined catalogue,
   ordered most-specific first — "Advertiser Campaign ID" must land in Advertiser
   Campaign Details, not Advertiser Details.

   HONEST LIMIT: the live capture gave the 20 group NAMES and the total column count,
   but not which column sits in which group. These rules are inferred, and they are
   right where it is checkable — Conversion Reporting Details lands 11 columns, Payout
   Details 5 and Signal Details 2, matching the live counts exactly. Everything else is
   a reasonable reading, so if the real membership is ever captured, correct it here
   rather than assuming this is authoritative. "Short Text Fields" and "Long Text
   Fields" are genuine catch-alls on the live page too, but a third of the catalogue
   landing there was a sign the rules were too coarse, not that the bucket is that big. */
function groupFor(col: string): string {
  const c = col.toLowerCase();
  if (/\(reported\)|sale amount/.test(c)) return "Conversion Reporting Details";
  if (/advertiser campaign/.test(c)) return "Advertiser Campaign Details";
  if (/advertiser/.test(c)) return "Advertiser Details";
  if (/publisher/.test(c)) return "Publisher Details";
  if (/^fees?$|earned|^paid$|payin|payout|call result/.test(c)) return "Payout Details";
  if (/adwords/.test(c)) return "Adwords Details";
  if (/^sms|sms /.test(c)) return "SMS Details";
  if (/ivr|keypress/.test(c)) return "IVR Details";
  if (/voice ai|ai agent|ai contained/.test(c)) return "Voice AI Details";
  if (/sentiment/.test(c)) return "Sentiment";
  if (/score|ranking/.test(c)) return "Scores";
  if (/talk time|monolog|overtalk|silence|hold time|dead air|handle time|ccm:/.test(c))
    return "Contact Center Metrics";
  if (/signal/.test(c)) return "Signal Details";
  if (/intent|outcome|inquiry type|call type|reason/.test(c)) return "Categories";
  if (/google|microsoft|piwik|adobe|sa360|external|gbraid|wbraid|click id/.test(c))
    return "External Call Details";
  if (/transcript|summary|journey/.test(c)) return "Long Text Fields";
  if (/invoca|record id|unique id/.test(c)) return "Invoca Data";
  if (/duration|direction|start time|destination|caller id|phone|recorded|hours/.test(c))
    return "Call Details";
  if (/\(t\/f\)$/.test(c)) return "Signals";
  /* Groupings a report is sliced by: marketing attribution, geography, org structure
     and booking status all read as categories rather than loose text. */
  if (/marketing |campaign|medium|^source$|search term|placement|media type/.test(c)) return "Categories";
  if (/division|line of business|territory|^area$|^region|specialty|product category|service type|practice area/.test(c))
    return "Categories";
  if (/scheduled|status|action|appointment|consultation|estimate|booking|tour|visit|drive/.test(c))
    return "Categories";
  if (/city|zip|postal|province|state|latitude|longitude|geo location|address/.test(c)) return "Call Details";
  if (/agent|evaluated by|reviewed by|handled by|^demo$|audience/.test(c)) return "Contact Center Metrics";
  if (/url|calling page|landing page|website|language/.test(c)) return "Call Details";
  if (/^member id|^interaction|ip address|network|lead score|rollout/.test(c)) return "Invoca Data";
  return "Short Text Fields";
}

export function InsightsColumnPicker() {
  const navigate = useNavigate();
  const { report } = useParams();
  const { profile, profileId } = useProfile();
  const { addTile } = useAiAssistant();
  const name = TITLES[report ?? ""] ?? "Details Report";
  const DASH = "/insights/dashboard/Summary%20Dashboard";

  const grouped = useMemo(() => {
    const cat = buildCatalog(profile);
    const all = [...new Set([...cat.dimensions, ...cat.measures])];
    const map = new Map<string, string[]>(COLUMN_GROUPS.map((g) => [g, []]));
    for (const col of all) (map.get(groupFor(col)) ?? map.get("Short Text Fields"))!.push(col);
    /* Empty accordions are not rendered: the live page only shows groups it has
       columns for, and an empty "Publisher Details" would read as a loading bug. */
    return [...map.entries()].filter(([, cols]) => cols.length > 0);
  }, [profile]);

  /* Call Record ID is the live page's default selection — it is what sits in the
     Reorder sidebar before you touch anything. */
  const [picked, setPicked] = useState<string[]>(["Call Record ID"]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set([COLUMN_GROUPS[0]]));

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
          <button className="icp-create" type="button" disabled={picked.length === 0}
            onClick={() => {
              addTile(`${profileId}::${DASH}`, {
                id: `t${Date.now()}`, tileType: "table", title: name,
                note: `${picked.length} column${picked.length === 1 ? "" : "s"}`,
                kpis: [], xLabels: [], series: [], slices: [],
                columns: picked, rows: reportRows(profile, picked),
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
