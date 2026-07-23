import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";

/* The network selector doubles as the live demo-customer switcher:
   pick a customer and the whole app re-skins to their generated data.
   The logo returns to the Launch screen (new prospect / revisit). */
export function TopBar() {
  const { profileId, setProfileId, profiles } = useProfile();

  return (
    <header className="topbar">
      <Link to="/launch" aria-label="Launch a prospect">
        <img className="logo" src="/logo.png" alt="Invoca" />
      </Link>
      <span className="demo-badge">Demo<br />Network</span>
      <div className="net-wrap">
        <span className="net-label">Network</span>
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
