import type { CustomerProfile } from "./schema";
import { columnGroupsFor } from "./insightsColumns";
import { vocabFor } from "./insightsCatalog";

/* =============================================================================
   The DASHBOARD TEMPLATES cards on an empty Insights dashboard, and the
   "Dashboard Configuration" drawer that opens when one is clicked.
   -----------------------------------------------------------------------------
   Measured off the LIVE page 8/24/2026 (invocaforhealthcare, dashboard 075317ba),
   drawer open, read straight off the rendered DOM — this screen is Invoca's own React
   and is same-origin, so nothing here is inferred from a screenshot.

   Clicking "Lead Conversion Dashboard" slides in an 800px right drawer titled
   "Dashboard Configuration": a Name field pre-filled with the dashboard's own name, the
   lede "Select the data that best fits these categories.", then FIVE categories, each a
   bold label + a searchable dropdown + an italic explanation, over a Cancel / Save
   footer with Save disabled.

   ⚠️ THE FIVE CATEGORIES DRAW ON TWO OPTION LISTS, NOT FIVE. Read off the React props of
   all five comboboxes: the three "Metric" fields share ONE list (that account's 75
   Signals) and the two Marketing fields share ANOTHER (its 96 marketing data fields).
   Opening one dropdown and generalising from it would have invented three lists that do
   not exist.

   ⚠️ BOTH LISTS ARE RE-SKINNED PER PROSPECT, because both are account data, not product
   chrome. The captured account's Signals list is its own configured signals and its
   marketing list names Facility / Medicare / Patient Type / Specialty — a blinds company
   must never show those. Ours come from the prospect's own catalogue, which is why our
   counts are LOWER and that is correct (the same call the 240-v-371 column note makes).

   ⚠️ WHAT SAVE BUILDS IS NOT MEASURED, and deliberately not guessed. Saving on the live
   account would have written to a real customer's dashboard, which is not ours to do, so
   the one thing this file cannot tell us is which tiles a template lays out. Save stores
   the SE's five choices on the dashboard and closes; give me a capture of a built Lead
   Conversion Dashboard and the layout becomes real. Same call as the inert cards.
   ============================================================================= */

/** One category in the configuration drawer. */
export interface TemplateField {
  /** The bold label, verbatim from the live drawer. */
  label: string;
  /** The italic line under the control, verbatim. */
  help: string;
  /** Which option list the dropdown draws on. */
  source: "signal" | "marketing";
}

export interface DashboardTemplate {
  name: string;
  body: string;
  /** null while a template's drawer has not been captured. */
  fields: TemplateField[] | null;
}

/* ⚠️ ALL FIVE HELP STRINGS ARE VERBATIM PRODUCT COPY and are NOT re-skinned: they
   describe what an Invoca Signal or Marketing Data Field IS, identically in every
   account. Only the OPTIONS inside the dropdowns are per prospect. */
const LEAD_CONVERSION_FIELDS: TemplateField[] = [
  { label: "Call Answered Metric", source: "signal",
    help: "This Signal tracks when someone answered the call." },
  { label: "Lead Intention Metric", source: "signal",
    help: "This Signal tracks when the caller discusses their intended goal for the call." },
  { label: "Lead Conversion Metric", source: "signal",
    help: "This Signal tracks when the caller engages in the business outcome. This could be scheduling an appointment, signing up for a new contract, etc." },
  { label: "Marketing Channel", source: "marketing",
    help: "This Marketing Data Field distinguishes between marketing channels such as paid search, organic search, email, etc." },
  { label: "Calling Page", source: "marketing",
    help: "This Marketing Data Field captures the webpage a user viewed immediately before initiating a call." },
];

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  { name: "Lead Conversion Dashboard",
    body: "Monitor essential sales metrics, team results, and revenue patterns.",
    fields: LEAD_CONVERSION_FIELDS },
  /* ⚠️ THE OTHER TWO OPEN A DRAWER TOO, and its categories are NOT captured. `fields:
     null` is what keeps them inert rather than reusing Lead Conversion's five, which
     would put an SMS dashboard's configuration behind a set of lead-conversion labels. */
  { name: "SMS Metrics Dashboard",
    body: "Monitor SMS metrics and performance.", fields: null },
  { name: "Marketing Summary",
    body: "Analyze marketing channel performance, call volume, and lead conversion across mediums, sources, campaigns, and pages.",
    fields: null },
];

/* ⚠️ THE PRODUCT'S OWN ORDER, not alphabetical, and it is worth writing down because it
   looks like a sorting bug: the live list reads Agent, Fee, <Booking> Action, … with
   "Calling Page" BEFORE "Call Intent" and "Masked Caller ID" between "Call Type" and
   "Consumer Name". So it sorts on some internal field key, not on the label. Rather than
   reverse-engineer that key from one account, this pins the captured SEQUENCE (which is
   product chrome, identical in every account, exactly like the column groups themselves)
   and orders our own per-prospect fields by it. Anything a prospect has that the captured
   account did not is appended alphabetically instead of being dropped. */
const MARKETING_ORDER = [
  "Agent", "Fee", "{BOOKING} Action", "{BOOKING} Scheduled", "{BOOKING} Status", "Area",
  "Audience Demographic", "Billing Reason", "Callback Number", "Calling Page", "Call Intent",
  "Call Outcome", "Call Type", "Masked Caller ID", "Consumer Name", "Consumer Zip",
  "Converting URL", "Google Ads Customer ID", "Demo", "(Destination) Phone Number",
  "Destination Time Zone", "Division", "(End) of Call Reason", "Evaluated By",
  "Existing {BOOKING} Time", "{LOCATION}", "{LOCATION} Address", "{LOCATION} City",
  "{LOCATION} Phone", "{LOCATION} State", "{LOCATION} Type", "{LOCATION} Website",
  "{LOCATION} Zip", "First Interaction Type", "Google GBRAID", "Google Click ID", "SA360",
  "Geo Location", "Google Analytics Client ID", "Handled By", "{PAYMENT} Carrier",
  "Interaction ID", "Interaction Type", "Detected Destination", "Invoca Unique ID",
  "IP Address", "(IVR) Keypresses", "Full Landing Page URL", "Website Language",
  "Lead Score", "Line of Business", "Adobe Experience Cloud ID", "Meeting", "Member ID",
  "Microsoft Ads Click ID", "Network", "Not Completed Reason",
  "Priority Routing Phone Number", "{CUSTOMER} Email", "{CUSTOMER} First Name",
  "{CUSTOMER} Last Name", "{CUSTOMER} Type", "Piwik Visitor ID", "Placement", "Postal",
  "Preferred Day or Time", "Province", "Reason for Call", "Region", "(Repeat) Caller",
  "Revenue", "Reviewed By", "Rollout Phase", "SMS Scheduled Callback Datetime",
  "SMS Session Status", "{CATEGORY}", "{CATEGORY} Needed", "Territory", "User Agent",
  "Marketing Campaign", "Marketing Medium", "Marketing Source", "Marketing Search Terms",
  "Google WBRAID", "Website Journey",
];

/* The three catalogue groups the marketing list is drawn from. Verified against the
   captured 96: every one of its names that is not account-specific lives in one of
   these, and no name outside them appears in it. */
const MARKETING_GROUPS = ["Categories", "Short Text Fields", "Long Text Fields"];

/**
 * The options behind the two Marketing Data Field dropdowns — the prospect's own
 * marketing fields, in the product's order.
 */
export function marketingFieldOptions(profile: CustomerProfile): string[] {
  const groups = columnGroupsFor(profile, "details-report");
  const mine = new Set(
    groups.filter((g) => MARKETING_GROUPS.includes(g.name)).flatMap((g) => g.columns),
  );
  /* ⚠️ RESOLVE THE TOKENS, DO NOT PATTERN-MATCH THEM. The first version turned each
     `{TOKEN}` into `.+` and took the first column that matched, which fails two ways at
     once: a bare `{LOCATION}` becomes `^.+$` and matches literally any column, and two
     order entries can claim the same column and leave the other unmapped. Measured
     result: six of Shady Blinds' fields ("Consultation Status", "Customer Type",
     "Product Category", "Showroom", "Showroom Type", "Showroom Zip") fell out of their
     captured positions into the alphabetical tail. This uses the SAME `vocabFor` the
     column table itself resolves through, so a tokenised entry lands on exactly one
     column or on none. */
  const v = vocabFor(profile);
  const resolve = (s: string) => s
    .replace(/\{BOOKING\}/g, v.booking).replace(/\{CUSTOMER\}/g, v.customer)
    .replace(/\{LOCATION\}/g, v.location).replace(/\{CATEGORY\}/g, v.category)
    .replace(/\{PAYMENT\}/g, v.payment);

  const ordered = MARKETING_ORDER.map(resolve).filter((c) => mine.has(c));
  const seen = new Set(ordered);
  const rest = [...mine].filter((c) => !seen.has(c)).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}

/**
 * The options behind the three Metric dropdowns — the prospect's own Signals.
 *
 * ⚠️ NO `(T/F)` TWINS. The Reports column picker pairs every signal with its twin
 * because the live accordion does; this dropdown is picking a METRIC, and the captured
 * 75 are plain signal names. Reusing the picker's list would double it with columns that
 * are not metrics.
 * ⚠️ `Interaction Count` and `Transfer` are APPENDED AFTER the alphabetical run, which
 * is measured: the captured list is alphabetical from "(Compliance) Call Recording" to
 * "Voice Mail" and then those two, out of order, at the end.
 */
export function metricOptions(profile: CustomerProfile): string[] {
  const groups = columnGroupsFor(profile, "details-report");
  const signals = (groups.find((g) => g.name === "Signals")?.columns ?? [])
    .filter((c) => !c.endsWith("(T/F)"))
    .sort((a, b) => a.localeCompare(b));
  const tail = ["Interaction Count", "Transfer"];
  return [...signals.filter((s) => !tail.includes(s)), ...tail];
}

/**
 * What a category's dropdown starts on.
 *
 * ⚠️ MEASURED, AND ONLY FROM ONE SAMPLE: four of the five combos are empty and "Calling
 * Page" is pre-filled with the field literally named "Calling Page". "Marketing Channel"
 * is empty and there is no field of that name in the list, so the rule that fits is an
 * exact label match against the options. Stated as an inference because a second
 * pre-filled category would be needed to confirm it.
 */
export function defaultFor(field: TemplateField, options: string[]): string {
  return options.includes(field.label) ? field.label : "";
}
