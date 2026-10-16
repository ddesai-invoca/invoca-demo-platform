/* =============================================================================
   reporter — describe the person behind a request, for an alert (10/15/2026)
   -----------------------------------------------------------------------------
   ⚠️⚠️ READ FROM SIGNED COOKIES, NEVER FROM THE REQUEST BODY. `/api/client-error`
   is public (it has to be, see server.ts), so an email in the body would be
   whatever anybody typed. The Invoca session cookie is HMAC-signed, and a shared
   demo's unlock cookie carries a signed proof beside the address the prospect
   entered at the gate, so both are only ever what the server itself issued.

   ⚠️ A prospect's address is SELF-DECLARED at the share gate (nobody proves it),
   and the label says "shared demo" so nobody mistakes it for an Invoca sign-in.
   ============================================================================= */
import { authEnabled, parseCookies, sessionEmail } from "../googleAuth.ts";
import { unlockedAs } from "./shareApi.ts";

/** A share token in a page route (`/share/<t>/...`) or an API path (`/api/share/<t>/...`). */
const SHARE = /^\/(?:api\/)?share\/([A-Za-z0-9_-]{16,})/;

/**
 * Who this is: the signed-in Invoca email, else the email a prospect gave at a shared
 * demo's gate, else a plain statement that nobody is signed in. Never throws.
 */
export function describeUser(cookieHeader: string | undefined, route: string): string {
  try {
    const email = sessionEmail(cookieHeader);
    if (email) return email;
    const m = SHARE.exec(route || "");
    if (m) {
      const who = unlockedAs(parseCookies(cookieHeader), m[1]);
      return who ? `${who} (prospect on a shared demo)` : "prospect on a shared demo (no email given)";
    }
    return authEnabled ? "not signed in" : "local@dev (sign-in is off)";
  } catch {
    return "unknown";
  }
}
