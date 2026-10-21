/* =============================================================================
   test-call.ts — place a REAL voice call to the agent, with a synthetic caller
   -----------------------------------------------------------------------------
   Asked for 10/14/2026: *"i really need to find a way for you to test voice call"*.

   The browser pane has no microphone, and `/api/chat` only tests the BRAIN. This joins a real
   LiveKit room exactly as Preview Workflow does (same `/api/livekit-token`, same dispatch, the
   same deployed worker), SPEAKS the caller's lines as audio through LiveKit's own TTS, and
   LISTENS to the agent's audio through LiveKit's own STT. So it exercises everything a phone
   call does: the token, dispatch, the worker, its STT of a human voice, the LLM, its TTS, and
   turn-taking, and it measures how long the agent takes to answer.

     npx tsx agent/test-call.ts <profile-or-demo-id> "line one" "line two" ...
     npx tsx agent/test-call.ts <id> --sim "You are Maria, a new patient who needs a cardiologist..."
     npx tsx agent/test-call.ts <id> --sim-file personas.txt     (one persona per line, one call each)

   Options: --voice=arcas (the caller's voice), --max-turns=10, --json (machine-readable log).

   ⚠️ NEEDS `npm run dev` RUNNING: the token comes from the dev server, exactly like the app.
   ⚠️ IT TALKS TO THE DEPLOYED WORKER. Local uses the production agent name (see
   `voiceAgentName`), so this is the same agent a prospect gets, and each call bills LiveKit
   minutes. The room is torn down at the end; the worker ends its session when the caller leaves.
   ⚠️ "AGENT SAID" is the worker's own transcript (`lk.transcription`); "HEARD" is what LiveKit's
   STT made of the agent's AUDIO. If they disagree, the problem is in the audio, not the words.
   ============================================================================= */
import { readFileSync, existsSync } from "node:fs";
import { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioStream, AudioFrame, TrackKind, dispose } from "@livekit/rtc-node";
import { inference, initializeLogger } from "@livekit/agents";
import { voiceSpecFor, specWithConfig, DEFAULT_SUPPORT_QUALIFY_QUESTION } from "../src/data/voiceAgentSpec.ts";
import { treeToVoicePaths } from "../src/data/voicePaths.ts";
import { serviceAreaFor } from "../src/data/serviceArea.ts";

initializeLogger({ pretty: false, level: "error" });

const BASE = process.env.TEST_CALL_BASE ?? "http://localhost:5173";
const args = process.argv.slice(2);
const id = args[0];
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name: string) => args.includes(`--${name}`);
if (!id || id.startsWith("--")) {
  console.log(`usage: npx tsx agent/test-call.ts <profile-or-demo-id> "line" ... | --sim "persona"`);
  process.exit(1);
}
const MAX_TURNS = Number(flag("max-turns") ?? 10);
const CALLER_VOICE = `deepgram/aura-2:${flag("voice") ?? "arcas"}`;

/* ── the brain, rebuilt the way the voice workflow page builds it ───────────────────────── */
/* ⚠️ A library demo carries its own override layer; a bundled profile has none. Same logic as
   `scripts/demo-voice-sim.ts`, plus the noun and intent the prompt now reads. */
const VOICE_PATH = "/agent-studio/agent/workflow/voice";
const AGENT_PATH = "/agent-studio/agent/preview";
const demoFile = `${process.env.DATA_DIR ?? ".data"}/demos/${id}.json`;
const bundled = `src/data/generated/${id}.json`;
const record = existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, "utf8"))
  : existsSync(bundled) ? { profile: JSON.parse(readFileSync(bundled, "utf8")) } : null;
if (!record) { console.log(`no demo or profile "${id}"`); process.exit(1); }
const p = record.profile;
const ov = record.customizations?.overrides ?? {};
/* `--overrides=file.json` lays a saved override layer over the demo, e.g. one exported from a
   browser's Ask AI state, so a call can test an edit that has not been saved to a demo yet. */
if (flag("overrides")) Object.assign(ov, JSON.parse(readFileSync(flag("overrides")!, "utf8")));
const tree = ov[VOICE_PATH];
const ac = { ...(p.reports.agentConfig ?? {}), ...(ov[AGENT_PATH] ?? {}) };
const spec = specWithConfig(voiceSpecFor(p)!, tree?.agent);
const brain = {
  customerName: p.customerName, industry: p.industry, customerNoun: p.customerNoun, intentKind: p.intentKind,
  rules: ac?.brandConversationRules ?? [],
  qaPairs: ac?.aiRecommendations?.find((r: { qaPairs?: unknown[] }) => r.qaPairs?.length)?.qaPairs ?? [],
  knowledge: (ac?.knowledgeSources ?? []).map((k: { name: string }) => k.name),
  playbook: ac?.smsPlaybook,
  serviceArea: ac?.serviceArea,
  voicePaths: treeToVoicePaths(tree, p),
  serviceZips: spec?.serviceZips, outOfAreaScript: spec?.outOfAreaScript,
  /* The real service area, as Preview Workflow sends it (voiceSession.ts). */
  coverage: serviceAreaFor(p, { zips: spec?.serviceZips }),
  voiceGreeting: spec?.greeting, voiceQualify: spec?.qualifyQuestion,
  voiceSupportQualify: spec?.supportQualifyQuestion ?? DEFAULT_SUPPORT_QUALIFY_QUESTION,
  voiceRules: spec?.rules, voiceSteps: spec?.informSteps,
  /* The team list Preview Workflow sends (`voiceSession.ts`), or the agent names a generic
     "new enquiries team" the app never would. */
  voiceRouting: (() => {
    const q = p.reports.voiceRoutingDemo?.queues ?? [];
    if (!q.length) return undefined;
    const name = (i: number) => q[i]?.name;
    return {
      newQueue: name(0) ?? "the new enquiries team", supportQueue: name(1) ?? "the support team", generalQueue: name(2),
      bookingTerm: p.bookingTerm,
      products: p.reports.marketingDashboard.breakdowns.find((b: { title: string }) => /Product Category/i.test(b.title))?.rows.map((x: { name: string }) => x.name),
      who: /patient/i.test(name(1) ?? "") ? "patient" : /resident/i.test(name(1) ?? "") ? "resident" : "customer",
    };
  })(),
};

/* `--prompt` prints the instructions the worker will be given, and places no call. */
if (has("prompt")) {
  const { voiceSystemPrompt } = await import("../engine/chat.ts");
  console.log(voiceSystemPrompt(brain as never));
  process.exit(0);
}

/* ── the caller's mouth and the caller's ears: LiveKit's own gateway TTS and STT ─────────── */
async function speakFrames(text: string): Promise<AudioFrame[]> {
  const tts = inference.TTS.fromModelString(CALLER_VOICE);
  const s = tts.stream();
  s.pushText(text); s.flush(); s.endInput();
  const frames: AudioFrame[] = [];
  /* ⚠️ The stream's iterator does not end on its own once the last frame is out, so the loop
     stops on the gateway's own final marker or a short quiet gap. */
  const it = s[Symbol.asyncIterator]();
  while (true) {
    const next = await Promise.race([it.next(), new Promise<null>((r) => setTimeout(() => r(null), frames.length ? 1500 : 15000))]);
    if (!next || next.done) break;
    const ev = next.value as { frame?: AudioFrame; final?: boolean };
    if (ev?.frame) frames.push(ev.frame);
    if (ev?.final) break;
  }
  s.close();
  return frames;
}
const rms = (f: AudioFrame) => {
  let sum = 0;
  for (let i = 0; i < f.data.length; i++) sum += f.data[i] * f.data[i];
  return Math.sqrt(sum / Math.max(1, f.data.length));
};

/* ── simulated caller: answers whatever the agent actually asked ─────────────────────────── */
async function simLine(persona: string, convo: { who: "agent" | "caller"; text: string }[]): Promise<string> {
  const caller = {
    customerName: "Customer",
    customSystem: `${persona}\nYou are the CALLER on a phone call with ${p.customerName}'s AI agent. `
      + `Answer exactly what the agent just asked, briefly and naturally, the way a person speaks on the phone; never volunteer a detail it did not ask for. `
      + `If it offers times, pick the first that fits. Only when the agent has asked you nothing further AND has either confirmed what you wanted or said it is transferring you, reply with a short thanks and the word DONE.`,
  };
  const messages = convo.map((m) => ({ role: m.who === "agent" ? "user" : "assistant", content: m.text }));
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brain: caller, messages }) });
  const j = (await res.json()) as { reply?: string };
  return (j.reply ?? "DONE").replace(/\s+/g, " ").trim();
}

interface Turn { who: "agent" | "caller"; text: string; heard?: string; latencyMs?: number; at: number }

async function placeCall(script: string[] | null, persona: string | null) {
  const res = await fetch(`${BASE}/api/livekit-token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brain, profileId: p.id, greeting: spec?.greeting ?? "", voice: tree?.agent?.voice }),
  });
  const tok = (await res.json()) as { url?: string; token?: string; room?: string; error?: string };
  if (!res.ok || !tok.token) throw new Error(`token: ${tok.error ?? res.status}`);

  const room = new Room();
  const t0 = Date.now();
  const turns: Turn[] = [];
  let agentText = "";             // what the worker says it said (lk.transcription)
  let heard = "";                 // what STT heard in the agent's audio
  let lastAgentAudio = 0;         // ms since t0 of the last non-silent agent frame
  let firstAgentAudioAfter = 0;   // set when the agent starts speaking after a caller turn
  let speakingSince = 0;
  let agentJoined = false;

  /* The worker also streams its own session events; nothing here needs them. */
  room.registerByteStreamHandler("lk.agent.session", () => {});
  room.registerTextStreamHandler("lk.transcription", async (reader, info) => {
    if (info.identity === room.localParticipant?.identity) return;
    const text = await reader.readAll();
    if (text.trim()) agentText += (agentText ? " " : "") + text.trim();
  });

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    agentJoined = true;
    const stt = new inference.STT({ model: "deepgram/nova-3", language: "en" });
    const ss = stt.stream();
    (async () => {
      for await (const f of new AudioStream(track, { sampleRate: 16000, numChannels: 1 })) {
        if (rms(f) > 500) {
          const now = Date.now() - t0;
          if (!speakingSince) speakingSince = now;
          if (!firstAgentAudioAfter) firstAgentAudioAfter = now;
          lastAgentAudio = now;
        }
        ss.pushFrame(f);
      }
    })().catch(() => {});
    (async () => {
      for await (const ev of ss) {
        const t = (ev as { type?: number; alternatives?: { text?: string }[] }).alternatives?.[0]?.text;
        if ((ev as { type?: number }).type === 2 && t?.trim()) heard += (heard ? " " : "") + t.trim();
      }
    })().catch(() => {});
  });

  await room.connect(tok.url!, tok.token, { autoSubscribe: true, dynacast: false });
  /* Learn the caller voice's sample rate from a real frame before publishing a track at it. */
  const warm = await speakFrames("Hello.");
  const rate = warm[0]?.sampleRate ?? 24000;
  const source = new AudioSource(rate, 1);
  const track = LocalAudioTrack.createAudioTrack("caller-mic", source);
  const opts = new TrackPublishOptions(); opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(track, opts);
  const silence = (ms: number) => {
    const n = Math.round((rate * ms) / 1000);
    return new AudioFrame(new Int16Array(n), rate, 1, n);
  };
  /* Keep the line open with silence so the agent's VAD has a stream to listen to. */
  await source.captureFrame(silence(300));

  /* Wait for the agent's greeting to finish: it has spoken, and been quiet for 1.4s. */
  const waitAgentTurn = async (maxMs: number) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await source.captureFrame(silence(100));
      const now = Date.now() - t0;
      if (lastAgentAudio && speakingSince && now - lastAgentAudio > 1400 && lastAgentAudio > speakingSince) return true;
    }
    return false;
  };
  const collectAgent = (latencyMs?: number) => {
    const text = agentText.trim(), h = heard.trim();
    agentText = ""; heard = ""; speakingSince = 0;
    if (text || h) turns.push({ who: "agent", text: text || "(no transcript)", heard: h, latencyMs, at: Date.now() - t0 });
    return text || h;
  };

  const joinBy = Date.now() + 35000;
  while (!agentJoined && Date.now() < joinBy) await source.captureFrame(silence(100));
  if (!agentJoined) { await room.disconnect(); throw new Error("no agent joined within 35s (cold start or worker down)"); }
  await waitAgentTurn(25000);
  collectAgent(firstAgentAudioAfter);

  const lines = script ? [...script] : [];
  for (let i = 0; i < MAX_TURNS; i++) {
    let line = script ? lines.shift() : await simLine(persona!, turns);
    if (!line) break;
    const done = /\bDONE\b/.test(line);
    line = line.replace(/\bDONE\b\.?/g, "").trim();
    if (line) {
      const frames = await speakFrames(line);
      turns.push({ who: "caller", text: line, at: Date.now() - t0 });
      for (const f of frames) await source.captureFrame(f);
      await source.captureFrame(silence(400));
    }
    const spokeAt = Date.now() - t0;
    firstAgentAudioAfter = 0; speakingSince = 0;
    const ok = await waitAgentTurn(30000);
    collectAgent(firstAgentAudioAfter ? firstAgentAudioAfter - spokeAt : undefined);
    if (!ok) { turns.push({ who: "agent", text: "(no reply within 30s)", at: Date.now() - t0 }); break; }
    /* A caller who is done still hears the agent's answer to their last line before hanging up. */
    if (done) break;
    /* ⚠️ Only an actual handoff ends the call. "I can connect you with your local office"
       is a reason for asking the ZIP, and treating it as a transfer hung up mid-call. */
    if (/\b(transferring you|transfer you now|i'?m transferring|connecting you now|one moment while i transfer)\b/i.test(turns[turns.length - 1].text) && script === null) {
      /* Let the simulated caller say thanks, then hang up. */
      const bye = await simLine(persona!, turns);
      const fr = await speakFrames(bye.replace(/\bDONE\b\.?/g, "").trim() || "Thanks.");
      turns.push({ who: "caller", text: bye.replace(/\bDONE\b\.?/g, "").trim(), at: Date.now() - t0 });
      for (const f of fr) await source.captureFrame(f);
      break;
    }
  }
  await room.disconnect();
  return { room: tok.room, seconds: Math.round((Date.now() - t0) / 1000), turns };
}

/* `--sim-file=path` or `--sim-file path`. */
const simFile = flag("sim-file") ?? (has("sim-file") ? args[args.indexOf("--sim-file") + 1] : undefined);
const personas = simFile
  ? readFileSync(simFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : has("sim") ? [args[args.indexOf("--sim") + 1]] : [null];
const script = personas[0] === null ? args.slice(1).filter((a) => !a.startsWith("--")) : null;

for (const persona of personas) {
  try {
    const r = await placeCall(script, persona);
    if (has("json")) { console.log(JSON.stringify({ prospect: p.customerName, persona, ...r })); continue; }
    console.log(`\n=== ${p.customerName} · room ${r.room} · ${r.seconds}s ===${persona ? `\nPERSONA: ${persona}` : ""}`);
    for (const t of r.turns) {
      if (t.who === "caller") console.log(`CALLER: ${t.text}`);
      else {
        console.log(`AGENT : ${t.text}${t.latencyMs != null ? `   [${(t.latencyMs / 1000).toFixed(1)}s to answer]` : ""}`);
        if (t.heard && t.heard.toLowerCase().replace(/[^a-z ]/g, "").slice(0, 40) !== t.text.toLowerCase().replace(/[^a-z ]/g, "").slice(0, 40))
          console.log(`        heard: ${t.heard}`);
      }
    }
    const lat = r.turns.filter((t) => t.who === "agent" && t.latencyMs != null).map((t) => t.latencyMs!);
    if (lat.length > 1) console.log(`median answer time ${(lat.slice(1).sort((a, b) => a - b)[Math.floor((lat.length - 1) / 2)] / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`CALL FAILED: ${(e as Error).message}`);
  }
}
await dispose();
process.exit(0);
