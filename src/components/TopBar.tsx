import { Link, useLocation, useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";

/* The network selector doubles as the live demo-customer switcher:
   pick a customer and the whole app re-skins to their generated data.
   The logo returns to the Launch screen (new prospect / revisit).

   The green "Network" chip beside it is a deliberate hidden entry point into the
   Google results screen, the same trick the ChatGPT tile on the Exchange plays:
   it starts the demo one step BEFORE Invoca, on the search that produced the
   call. It is a button rather than a link on the <select> so picking a customer
   still just switches customer.

   PER-PAGE AI + UNDO. The sparkle and undo sit immediately left of the star and
   put the Ask AI drawer on EVERY platform screen, not just the dashboards. They
   are invisible until that zone is hovered (see .tb-ai in app.css) so they never
   show up in a screenshot or mid-demo.

   The scope key is `${profileId}::${pathname}` — the SAME key the dashboards use
   — which is what makes an edit stay on the page it was made on and gives each
   page its own undo stack. Nothing here is dashboard-specific; the key is
   derived from the route, so a new screen gets both for free. */
export function TopBar() {
  const { profileId, setProfileId, profiles } = useProfile();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { openDrawer, undo, canUndo, readOnly } = useAiAssistant();
  const scopeKey = `${profileId}::${pathname}`;
  /* Undo is per page by design: the button can never change a screen you are not
     looking at. It greys out when THIS page has nothing left to undo. */
  const undoable = canUndo(scopeKey) && !readOnly;

  return (
    <header className="topbar">
      <Link to="/launch" aria-label="Launch a prospect">
        <img className="logo" src="/logo.png" alt="Invoca" />
      </Link>
      <span className="demo-badge">Demo<br />Network</span>
      <div className="net-wrap">
        <button
          className="net-label net-label-btn"
          onClick={() => navigate("/google-search")}
          title="Open the Google results page for this prospect"
        >
          Network
        </button>
        <select
          className="net-select"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.customerName}</option>
          ))}
        </select>
      </div>
      <div className="search-wrap">
        <div className="search">
          <span className="material-icons">search</span>
          <span>Navigate to...</span>
        </div>
      </div>
      <div className="topbar-icons">
        {/* Hover zone: both buttons hold their layout space at all times, so the
            invisible area is still hoverable. focus-visible reveals them too, so
            they stay reachable by keyboard. */}
        <span className="tb-ai">
          <button
            className="tb-ai-btn tb-ai-spark"
            onClick={() => openDrawer()}
            title="Ask AI about this page"
            aria-label="Ask AI about this page"
          >
            <span className="material-icons">auto_awesome</span>
          </button>
          <button
            className={"tb-ai-btn" + (undoable ? "" : " tb-ai-btn-off")}
            onClick={() => undoable && undo(scopeKey)}
            disabled={!undoable}
            title={undoable ? "Undo the last AI change on this page" : "Nothing to undo on this page"}
            aria-label="Undo the last AI change on this page"
          >
            <span className="material-icons">undo</span>
          </button>
        </span>
        <span className="material-icons">star</span>
        <span className="icon-badge">
          <span className="material-icons">notifications</span>
          <span className="count">57</span>
        </span>
        <span className="icon-badge">
          <span className="material-icons">help</span>
          <span className="count">1</span>
        </span>
        <span className="avatar">DD</span>
      </div>
    </header>
  );
}
