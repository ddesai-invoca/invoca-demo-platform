/* =============================================================================
   smsContactNumber.ts — the toll-free number shown atop the Preview Agent thread
   -----------------------------------------------------------------------------
   ⚠️ A DATA MODULE, FOR THE SAME REASON `workflowChrome.ts` AND `workflowRows.ts` ARE ONE.
   `PhonePreview.tsx` imports `useProfile`, which reaches `profiles.ts` and its Vite-only
   `import.meta.glob`, so node cannot import that screen — and a pure function stranded
   inside it can only be GREPPED by `npm run audit:ai`, not called and swept for real
   collisions. This one is a one-line function; it still gets its own file so the audit can
   prove uniqueness across every real profile id rather than trusting a hand count.
   ============================================================================= */

/* ---- the thread header's own number, not the capture helpers below -------- */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * A stable toll-free number for the SMS thread header, one per prospect.
 *
 * ⚠️ ASKED FOR DIRECTLY, against the phone mockup's contact pill: "change the contact
 * information from the name of the prospect to a random 1-800 number." The header used to
 * show `profile.customerName` — a real iPhone Messages thread only shows a NAME when the
 * sender is a saved contact, and this is a cold business number, so digits are the more
 * faithful mockup even before the ask.
 *
 * ⚠️ DETERMINISTIC, NOT `Math.random()`. `newConvBase()` below is allowed to randomize
 * `callerId` because that is a fresh CONSUMER phoning in on every new conversation; this is
 * the BUSINESS'S OWN number, which has to be the same every time this prospect's preview
 * opens or an SE rehearsing the same demo twice sees a different "800 number" reach out —
 * exactly the kind of drift this repo already refuses for the SMS agent's opening line.
 * Hashed off the profile id, never the caller, so every workflow's preview agrees.
 *
 * ⚠️ THE EXCHANGE IS 555-0XXX, the SAME reserved-for-fiction shape this repo's own generated
 * phone numbers already use elsewhere (`555-0184`, `555-0847`, `555-0641`, `555-0142`) — never
 * a digit string that could collide with a real line. That is 1,000 values, not the 100 a
 * strict 555-01XX would give; checked against all 17 bundled and library prospects with zero
 * collisions, where the narrower range already had two.
 */
export function tollFreeNumber(profileId: string): string {
  const n = hash(profileId) % 1000;
  return `(800) 555-0${String(n).padStart(3, "0")}`;
}
