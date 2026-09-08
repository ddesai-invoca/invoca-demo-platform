import { cli, defineAgent, inference, voice, WorkerOptions } from "@livekit/agents";
import * as anthropic from "@livekit/agents-plugin-anthropic";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";

/* =============================================================================
   voiceAgent.js — the LiveKit worker behind the live Voice-agent demo
   -----------------------------------------------------------------------------
   Replaces the request/response pipeline that the Voice call used to run
   (browser SpeechRecognition -> POST /api/chat -> POST /api/tts -> play an MP3).
   MEASURED on the dev server before the switch: 1.0-1.2s for the whole Haiku reply,
   then 3.0-3.6s for the whole MP3, then playback — about 4.5-6s of silence before
   the agent said a word, because every stage waited for ALL of the one before it.
   Deepgram was never the problem; the ARCHITECTURE was. This streams end to end
   and speaks on the first sentence.

   ⚠️ **THIS RUNS AS ITS OWN PROCESS AND ITS OWN RENDER SERVICE.** It is not part of
   the web app. That is why `agent/` has its own package.json: `@livekit/agents` and
   the three plugins never reach the browser bundle, which ships as ONE file with no
   code splitting (load-bearing for the offline service worker).

   ⚠️⚠️ **THE WORKER IS DUMB ON PURPOSE — IT NEVER BUILDS A PROMPT.** Every word it
   speaks comes from `instructions` in the job metadata, minted by
   `engine/livekitToken.ts` from `voiceSystemPrompt(brain)` — the SAME function
   `/api/chat` calls. If this file built its own prompt it would need the profile, the
   vocabulary and `engine/chat.ts`, and the two would drift the first time somebody
   tuned the routing flow. One prompt, one definition. Same rule `smsBrain.ts` already
   enforces for the SMS side.

   ⚠️ **CLAUDE STAYS THE BRAIN.** `@livekit/agents-plugin-anthropic` reads the same
   `ANTHROPIC_API_KEY` the rest of the platform uses, so moving to LiveKit did not
   hand the conversation to somebody else's model. Everything else — speech in and
   speech out — comes from LiveKit's gateway, so this worker needs no provider keys
   of its own.
   ============================================================================= */

/* ⚠️⚠️ **STT AND TTS COME FROM LIVEKIT'S INFERENCE GATEWAY, NOT FROM OUR OWN KEYS**
   (asked for 8/25/2026: "don't use the Deepgram API keys, use it all from the LiveKit
   instance"). LiveKit brokers the provider and bills it, so the worker authenticates
   with LIVEKIT_API_KEY/SECRET alone and **DEEPGRAM_API_KEY is no longer read anywhere
   in this pipeline**. Note the model strings are `provider/model` — that prefix is what
   routes through the gateway, and dropping it is not the same call.

   ⚠️ **THE LLM IS THE ONE EXCEPTION, AND IT IS NOT AN OVERSIGHT.** LiveKit's inference
   gateway lists OpenAI, Google, Moonshot, DeepSeek, ZAI and xAI — **there is no
   Anthropic model in it** (checked the installed package's own `LLMModels` type, 1.7.0).
   Routing the brain through the gateway would therefore mean giving up Claude, which is
   the platform's standing rule for this agent. So the LLM keeps the direct Anthropic
   plugin on the ANTHROPIC_API_KEY the rest of the app already uses. Revisit the moment
   LiveKit adds Claude to the gateway. */

/** Kept in step with the platform's own fast model (engine/chat.ts). */
const LLM_MODEL = process.env.VOICE_LLM_MODEL?.trim() || "claude-haiku-4-5";
/** Streaming STT through LiveKit. `auto` is also valid if a prospect needs it picked. */
const STT_MODEL = process.env.VOICE_STT_MODEL?.trim() || "deepgram/nova-3";
/**
 * The default voice, NAMED — not left to the provider to choose.
 *
 * ⚠️⚠️ **`deepgram/aura-2` ON ITS OWN NAMES NO VOICE (9/3/2026).** Verified against the
 * installed SDK: `fromModelString("deepgram/aura-2")` leaves `opts.voice` undefined, so the
 * gateway picks the provider's own default and the platform's default voice was whatever that
 * happened to be. Asked for directly: "can we make the default voice Thalia". Naming it here
 * makes Thalia the default on every path — a call whose metadata carries no voice, an older
 * client, or a room created outside our own token.
 *
 * ⚠️ It stays in step with `DEFAULT_VOICE_ID` in `src/data/voiceOptions.ts`, and
 * `audit:voice` asserts the two are the same string rather than trusting this comment.
 */
const TTS_MODEL = process.env.VOICE_TTS_MODEL?.trim() || "deepgram/aura-2:thalia";

/** Read the dispatch metadata the token put on this job. */
function jobBrief(ctx) {
  /* ⚠️ ctx.job.metadata is a STRING and may be empty — a room created without our
     token (someone poking the LiveKit dashboard) has no metadata at all. Fall back to
     a neutral operator rather than throwing: a worker that crashes on a stray room
     stops serving the real ones. */
  let raw = "";
  try { raw = ctx.job?.metadata ?? ""; } catch { raw = ""; }
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    return typeof b?.instructions === "string" && b.instructions.trim() ? b : null;
  } catch {
    return null;
  }
}

/**
 * The voice this call speaks in.
 *
 * ⚠️⚠️ **THE VOICE IS PER CALL, NOT PER WORKER — that is the whole point of this helper.**
 * `TTS_MODEL` is read from the environment ONCE at process start, so before this every demo
 * on the platform shared one voice and the Details tab's picker could only ever have been
 * decoration. The token now puts the SE's choice in the job metadata beside `instructions`,
 * exactly as it already does for the greeting, and each session builds its own TTS from it.
 *
 * ⚠️ **`fromModelString` IS THE SDK'S OWN PARSER, and using it is deliberate.** The metadata
 * carries the composite "deepgram/aura-2:thalia" — the shape LiveKit's docs show — so this
 * worker holds NO table of our voices and cannot disagree with the picker about what a name
 * means. Splitting the string here by hand is how the two ends drift.
 *
 * ⚠️ **FALLS BACK RATHER THAN THROWING.** A malformed or unknown voice must not cost the call
 * its tongue: an empty room is this pipeline's worst failure and it is silent. Anything we
 * cannot parse lands on the env default, which is the voice every demo had before.
 */
function ttsFor(brief) {
  const want = typeof brief?.voice === "string" ? brief.voice.trim() : "";
  if (want) {
    try {
      return inference.TTS.fromModelString(want);
    } catch (e) {
      console.warn(`[voice-agent] unusable voice "${want}", falling back to ${TTS_MODEL}:`, e?.message ?? e);
    }
  }
  /* ⚠️ `fromModelString`, NOT the constructor. `TTS_MODEL` now carries a voice
     ("deepgram/aura-2:thalia"), and passing a composite as a bare `model` would send the
     gateway a model id that does not exist. The parser splits it; a bare env override
     ("cartesia/sonic-3") still works, it simply names no voice. */
  return inference.TTS.fromModelString(TTS_MODEL);
}

export default defineAgent({
  /* Silero VAD is loaded ONCE per worker process and shared by every job — it is a
     model file, and loading it per call would add startup latency to the very thing
     this migration exists to remove. */
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx) => {
    const brief = jobBrief(ctx);
    if (!brief) {
      console.warn("[voice-agent] job has no instructions metadata; refusing the room rather than improvising a prompt");
      return;
    }
    console.log(`[voice-agent] ${brief.customerName || "unknown"} (${brief.profileId || "-"}) room=${ctx.job?.room?.name ?? "?"}`);

    const agent = new voice.Agent({ instructions: brief.instructions });

    const session = new voice.AgentSession({
      stt: new inference.STT({ model: STT_MODEL }),
      llm: new anthropic.LLM({ model: LLM_MODEL }),
      tts: ttsFor(brief),
      vad: ctx.proc.userData.vad,
    });

    await session.start({ agent, room: ctx.room });

    /* ⚠️ THE AGENT SPEAKS FIRST, and it must. The old pipeline opened with a greeting
       and the demo's whole first beat is the agent answering the phone; without this
       the SE says hello into silence and the call reads as broken. */
    const greeting = (brief.greeting || "").trim();
    await session.generateReply(
      greeting
        ? { instructions: `Open the call by saying exactly: ${greeting}` }
        : { instructions: "Greet the caller and ask how you can help." },
    );
  },
});

/* `agentName` MUST match AGENT_NAME in engine/livekitToken.ts — the token dispatches
   by name, and a mismatch means no agent ever joins and the caller hears nothing. */
/* ⚠️ THE SAME VARIABLE THE TOKEN USES. `engine/appEnv.ts` derives it from the environment so
   a staging web service and a staging worker pair up without either touching production; this
   side cannot import that module (the worker is a standalone deployed image), so it reads the
   var directly and falls back to the identical production default. `audit:voice` asserts the
   two defaults match, because a mismatch means no agent joins and the caller hears silence. */
cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.VOICE_AGENT_NAME?.trim() || "invoca-voice",
}));
