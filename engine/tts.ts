/* =============================================================================
   tts.ts — premium text-to-speech for the live Voice agent
   -----------------------------------------------------------------------------
   Turns the agent's reply text into human-sounding speech. Called server-side
   from the /api/tts dev endpoint so the provider key never reaches the browser.
   Returns MP3 bytes; the VoiceCall client plays them and falls back to the
   browser voice if this is unavailable (no key / error), so the demo is never
   silent.

   Two providers are supported, chosen by /api/tts (via TTS_PROVIDER, or auto:
   Deepgram if its key is present, else ElevenLabs):
     • Deepgram Aura-2  — fast, natural voices built for realtime voice agents
     • ElevenLabs       — flagship multilingual v2, most lifelike

   Voices/models are overridable via env (DEEPGRAM_MODEL, ELEVENLABS_VOICE_ID /
   ELEVENLABS_MODEL_ID); pick any from the provider's dashboard.
   ============================================================================= */

const DEEPGRAM_DEFAULT_MODEL = "aura-2-thalia-en";     // Aura-2 — clear, warm, natural
const ELEVEN_DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" — warm, professional
const ELEVEN_DEFAULT_MODEL_ID = "eleven_multilingual_v2"; // flagship quality

export type TtsProvider = "deepgram" | "elevenlabs";

export interface TtsConfig {
  text: string;
  provider: TtsProvider;
  deepgram?: { apiKey: string; model?: string };
  elevenlabs?: { apiKey: string; voiceId?: string; modelId?: string };
}

export async function synthesize(cfg: TtsConfig): Promise<Uint8Array> {
  const text = (cfg.text || "").trim();
  if (!text) throw new Error("tts: text is required");

  if (cfg.provider === "deepgram") {
    if (!cfg.deepgram?.apiKey) throw new Error("DEEPGRAM_API_KEY is not set.");
    return ttsDeepgram(text, cfg.deepgram.apiKey, cfg.deepgram.model);
  }
  if (!cfg.elevenlabs?.apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");
  return ttsElevenLabs(text, cfg.elevenlabs.apiKey, cfg.elevenlabs.voiceId, cfg.elevenlabs.modelId);
}

/* Deepgram Aura — POST /v1/speak?model=... with { text }. Defaults to MP3 out. */
async function ttsDeepgram(text: string, apiKey: string, model?: string): Promise<Uint8Array> {
  const m = model?.trim() || DEEPGRAM_DEFAULT_MODEL;
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(m)}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`Deepgram TTS failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error("Deepgram TTS returned empty audio.");
  return buf;
}

/* ElevenLabs — POST /v1/text-to-speech/{voice}. */
async function ttsElevenLabs(text: string, apiKey: string, voiceId?: string, modelId?: string): Promise<Uint8Array> {
  const vid = voiceId?.trim() || ELEVEN_DEFAULT_VOICE_ID;
  const mid = modelId?.trim() || ELEVEN_DEFAULT_MODEL_ID;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: mid,
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    }
  );
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error("ElevenLabs TTS returned empty audio.");
  return buf;
}
