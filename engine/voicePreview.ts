import { AccessToken } from "livekit-server-sdk";
import { VOICE_OPTIONS, isKnownVoice, liveKitVoiceModel } from "../src/data/voiceOptions.ts";

/* =============================================================================
   voicePreview.ts — auditioning a voice, 100% through LiveKit
   -----------------------------------------------------------------------------
   Powers the play button beside the Details tab's voice picker. This REPLACED
   `engine/tts.ts`, which called `api.deepgram.com` and `api.elevenlabs.io` directly with
   their own API keys.

   ⚠️⚠️ **WHY IT WAS REPLACED RATHER THAN KEPT AS A SECOND PATH (9/3/2026).** Asked for
   directly: "completely delete everything related to elevenlabs or deepgram... everything to
   do with Voice agents has to go through LiveKit." Beyond the vendor decision there was a real
   defect in having two paths: the preview went to Deepgram DIRECT while the call went through
   LiveKit's gateway, so the button could audition a voice the call would not produce. Now the
   preview and the call send the **same model string** to the **same gateway**, and can only
   diverge if LiveKit itself is inconsistent with itself.

   ⚠️ **NO NEW DEPENDENCY, AND THAT WAS MEASURED RATHER THAN ASSUMED.** The obvious route is
   `inference.TTS` from `@livekit/agents` — the class the worker uses. Adding it to the WEB
   server costs 26 MB plus the OpenTelemetry exporter stack and `@livekit/local-inference`, a
   partly-native tree, on a service whose job is serving demo screens; a native install failure
   on Render would break the whole app for the sake of one button. So this speaks the gateway's
   own protocol with `livekit-server-sdk` (already a dependency) for auth and Node's BUILT-IN
   WebSocket.

   ⚠️ **THE HANDSHAKE USES `?access_token=`, WHICH IS WHY NO `ws` PACKAGE IS NEEDED.** The SDK
   authenticates with an `Authorization: Bearer` HEADER, and Node's built-in WebSocket cannot
   set headers. Verified against the live gateway: a query-param `access_token` is accepted and
   a `token` param is rejected, so the name matters and is not a guess.

   ⚠️⚠️ **THE FRAME SHAPES ARE READ OFF THE SDK'S OWN COMPILED CLIENT, NOT A PUBLISHED SPEC —
   so state the blast radius.** If LiveKit changes this wire format, the PLAY BUTTON breaks and
   says so; **the call does not**, because the deployed worker uses the real SDK. That
   asymmetry is the whole reason this shortcut is acceptable here and would not be acceptable
   in the worker.
   ============================================================================= */

/** Mirrors the SDK's own default, including its staging switch. */
function gatewayUrl(livekitUrl?: string): string {
  const explicit = process.env.LIVEKIT_INFERENCE_URL?.trim();
  if (explicit) return explicit;
  return (livekitUrl ?? process.env.LIVEKIT_URL ?? "").includes(".staging.livekit.cloud")
    ? "https://agent-gateway.staging.livekit.cloud/v1"
    : "https://agent-gateway.livekit.cloud/v1";
}

export interface PreviewEnv {
  apiKey: string;
  apiSecret: string;
  /** Only used to decide staging vs production gateway. */
  url?: string;
}

/** What the gateway returns, and therefore what the WAV header must declare. */
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const ENCODING = "pcm_s16le";
/** A three-word line takes ~1.3s; ten is generous and still fails inside a demo's patience. */
const TIMEOUT_MS = 10_000;

/**
 * Wrap raw PCM in a 44-byte WAV header.
 *
 * ⚠️ The gateway returns HEADERLESS pcm_s16le, which no browser will play. This is the whole
 * reason the endpoint does not just forward the bytes. WAV rather than MP3 because that needs
 * no encoder: ~40 KB for a three-word preview, which is irrelevant at this length.
 */
function toWav(pcm: Uint8Array): Uint8Array {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * 2, 32); // block align
  header.writeUInt16LE(16, 34);           // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/**
 * Synthesize one short line in one of the voices the picker offers, and return WAV bytes.
 *
 * Throws with a readable message; the endpoints turn that into JSON so the Details tab can
 * say WHY rather than leaving a dead button.
 */
export async function synthesizePreview(
  opts: { voice: string; text: string },
  env: PreviewEnv,
): Promise<Uint8Array> {
  /* ⚠️ ALLOW-LIST THE VOICE. This is reachable from a browser and spends LiveKit inference,
     so it may only ever synthesize one of the voices the picker actually offers. */
  if (!isKnownVoice(opts.voice)) {
    throw new Error(`Unsupported voice: ${opts.voice}. Known: ${VOICE_OPTIONS.map((v) => v.id).join(", ")}`);
  }
  const text = opts.text.trim();
  if (!text) throw new Error("text is required.");
  /* A preview is a few words. Capping it keeps this from being a general TTS service on our
     LiveKit account, whatever a caller posts. */
  if (text.length > 200) throw new Error("Preview text must be 200 characters or fewer.");

  const [model, voice] = liveKitVoiceModel(opts.voice).split(":");

  const at = new AccessToken(env.apiKey, env.apiSecret, { identity: "voice-preview", ttl: 60 });
  at.addInferenceGrant({ perform: true });
  const token = await at.toJwt();

  const base = gatewayUrl(env.url).replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/tts?access_token=${encodeURIComponent(token)}`);

  const chunks: Buffer[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* already closing */ }
        reject(new Error("The voice service did not answer in time."));
      }, TIMEOUT_MS);
      const finish = (err?: Error) => {
        clearTimeout(timer);
        try { ws.close(); } catch { /* already closing */ }
        err ? reject(err) : resolve();
      };

      ws.onopen = () => {
        const generation_config = { model, voice };
        ws.send(JSON.stringify({
          type: "session.create",
          sample_rate: String(SAMPLE_RATE),
          encoding: ENCODING,
          extra: {},
          model,
          voice,
        }));
        /* The trailing space is what the SDK sends too — the gateway tokenizes per push. */
        ws.send(JSON.stringify({ type: "input_transcript", transcript: `${text} `, generation_config, extra: {} }));
        ws.send(JSON.stringify({ type: "session.flush" }));
      };

      ws.onmessage = (m: MessageEvent) => {
        let ev: { type?: string; audio?: string; error?: unknown };
        try {
          ev = JSON.parse(typeof m.data === "string" ? m.data : new TextDecoder().decode(m.data as ArrayBuffer));
        } catch { return; }
        if (ev.type === "output_audio" && ev.audio) chunks.push(Buffer.from(ev.audio, "base64"));
        else if (ev.type === "done") finish();
        else if (ev.type === "error") finish(new Error(`The voice service refused: ${JSON.stringify(ev.error).slice(0, 200)}`));
      };

      /* ⚠️ A CLOSE BEFORE `done` IS A FAILURE, NOT A COMPLETION. Resolving on close would
         return whatever partial audio had arrived, so a rejected model would play as a
         fraction of a word rather than reporting itself. */
      ws.onclose = () => finish(chunks.length ? undefined : new Error("The voice service closed the connection before sending any audio."));
      ws.onerror = () => finish(new Error("Could not reach the voice service."));
    });
  } finally {
    try { ws.close(); } catch { /* already closed */ }
  }

  const pcm = Buffer.concat(chunks);
  if (!pcm.byteLength) throw new Error("The voice service returned no audio.");
  return toWav(pcm);
}
