/* =============================================================================
   eventDemos.ts — which event a library demo belongs to
   -----------------------------------------------------------------------------
   A demo record can carry an `event` key (see DemoRecord in engine/demoStore.ts).
   When it does, the Launch screen files it under that event's own dropdown
   INSTEAD of "My demos" / "Team demos" — an event roster is a set of prospects
   somebody will demo at a conference, not a personal or team working copy.

   ⚠️ ONE DEFINITION, TWO SIDES. The seeder (engine/eventSeeds.ts) WRITES this
   key and the Launch screen READS it. Two copies of the string is how one side
   ends up reading a key nobody writes — the demo appears in no section at all
   and nothing errors. This module has no React import so the engine can use it.
   ============================================================================= */

/** 2026 Dallas Invoca Summit — the prospect roster for that event. */
export const DALLAS_EVENT = "dallas-2026";

/* ⚠️ EVERY SEEDED ROSTER ID IS PREFIXED, and it is not cosmetic. Two of the 59
   Dallas prospects — AutoNation and Goosehead Insurance — already exist as
   bundled profiles under the slugs a clean name produces, and the shared library
   holds 200+ more demos whose ids nobody is checking against this list. An
   unprefixed collision does not error: the seeder finds the id already taken and
   SKIPS it, so that prospect is silently missing from the conference roster, and
   a bundled profile sharing an id would drop out of its own section too. */
export const DALLAS_ID_PREFIX = "dallas-";

/** The library demo id for a roster slug. */
export const dallasDemoId = (slug: string): string => `${DALLAS_ID_PREFIX}${slug}`;
