import type { CustomerProfile } from "./schema";
import { INTENT_SALES, INTENT_SUPPORT, SUPPORT_LEAF, LEAF_QUALIFY, LEAF_ESCALATE } from "./workflowChrome";
import { intentCopyFor, type IntentCopy } from "./prospectIntent";
import { smsIntentText, voiceIntentSubs, RETIRED_SMS_SALES, RETIRED_SMS_SUPPORT, RETIRED_VOICE_SALES, RETIRED_VOICE_SUPPORT } from "./intentText";

/** This prospect's industry intent, one definition for every workflow reader. */
export const intentOf = (p: CustomerProfile): IntentCopy => intentCopyFor(p);

/* =============================================================================
   voiceUseCases.ts — the branches under the two user-group nodes
   -----------------------------------------------------------------------------
   Agreed 8/27/2026. The four chrome nodes stay locked because the real Invoca page does not
   let anyone rename them, but the row BELOW "All Sales Inquiry Users" and "All Support Users"
   is configuration: as many branches as the SE wants, each one a USE CASE with its own fields
   to collect and its own destination.

   ⚠️ **DERIVED, NOT GENERATED.** No engine phase and no schema slice, so generation time is
   unchanged and every demo already on disk gets these the moment it renders. Same call
   `deriveVoiceSpec`, `leadFormFacts` and `franchiseAi` already make.

   ⚠️ **SALES BRANCHES ARE BUYING STAGE, NOT PRODUCT LINE.** The alternative was one branch per
   "Conversions by Product Category" row, which reads well on a slide and is wrong on a phone:
   a caller does not ring up having already sorted themselves into the prospect's product
   taxonomy. Where they are in the decision ("ready to book", "still comparing", "booking for a
   group") is something they CAN answer, and it is the split that changes how the call is
   routed.

   ⚠️ **SUPPORT BRANCHES ARE ACTIONS**, for the same reason: an existing customer rings up to
   DO something (change it, cancel it, query a charge), and each of those wants a different
   reference number and a different team.

   ⚠️⚠️ **`vocabFor` IS NOT EXTENDED HERE, DELIBERATELY.** That helper feeds the Insights column
   catalogue, the tile Configuration drawer and the question catalogue; adding voice words to it
   would change screens nobody asked about. The same reasoning is recorded at `franchiseAi.ts`,
   which overrides its noun locally rather than upstream. This file keeps its own vocabulary and
   touches nothing else.
   ============================================================================= */

/** One branch under a user-group node. */
export interface VoiceUseCase {
  /** The node's title, and the answer the caller gives. */
  title: string;
  /** Its pills, AND what the agent asks for on that path. One list, two renderings. */
  collect: string[];
  /**
   * The team it hands off to, named aloud on transfer.
   *
   * ⚠️ **OPTIONAL, AND THAT IS LOAD-BEARING.** Comfort Keepers' spec is SE-authored and names
   * no destinations; leaving this undefined keeps its diagram and its call byte-identical.
   * Opt-in props defaulted to today's behaviour is the standing rule for shared components.
   */
  route?: string;
}

export interface VoiceUseCases {
  sales: VoiceUseCase[];
  support: VoiceUseCase[];
}

/**
 * Voice-specific vocabulary, keyed off the prospect's industry.
 *
 * ⚠️ MOST SPECIFIC VERTICAL FIRST, the same ordering trap `vocabFor` documents: an industry
 * string frequently names two verticals ("Window treatments & home services") and whichever
 * test runs first wins.
 */
export function voiceVocab(profile: CustomerProfile) {
  const ind = (profile.industry || "").toLowerCase();
  /* ⚠️ **WORD BOUNDARIES, NOT `includes`.** A substring test matched "car" inside "In-home
     senior CARE", so Comfort Keepers derived a "Fleet or business enquiry" branch routed to
     Fleet Sales and asked callers for a "Purchase Timeline". Its own industry string turned a
     senior-care agent into a car dealership, and nothing failed. `vocabFor` gets away with
     `includes` because none of its keywords are substrings of another vertical's word; these
     are, so they cannot. */
  const has = (...w: string[]) =>
    w.some((x) => new RegExp(`(^|[^a-z])${x}[a-z]*([^a-z]|$)`, "i").test(ind));
  /* ⚠️ AND THE KEYWORD "car" IS BANNED FROM THE LISTS BELOW. The boundary fixed the front of
     the word but the trailing `[a-z]*` still let "car" swallow "care", so Comfort Keepers was
     STILL a car dealership after the first fix. "auto" already covers "Automotive", so the
     keyword bought nothing and cost a whole vertical. Suffix wildcards are needed for
     automotive/insurance/cleaning, so the discipline is on the keyword list, not the regex. */

  /* WHERE the service happens. For a hotel this is the DESTINATION, not the caller's own ZIP —
     a guest's home postcode tells you nothing about which property they want, which is exactly
     what the generic template got wrong on Marriott. */
  const where =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Destination"
    : has("home service", "plumb", "hvac", "roof", "restoration", "clean", "pest") ? "Service Address"
    : has("senior", "care", "living") ? "Care Location"
    : "Consumer Zip";

  /* WHEN they want it. */
  const when =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Travel Dates"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Preferred Date"
    : has("auto", "vehicle", "dealer", "tire") ? "Purchase Timeline"
    : "Timeline";

  /* The reference an EXISTING customer quotes. This is the single biggest reason the support
     branches need their own fields: none of them want a ZIP. */
  const ref =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Confirmation Number"
    : has("insur", "policy") ? "Policy Number"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Patient ID"
    /* An auto retailer is "retail" too, and its support caller quotes a repair order. */
    : has("auto", "vehicle", "dealer", "tire") ? "Repair Order Number"
    : has("retail", "store", "mattress", "blind", "window", "furnish") ? "Order Number"
    : `${profile.bookingTerm} Reference`;

  /* The larger-than-one-caller enquiry, which is a different desk in every vertical. */
  const bulk =
    has("hotel", "lodging", "resort", "travel", "vacation") ? { title: "Group or event booking", team: "Group Sales" }
    : has("auto", "vehicle", "dealer", "tire") ? { title: "Fleet or business enquiry", team: "Fleet Sales" }
    : has("retail", "store", "mattress", "blind", "window", "furnish") ? { title: "Bulk or trade order", team: "Trade Sales" }
    : has("senior", "care", "living") ? { title: "Multiple family members", team: "Care Coordination" }
    : has("health", "medical", "clinic", "hospital", "dental") ? { title: "Employer or group health", team: "Group Health" }
    : { title: "Large or multi-site enquiry", team: "Key Accounts" };

  /* ⚠️ WHAT WENT WRONG, named the way the vertical names it. "Service issue" is right for a
     home service and meaningless for a hotel, where the equivalent is the stay itself. */
  const issue =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Stay Issue or Complaint"
    : has("home service", "plumb", "hvac", "roof", "restoration", "clean", "pest") ? "Service Issue or Re-Treatment"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Care Concern or Follow-Up"
    : has("senior", "care", "living") ? "Care Concern or Follow-Up"
    : has("insur", "policy") ? "Claim or Coverage Issue"
    : has("auto", "vehicle", "dealer", "tire") ? "Repair Issue or Warranty"
    : has("retail", "store", "mattress", "blind", "window", "furnish") ? "Order Problem or Return"
    : "Service Issue or Complaint";

  /* WHEN IT ALREADY HAPPENED. A support lookup needs the date of the thing being asked about,
     which is the opposite of `when` (that one is when they WANT something). */
  const last =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Stay Dates"
    : has("auto", "vehicle", "dealer", "tire") ? "Service Date"
    : has("retail", "store", "mattress", "blind", "window", "furnish") ? "Order Date"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Last Visit Date"
    : has("insur", "policy") ? "Claim Date"
    : "Last Service Date";

  /* ⚠️⚠️ **WHAT AN EXISTING CUSTOMER HAS OPEN, WHICH IS NOT ALWAYS THE BOOKING TERM.**
     `bookingTerm` is a SALES word: AutoNation's is "Test Drive", so a support branch built
     from it read "Test Drive Status or Change" to somebody ringing about a repair. The thing
     a support caller has a status on is whatever they already bought. */
  const openItem =
    has("auto", "vehicle", "dealer", "tire") ? "Service Visit"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Appointment"
    : has("retail", "store", "mattress", "blind", "window", "furnish") ? "Order"
    : has("insur", "policy") ? "Policy"
    : profile.bookingTerm || "Appointment";

  /* ⚠️ THE SECOND IDENTIFIER, the one that actually finds the account. `where` is built for a
     SALES call and answers "where do you want it", so it hands back a ZIP for healthcare and
     automotive, which locates nobody's record. This is what each vertical really asks for. */
  const verify =
    has("home service", "plumb", "hvac", "roof", "restoration", "clean", "pest") ? "Service Address"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Date of Birth"
    : has("auto", "vehicle", "dealer", "tire") ? "Vehicle or Plate"
    : has("senior", "care", "living") ? "Care Location"
    : "Consumer Name";

  /* WHEN THE NEXT ONE IS, for a status check. */
  const scheduled =
    has("hotel", "lodging", "resort", "travel", "vacation") ? "Check-In Date"
    : has("health", "medical", "clinic", "hospital", "dental") ? "Appointment Date"
    : has("home service", "plumb", "hvac", "roof", "restoration", "clean", "pest") ? "Scheduled Visit Date"
    : has("insur", "policy") ? "Renewal Date"
    : "Scheduled Date";

  return { where, when, ref, bulk, issue, last, scheduled, openItem, verify };
}

/**
 * A destination, taken from the prospect's own routing queue.
 *
 * ⚠️ **THE QUEUE NAME IS USED WHOLE.** An earlier version cut it at the first separator, the
 * way the intent NODE titles do, and that is right for a node title and wrong for a team:
 * "Reservation, New Booking" became "Reservation" and "Test Drive" stayed "Test Drive", so the
 * agent announced it was transferring the caller to a booking term rather than to a desk. The
 * qualifier after the comma is the part that makes it read as a queue.
 */
function queueName(name: string | undefined, fallback: string): string {
  return (name ?? "").trim() || fallback;
}

/**
 * The default branches for a prospect, from data it already carries.
 *
 * ⚠️ **DESTINATIONS COME FROM THE PROSPECT'S OWN ROUTING QUEUES** (`voiceRoutingDemo.queues`),
 * which every profile carries and which the diagram used to draw before those nodes became
 * locked chrome. Inventing team names when real ones are sitting in the profile would put
 * words in the prospect's mouth on the one screen that is about their routing.
 */
export function deriveUseCases(profile: CustomerProfile): VoiceUseCases {
  const v = voiceVocab(profile);
  const intent = intentOf(profile);
  const queues = (profile.reports.voiceRoutingDemo?.queues ?? []).map((q) => queueName(q.name, "")).filter(Boolean);
  const newTeam = queues[0] || `New ${profile.bookingTerm} Team`;
  /* ⚠️⚠️ **ROUTES ARE MATCHED BY WHAT THE QUEUE IS FOR, NOT BY ITS POSITION (10/14/2026).**
     Positional routing sent a hospital's "Care Concern" to "Insurance Verification and
     Billing" and AutoNation's "Repair Issue" to "General Sales Support". Each case names the
     words its desk would carry; the first of the prospect's OWN queues that matches wins, and
     only when none does is the positional default used. Nothing is ever invented. */
  /* Alternatives are tried IN ORDER, so "urgent" beats the "schedul" it is listed before:
     a single regex over the queues in queue order sent same-day care to the scheduling desk. */
  const pick = (re: RegExp, fallback: string, avoid?: RegExp) => {
    for (const alt of re.source.split("|")) {
      const a = new RegExp(alt, "i");
      const hit = queues.find((q) => a.test(q) && !(avoid && avoid.test(q)));
      if (hit) return hit;
    }
    return fallback;
  };
  const NOT_BILLING = /billing|insurance verification|payment/i;
  /* ⚠️ A SUPPORT CASE NEVER FALLS BACK ONTO A BILLING DESK. Positionally the second queue is
     often billing ("Insurance Verification and Billing"), and a care concern landed there. */
  /* ⚠️ AND NEVER ONTO A NEW-BUSINESS DESK: "Service Appointment, New Project" is where a new
     job goes, not where a complaint about the last one does. */
  const NOT_SUPPORT = /billing|insurance verification|payment|sales|new booking|new project|new patient|new mattress|new bundle|new client/i;
  const supportDesk = queues.find((q) => /support|existing|help|customer care|guest|patient services/i.test(q) && !NOT_SUPPORT.test(q) && q !== newTeam)
    ?? `${profile.customerName} ${profile.customerNoun} Support`;
  const fill = (f: string) => (f === "{where}" ? v.where : f === "{when}" ? v.when : f);

  /* ⚠️⚠️ **THE NEW-SIDE BRANCHES ARE THE INDUSTRY'S, NOT A SHOPPING FUNNEL (10/14/2026).**
     "Ready to book now / Comparing options" read as a sales pipeline on a hospital, which is
     exactly what was reported. Each vertical names what a new caller actually wants
     (`prospectIntent.ts`); only an unrecognised business keeps the generic pair plus its
     larger-than-one-caller branch. */
  const sales: VoiceUseCase[] = intent.useCases.map((u) => ({
    title: u.title,
    collect: u.collect.map(fill),
    route: pick(u.route, newTeam, NOT_BILLING),
  }));
  if (intent.kind === "general") {
    sales.push({ title: v.bulk.title, collect: ["Consumer Name", "Group Size", v.when], route: v.bulk.team });
  }
  const sr = intent.supportRoute;

  return {
    sales,
    /* ⚠️⚠️ **FOUR BRANCHES, AND "CHANGE" AND "CANCEL" WERE MERGED BECAUSE THEY WERE THE SAME
       BRANCH.** Reported directly: *"i think change, reschedule and cancel would be the
       same"*. They were right, and by this file's own rule: a branch earns its place by
       needing a different reference, a different team or a different action, and those two
       wanted the identical reference, the identical fields and the identical desk. What
       replaced them is split on what the agent has to LOOK UP, which is the thing that
       actually differs: the visit that went wrong, the visit that is coming, the charge.
       ⚠️ Titles are the heading on the box, so they are written as product configuration
       rather than as a caller's words, and each one re-skins through `voiceVocab`. */
    support: [
      {
        /* The defining support call for anything with a guarantee or a result: it did not
           work. Its own desk, because handled slowly this is a cancellation. */
        title: v.issue,
        collect: [v.verify, v.last, v.ref],
        route: pick(sr.issue, supportDesk, NOT_SUPPORT),
      },
      {
        /* "Where is it / when are you coming", plus moving it. Pure deflection: a read and
           a reschedule, no human needed. */
        title: `${v.openItem} Status or Change`,
        collect: [v.verify, v.scheduled, v.ref],
        route: pick(sr.status, supportDesk, NOT_SUPPORT),
      },
      {
        /* ⚠️ NO CARD DIGITS IN THE COLLECT LIST, EVER. The brand rules already forbid asking
           for payment details over text, and a field on the diagram is an instruction to
           ask for it. The charge DATE is enough to find the transaction. */
        title: `Billing and Account`,
        collect: ["Consumer Name", "Charge Date", v.ref],
        route: pick(sr.billing, "Billing"),
      },
      {
        /* ⚠️ THE CATCH-ALL IS A REAL BRANCH, NOT A GAP. Without it every unmatched support
           caller falls into whichever of the three the model likes best, which is how a
           billing question ends up in the re-treatment queue. */
        title: `Other Support Request`,
        collect: ["Consumer Name", v.ref],
        route: pick(sr.other, supportDesk, NOT_SUPPORT),
      },
    ],
  };
}

/* =============================================================================
   REPAIRING A TREE THAT FROZE THE OLD SUPPORT SET
   -----------------------------------------------------------------------------
   ⚠️⚠️ **A STORED TREE OVERRIDE OUTRANKS THE DERIVED DEFAULT, SO CHANGING
   `deriveUseCases` DOES NOTHING FOR A DEMO SOMEBODY HAS EDITED.** Applying an edit
   anywhere on a workflow page persists the WHOLE tree, so every demo an SE has
   touched carries a snapshot of whatever the support branches were that day. Aptive
   is one: its record still lists "Change or reschedule / Cancel a service appointment
   / Billing question" and no change here would ever have reached it.

   ⚠️ **READ-TIME, NOT A MIGRATION**, for the reason this repo already records for
   `repairSmsSegments` and the marketing-source rename: the override layer syncs to the
   shared demo record, so a tree written by the old code reaches a colleague's browser
   where no migration ever ran.

   ⚠️⚠️ **IDENTIFIED BY AN EXACT MATCH ON THE RETIRED TITLES, WHICH IS WHAT MAKES IT
   SAFE.** Only the old derived default could produce that precise set, so a hand-edited
   support branch is left alone by construction. Anything else, including a set an SE has
   renamed or added to, is not touched.
   ============================================================================= */

/** The titles the retired default produced, as a predicate rather than a list of
 *  strings, because "Cancel a service appointment" interpolates the booking term. */
function isRetiredSupportSet(titles: string[]): boolean {
  if (titles.length !== 3) return false;
  const [a, b, c] = titles.map((t) => t.toLowerCase().trim());
  return a === "change or reschedule"
    && /^cancel (a|an) .+/.test(b)
    && c === "billing question";
}

/**
 * Swap a frozen retired support set for the current derived one.
 *
 * ⚠️ Returns the SAME object when there is nothing to repair, so it never costs a
 * re-render — the identity rule `repairSmsSegments` and the marketing rename both follow.
 */
export function repairSupportUseCases<T extends { title?: string; leaves?: unknown[] }>(
  branches: T[],
  profile: CustomerProfile,
  /**
   * ⚠️ **NAMED, BECAUSE TWO POSITIONAL BOOLEANS WOULD BE READ WRONG AT A CALL SITE.** Both
   * flags change what the repair is allowed to do, and `(branches, profile, true, false)`
   * tells a reader nothing about which is which.
   */
  opts: {
    /**
     * Whether this is the BUILT-IN template, which is the only tree whose support leaf may be
     * REFILLED when it is empty.
     *
     * ⚠⚠ **WITHOUT THIS THE EMPTY-LEAF REPAIR LEAKS ONTO EVERY AUTHORED WORKFLOW.** Orlando
     * Health's five ER trees, Avi & Co's, Reyes Law's and every generated quote-request one
     * build their support leaf from the shared chrome constants with no children — an empty
     * support leaf is their NORMAL, signed-off state, and filling it would inject four
     * pest-control-shaped branches into a hospital's messaging workflow. Measured: ungated it
     * changed all eight on disk. The retired-title repair needs no such gate, because only the
     * old derived default could produce that exact set.
     */
    builtIn?: boolean;
    /**
     * Whether a repaired answer may carry its routing destination.
     *
     * ⚠⚠ **VOICE ONLY — on SMS the renderer draws `Route to <team>` INSTEAD OF the action.**
     * Seen in the browser: the four support answers read "Route to General Customer Care"
     * where their drawer and their tint both said Support & Escalate, one node described two
     * ways. The voice agent names the desk out loud and its prompt reads the field, so there
     * it stays.
     */
    withRoute?: boolean;
  } = {},
): T[] {
  const { builtIn = false, withRoute = true } = opts;
  let changed = false;
  const derived = deriveUseCases(profile);
  const support = derived.support;
  const kind = intentOf(profile).kind;
  const smsText = smsIntentText(profile);
  const voiceText = voiceIntentSubs(profile);
  const next = branches.map((b0) => {
    let b = b0;
    const isSupportBranch = String(b.title ?? "") === INTENT_SUPPORT;
    const isSalesBranch = String(b.title ?? "") === INTENT_SALES;
    /* ⚠️⚠️ **A STORED INTENT SUBTITLE FROZE THE ONE-SIZE SALES TEMPLATE (10/14/2026).** Every
       demo an SE touched saved "interested in starting <X> service, or … add or upgrade" on
       its Sales Inquiry box, so changing the template reached none of them. Recognised by the
       retired template's exact shape and swapped for the industry wording; anything an SE
       wrote is left alone. */
    const sub = String((b as { subtitle?: string }).subtitle ?? "");
    const fixedSub = isSalesBranch
      ? (RETIRED_SMS_SALES.test(sub) ? smsText.sales : RETIRED_VOICE_SALES.test(sub) ? voiceText.sales : sub)
      : isSupportBranch
        ? (RETIRED_SMS_SUPPORT.test(sub) ? smsText.support : RETIRED_VOICE_SUPPORT.test(sub) ? voiceText.support : sub)
        : sub;
    if (fixedSub !== sub) { b = { ...b, subtitle: fixedSub }; changed = true; }
    if (isSalesBranch && withRoute && kind !== "general") {
      /* ⚠️ The retired voice funnel ("Ready to book now / Comparing options / <bulk>") is swapped
         for the industry's own new-side branches. Voice only: the SMS sales side is the
         prospect's service lines and was never this set. */
      const sl = (b.leaves ?? []) as { title?: string; paths?: { title?: string }[] }[];
      const fixedSl = sl.map((leaf) => {
        const t = (leaf.paths ?? []).map((x) => String(x.title ?? ""));
        if (!(t.length === 3 && t[0] === "Ready to book now" && t[1] === "Comparing options")) return leaf;
        const proto = (leaf.paths ?? [])[0] ?? {};
        return { ...leaf, paths: derived.sales.map((u) => ({ ...proto, title: u.title, chips: u.collect, ...(u.route ? { route: u.route } : {}) })) };
      });
      if (fixedSl.some((l, i) => l !== sl[i])) { b = { ...b, leaves: fixedSl }; changed = true; }
    }
    const leaves = (b.leaves ?? []) as {
      title?: string; action?: string; actionKind?: string; actionIcon?: string;
      tone?: string; paths?: { title?: string }[];
    }[];
    const fixedLeaves = leaves.map((leaf) => {
      const paths = leaf.paths ?? [];
      const titles = paths.map((p) => String(p.title ?? ""));
      /* ⚠⚠ **AN EMPTY SUPPORT LEAF IS ALSO A FROZEN SNAPSHOT, and missing that is why the
         SMS tree drew nothing under it.** Measured on a real stored demo: Aptive's SMS
         override holds `All Support Users` with ZERO children — the pre-10/6 template, saved
         the day an SE applied an edit — while its VOICE override holds the retired 3-set and
         repaired correctly. One shape was recognised and the other was not, so the same
         prospect showed the four cases on one channel and nothing on the other.
         ⚠️ Identified by the locked CHROME names rather than by emptiness alone, so the only
         leaf this can refill is the one the product always draws. */
      const isChromeSupportLeaf = isSupportBranch && String(leaf.title ?? "") === SUPPORT_LEAF;
      const stale = isRetiredSupportSet(titles)
        || (builtIn && isChromeSupportLeaf && paths.length === 0);
      /* ⚠⚠ **AND A LEAF THAT BRANCHES MUST BE A QUALIFY, which a stored one is not.** Every
         override written before today carries `Support & Escalate` on a node with children —
         a TERMINAL action nesting, which the product's own model does not allow and which is
         why its answers never appeared. Repaired on its own, so a tree whose titles are
         already current still gets the action fixed. */
      /* ⚠⚠ **GATED ON `builtIn` TOO — UNGATED IT CHANGED ALL EIGHT AUTHORED EXTRAS, measured
         rather than reasoned about.** `extraTree` builds the same locked chrome, so Orlando
         Health's five ER trees, Avi & Co's two and Reyes Law's nurture flow all have a
         `Need Support` branch whose `All Support Users` leaf carries authored children — and
         every one of them flipped to a Qualify. They are signed off, and the ask was for the
         built-in pair, so the blast radius stops here.
         ⚠️ **CONSEQUENCE, STATED: those eight still draw a terminal action with children**,
         which is the same contradiction this repair exists to fix. Flagged rather than fixed
         quietly; it is a one-line change to widen once somebody asks for it. */
      const needsQualify = builtIn
        && isChromeSupportLeaf
        && (paths.length > 0 || stale)
        && leaf.actionKind !== "qualify";
      if (!stale && !needsQualify) return leaf;
      changed = true;
      /* ⚠️ The node's own shape is kept and only what is stale replaced, so a lock or
         anything else an SE set on that leaf survives. */
      const next: typeof leaf = { ...leaf };
      if (needsQualify) {
        next.action = LEAF_QUALIFY;
        next.actionKind = "qualify";
        next.actionIcon = "callSplit";
      }
      if (stale) {
        /* ⚠⚠ **THE ANSWERS ARE TERMINAL ESCALATES, NOT COPIES OF THE OLD FIRST CHILD.** The
           earlier version spread `paths[0]`, which on the voice tree meant every repaired
           support answer inherited `Inform & Route` — the SALES ending — from a node that was
           itself stale. A support answer is where the agent does the work. */
        next.paths = support.map((u) => ({
          title: u.title,
          action: LEAF_ESCALATE,
          actionKind: "escalate" as const,
          actionIcon: "headsetMic" as const,
          tone: "orange" as const,
          chips: u.collect,
          ...(withRoute && u.route ? { route: u.route } : {}),
        })) as typeof leaf.paths;
      }
      return next;
    });
    return fixedLeaves.some((l, i) => l !== leaves[i]) ? { ...b, leaves: fixedLeaves } : b;
  });
  return changed ? (next as T[]) : branches;
}
