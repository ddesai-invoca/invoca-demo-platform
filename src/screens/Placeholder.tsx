import { useProfile } from "../data/ProfileContext";

/* Temporary screen for nav items we haven't templatized yet.
   Replace each with a real profile-driven screen as we build them out. */
export function Placeholder({ name }: { name: string }) {
  const { profile } = useProfile();
  return (
    <div className="placeholder">
      <span className="material-icons placeholder-icon">construction</span>
      <h2>{name}</h2>
      <p>This screen isn’t built yet.</p>
      <p className="muted">
        When built, it will render <strong>{profile.customerName}</strong>’s data from the same
        customer profile — consistent with every other screen.
      </p>
    </div>
  );
}
