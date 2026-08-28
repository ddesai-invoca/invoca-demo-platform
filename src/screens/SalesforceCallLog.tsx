import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { salesforceCallLog } from "../data/salesforceCallLog";

/* =============================================================================
   Invoca Call Log -> Recently Viewed — screen 4 of 4
   -----------------------------------------------------------------------------
   Built off `reference/salesforce/call-log-v1.html`, measured at 1920. The Invoca
   package's own custom object: one record per call, one column, an auto-numbered
   name. It is the plainest of the four screens and it is the one that proves the
   integration writes into Salesforce at all.

   ⚠️ THE NAME COLUMN FILLS THE BOX; the capture's 1558px is `lightning-datatable`
   writing its measured widths inline in ITS window, frozen by SingleFile. See the
   note at `.scl-col-name`.

   ⚠️ EVERY ROW OPENS ITS RECORD, as of 8/28/2026. They were inert until the record
   page was built off its own capture; the rule that kept them inert — never link
   somewhere invented — is the same rule that let them go live once the destination
   was real.
   ============================================================================= */

/** The header's action group: white, 1px #5C5C5C, ink #0250D9, 600, ends rounded. */
function GroupBtn({ children, first, last }:
  { children: React.ReactNode; first?: boolean; last?: boolean }) {
  return (
    <li className={"scl-gbtn" + (first ? " scl-gbtn--first" : "") + (last ? " scl-gbtn--last" : "")}>
      <span className="scl-gbtn-a">{children}</span>
    </li>
  );
}

/** One of the round icon buttons on the second header row. */
function IconBtn({ icon, caret, grey, first, last }:
  { icon: string; caret?: boolean; grey?: boolean; first?: boolean; last?: boolean }) {
  return (
    <span className={"scl-ibtn" + (caret ? " scl-ibtn--wide" : "") + (grey ? " scl-ibtn--grey" : "")
      + (first ? " scl-ibtn--first" : "") + (last ? " scl-ibtn--last" : "")}>
      <SldsIcon name={icon} size={14} />
      {caret ? <SldsIcon name="triangledown" size={8} className="scl-ibtn-caret" /> : null}
    </span>
  );
}

export function SalesforceCallLog() {
  const { profile } = useProfile();
  const view = salesforceCallLog(profile);

  return (
    <div className="sfh-root">
      <SfGlobalHeader />
      <SfContextBar active="Invoca Call Log" />

      <div className="scl-page">
        {/* ⚠️ ONE WHITE CARD AT RADIUS 20 holding both the header band and the list —
            the header is NOT the page background here, it is a #F3F3F3 band inside
            the card with a 1px #C9C9C9 rule under it. */}
        <div className="scl-card">
          <div className="scl-head">
            <div className="scl-headrow">
              {/* #8B85F9 is the same purple Seller Home's Invoca Call Log record tile
                  carries, measured on both captures — one object, one colour. */}
              <span className="scl-entity"><img src="/icons/salesforce/invoca-call-log.png" alt="" /></span>
              <div className="scl-headtext">
                <div className="scl-eyebrow">Invoca Call Log</div>
                <div className="scl-titlerow">
                  <h1 className="scl-title">Recently Viewed</h1>
                  {/* The list-view picker's caret carries NO border; the pin beside it does. */}
                  <span className="scl-tbtn"><SldsIcon name="triangledown" size={14} /></span>
                  <span className="scl-tbtn scl-tbtn--bordered" title="This list is pinned.">
                    <SldsIcon name="pin" size={14} />
                  </span>
                </div>
              </div>
              <ul className="scl-actions">
                <GroupBtn first>New</GroupBtn>
                <GroupBtn>Import</GroupBtn>
                <GroupBtn>Change Owner</GroupBtn>
                <GroupBtn last>Assign Label</GroupBtn>
              </ul>
            </div>

            <div className="scl-headrow scl-headrow--2">
              <span className="scl-count">{view.statusLine}</span>
              <span className="scl-tools">
                <span className="scl-search">
                  <SldsIcon name="search" size={14} className="scl-search-ic" />
                  <span className="scl-search-ph">Search this list...</span>
                </span>
                <span className="scl-icluster">
                  <IconBtn icon="settings" caret />
                  <IconBtn icon="listdisplay" caret />
                  <IconBtn icon="refresh" />
                </span>
                <IconBtn icon="sortarrows" />
                <IconBtn icon="pencil" />
                {/* ⚠️ THIS PAIR IS GREY-ON-#E5E5E5 where every other icon button is
                    #0250D9 on white — measured, not a hover state. */}
                <span className="scl-ipair">
                  <IconBtn icon="piechart" grey first />
                  <IconBtn icon="filter" grey last />
                </span>
              </span>
            </div>
          </div>

          <div className="scl-scroll">
            <table className="scl-table">
              <thead>
                <tr>
                  <th className="scl-th scl-th--num" />
                  <th className="scl-th scl-th--check"><span className="scl-check" /></th>
                  <th className="scl-th scl-th--name">
                    <span className="scl-th-label">Invoca Call Log Name</span>
                    <SldsIcon name="chevrondown" size={14} className="scl-th-chev" />
                  </th>
                  <th className="scl-th scl-th--act" />
                </tr>
              </thead>
              <tbody>
                {view.records.map((r, i) => (
                  <tr className="scl-tr" key={r.name}>
                    <td className="scl-td scl-td--num">{i + 1}</td>
                    <td className="scl-td"><span className="scl-check" /></td>
                    <td className="scl-td">
                      {/* ⚠️ LIVE NOW THAT THE RECORD PAGE EXISTS. These were deliberately
                          inert while it did not — a link that navigates somewhere invented
                          is worse than one that does nothing. */}
                      <Link className="scl-link" to={`/salesforce/call-log/${r.name}`}>{r.name}</Link>
                    </td>
                    <td className="scl-td scl-td--act">
                      <SldsIcon name="triangledown" size={12} className="scl-rowcaret" />
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
