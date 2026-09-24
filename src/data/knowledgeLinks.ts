import type { CustomerProfile, KnowledgeSource } from "./schema";

/* =============================================================================
   knowledgeLinks.ts — where a Knowledge Source row actually goes
   -----------------------------------------------------------------------------
   Asked for directly: *"can we make these Knowledge sources clickable, so for
   the weblinks it goes to the link, and for the PDF it opens the playbook"*.
   They had been `<a href="#">` since the screen was built.

   ⚠️⚠️ **MEASURED FIRST, AND IT IS WHY THIS FILE EXISTS: NOT ONE ROW CARRIES A
   URL.** Across 91 profiles on disk there are 453 knowledge rows, and **453 of
   them are LABELS** — "Homepage", "Find Your Home", "Shop New & Used Cars",
   "Our Locations". The schema has only `name`, and the generator writes
   human-readable page names rather than addresses. So "go to the link" has no
   link to go to, and something has to decide one.

   ⚠️⚠️ **A GUESSED PATH IS REFUSED — IT 404s IN FRONT OF A CUSTOMER.** Turning
   "Find Your Home" into `/find-your-home` is the obvious move and it is wrong:
   nothing verifies that path exists, and the failure lands mid-demo on the
   prospect's own website. This repo already settled the identical question for
   the Google LSA "Book online" button — `src/data/bookingPath.ts` uses a
   hand-RESOLVED table and falls back to "/" precisely because *"a guessed path
   (/book, /schedule) 404s in front of a customer, which is worse than landing
   one click away"*. Same rule here.
   ⚠️ The profile DOES contain paths that look usable — `voiceScreenpop
   .callingWebpage` is `/pest-control/scorpions/` on Aptive — but those are
   GENERATED too, so they are exactly the unverified guess this refuses.

   So: an address if the row already is one, otherwise the prospect's own site,
   which is the one URL known to be real (the SE typed it to make the demo).
   ============================================================================= */

/** Does this row's `name` already name an address rather than a page title? */
export function looksLikeUrl(name: string): boolean {
  const s = name.trim();
  if (/^https?:\/\//i.test(s)) return true;
  /* A bare "www.foo.com/bar" also counts; a label never contains a dotted host
     before its first slash. Checked on the host part only, so "Plans & Build-a-Plan"
     and "Continuing Life, Communities" stay labels. */
  const host = s.split("/")[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !/\s/.test(host);
}

/** The prospect's own site, always real — it is what generated the demo. */
export function siteRoot(profile: CustomerProfile): string {
  const raw = profile.websiteUrl || `https://www.${profile.brandDomain}`;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return `https://${profile.brandDomain}`;
  }
}

/**
 * Where a Web Link row navigates. Never null — every row is clickable, and the
 * worst case is the prospect's homepage rather than a dead link or a 404.
 */
export function knowledgeHref(profile: CustomerProfile, s: KnowledgeSource): string {
  if (looksLikeUrl(s.name)) {
    const t = s.name.trim();
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }
  return siteRoot(profile);
}
