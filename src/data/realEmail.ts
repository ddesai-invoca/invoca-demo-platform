import type { CustomerProfile } from "./schema";

/* =============================================================================
   Real mailboxes, not placeholder domains (10/19/2026)
   -----------------------------------------------------------------------------
   Asked for from CRM feedback ("replace 'emailprovider' to gmail"), then "apply gmail
   everywhere". Generated profiles carry addresses like `sarah.mitchell@email.com` and
   `@emailprovider.com` (measured: 290 and 34 across the profiles on disk), which read as fake
   on a CRM record, a screen pop or a Salesforce lead.

   ⚠️ APPLIED AT LOAD, NOT AS A DATA MIGRATION, for the reason `renameMarketingSources`
   records: the shared library holds hundreds of demos no local edit reaches. `ProfileContext`
   runs it as every profile enters the store, so every screen is right by construction.
   ⚠️ ONLY PLACEHOLDER DOMAINS MOVE. A business address (`@ridgelinelogistics.com`), a real
   provider (`@outlook.com`) and Invoca's own (`@invoca.com`) are left exactly as they are.
   ============================================================================= */
const PLACEHOLDER = /@(emailprovider|email|example|provider|mail|domain|test|sample)\.(com|net|org)\b/gi;

/** One address or any text containing addresses, with placeholder domains made gmail. */
export const realEmail = (s: string): string => s.replace(PLACEHOLDER, "@gmail.com");
const HAS_PLACEHOLDER = new RegExp(PLACEHOLDER.source, "i");   // no /g: .test() must not keep state

function walk(v: unknown): unknown {
  if (typeof v === "string") return HAS_PLACEHOLDER.test(v) ? realEmail(v) : v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = walk(x); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  if (v && typeof v === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const y = walk(x); if (y !== x) changed = true; out[k] = y; }
    return changed ? out : v;
  }
  return v;
}

/** The profile with every placeholder email domain made gmail. The SAME object when there was
    nothing to change, so a clean profile costs no re-render. */
export const withRealEmails = (p: CustomerProfile): CustomerProfile => walk(p) as CustomerProfile;
