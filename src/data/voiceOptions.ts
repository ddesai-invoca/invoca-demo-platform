/* =============================================================================
   The voices an SE can give the voice agent — ONE definition, four readers
   -----------------------------------------------------------------------------
   Read by the Details tab's picker, by `/api/tts` (which validates against it before
   spending our Deepgram key), by `mintVoiceToken` (which turns a choice into the string
   the worker speaks with) and by the audit. Four copies of this list would drift on the
   first voice anybody added, and the symptom would be a picker offering a voice the call
   cannot produce.

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

   ⚠️ **TWO ID FORMATS, AND BOTH ARE REAL — do not "tidy" them into one.**
     - Deepgram's REST API (the play button) wants the full `aura-2-<name>-en`.
     - LiveKit Inference wants provider/model plus a voice, which its SDK also accepts as
       the composite `deepgram/aura-2:<name>` — the exact shape LiveKit's docs show
       (`deepgram/aura-2:apollo`) and what `inference.TTS.fromModelString()` parses.
   Both are derived from one entry here, so the voice an SE previews is by construction
   the voice the call uses.
   ============================================================================= */

export interface VoiceOption {
  /** The short id we store on the agent config, e.g. "thalia". */
  id: string;
  /** What the picker shows, matching the real page's "Thalia (Deepgram Aura 2)". */
  label: string;
  /** Deepgram's own model id — the play button's preview goes through this. */
  deepgramModel: string;
  /** Deepgram's own one-line character description, shown under the picker. */
  note: string;
  gender: "Feminine" | "Masculine";
}

/** The provider + model half of the LiveKit Inference string; the voice is appended. */
const LK_MODEL = "deepgram/aura-2";

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "thalia",
    label: "Thalia (Deepgram Aura 2)",
    deepgramModel: "aura-2-thalia-en",
    note: "Clear, confident, energetic — Deepgram's own pick for casual chat and IVR.",
    gender: "Feminine",
  },
  {
    id: "andromeda",
    label: "Andromeda (Deepgram Aura 2)",
    deepgramModel: "aura-2-andromeda-en",
    note: "Casual and expressive, suited to customer service.",
    gender: "Feminine",
  },
  {
    id: "arcas",
    label: "Arcas (Deepgram Aura 2)",
    deepgramModel: "aura-2-arcas-en",
    note: "Natural and smooth, clear and comfortable for service roles.",
    gender: "Masculine",
  },
  {
    id: "harmonia",
    label: "Harmonia (Deepgram Aura 2)",
    deepgramModel: "aura-2-harmonia-en",
    note: "Empathetic, clear and calm, for customer service.",
    gender: "Feminine",
  },
  {
    id: "neptune",
    label: "Neptune (Deepgram Aura 2)",
    deepgramModel: "aura-2-neptune-en",
    note: "Professional, patient and polite.",
    gender: "Masculine",
  },
  {
    id: "athena",
    label: "Athena (Deepgram Aura 2)",
    deepgramModel: "aura-2-athena-en",
    note: "Calm, smooth and professional, with a mature tone.",
    gender: "Feminine",
  },
];

/**
 * The voice used when a demo has never chosen one.
 *
 * ⚠️ **THALIA IS NOT AN ARBITRARY DEFAULT** — it is what `engine/tts.ts` has always sent
 * to Deepgram (`DEEPGRAM_DEFAULT_MODEL`) and what the worker's `deepgram/aura-2` resolves
 * to, so an untouched demo sounds exactly as it did before this picker existed. Changing
 * it would silently re-voice every demo on the platform.
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

/** The Deepgram model the play button previews with, e.g. "aura-2-thalia-en". */
export function previewModel(id: string | undefined | null): string {
  return voiceOption(id).deepgramModel;
}

/**
 * Is this a Deepgram model we are willing to spend our own key on?
 *
 * ⚠️ `/api/tts` takes a model from the BROWSER now, so without this the endpoint is an
 * open Deepgram proxy on our key — any model, any voice, for anyone who can reach the
 * page. It is an allow-list of exactly the six voices the picker offers.
 */
export function isAllowedPreviewModel(model: string | undefined | null): boolean {
  return !!model && VOICE_OPTIONS.some((v) => v.deepgramModel === model.trim());
}
