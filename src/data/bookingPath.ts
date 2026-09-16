/* =============================================================================
   Where "Book online" actually goes, per advertiser (9/12/2026)
   -----------------------------------------------------------------------------
   Reported directly: the handoff was landing on the prospect's HOME PAGE, and the real one
   does not — *"when you click on the book online for Roto Rooter it takes them to URL:
   www.rotorooter.com/schedule-service/?zipCode=30328&gad=…&rwg_token=… and not the home
   page."* Correct: `google.com/localservices/booking?ebd=…` decodes to the advertiser's own
   BOOKING page, not their front door.

   ⚠️⚠️ **A TABLE, NOT RUNTIME DISCOVERY, AND THAT WAS MEASURED RATHER THAN ASSUMED.** The
   obvious build is the `engine/ogImage.ts` pattern — fetch the site at view time and find the
   booking link. It was probed across the library and it fails for exactly the prospects that
   matter: **AutoNation 403, Mattress Firm 403, Orlando Health 429** — the same enterprise
   blocking `ogImage` already records. A BROWSER reaches all three (that is how the paths
   below were resolved), but a server cannot, so runtime discovery would quietly drop the
   biggest brands to the home page. A demo link must also not depend on whether somebody
   else's site answers a fetch mid-pitch. So each path is resolved once, by hand, and stored.

   ⚠️ **VERIFIED AGAINST THE REAL THING WHERE IT COULD BE.** Roto-Rooter's entry is the
   control: the discovery found `/schedule-service/`, which is character-for-character the
   path in the live Google LSA link above. That is the evidence the rest of the table is the
   right KIND of page.

   ⚠️ **PATHS ONLY — never a query string.** The real Roto-Rooter URL also carries
   `zipCode=30328` and `gad=…`, but those are ADVERTISER-SPECIFIC parameters that Google's
   handoff fills in for a page that accepts them. Appending a zipCode to a prospect whose
   booking page has no such field would be inventing an integration. The generic tokens
   (`oppref`, the utm set, `rwg_token`) are appended by `bookingHandoffUrl` for every prospect
   because those are Google's and Invoca's own, not the advertiser's.

   ⚠️ **UNKNOWN PROSPECT -> THE HOME PAGE, WHICH IS NEVER A 404.** The platform generates new
   prospects constantly and none of them will be in this table. A guessed path (`/book`,
   `/schedule`) would 404 in front of a customer, which is worse than landing one click away.

   HOW TO ADD ONE: open the prospect's site, find the primary booking / "get a quote" CTA, and
   put its PATH here keyed by the bare domain. Prefer the page that actually starts a booking
   over a generic contact page.
   ============================================================================= */

const BOOKING_PATH: Record<string, string> = {
  /* Resolved by server fetch. Roto-Rooter's matches the live Google LSA destination exactly. */
  "rotorooter.com": "/schedule-service/",
  "aptivepestcontrol.com": "/build-a-plan/",
  "keywhitman.com": "/lasik/schedule-online/",
  "nationalvanlines.com": "/free-moving-quote/",
  /* Resolved in a browser — these three 403/429 a server-side fetch. */
  "autonation.com": "/appointment",
  "orlandohealth.com": "/request-an-appointment",
  "mattressfirm.com": "/en-us/stores/",
  /* Client-rendered sites whose CTA is not in the served HTML; read off the rendered page.
     ⚠️ Comfort Keepers books a CARE ASSESSMENT, which is why this is not `/contact-us/`. */
  "comfortkeepers.com": "/care-assessment/",
  "vectorsecurity.com": "/services/",
};

/** The advertiser's booking path, or "/" when we have not resolved one for them. */
export function bookingPath(domain: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  return BOOKING_PATH[host] ?? "/";
}

/** Do we know this advertiser's real booking page? Exposed for the audit. */
export function hasBookingPath(domain: string): boolean {
  return bookingPath(domain) !== "/";
}
