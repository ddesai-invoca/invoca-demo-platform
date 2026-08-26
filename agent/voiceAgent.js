import { cli, defineAgent, voice, WorkerOptions } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
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
   hand the conversation to somebody else's model.
   ============================================================================= */

/** Model kept in step with the platform's own fast model (engine/chat.ts). */
const LLM_MODEL = process.env.VOICE_LLM_MODEL?.trim() || "claude-haiku-4-5";
/** Deepgram STT: nova-3 is their realtime streaming model. */
const STT_MODEL = process.env.VOICE_STT_MODEL?.trim() || "nova-3";
/** Deepgram Aura — the SAME voice the old pipeline used, now streamed. */
const TTS_MODEL = process.env.DEEPGRAM_MODEL?.trim() || "aura-2-thalia-en";

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
      stt: new deepgram.STT({ model: STT_MODEL }),
      llm: new anthropic.LLM({ model: LLM_MODEL }),
      tts: new deepgram.TTS({ model: TTS_MODEL }),
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
cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: "invoca-voice",
}));
