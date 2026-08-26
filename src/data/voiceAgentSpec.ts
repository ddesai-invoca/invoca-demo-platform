import { isProspect } from "./prospect";

/* =============================================================================
   voiceAgentSpec.ts — a prospect's own Qualify-and-Route configuration
   -----------------------------------------------------------------------------
   The voice workflow's CONTENT for one prospect: what the intent looks like, how the agent
   opens the call, the qualifying question and its answers, and the routing steps including
   the service-area check.

   ⚠️ **WHY AN OVERRIDE TABLE RATHER THAN GENERATED DATA.** Everything else on this screen is
   derived per prospect, and for most of them derivation is right — it costs no generation time
   and every demo on disk gets it. But an SE configuring a real agent types THESE words: the
   exact greeting, the exact ZIP codes, the exact sentence read to a caller outside the service
   area. Deriving those would be inventing them. Same pattern and same matcher as `SHAPE` and
   `SMS_SHAPE` in AgentWorkflow: keyed by prospect NAME through `isProspect`, never a guessed
   id, because these demos live in the shared library and their ids are whatever the SE typed.

   ⚠️ **A PROSPECT WITHOUT A SPEC IS UNAFFECTED.** `voiceSpecFor` returns null and every screen
   falls back to what it derived before, so this adds nothing to the other prospects and
   nothing to generation time.
   ============================================================================= */

export interface VoiceAgentSpec {
  /** Matched with `isProspect`, so any id the SE typed still resolves. */
  prospect: string;
  /** "What does this intent look like?" — the description AND the opening line. */
  intent: string;
  /** What the agent says first. Also the last of the conversation rules, as the real one has it. */
  greeting: string;
  /** The Qualify leaf's question. */
  qualifyQuestion: string;
  /** Its answers, which are also the two path nodes on the row below. */
  segments: [string, string];
  /** What the agent says when it cannot tell which answer it heard. */
  qualifyFallback: string;
  /** The intent's conversation rules, in order. */
  rules: string[];
  /**
   * ⚠️ **AN ALLOW-LIST, WHICH INVERTS THE DEMO GATE.** The generic voice prompt treats a single
   * ZIP ("12345") as the only OUT-of-area one, so every other ZIP proceeds — right for a
   * national business. This prospect serves three ZIPs and turns everything else away, so the
   * polarity is the other way round and `buildVoiceSystem` has to be told which it is.
   */
  serviceZips?: string[];
  /** Read verbatim to a caller outside the service area. */
  outOfAreaScript?: string;
  /** The Inform & Route steps, verbatim, in the SE's own numbering. */
  informSteps: string[];
}

/**
 * COMFORT KEEPERS — in-home senior care, franchised, and the caller is usually a family
 * member rather than the person receiving care. Both halves of the qualifying question matter
 * to them: arranging care AND caregiver recruitment, which is why the intent covers job
 * seekers as well as clients.
 */
const COMFORT_KEEPERS: VoiceAgentSpec = {
  prospect: "comfort keepers",
  intent:
    "The caller is reaching out about Comfort Keepers' home care services, either as a prospective client or family member interested in arranging care for themselves or a loved one, or as a job seeker interested in becoming a caregiver/employee.\n\n"
    + "This is how you should also greet and start a phone call: Hi, thanks for calling Comfort Keepers, I'm here to help. Are you looking to arrange care services for yourself or a loved one, or are you interested in becoming a caregiver with us?",
  greeting:
    "Hi, thanks for calling Comfort Keepers, I'm here to help. Are you looking to arrange care services for yourself or a loved one, or are you interested in becoming a caregiver with us?",
  qualifyQuestion:
    "Are you interested in arranging care services, or are you looking to become a caregiver with us?",
  segments: ["Looking for care services", "Interested in becoming a caregiver"],
  qualifyFallback:
    "I want to make sure I connect you with the right team. Are you looking to arrange care services for yourself or a loved one, or are you interested in becoming a caregiver with us?",
  rules: [
    "If the caller is a prospective client or family member inquiring about care services, acknowledge their situation warmly (e.g. \"I'd be happy to help you find the right care\") before asking any qualifying questions. Many callers are inquiring on behalf of an aging parent or family member and are dealing with a difficult situation.",
    "If the caller is inquiring about caregiver employment, respond professionally and briefly acknowledge that Comfort Keepers is always looking for compassionate caregivers before moving to next steps.",
    "As soon as this intent is recognized, determine whether the caller is looking to arrange care services or is interested in becoming a caregiver, so the conversation can proceed down the correct path.",
    "When asking for the caller's zip code, explain that it's used to connect them with their local Comfort Keepers office.",
    "If asked about cost or pricing, do not provide specific numbers. Acknowledge that pricing varies by service type and location, and let the caller know the local team will cover exact pricing.",
    "This is how you should also greet and start a phone call: Hi, thanks for calling Comfort Keepers, I'm here to help. Are you looking to arrange care services for yourself or a loved one, or are you interested in becoming a caregiver with us?",
  ],
  serviceZips: ["30097", "30096", "30095"],
  outOfAreaScript:
    "Thank you for calling Comfort Keepers. Unfortunately, we don't currently serve your area, but we'd encourage you to check back with us in the future or visit comfortkeepers.com to find a nearby location.",
  /* ⚠️ VERBATIM, INCLUDING THE ORDERING. Step 3 says to turn an out-of-area caller away and
     step 5 supplies the words for it, which reads out of sequence — but it is the SE's own
     configuration and tidying it would be editing their agent rather than replicating it. */
  informSteps: [
    "1. Ask the caller for their zip code and capture it.",
    "2. Check the zip code against our current service area: 30097, 30096, 30095.",
    "3. If the zip code falls outside 30097, 30096, or 30095, politely inform the caller that we do not yet serve their area and end the call.",
    "4. If the zip code falls within our service area, ask the caller for their full name and capture it.",
    "5. If zip code does not fall within our service area say: Thank you for calling Comfort Keepers. Unfortunately, we don't currently serve your area, but we'd encourage you to check back with us in the future or visit comfortkeepers.com to find a nearby location.",
    "6. If the caller does not provide their full name, ask again before proceeding. Do not route the call without a captured full name.",
  ],
};

const SPECS: VoiceAgentSpec[] = [COMFORT_KEEPERS];

/** This prospect's voice-agent spec, or null when it has none and everything derives as before. */
export function voiceSpecFor(profile: { id: string; customerName: string }): VoiceAgentSpec | null {
  return SPECS.find((s) => isProspect(profile, s.prospect)) ?? null;
}
