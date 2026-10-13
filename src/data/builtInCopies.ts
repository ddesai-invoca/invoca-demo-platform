import type { CustomerProfile } from "./schema";
import { isProspect } from "./prospect";

/* =============================================================================
   builtInCopies — "Voice Test" and "SMS Test": copies of the BUILT-IN pair
   -----------------------------------------------------------------------------
   Asked for 10/13/2026: *"duplicate the voice and SMS call the Voice Test and SMS Test"*.

   ⚠️⚠️ **A COPY OF THE BUILT-IN TEMPLATE, NOT AN EXTRA WORKFLOW.** An `ExtraWorkflow` renders
   through `extraTree` with its own drawers and its own authored prompt, so "duplicating" into
   one would produce a different workflow that merely looks similar. These render exactly what
   the originals render (same template, same drawers, same agent wiring) under their own
   pathname, which is what gives them their OWN scope key: edits, undo and saved state are
   separate from the original's.

   ⚠️ **EACH STARTS AS THE ORIGINAL'S CURRENT STATE.** The page's base is the original's
   effective data, so the copy opens with every edit the original carries. Consequence,
   stated: until the copy itself is edited, a later change to the original shows in the copy
   too; the first edit to the copy stores its own full tree, and from then on they are
   independent.

   ⚠️ Gated by NAME like the other per-prospect workflows (`isProspect`), so widening it is one
   entry.
   ============================================================================= */

const SHOW_FOR = ["aptive"];

export interface BuiltInCopy {
  slug: "voice-test" | "sms-test";
  channel: "Voice" | "SMS";
  /** The original's route segment, whose saved state the copy starts from. */
  source: "voice" | "sms";
  suffix: string;
}

const COPIES: BuiltInCopy[] = [
  { slug: "voice-test", channel: "Voice", source: "voice", suffix: "Voice Test" },
  { slug: "sms-test", channel: "SMS", source: "sms", suffix: "SMS Test" },
];

export function builtInCopiesFor(p: CustomerProfile): BuiltInCopy[] {
  return SHOW_FOR.some((name) => isProspect(p, name)) ? COPIES : [];
}

export const isCopySlug = (slug: string | null | undefined): slug is BuiltInCopy["slug"] =>
  !!slug && COPIES.some((c) => c.slug === slug);

/** The page each copy (or original) lives on, which is also its scope path. */
export const workflowPath = (segment: string): string => `/agent-studio/agent/workflow/${segment}`;
