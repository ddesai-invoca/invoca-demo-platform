import { isProspect } from "./prospect";

/* =============================================================================
   Real RCS deep links for the Google ad's "Message" button (10/20/2026).

   By default the button opens our RCS Preview Agent (`?wf=rcs`). A prospect listed here has
   a REAL RCS Business Messaging agent of its own, so the button opens that instead: an
   `sms:` link with the agent's `service_id`, which a phone with RCS (Google Messages)
   opens straight into the business's chat, with the body pre-filled. On a desktop it opens
   whatever handles `sms:` links (Messages on a Mac), not our preview.

   Asked for with the exact link, "JUST for the iTelecom prospect". Matched by NAME through
   the shared `isProspect`, never a guessed id: iTelecom is a shared-library demo whose id
   came from whatever was typed when it was generated. Add a row to give another prospect
   its own agent.
   ============================================================================= */

const DEEP_LINKS: { prospect: string; href: string }[] = [
  {
    prospect: "iTelecom",
    href: "sms:+18447096720?service_id=itelecom_5i4jwm2y_agent%40rbm.goog&body=Hi%2C%20I'd%20like%20help%20learning%20more%20about%20iTelecom%20offerings.%20",
  },
];

/** The prospect's own RCS agent link, or null to use the RCS Preview Agent. */
export function rcsDeepLink(p: { id: string; customerName: string }): string | null {
  return DEEP_LINKS.find((d) => isProspect(p, d.prospect))?.href ?? null;
}
