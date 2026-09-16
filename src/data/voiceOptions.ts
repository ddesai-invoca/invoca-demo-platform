/* =============================================================================
   The voices an SE can give the voice agent — ONE definition, four readers
   -----------------------------------------------------------------------------
   Read by the Details tab's picker, by `engine/voicePreview.ts` (the play button, which
   allow-lists against it before spending LiveKit inference), by `mintVoiceToken` (which turns
   a choice into the string the worker speaks with) and by the audit. Four copies of this list
   would drift on the first voice anybody added, and the symptom would be a picker offering a
   voice the call cannot produce.

   ⚠️⚠️ **"EVERY VOICE AVAILABLE IN LIVEKIT" IS NOT AN ENUMERABLE SET, so this is a
   deliberate snapshot rather than a lookup.** LiveKit Inference brokers seven TTS
   providers (Cartesia, Deepgram, ElevenLabs, Rime, Inworld, xAI, Fish Audio — the list
   in `@livekit/agents@1.7.0`'s own `inference/tts.d.ts`), and it publishes **no endpoint
   or CLI that lists their voices** — confirmed against LiveKit's docs, which say each
   provider's catalogue lives in that provider's own documentation. ElevenLabs ids are
   per-account UUIDs on top of that. So any list we show is hand-maintained, and the
   honest thing is to keep it short, real, and verified.

   ⚠️ **THE SIX ARE THE USER'S OWN PICK** (9/3/2026), and they are one coherent set: all
   Deepgram Aura-2, all American English, all voices Deepgram itself describes for
   customer service or IVR. Every id below is copied from Deepgram's published Aura-2
   table, not typed from memory — a wrong id is a call that connects and then cannot
   speak.

   ⚠️ **ONE ID FORMAT NOW, AND THAT IS THE POINT (9/3/2026).** An earlier version carried a
   second `deepgramModel` (`aura-2-<name>-en`) because the play button called Deepgram's REST
   API directly. Both vendors are gone: the preview and the call now send the SAME
   `deepgram/aura-2:<name>` string to the SAME LiveKit gateway, so they cannot audition one
   voice and place a call in another. `deepgram` here is a MODEL NAME inside LiveKit's
   inference gateway — not a vendor we hold a credential for.
   ============================================================================= */

export interface VoiceOption {
  /** The short id we store on the agent config, e.g. "thalia". */
  id: string;
  /** ⚠️⚠️ **THE VOICE'S NAME ALONE — a deliberate departure from the screenshot (9/16/2026).**
     These read "Thalia (Deepgram Aura 2)" on the real page and did here too, until it was
     asked for directly: *"For the Agent Voice dropdown, remove the vendor name and just keep
     the Name of the voice."* The model and the provider are plumbing an SE does not choose —
     the six are all Aura-2 either way, so the suffix was six identical parentheticals — and a
     third party's brand on a picker mid-demo invites a question the demo is not about.
     ⚠️ **DISPLAY ONLY.** `id` is what is stored, allow-listed and sent to the gateway, so
     nothing about the call changes with this string; `audit:voice` asserts the label still
     begins with the id so the two cannot drift apart. */
  label: string;
  /** ⚠️ **THE CHARACTER LINE, AND IT NAMES NO VENDOR EITHER (9/16/2026).** Asked for straight
     after the labels: *"remove deepgram wording for everywhere."* It renders directly under
     the picker, so a vendor's name here put back on screen exactly what the labels had just
     dropped. The descriptions are still the provider's own words about each voice; only the
     attribution is gone. `audit:voice` scans these as well as the labels. */
  note: string;
  gender: "Feminine" | "Masculine";
}

/** The provider + model half of the LiveKit Inference string; the voice is appended. */
const LK_MODEL = "deepgram/aura-2";

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "thalia",
    label: "Thalia",
    note: "Clear, confident, energetic — made for casual chat and IVR.",
    gender: "Feminine",
  },
  {
    id: "andromeda",
    label: "Andromeda",
    note: "Casual and expressive, suited to customer service.",
    gender: "Feminine",
  },
  {
    id: "arcas",
    label: "Arcas",
    note: "Natural and smooth, clear and comfortable for service roles.",
    gender: "Masculine",
  },
  {
    id: "harmonia",
    label: "Harmonia",
    note: "Empathetic, clear and calm, for customer service.",
    gender: "Feminine",
  },
  {
    id: "neptune",
    label: "Neptune",
    note: "Professional, patient and polite.",
    gender: "Masculine",
  },
  {
    id: "athena",
    label: "Athena",
    note: "Calm, smooth and professional, with a mature tone.",
    gender: "Feminine",
  },
];

/**
 * The voice used when a demo has never chosen one.
 *
 * ⚠️ **THALIA IS NOT AN ARBITRARY DEFAULT** — it is what the worker's bare `deepgram/aura-2`
 * resolves to, and what the retired TTS layer sent for months, so an untouched demo sounds
 * exactly as it did before this picker existed. Changing it silently re-voices every demo on
 * the platform, which `audit:voice` asserts against the worker's own fallback model.
 */
export const DEFAULT_VOICE_ID = "thalia";

/** The chosen voice, or the default when the id is absent or not one we offer. */
export function voiceOption(id: string | undefined | null): VoiceOption {
  const hit = id ? VOICE_OPTIONS.find((v) => v.id === id.trim().toLowerCase()) : undefined;
  return hit ?? VOICE_OPTIONS.find((v) => v.id === DEFAULT_VOICE_ID)!;
}

/**
 * ⚠️ **VALIDATE ON READ, because this field is AI-writable.** `agent.voice` sits in the
 * object the workflow page registers as its Ask AI scope, so the model can write it —
 * and an invented id ("british-male") would reach the worker and leave a call that
 * connects and never speaks. Every reader goes through `voiceOption`, so an unknown id
 * degrades to the default instead of breaking the demo. Same instruct-then-enforce
 * pairing as the dash sweep and the placeholder rule.
 */
export function isKnownVoice(id: string | undefined | null): boolean {
  return !!id && VOICE_OPTIONS.some((v) => v.id === id.trim().toLowerCase());
}

/** The string the LiveKit worker speaks with, e.g. "deepgram/aura-2:thalia". */
export function liveKitVoiceModel(id: string | undefined | null): string {
  return `${LK_MODEL}:${voiceOption(id).id}`;
}


