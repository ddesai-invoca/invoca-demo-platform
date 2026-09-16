/* =============================================================================
   admins.ts — the project admin list, ONE definition
   -----------------------------------------------------------------------------
   Extracted from `demoApi.ts` 9/16/2026 so `alerts.ts` can read it without an
   import cycle. `demoApi` re-exports `adminEmails`, so every existing caller
   (`feedbackApi`, `audit:app`) is unchanged.

   ⚠️⚠️ **WHY IT MOVED RATHER THAN BEING IMPORTED FROM `demoApi`.** The alert funnel
   has to be callable from ANYWHERE a failure happens, including from `demoApi`
   itself when a demo write fails. With the list still owned by `demoApi` that is a
   runtime cycle (`demoApi -> alerts -> demoApi`), and this repo has already been
   bitten by exactly that once: `leadSlug` moved to `salesforceLiveLead.ts` because
   the list and the record page imported each other, which "happens to work (function
   declarations hoist) and is exactly the fragility that breaks on an unrelated
   refactor". A leaf module that imports nothing cannot be in a cycle.
   ============================================================================= */

/* PROJECT ADMINS — write access to every demo, not just their own.

   The list is the built-in ADMINS below PLUS anything in the DEMO_ADMIN_EMAILS
   env var (comma separated). Additive, deliberately: replacing the built-in list
   means `DEMO_ADMIN_EMAILS=bill@invoca.com`, meant as "Bill too", silently
   strips the project admin of access to everyone's demos — the exact problem
   this feature exists to fix, reintroduced by a config typo. To remove a
   built-in admin, edit this constant.

   Read at module load, so changing the var needs a server restart (on Render, a
   restart — not a redeploy). Matching is case-insensitive and tolerates spaces. */
const ADMINS = ["ddesai@invoca.com"];

const ADMIN_EMAILS = new Set(
  [...ADMINS, ...(process.env.DEMO_ADMIN_EMAILS ?? "").split(",")]
    .map((e) => e.trim().toLowerCase()).filter(Boolean),
);

/** The admin addresses themselves, for the two things that have to REACH an admin
 *  rather than just authorise one: the new-feedback notification and an alert. */
export const adminEmails = (): string[] => [...ADMIN_EMAILS];

/** Is this address an admin? `trim()` on THIS side too: the config side was already
 *  trimmed, so an email arriving with surrounding whitespace missed a list it was
 *  actually in. */
export const isAdminEmail = (email: string | undefined | null): boolean =>
  ADMIN_EMAILS.has((email ?? "").trim().toLowerCase());
