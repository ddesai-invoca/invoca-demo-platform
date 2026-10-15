import type { CustomerProfile } from "./schema";
import { INTENT_SALES, INTENT_SUPPORT } from "./workflowIntents";
import { intentCopyFor } from "./prospectIntent";

/* =============================================================================
   intentText.ts — the two intents' descriptions, in the prospect's industry words
   -----------------------------------------------------------------------------
   ⚠️ ITS OWN FILE TO AVOID A CYCLE: the SMS template, the voice copy and the stale-tree
   repair in `voiceUseCases.ts` all need these strings, and `smsTemplate.ts` already imports
   `voiceUseCases.ts`.
   ⚠️ The node's subtitle IS the drawer's `looksLike` (pinned by `audit:ai`), so this one
   definition is what keeps the box and its drawer saying the same thing.
   ============================================================================= */

export function smsIntentText(p: CustomerProfile): { sales: string; support: string } {
  const i = intentCopyFor(p);
  const noun = p.customerNoun.toLowerCase();
  return {
    sales: `The consumer is a new or returning ${noun} getting in touch about ${i.newNeeds}.\n\n`
      + `They are NOT: existing ${noun}s asking about something already underway (${i.supportNeeds}). `
      + `Those consumers belong in ${INTENT_SUPPORT}.`,
    support: `The consumer is an existing ${p.customerName} ${noun} getting in touch about something already underway: `
      + `${i.supportNeeds}. They may be messaging from a recognised or unrecognised number.\n\n`
      + `They are NOT: ${noun}s getting in touch about ${i.newNeeds}. Those consumers belong in ${INTENT_SALES}.`,
  };
}

export function voiceIntentSubs(p: CustomerProfile): { sales: string; support: string } {
  const i = intentCopyFor(p);
  const noun = p.customerNoun.toLowerCase();
  return {
    sales: i.newSub,
    support: `Caller is an existing ${noun} and needs help with something already in progress`,
  };
}

/* The retired one-size template, recognised so a tree or drawer text STORED from it can be
   swapped for the industry wording at read time. Exact shapes only, so an SE's own text is
   never touched. */
export const RETIRED_SMS_SALES = /^The consumer is a prospective .+ interested in starting .+ service, or an existing .+ who wants to add or upgrade what they already have\./;
export const RETIRED_SMS_SUPPORT = /^The consumer is an existing .+ reaching out about their current account or service\. They may need to reschedule, ask about billing or payments, report a concern, change or cancel their plan, or check on status\./;
export const RETIRED_VOICE_SALES = /^Caller wants to book an? .+ and is not an existing \w+$/;
export const RETIRED_VOICE_SUPPORT = /^Caller is an existing (customer|patient|resident) and needs help with something already in progress$/;
