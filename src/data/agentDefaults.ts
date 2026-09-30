import type { CustomerProfile } from "./schema";

/* =============================================================================
   agentDefaults.ts — product defaults that overrule what the engine decided
   -----------------------------------------------------------------------------
   Asked for directly: *"in the default sms agent, never give any pricing, unless
   the user uses the ask ai feature to change but dont do it from the beginning"*.

   ⚠️⚠️ **MEASURED FIRST: 110 OF 179 PROFILES ON DISK SAID THE AGENT MAY QUOTE A
   PRICE**, including Key-Whitman Eye Center and Marriott — verticals where a
   price quoted over SMS is questionable on its own terms. `engine/core.ts` asks
   the model to judge this per prospect (`providesEstimate`), and the judgement is
   reasonable in isolation; the product decision is that the DEFAULT should be no
   pricing regardless, and an SE turns it on deliberately.

   ⚠️⚠️ **CLAMPED ON THE BASE, NOT ON THE EFFECTIVE CONFIG — that is the whole
   reason this is a separate step rather than a line in the prompt builder.** The
   Ask AI override layer is merged ON TOP of the profile, so forcing the flag
   false after the merge would also kill an SE's deliberate change and the drawer
   would report success while the agent kept refusing. Forcing it false HERE makes
   the base a plain "no", which an override can then raise — exactly the
   "unless the user uses the ask ai feature" half of the request.

   ⚠️ **NOT A DATA MIGRATION, AND DELIBERATELY SO.** Applied at READ time, the same
   place and for the same reason as `renameMarketingSources`: 110 profiles are on
   disk and ~450 more live only in the shared library, so editing files would fix
   neither the team's demos nor anything already open in a browser. The stored
   record keeps whatever the engine wrote; the app simply stops acting on it.

   ⚠️ **THE ENGINE PROMPT IS LEFT ALONE.** `providesEstimate` still means what it
   always meant and is still generated, so nothing about the prompt or the schema
   changes and the field stays available if this policy is ever relaxed. Changing
   the prompt instead would fix only prospects generated from today.
   ============================================================================= */

/**
 * The built-in SMS agent never offers a price unless somebody asks it to.
 *
 * Returns the SAME OBJECT when there is nothing to change, so this costs no
 * re-render for the 69 profiles that already said no.
 */
export function withoutDefaultPricing(p: CustomerProfile): CustomerProfile {
  const pb = p.reports?.agentConfig?.smsPlaybook;
  if (!pb || pb.providesEstimate !== true) return p;
  return {
    ...p,
    reports: {
      ...p.reports,
      agentConfig: {
        ...p.reports.agentConfig!,
        smsPlaybook: { ...pb, providesEstimate: false },
      },
    },
  };
}

/* =============================================================================
   The SMS agent does not promise a reminder text when it books (9/29/2026)
   -----------------------------------------------------------------------------
   Asked for directly: *"for use cases where the sms agent schedules the
   appointment, dont say the 'You'll get a reminder text shortly before with a
   number to call.' message"*.

   ⚠️⚠️ **FIXING THE PROMPT ALONE WOULD HAVE BEEN A NO-OP, AND THAT IS THE WHOLE
   REASON THIS FUNCTION EXISTS.** The line comes from step 5 of the SMS flow in
   `engine/chat.ts` — but it is ALSO written into every prospect's own
   `brandConversationRules`, which the prompt renders verbatim under "follow
   these". Measured: **179 of 179 profiles on disk carry it there.** Silence the
   flow and leave the rule, and the agent keeps saying it while the two halves of
   its own prompt disagree — the self-contradicting prompt this file records
   twice, and the silent no-op it records six times.

   ⚠️⚠️ **MEASURED, BY ISOLATING THE TWO HALVES AGAINST THE REAL ENDPOINT.** With
   step 5 NEUTRALISED (the promise simply removed, no prohibition) the agent
   promised a reminder **3 of 3 runs on stale data and 0 of 3 on stripped data** —
   so this strip is load-bearing rather than belt-and-braces. With both halves in
   place it is 0 of 3 either way, so the prohibition is a real backstop for
   anything that reintroduces the instruction later.
   ⚠️ **AN EARLIER READING APPEARED TO SAY THE OPPOSITE and was confounded**: putting
   the clause back into the brain produced no promise, because the prohibition was
   already in place and overriding it. **Test one half at a time, or the stronger
   guard hides whether the weaker one matters at all.**

   ⚠️ **STRIPPED AT READ TIME, NOT MIGRATED**, the same place and reasoning as
   `withoutDefaultPricing` above: 179 profiles are on disk and several hundred
   more live only in the shared library, which no local edit reaches. The stored
   record keeps what the engine wrote; the app stops acting on it, so every demo
   already saved — and every one already open in a browser — is corrected without
   regenerating anything.

   ⚠️⚠️ **THE CLAUSE IS ALWAYS TRAILING, AND THAT WAS MEASURED RATHER THAN
   ASSUMED — it is what makes a surgical cut safe.** Across all 179 rules there
   are **52 distinct phrasings** ("confirm they will receive a reminder text
   before the appointment with a number to call", "you'll get a reminder text
   beforehand with a number to call", …) and **zero** with any prose after the
   mention. So the clause is cut and the rest of the rule — confirm the ZIP,
   share a range, recommend a consultation, propose a day and time — survives
   intact. Dropping the whole RULE would take all of that with it.

   ⚠️ **SMS ONLY, BY CONSTRUCTION.** `brandConversationRules` is the SMS sales
   playbook and this file already records that it must never reach the voice
   prompt, so the voice agent is untouched without needing to be excluded.
   ============================================================================= */

/** The promise itself, in any of the phrasings the generator produced. */
const REMINDER = /\b(?:reminder\s+(?:text|message|sms|call)|text\s+reminder|reminder\s+before)\b/i;
/**
 * Where a trailing clause can begin. The NEAREST one before the mention wins, so a
 * longer list cuts LATER and therefore keeps MORE of the sentence — which is why the
 * bare connectors are here rather than just the comma forms.
 */
const CLAUSE = [", and then ", ", and ", ", then ", " and then ", " and ", " along with ", " with ", "; ", ", "];

/**
 * Cut the "you'll get a reminder text…" promise out of one string.
 * Returns the SAME STRING when it says nothing about a reminder.
 *
 * ⚠️⚠️ **IT CUTS TO THE END OF THAT SENTENCE, NOT THE END OF THE STRING, AND THAT IS
 * WHAT MAKES ONE FUNCTION SERVE BOTH CALLERS.** In a brand rule the promise is always
 * the final clause, so the two are the same thing. In an approved Q&A answer it is
 * mid-paragraph — "…at a day and time that works for you, and you will get a reminder
 * text with a number to call. When are you free?" — and cutting to the end of the
 * string would take the agent's own follow-up question with it.
 */
export function withoutReminderPromise(text: string): string {
  const m = REMINDER.exec(text);
  if (!m) return text;

  /* The sentence the promise sits in. */
  const endRel = text.slice(m.index).search(/[.!?](\s|$)/);
  const end = endRel < 0 ? text.length : m.index + endRel + 1;
  const prevBreak = text.slice(0, m.index).search(/[.!?](\s|$)(?![\s\S]*[.!?](\s|$))/);
  const start = prevBreak < 0 ? 0 : prevBreak + 1;

  /* The nearest clause boundary INSIDE that sentence. Anything earlier would cut
     away a neighbouring clause that has nothing to do with the promise. */
  let cut = -1;
  for (const sep of CLAUSE) {
    const at = text.lastIndexOf(sep, m.index);
    if (at >= start && at > cut) cut = at;
  }

  /* ⚠️ NO BOUNDARY INSIDE THE SENTENCE means the whole sentence is the promise, so the
     sentence goes rather than being left as a stub. */
  const from = cut < 0 ? start : cut;
  const joined = `${text.slice(0, from).replace(/[\s,;]+$/, "").replace(/\s+and$/i, "")}${
    cut < 0 ? "" : "."
  } ${text.slice(end).trim()}`;

  const kept = joined.replace(/\s+/g, " ").replace(/\s+([.!?,])/g, "$1").trim();
  if (kept.replace(/[.!?\s]/g, "").length <= 10) return "";
  return /[.!?]$/.test(kept) ? kept : `${kept}.`;
}

/**
 * The built-in SMS agent stops promising a reminder text when it books.
 *
 * Returns the SAME OBJECT when the prospect never carried the promise.
 */
export function withoutReminderPromises(p: CustomerProfile): CustomerProfile {
  const ac = p.reports?.agentConfig;
  if (!ac) return p;
  const rules = ac.brandConversationRules ?? [];
  const recs = ac.aiRecommendations ?? [];
  const inRules = rules.some((r) => REMINDER.test(r ?? ""));
  /* ⚠️⚠️ **THE APPROVED Q&A IS THE OTHER HALF, AND MISSING IT WOULD HAVE LEFT FOUR
     PROSPECTS CONTRADICTING THEMSELVES.** `qaPairs` is rendered into the prompt as
     "use these as ground truth", so an answer promising a reminder outranks a flow
     that no longer mentions one. Measured: 4 prospects carry such a pair. The rest of
     `aiRecommendations` never reaches the prompt and is left exactly as generated. */
  const inQa = recs.some((r) => (r.qaPairs ?? []).some((q) => REMINDER.test(q.answer ?? "")));
  if (!inRules && !inQa) return p;

  return {
    ...p,
    reports: {
      ...p.reports,
      agentConfig: {
        ...ac,
        ...(inRules
          ? { brandConversationRules: rules.map((r) => withoutReminderPromise(r ?? "")).filter((r) => r.trim().length > 0) }
          : {}),
        ...(inQa
          ? {
              aiRecommendations: recs.map((r) =>
                (r.qaPairs ?? []).some((q) => REMINDER.test(q.answer ?? ""))
                  ? { ...r, qaPairs: r.qaPairs!.map((q) => ({ ...q, answer: withoutReminderPromise(q.answer ?? "") })) }
                  : r,
              ),
            }
          : {}),
      },
    },
  };
}
