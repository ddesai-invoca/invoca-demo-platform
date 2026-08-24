import { Link } from "react-router-dom";
import { SldsIcon } from "./SldsIcon";

/* =============================================================================
   The Salesforce chrome every Lightning screen shares: the global header, the app
   context bar and the To Do List footer.
   -----------------------------------------------------------------------------
   Extracted from `SalesforceHome` when the Calendar screen arrived, so the two cannot
   drift — the first version of the header lived inside the Home screen, and a second copy
   is how the nav ends up with a different active tab treatment on each page.

   Measured off captures of Lightning (8/24/2026):
     global header  50 tall; search 400 x 32, WHITE with a 1px #747474 border, radius 4
     the + button   20 x 20, background #919191 (GREY, not brand blue), radius 4,
                      white 16px glyph
     right icons    20px at #919191, no button chrome; star 16, its caret 12
     avatar         32 circle, #1B96FF
     context bar    40 tall, white, 3px #0070D2 rule, padding-left 24
     nav item       37 tall, link 13/19.5 #181818, padding 0 12
     active tab     background rgba(0,112,210,.1) — a WASH, no underline
   ============================================================================= */

const TABS = [
  "Home", "Opportunities", "Leads", "Tasks", "Files", "Accounts", "Contacts", "Campaigns",
  "Dashboards", "Reports", "Chatter", "Groups", "Calendar", "People", "Cases", "Forecasts",
];
const NO_CHEVRON = new Set(["Chatter", "Forecasts"]);

/** Tabs whose screen exists. Everything else stays inert rather than linking to a blank. */
const ROUTES: Record<string, string> = {
  Home: "/salesforce",
  Calendar: "/salesforce/calendar",
};

export function SfGlobalHeader() {
  return (
    <header className="sfh-globalhead">
      <span className="sfh-logo" aria-label="Salesforce">
        <SldsIcon name="cloud" size={38} />
      </span>

      <div className="sfh-search">
        <SldsIcon name="search" size={14} className="sfh-search-icon" />
        <span className="sfh-search-ph">Search...</span>
      </div>

      <div className="sfh-globalicons">
        <span className="sfh-gi sfh-gi--star">&#9733;</span>
        <span className="sfh-gi sfh-gi--tri"><SldsIcon name="triangledown" size={12} /></span>
        {/* ⚠️ GREY, NOT BRAND BLUE. Measured `background: #919191` on a 20px box — the first
            build made this the #0176D3 primary, which is the loudest thing in the header
            and the wrong colour entirely. */}
        <span className="sfh-gi sfh-gi--add"><SldsIcon name="add" size={16} /></span>
        <span className="sfh-gi"><SldsIcon name="guidance" size={20} /></span>
        <span className="sfh-gi"><SldsIcon name="help" size={20} /></span>
        <span className="sfh-gi"><SldsIcon name="setup" size={20} /></span>
        <span className="sfh-gi"><SldsIcon name="notification" size={20} /></span>
        {/* The avatar is a white user glyph on #1B96FF — see the `user` note in SldsIcon. */}
        <span className="sfh-avatar"><SldsIcon name="user" size={20} /></span>
      </div>
    </header>
  );
}

export function SfContextBar({ active }: { active: string }) {
  return (
    <nav className="sfh-bar">
      <span className="sfh-waffle" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
      </span>
      <span className="sfh-app">Sales</span>
      <ul className="sfh-tabs">
        {TABS.map((t) => {
          const to = ROUTES[t];
          return (
            <li className={"sfh-tab" + (t === active ? " sfh-tab--on" : "")} key={t}>
              {/* ⚠️ ONLY A TAB WITH A BUILT SCREEN LINKS. There is no `*` catch-all in the
                  router, so linking the rest would put a blank page mid-demo behind a tab
                  that looks live. Add to ROUTES in the same commit as the screen. */}
              {to && t !== active
                ? <Link className="sfh-tab-link" to={to}>{t}</Link>
                : <span className="sfh-tab-link">{t}</span>}
              {NO_CHEVRON.has(t) ? null
                : <SldsIcon name="chevrondown" size={14} className="sfh-tab-chev" />}
            </li>
          );
        })}
      </ul>
      <span className="sfh-barpencil"><SldsIcon name="pencil" size={14} /></span>
    </nav>
  );
}

export function SfTodoBar() {
  return (
    <footer className="sfh-todo">
      <SldsIcon name="todo" size={14} className="sfh-todo-icon" />
      <span>To Do List</span>
    </footer>
  );
}
