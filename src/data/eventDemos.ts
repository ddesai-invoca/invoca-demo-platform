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

/** 2026 Invoca Chicago Summit. */
export const CHICAGO_EVENT = "chicago-2026";
/** ⚠️ Its own prefix, for the same reason Dallas has one — see the note above. */
export const CHICAGO_ID_PREFIX = "chicago-";
export const chicagoDemoId = (slug: string): string => `${CHICAGO_ID_PREFIX}${slug}`;

/* =============================================================================
   THE EVENT REGISTRY (10/8/2026)
   -----------------------------------------------------------------------------
   Asked for as *"create a new event similar to the 2026 Dallas Invoca Summit and
   call it 2026 Invoca Chicago Summit"*. Adding the second one is what turned the
   constants above into a list: the Launch screen had the event baked into a
   TERNARY (`d.event === DALLAS_EVENT ? "dallas" : ...`) and its section header
   baked into a second table, so a new event meant editing both and a third would
   mean editing them again. Now a new event is ONE ENTRY here.

   ⚠️⚠️ **THE `key` IS WRITTEN BY THE SEEDER AND READ BY THE LAUNCH SCREEN**, which
   is the note at the top of this file and the reason it lives in one module. The
   `group` is purely the Launch screen's own section id; it is NOT stored on any
   record, so it may be renamed freely and the `key` may not — a demo already on
   the server disk carries that string.
   ============================================================================= */

export interface EventDef {
  /** Stored on `DemoRecord.event`. ⚠️ CHANGING ONE ORPHANS EVERY DEMO ALREADY TAGGED. */
  key: string;
  /** The Launch screen's section id. Internal to that screen; safe to rename. */
  group: string;
  /** The dropdown header. */
  label: string;
  /** See `DALLAS_ID_PREFIX` — every seeded roster id carries one. */
  idPrefix: string;
}

/** ⚠️ ORDER IS THE ORDER THE SECTIONS RENDER IN, under "Team demos" and above
 *  "Samples". Newest event first, so the one somebody is working is at the top. */
export const EVENTS: EventDef[] = [
  { key: CHICAGO_EVENT, group: "chicago", label: "2026 Invoca Chicago Summit", idPrefix: CHICAGO_ID_PREFIX },
  { key: DALLAS_EVENT,  group: "dallas",  label: "2026 Dallas Invoca Summit",  idPrefix: DALLAS_ID_PREFIX },
];

/** Which Launch section a demo belongs to, or null when it is in no event. */
export const eventGroupOf = (event?: string): string | null =>
  (event && EVENTS.find((e) => e.key === event)?.group) || null;

/** The event a demo id was seeded for, by its prefix — used by the audits. */
export const eventForId = (id: string): EventDef | undefined =>
  EVENTS.find((e) => id.startsWith(e.idPrefix));
