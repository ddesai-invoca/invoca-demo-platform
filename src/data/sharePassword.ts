/* =============================================================================
   sharePassword.ts — the share link's password, from the prospect's own name
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"the password is the prospect's name with no spaces."*

   ⚠️⚠️ **ONE DEFINITION, THREE READERS** — the route that CREATES a share, the email
   that sends it, and the audit. A second copy is how the stored hash and the emailed
   string come to disagree, which presents as "the password you sent me doesn't work"
   with nothing in any log to explain it.

   ⚠️ DOM-free so `engine/` can import it with an explicit `.ts` extension, the same
   shape as `src/data/markStatus.ts` and for the same reason.
   ============================================================================= */

/**
 * ⚠️ **NOT A SECRET, AND THE REST OF THE DESIGN HAS TO ASSUME THAT.** The unlock page
 * prints the prospect's name in its own heading, so anybody holding the link can derive
 * this without asking for it. The real secret is the 32-byte token in the URL. The email
 * step buys a RECORD OF WHO OPENED THE DEMO, not a second factor.
 */
export function sharePassword(prospect: string): string {
  /* ⚠️ Every whitespace run, not just " " — a pasted prospect name can carry a
     non-breaking space or a tab, and a password nobody can type is worse than a weak
     one. Punctuation is KEPT ("Avi & Co." -> "Avi&Co.") because stripping it would be a
     second rule to remember when reading it out. */
  return prospect.replace(/\s+/g, "").trim();
}
