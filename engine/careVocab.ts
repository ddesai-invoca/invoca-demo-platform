/* =============================================================================
   careVocab — healthcare wording for the Quality Management dashboards
   -----------------------------------------------------------------------------
   Asked for directly (10/6/2026): *"for all healthcare prospects i want you to
   have healthcare language instead of the sales language"*, scoped on the follow-up
   to **"only future prospects that are healthcare"**.

   ⚠️⚠️ **SO THIS IS GENERATION-TIME ONLY, AND THAT IS WHY IT LIVES HERE.** The QM
   titles are LITERALS in `engine/core.ts`'s scaffolding, baked into each profile's
   JSON when it is generated — so changing them changes what the NEXT prospect is
   born with and leaves every stored demo exactly as it is. No read-time transform,
   no migration, nothing rewritten. That was the explicit ask, and it is also the
   safer half: this repo already records that rewriting a saved demo's text strands
   the reports that quote it verbatim.

   ⚠️⚠️ **THE WORDING IS THE PROSPECT'S OWN CANONICAL TERM, NOT VOCABULARY INVENTED
   HERE.** `qualifiedCallTerm` is generated in the prefix for every prospect and is
   already "New Patient Call" on healthcare accounts and "Sales Call" on the rest —
   it exists precisely so the conversion dashboards stop drifting apart. The QM
   dashboard was simply never wired to it. Deriving from it means a hospital reads
   "New Patient" because its OWN data says so, rather than because a table here
   guessed a healthcare word.

   ⚠️ **`vocabFor` IS DELIBERATELY NOT EXTENDED.** It feeds the Insights column
   catalogue, the tile Configuration drawer and the question catalogue, so adding
   QM words there would change screens nobody asked about — the same call
   `franchiseAi` and `voiceUseCases` each made.
   ============================================================================= */

/** Care DELIVERY, not merely healthcare-adjacent. */
const CARE = /\b(health(care)?|hospital(?!ity)|medical|clinic|dental|dentist|patient|physician|surgical|oncolog\w*|pediatric|primary care|urgent care|hospice|home health|behavioral health|optometr\w*|eye care|vision care|hearing|senior (living|care)|nursing|dermatolog\w*|therapy|rehab\w*)\b/i;

/**
 * Does this prospect serve PATIENTS, as opposed to selling INTO healthcare?
 *
 * ⚠️⚠️ **THE NOUN IS THE DISCRIMINATOR, AND IT HAS TO BE.** Measured across the 36
 * healthcare-adjacent profiles on disk: nine of them genuinely sell — dental support
 * organisations selling to dentists (`customerNoun: "Doctor"`), a healthcare
 * marketing platform and a revenue-cycle business (`"Customer"`). Sales language is
 * CORRECT for those, and an industry keyword alone cannot tell them apart: "Dental
 * Support Organization" reads as healthcare either way. `customerNoun` already
 * records who the customer is, so it is the honest test.
 *
 * ⚠️⚠️ **"Hospitality" IS BLOCKED TWICE OVER, AND MEASURING THAT CORRECTED A CLAIM THIS
 * COMMENT FIRST GOT WRONG.** It said `hospital(?!ity)` was load-bearing. Tested both ways:
 * `\bhospital\b` alone already fails on "Hospitality" (the next character is a word
 * character), and `hospital(?!ity)` alone fails it with no word boundaries at all. So the
 * two guards are redundant with EACH OTHER and removing either one changes nothing —
 * which also means `audit:care` pins the OUTCOME here rather than a mechanism, and no
 * single-guard sabotage can make that check fire. What actually swept two hotel-management
 * prospects into healthcare was an exploratory scan carrying neither guard, the same
 * substring trap this repo records for "car" inside "care". Keep both.
 */
export function servesPatients(industry: string, customerNoun: string): boolean {
  if (!CARE.test(industry || "")) return false;
  return ["patient", "resident", "member"].includes((customerNoun || "").trim().toLowerCase());
}

/**
 * "New Patient Call" -> "New Patient", so it reads as an adjective in a tile title.
 * Anything that is not a `… Call` is used whole ("Residency Inquiry").
 */
function qualifier(qualifiedCallTerm: string): string {
  const t = (qualifiedCallTerm || "").trim();
  return t.replace(/\s+calls?$/i, "").trim() || "New Patient";
}

export interface QmLabels {
  opportunities: string;
  conversions: string;
  lostOpportunities: string;
  baselineScore: string;
  scorecard: string;
  scorecardAvg: string;
  fail: string;
  nonQualified: string;
}

/**
 * The QM dashboard's own wording for this prospect.
 *
 * ⚠️⚠️ **A NON-CARE PROSPECT GETS TODAY'S LITERALS BACK, CHARACTER FOR CHARACTER.**
 * That is what keeps this change scoped to the thing that was asked for: every
 * other vertical's next generation is byte-identical to its last, so nothing
 * signed off moves. `audit:care` asserts it rather than trusting it.
 */
export function qmLabels(qualifiedCallTerm: string, industry: string, customerNoun: string): QmLabels {
  if (!servesPatients(industry, customerNoun)) {
    return {
      opportunities: "Sales Opportunities",
      conversions: "Sales Conversions",
      lostOpportunities: "Calls Needing Review - Lost Sales Opportunities",
      baselineScore: "Baseline Sales Quality Score",
      scorecard: "New Customer Sales Combination Scorecard",
      scorecardAvg: "New Customer Sales Combination Scorecard (Average)",
      fail: "New Customer Sales Fail (Range & Count)",
      nonQualified: "Non-Sales Inquiries",
    };
  }
  const q = qualifier(qualifiedCallTerm);
  return {
    opportunities: `${q} Opportunities`,
    conversions: `${q} Conversions`,
    lostOpportunities: `Calls Needing Review - Lost ${q} Opportunities`,
    baselineScore: `Baseline ${q} Quality Score`,
    /* ⚠️ The "New Customer" prefix is DROPPED rather than kept, because the qualifier
       already carries it ("New Patient Combination Scorecard", not "New Customer New
       Patient Combination Scorecard"). */
    scorecard: `${q} Combination Scorecard`,
    scorecardAvg: `${q} Combination Scorecard (Average)`,
    fail: `${q} Fail (Range & Count)`,
    /* ⚠️ "Non-Sales Inquiries" negates the qualified call, so the healthcare form
       negates the same thing rather than reading "Non-Patient", which would suggest
       the caller is not a patient instead of the call not being a new-patient one. */
    nonQualified: `Non-${q} Inquiries`,
  };
}
