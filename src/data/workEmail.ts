/* =============================================================================
   workEmail.ts — is this a company address, or a consumer mailbox?
   -----------------------------------------------------------------------------
   Asked for directly (10/9/2026), against the share gate's email field: *"i want the user
   that i share demos with to have a company domain email and not a regualr gmail, yahoo,
   outlook etc emails."*

   ⚠️⚠️ **ONE DEFINITION, TWO READERS, AND THE SERVER IS THE ONE THAT COUNTS.** The gate uses
   it to say so before the prospect presses the button, and `engine/shareApi.ts` uses it to
   refuse the request — `POST /api/share/:token/request-password` is a PUBLIC route that sends
   mail, so a check that lives only in the browser is a suggestion. The client half is purely
   so the message arrives without a round trip.

   ⚠️⚠️ **A BLOCKLIST, BECAUSE AN ALLOWLIST IS NOT KNOWABLE.** We cannot enumerate the domains
   of every prospect Invoca will ever demo to, so the test is "is this one of the mailboxes
   anybody can open in a minute" rather than "is this a company we recognise". The honest
   consequence is stated rather than hidden: a consumer provider that is not on this list gets
   through. Add to the list; do not try to invert it.

   ⚠️ **DISPOSABLE DOMAINS ARE BLOCKED FOR A DIFFERENT REASON THAN GMAIL.** A free mailbox is
   the wrong KIND of address for a business demo; a ten-minute mailbox additionally defeats the
   thing the email step exists for, which is a record of who opened the demo.

   ⚠️ **FALSE POSITIVES WERE THE THING TO AVOID, so two rules are deliberately narrow:**
   • `orange.com` and `free.fr` are consumer ISPs AND real companies. Only the ISP's own
     country domain is listed (`orange.fr`), never the family, or an employee of Orange S.A.
     would be refused by their own corporate address.
   • `mail` is an exact domain (`mail.com`, `mail.ru`), never a family, or `mail.acme.com`
     — a perfectly ordinary corporate mail host — would be refused.
   ============================================================================= */

/** Consumer mailboxes, matched on the whole host. */
const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "msn.com",
  "aol.com", "aim.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me", "tutanota.com", "tuta.io", "hushmail.com",
  "zoho.com", "fastmail.com", "inbox.com", "mail.com", "mail.ru", "email.com",
  "orange.fr", "free.fr", "laposte.net", "wanadoo.fr", "sfr.fr",
  "t-online.de", "web.de", "freenet.de",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  "naver.com", "hanmail.net", "daum.net", "nate.com",
  "rediffmail.com", "sify.com",
  /* US ISP mailboxes — still a personal address, and still not a company domain. */
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "charter.net", "earthlink.net", "juno.com", "netzero.net",
  "roadrunner.com", "rr.com", "optonline.net", "frontier.com", "windstream.net",
  "btinternet.com", "virginmedia.com", "sky.com", "talktalk.net", "ntlworld.com",
  "bigpond.com", "optusnet.com.au", "telstra.com",
  "shaw.ca", "sympatico.ca", "rogers.com", "videotron.ca",
]);

/**
 * Consumer brands that run many country domains (`yahoo.co.uk`, `hotmail.fr`, `live.de`).
 *
 * ⚠️ Matched as the registrable name with any TLD and any subdomain, so `mail.yahoo.com`
 * and `yahoo.com.br` are both caught. Keep this list to names that are unambiguously a
 * consumer mail brand — see the false-positive note at the top of this file.
 */
const FREE_FAMILIES = ["yahoo", "ymail", "rocketmail", "hotmail", "outlook", "live",
  "msn", "gmx", "yandex", "zoho", "aol"];

/** Throwaway mailboxes: free AND untraceable, which is worse for a record of who opened it. */
const DISPOSABLE = ["mailinator", "guerrillamail", "10minutemail", "tempmail", "temp-mail",
  "throwawaymail", "yopmail", "trashmail", "sharklasers", "getnada", "dispostable",
  "maildrop", "fakeinbox", "mintemail", "mohmal", "emailondeck", "spamgourmet",
  "burnermail", "tempr", "moakt", "luxusmail", "mailnesia"];

export type WorkEmailVerdict = "ok" | "malformed" | "free" | "disposable";

/** The host of an address, lowercased. Empty when it does not parse as one. */
function hostOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "");
}

/** True when `host` is `name.<tld>` or `<anything>.name.<tld>`. */
function isFamily(host: string, name: string): boolean {
  const labels = host.split(".");
  /* The registrable label sits before the public suffix, which is one label (.com) or two
     (.co.uk). Checking both positions covers every variant without a suffix list. */
  return labels.length >= 2
    && (labels[labels.length - 2] === name
      || (labels.length >= 3 && labels[labels.length - 3] === name
        && labels[labels.length - 2].length <= 3));
}

/**
 * Why this address cannot be used, or `"ok"`.
 *
 * ⚠️ The SHAPE check stays where it was in `shareApi` — this answers a different question and
 * returning `"malformed"` here only means the host could not be read.
 */
export function workEmailVerdict(email: string): WorkEmailVerdict {
  const host = hostOf(String(email ?? ""));
  if (!host || !host.includes(".")) return "malformed";
  if (DISPOSABLE.some((d) => isFamily(host, d))) return "disposable";
  if (FREE_DOMAINS.has(host)) return "free";
  if (FREE_FAMILIES.some((f) => isFamily(host, f))) return "free";
  return "ok";
}

export const isWorkEmail = (email: string): boolean => workEmailVerdict(email) === "ok";

/**
 * What to tell the person, in their words rather than ours.
 *
 * ⚠️ It names the reason and what to do, because "invalid email" on an address that is
 * demonstrably valid reads as the form being broken.
 */
export function workEmailMessage(v: WorkEmailVerdict): string {
  return v === "disposable"
    ? "Please use your company email. Temporary mailboxes are not accepted."
    : "Please use your company email. Personal addresses like Gmail, Yahoo and Outlook are not accepted.";
}
