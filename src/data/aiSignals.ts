import type { CISignal } from "./schema";

/* =============================================================================
   Signals that only make sense when a HUMAN answered the call
   -----------------------------------------------------------------------------
   Asked for 9/3/2026, pointing at "(QA) Proper Greeting" and "(QA) Proper Close" in the AI
   SMS report's MET SIGNALS rail: "the AI SMS or Voice conversation report doesn't need QA
   signals as there is no human agent involved."

   ⚠️ **THE (QA) PREFIX IS INVOCA'S OWN MARKER FOR AGENT-QUALITY SCORING** — the category a
   supervisor grades a rep against, and the same names appear on the Call Review scorecard.
   Scoring an AI agent on whether it remembered to greet the caller is measuring the prompt,
   not the conversation: it passes on every single call by construction, so it takes a row in
   the rail and tells an SE nothing. Worse, it implies a human was on the line in a report
   whose whole point is that nobody was.

   ⚠️⚠️ **THIS FILTERS AT THE RENDER BOUNDARY ON PURPOSE, NOT ONLY IN THE PROMPTS.** The
   generation prompts were fixed in the same commit, but eleven demos in
   `src/data/generated/` and every live record in `.data/demos/` were already generated WITH
   these signals, and a prompt change cannot reach them. Filtering where the two screens read
   their conversations corrects every existing demo, the live records, and anything a stale
   `/api/analyze` returns, with no regeneration and no data migration.

   ⚠️ **WHO MUST NOT IMPORT THIS:** `ConversationIntelligence.tsx`, `CallReview.tsx` and the
   scorecard. Those screens are about a call a PERSON took, where agent-quality scoring is the
   entire subject — the Call Review scorecard grades "(QA) Proper Close" as 0/10 and that miss
   is the story it tells. `insightsCatalog.ts` keeps them too: it is the catalogue of signals
   an account HAS, not the ones one AI conversation hit. Two readers, deliberately.
   ============================================================================= */

/**
 * Is this a human-agent quality signal?
 *
 * Matches Invoca's `(QA)` category prefix rather than the two names seen so far, so a demo
 * generated with "(QA) Commitment to Help" (which `insightsCatalog` also lists) is caught
 * without another edit here. Tolerant of leading space and case; deliberately NOT a substring
 * match, so a signal that merely mentions quality somewhere in its name survives.
 */
export function isAgentQaSignal(name: string): boolean {
  return /^\s*\(qa\)/i.test(name);
}

/**
 * Drop human-agent quality signals from every conversation in an AI report.
 *
 * ⚠️ Returns the SAME array and the same objects when nothing matches. The two screens
 * compute this on every render and hold `selectedId` against `conversation.id`, so allocating
 * fresh objects per render would be pure churn.
 */
export function withoutAgentQaSignals<T extends { signals: CISignal[] }>(list: T[]): T[] {
  if (!list.some((c) => c.signals.some((s) => isAgentQaSignal(s.name)))) return list;
  return list.map((c) =>
    c.signals.some((s) => isAgentQaSignal(s.name))
      ? { ...c, signals: c.signals.filter((s) => !isAgentQaSignal(s.name)) }
      : c,
  );
}
