import { Link } from "react-router-dom";
import { SldsIcon } from "./SldsIcon";

/* =============================================================================
   The Salesforce chrome every Lightning screen shares: the global header, the app
   context bar and the To Do List footer.
   -----------------------------------------------------------------------------
   Extracted from `SalesforceHome` when the Calendar screen arrived, so the two cannot
   drift — the first version of the header lived inside the Home screen, and a second copy
   is how the nav ends up with a different active tab treatment on each page.

   ⚠️⚠️ **RE-MEASURED 8/27/2026 OFF A NEWER CAPTURE, and Salesforce has restyled this chrome.**
   `reference/salesforce/seller-home-v2.html` (`invocafforhomeservices.lightning.force.com`).
   Every value below changed; the previous set is kept in the right-hand column because the
   difference is the whole point of the re-measure:

   | | was (8/24 capture) | now |
   |---|---|---|
   | search | 400 x 32, radius **4**, 1px `#747474` | 400 x 32, radius **8**, 1px **`#5C5C5C`** |
   | the + button | 20 x 20, `#919191`, radius **4** | 20 x 20, **`#5C5C5C`**, radius **240** (a circle) |
   | right icons | 20px `#919191` | **24px**, each in a 240-radius hit area |
   | favourites | one star | a SPLIT PAIR: star 26 x 24 `240 0 0 240`, caret 22 x 24 `0 240 240 0` |
   | context bar | white, **3px `#0070D2`** bottom rule | **transparent**, NO rule (the page grey shows) |
   | nav item | 37 tall, 13/19.5 `#181818` | **32** tall, **500** 13/19.5 **`#03234D`** |
   | active tab | a `rgba(0,112,210,.1)` **WASH** | ink **`#0250D9`** + a **3px underline**, radius 12 |
   | app name | in the header row | **on the NAV row**, `400 20px/25px` `#03234D` at x=60 |

   ⚠️ **THE ACTIVE TAB IS AN `::after`, NOT A BACKGROUND.** Measured `top: 32px; bottom: -3px;
   left: 0; right: 0; border-radius: 12px; background: #0250D9` — a 3px bar sitting just under
   the 32px tab. An inactive tab carries the same pseudo element with a dark navy fill, hidden
   rather than absent, so reading only "is there an ::after" would light every tab up.

   ⚠️ **"Sales" IS NOT IN THE LOGO IMAGE.** `.slds-global-header__logo` (200 x 40) contains a
   `slds-assistive-text` span reading "Sales", which measures 0 x 0 — the visible app name is a
   separate 20px element one row down. Reading the assistive text as the visible label would
   put the app name in the wrong row entirely.
   ============================================================================= */

/* ⚠️ THIS CAPTURE'S OWN TAB SET, in its own order — it carries **Invoca Call Log**, which is
   the whole reason this org is the one being demoed, and drops Calendar/People/Cases/Forecasts
   from the older capture. "More" is the overflow item the real bar ends with. */
const TABS = [
  "Home", "Opportunities", "Leads", "Tasks", "Invoca Call Log", "Files", "Accounts", "Contacts",
  "Campaigns", "Dashboards", "Reports", "Chatter", "Groups", "More",
];
/* Chatter has no dropdown; neither does Home. Everything else carries the "<X> List" caret. */
const NO_CHEVRON = new Set(["Home", "Chatter"]);

/**
 * Tabs whose screen exists. Everything else stays inert rather than linking to a blank.
 *
 * ⚠️⚠️ **THIS ORG'S NAV HAS NO CALENDAR TAB, and that breaks a documented click path.** The
 * older capture had one and the demo flow is "Seller Home -> Calendar -> the appointment the
 * SMS agent booked". This capture's bar ends Chatter, Groups, **More** — Calendar is not on
 * it, so keeping a Calendar tab would be inventing a tab this org does not have.
 * **More** is the overflow menu, which is exactly where a tab like Calendar lives, so it
 * carries the route. That is the smallest departure available: the alternative is either an
 * invented tab or a demo path that dead-ends. Flagged to the user rather than decided
 * quietly; give me a capture of the More menu and it becomes a real dropdown.
 */
const ROUTES: Record<string, string> = {
  Home: "/salesforce",
  Leads: "/salesforce/leads",
  "Invoca Call Log": "/salesforce/call-log",
  More: "/salesforce/calendar",
};

export function SfGlobalHeader() {
  return (
    <header className="sfh-globalhead">
      {/* ⚠️ THE REAL LOGO, EXTRACTED VERBATIM. It is a CSS `background-image` on
          `.slds-global-header__logo` — a **200 x 40** element with `background-size: contain`
          and `background-position: 0% 50%` — not an `<img>` and not an inline `<svg>`. Two
          earlier passes concluded "the asset is not in the capture" because their corner
          searches filtered to elements narrower than 70px, and a 200px-wide div never
          matched. It was there the whole time. */}
      <span className="sfh-logo" aria-label="Salesforce" />

      <div className="sfh-search">
        <SldsIcon name="search" size={14} className="sfh-search-icon" />
        <span className="sfh-search-ph">Search...</span>
      </div>

      <div className="sfh-globalicons">
        {/* ⚠️ A SPLIT PAIR, not one star: 26 x 24 and 22 x 24, their radii mirrored so the two
            read as a single pill. The left half is disabled on this page. */}
        <span className="sfh-fav sfh-fav--l">&#9733;</span>
        <span className="sfh-fav sfh-fav--r"><SldsIcon name="triangledown" size={12} /></span>
        {/* ⚠️ GREY AND ROUND. Measured `background: #5C5C5C`, `border-radius: 240px` on a 20px
            box — the previous build had it grey but square, and an earlier one had it in the
            brand blue, which is the loudest thing in the header and the wrong colour. */}
        <span className="sfh-gi sfh-gi--add"><SldsIcon name="add" size={14} /></span>
        <span className="sfh-gi"><SldsIcon name="guidance" size={24} /></span>
        <span className="sfh-gi"><SldsIcon name="help" size={24} /></span>
        <span className="sfh-gi"><SldsIcon name="setup" size={24} /></span>
        <span className="sfh-gi"><SldsIcon name="notification" size={24} /></span>
        {/* The avatar's artwork is the real one too — a background image, see the CSS. */}
        <span className="sfh-avatar" />
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
