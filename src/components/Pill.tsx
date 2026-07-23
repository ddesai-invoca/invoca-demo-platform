import type { ReactNode } from "react";

export function Pill({ children, closable = false }: { children: ReactNode; closable?: boolean }) {
  return (
    <button className="pill">
      <span>{children}</span>
      {closable && <span className="material-icons">close</span>}
    </button>
  );
}
