import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useVoiceCapture } from "../data/VoiceCaptureContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { salesforceLeads } from "../data/salesforceLeads";

/* =============================================================================
   Leads -> Lead Intelligence View — screen 3 of 4
   -----------------------------------------------------------------------------
   Built off `reference/salesforce/leads-v1.html`, measured at 1920 the same way as
   Seller Home: dump a property set off the capture's rendered DOM, dump the same
   off ours, fix until the diff is empty.

   ⚠️ THE TABLE IS WIDER THAN THE CARD AND THAT IS THE DESIGN. The capture's table
   is 2951px across a 1854px container, so the last four columns — Invoca
   Attribution ID, Created Date, Lead Source, Actions — live behind a horizontal
   scroll. **Invoca Attribution ID is the reason this screen is in the demo**, so
   the column order is the capture's and the SE scrolls to it, rather than being
   promoted forward into a layout the real page does not have.

   ⚠️ THE ROW DATA IS THE PROSPECT'S OWN PEOPLE, not the capture's 13 rows — see
   the header comment in `src/data/salesforceLeads.ts` for why, and for why the
   item count and the KPI tiles are computed from those rows instead of typed.
   ============================================================================= */

/** The header's button group: 1px #5C5C5C, ink #0250D9, 600, ends rounded to 240. */
function GroupBtn({ children, first, last, icon }:
  { children?: React.ReactNode; first?: boolean; last?: boolean; icon?: string }) {
  return (
    <span className={"sfl-gbtn" + (first ? " sfl-gbtn--first" : "") + (last ? " sfl-gbtn--last" : "")
      + (icon ? " sfl-gbtn--icon" : "")}>
      {icon ? <SldsIcon name={icon} size={14} /> : children}
    </span>
  );
}

/** A filter pill: white, radius 8, 1px #5C5C5C, ink #5C5C5C, with a trailing glyph. */
function FilterPill({ label, icon }: { label: string; icon: string }) {
  return (
    <span className="sfl-pill">
      <span className="sfl-pill-label">{label}</span>
      <SldsIcon name={icon} size={14} className="sfl-pill-icon" />
    </span>
  );
}

/* ⚠️ COLUMN WIDTHS ARE THE CAPTURE'S, IN ITS ORDER, and they sum to the 2951 the
   capture's table measures. They are here rather than in the CSS because the row
   cells and the header cells have to agree on them exactly; two lists would
   drift the moment a column is added. */
const COLS = [
  { key: "num", w: 52, label: "" },
  { key: "check", w: 32, label: "" },
  { key: "name", w: 289, label: "Name" },
  { key: "important", w: 44, label: "" },
  { key: "first", w: 140, label: "First Name" },
  { key: "last", w: 155, label: "Last Name" },
  { key: "phone", w: 199, label: "Phone" },
  { key: "status", w: 174, label: "Lead Status" },
  { key: "sms", w: 140, label: "SMS Opt In" },
  { key: "product", w: 322, label: "Product of Interest" },
  { key: "email", w: 241, label: "Email" },
  { key: "attribution", w: 591, label: "Invoca Attribution ID" },
  { key: "created", w: 241, label: "Created Date" },
  { key: "source", w: 181, label: "Lead Source" },
  { key: "actions", w: 100, label: "Actions" },
  { key: "tail", w: 50, label: "" },
] as const;

export function SalesforceLeads() {
  const { profile, profileId } = useProfile();
  /* ⚠️ A BOOKED CALL BECOMES THE TOP ROW. The SE makes the call, opens this tab, and their
     caller is the newest lead — see `liveBookedLead`. Absent one, this list is the derived
     ten it has always been. */
  const { capturedFor } = useVoiceCapture();
  const voiceCalls = capturedFor(profileId);
  const view = salesforceLeads(profile, voiceCalls);

  return (
    <div className="sfh-root">
      <SfGlobalHeader />
      <SfContextBar active="Leads" />

      <div className="sfl-page">
        {/* ---- page header: eyebrow, title, the five-button group ---------- */}
        <div className="sfl-head">
          {/* ⚠️ #1B96FF AT RADIUS 100%, and the fill is three levels above the svg —
              the same place the Seller Home record tiles hide theirs. */}
          <span className="sfl-entity"><SldsIcon name="lead" size={20} /></span>
          <div className="sfl-headtext">
            <div className="sfl-eyebrow">Leads</div>
            <div className="sfl-titlerow">
              <h1 className="sfl-title">My Leads</h1>
              <SldsIcon name="triangledown" size={14} className="sfl-titlechev" />
            </div>
          </div>
          <div className="sfl-headactions">
            <GroupBtn first icon="settings" />
            <GroupBtn icon="refresh" />
            <GroupBtn icon="pencil" />
            <GroupBtn>New</GroupBtn>
            <GroupBtn last>List View</GroupBtn>
          </div>
        </div>

        {/* ---- the one card: filters, KPI strip, table --------------------- */}
        <div className="sfl-card">
          <div className="sfl-filters">
            <span className="sfl-filter-label">Created</span>
            <FilterPill label="This Quarter" icon="chevrondown" />
            <span className="sfl-filter-label">Owner</span>
            <FilterPill label="Me" icon="search" />
            <span className="sfl-iconpair">
              <GroupBtn first icon="bookmark" />
              <GroupBtn last icon="filter" />
            </span>
          </div>

          {/* ⚠️ THE FIRST TILE IS THE SELECTED ONE: #F3F3F3 behind a 2px #5C5C5C
              border at radius 10. The rest carry the same 2px as TRANSPARENT, so
              selecting one moves no text. */}
          <div className="sfl-kpis">
            {view.kpis.map((k, i) => (
              <div className={"sfl-kpi" + (i === 0 ? " sfl-kpi--on" : "")} key={k.label}>
                <p className="sfl-kpi-label">
                  {k.label}
                  {k.info ? <SldsIcon name="info" size={14} className="sfl-kpi-info" /> : null}
                </p>
                <p className="sfl-kpi-value">{k.value}</p>
              </div>
            ))}
          </div>

          <div className="sfl-listhead">
            <span className="sfl-count">{view.statusLine}</span>
            <span className="sfl-actions">
              <GroupBtn first>Add to Campaign</GroupBtn>
              <GroupBtn>Change Status</GroupBtn>
              <GroupBtn>Change Owner</GroupBtn>
              <GroupBtn>Send Email</GroupBtn>
              <GroupBtn last>Assign Label</GroupBtn>
            </span>
          </div>

          <div className="sfl-scroll">
            <table className="sfl-table" style={{ width: COLS.reduce((a, c) => a + c.w, 0) }}>
              <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={"sfl-th sfl-th--" + c.key}>
                      {c.key === "check"
                        ? <span className="sfl-check" />
                        : c.key === "important"
                          ? <SldsIcon name="bookmark" size={14} className="sfl-th-flag" />
                          : c.label
                            ? <>
                                <span className="sfl-th-label">{c.label}</span>
                                <SldsIcon name="chevrondown" size={14} className="sfl-th-chev" />
                              </>
                            : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.leads.map((l, i) => (
                  <tr className="sfl-tr" key={l.attributionId}>
                    <td className="sfl-td sfl-td--num">{i + 1}</td>
                    <td className="sfl-td"><span className="sfl-check" /></td>
                    <th className="sfl-td sfl-td--name">
                      {/* ⚠️ THE NAME IS THE ONE LIVE LINK ON THIS ROW — it opens the lead
                          record page, which is what the demo path does next. Every other
                          cell stays inert. */}
                      <Link className="sfl-link" to={`/salesforce/leads/${l.slug}`}>
                        {`${l.first} ${l.last}`.trim()}
                      </Link>
                    </th>
                    <td className="sfl-td"><SldsIcon name="bookmark" size={14} className="sfl-flag" /></td>
                    <td className="sfl-td">{l.first}</td>
                    <td className="sfl-td">{l.last}</td>
                    <td className="sfl-td"><span className="sfl-link">{l.phone}</span></td>
                    <td className="sfl-td">{l.status}</td>
                    <td className="sfl-td">{l.smsOptIn}</td>
                    <td className="sfl-td">{l.product}</td>
                    <td className="sfl-td">
                      {l.email ? <span className="sfl-link">{l.email}</span> : null}
                    </td>
                    <td className="sfl-td">{l.attributionId}</td>
                    <td className="sfl-td">{l.created}</td>
                    <td className="sfl-td" />
                    <td className="sfl-td sfl-td--actions">
                      <SldsIcon name="email" size={14} className="sfl-rowicon" />
                      <SldsIcon name="call" size={14} className="sfl-rowicon" />
                    </td>
                    <td className="sfl-td sfl-td--tail">
                      <SldsIcon name="triangledown" size={12} className="sfl-rowicon" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SfTodoBar />
    </div>
  );
}
