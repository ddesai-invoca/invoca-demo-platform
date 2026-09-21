import { useEffect, useRef } from "react";
import { useDemoLibrary } from "../data/DemoLibraryContext";

/* =============================================================================
   AdminNoticeModal — the one-time "you're now an admin" popup
   -----------------------------------------------------------------------------
   Asked for directly, in the same request that added six new project admins:
   "show a pop up letting them know the next time they log in to the platform."

   ⚠️ MOUNTED BESIDE `<EnvBadge />` IN `App.tsx` — inside the router but OUTSIDE
   `<Routes>` — for the exact reason that file already gives: the popup has to be
   identifiable however someone lands after signing in, and several routes (the
   phone preview, Google Search, the Salesforce pages) render outside the app
   shell entirely. A component that only rendered inside `AppShell` would miss
   anyone whose first page after login is one of those.

   ⚠️ THE SERVER DECIDES WHO SEES THIS AND WHEN IT HAS BEEN SEEN
   (`engine/adminNotices.ts`) — this component only renders what
   `DemoLibraryContext` already fetched on load, the same split `admin` itself
   already uses. There is nothing here to key off a route or a localStorage flag;
   a person who has not dismissed it sees it exactly once, on any device, because
   the fact lives on the server rather than in this browser.
   ============================================================================= */
export function AdminNoticeModal() {
  const { adminNotice, dismissAdminNotice } = useDemoLibrary();
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!adminNotice) return;
    const t = setTimeout(() => btnRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void dismissAdminNotice(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [adminNotice, dismissAdminNotice]);

  if (!adminNotice) return null;

  return (
    <div className="adm-overlay" onClick={() => void dismissAdminNotice()}>
      <div className="adm-modal" role="dialog" aria-modal="true" aria-label="You're now an admin"
        onClick={(e) => e.stopPropagation()}>
        <div className="adm-badge">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <h2 className="adm-title">You&rsquo;re now an admin</h2>
        <p className="adm-body">
          You can now see support and feature requests from the whole team, not just your
          own &mdash; open them anytime from the Support menu, top right.
        </p>
        <button ref={btnRef} className="adm-btn" onClick={() => void dismissAdminNotice()}>
          Got it
        </button>
      </div>
    </div>
  );
}
