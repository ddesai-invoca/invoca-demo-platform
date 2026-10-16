import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { pageTitle } from "../data/pageTitle";

/** Keeps the browser tab's title in step with the screen. Renders nothing.
    Mounted once inside each router (the signed-in app and a shared demo), outside
    `<Routes>`, so every route gets it without each screen remembering to.
    ⚠️ Only the ACTIVE profile is read: while a fetched profile loads, `profile` is
    still the seed default, and a dashboard tab would briefly carry the seed's title. */
export function PageTitle() {
  const { pathname } = useLocation();
  const { profile, profileId } = useProfile();
  const active = profile?.id === profileId ? profile : null;
  useEffect(() => {
    const t = pageTitle(pathname, active);
    if (t) document.title = t;
  }, [pathname, active]);
  return null;
}
