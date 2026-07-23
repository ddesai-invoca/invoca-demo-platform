import { NavLink } from "react-router-dom";
import { NAV } from "./nav";

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="nav-scroll">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            {item.svg ? (
              <span className="nav-svg">{item.svg()}</span>
            ) : (
              <span className="material-icons">{item.icon}</span>
            )}
            <span className="nav-label">{item.label}</span>
            {item.badge && <span className="nav-new">{item.badge}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
