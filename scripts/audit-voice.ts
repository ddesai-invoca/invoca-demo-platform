/* =============================================================================
   audit-voice.ts — the voice pipeline's cross-file contracts
   -----------------------------------------------------------------------------
   `npm run audit:voice` (also run by `npm run audit`).

   The LiveKit voice call spans FOUR files that have to agree, and every disagreement
   between them fails the same silent way: the token mints, the room is created, the browser
   connects, and no agent ever joins. The caller hears nothing and no error is raised
   anywhere. That cost a real round trip ("I clicked start call but voice agent isnt
   starting"), so the agreements are checked rather than remembered.

   Each check was verified to FIRE on its own broken shape, not merely to pass on a good
   tree — a check that never fires is indistinguishable from no check.
   ============================================================================= */
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

const token = read("engine/livekitToken.ts");
const worker = read("agent/voiceAgent.js");
const toml = read("agent/livekit.toml");
const client = read("src/data/liveKitVoice.ts");
const chat = read("engine/chat.ts");

/* 1. THE AGENT NAME. The token dispatches by name; the worker registers under one; the
      deployment config names one. Any mismatch = no agent joins, silently. */
const nameOf = (s: string, re: RegExp) => s.match(re)?.[1];
const tokenName = nameOf(token, /AGENT_NAME\s*=\s*"([^"]+)"/);
const workerName = nameOf(worker, /agentName:\s*"([^"]+)"/);
/* ⚠️ THE DISPATCH NAME IS NOT IN livekit.toml, and asserting that it was is a mistake this
   check used to make. That file carries the project subdomain and the DEPLOYMENT id, which
   the CLI assigns; the name a token dispatches by comes from `WorkerOptions({ agentName })`.
   What still has to agree is the worker and the token, which is checked below. */
const tomlSubdomain = nameOf(toml, /^\s*subdomain\s*=\s*"([^"]+)"/m);
check(!!tokenName, "token declares AGENT_NAME");
check(tokenName === workerName, "worker registers under the token's AGENT_NAME",
  `token=${tokenName} worker=${workerName}`);
check(!!tomlSubdomain, "livekit.toml names the LiveKit project to deploy into",
  `subdomain=${tomlSubdomain}`);
/* The container must not run as root and must launch with `start`, or LiveKit Cloud rejects
   the build / the worker never connects. Both are one-line mistakes with a slow feedback loop. */
{
  const df = read("agent/Dockerfile");
  check(/^USER node$/m.test(df), "the agent image does not run as root");
  check(/CMD \[.*"start".*\]/.test(df), "the image launches the agent with `start`, not `dev`");
  check(!/ENV\s+LIVEKIT_/.test(df), "the image bakes in no LiveKit credentials");
  check(/node:\d+-slim|node:\d+-bookworm|debian|ubuntu/i.test(df), "the base image is glibc, not Alpine");
}

/* 2. THE METADATA CONTRACT. The token writes `instructions`; the worker refuses a job
      without one. If the token stopped sending it the worker would decline every call. */
check(/metadata:\s*JSON.stringify\(\{[\s\S]{0,200}instructions/.test(token),
  "token puts `instructions` in the dispatch metadata");
check(/instructions/.test(worker) && /ctx\.job\?\.metadata|ctx\.job\.metadata/.test(worker),
  "worker reads instructions from ctx.job.metadata");

/* 3. ONE PROMPT, NOT TWO. The whole point of shipping the prompt as metadata is that the
      worker never builds its own — otherwise the spoken agent and /api/chat drift. */
check(/voiceSystemPrompt/.test(token), "token builds the prompt with voiceSystemPrompt");
check(/export function voiceSystemPrompt/.test(chat), "voiceSystemPrompt is exported for it");
check(!/buildVoiceSystem|You are the AI phone assistant/.test(worker),
  "worker does NOT author a prompt of its own");

/* 4. A FRESH ROOM PER CALL. LiveKit dispatches from a token only when the room is first
      created, so a reused name means no agent and silence. */
check(/Date\.now\(\)\.toString\(36\)/.test(token) && /Math\.random\(\)/.test(token),
  "room name is unique per call");

/* 5. THE FAILURES THE SCREEN MUST REPORT. Both were silent once, and both were
      indistinguishable from a dead mic. */
check(/CONNECT_TIMEOUT_MS/.test(client) && /Promise\.race/.test(client),
  "client bounds room.connect (it retries internally and can hang forever)");
check(/AGENT_JOIN_TIMEOUT_MS/.test(client) && /remoteParticipants/.test(client),
  "client reports an empty room (worker down) instead of sitting on Listening");

/* 6. THE BUNDLE. livekit-client must stay a dynamic import: at the top of the module it
      cost +124KB gzipped on EVERY screen, for a library only the voice call touches. */
check(/await import\("livekit-client"\)/.test(client),
  "livekit-client is imported on demand");
check(!/^import \{[^}]*\} from "livekit-client"/m.test(client),
  "livekit-client is NOT imported at module top level (bundle cost)");

/* 7. THE WORKER OWNS NO PROVIDER KEYS. Speech in and out are brokered by LiveKit, so a
      DEEPGRAM_API_KEY creeping back in here means we are paying twice and drifting from
      the "all through the gateway" decision. */
check(!/process\.env\.DEEPGRAM_API_KEY/.test(worker),
  "worker reads no Deepgram key (STT/TTS come from LiveKit's gateway)");

/* ⚠️ 8. THE READINESS PROBE MUST BE ABLE TO SAY "NO". `useLiveKitReady` POSTs an EMPTY body
      and reads 400 as "LiveKit is available here". Both servers used to validate `brain`
      before checking the config, so an unconfigured server answered 400 to that probe, the app
      chose the LiveKit engine, the real token request then 501'd, and Start Call silently did
      nothing — on production, with the fallback engine sitting unused. The config check must
      come FIRST in both. */
for (const [file, src] of [["server.ts", read("server.ts")], ["vite.config.ts", read("vite.config.ts")]] as const) {
  const seg = src.slice(src.indexOf("livekit-token"));
  const cfgAt = Math.min(...["livekitEnv()", "livekitEnv(env)"].map((k) => {
    const i = seg.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }));
  const brainAt = seg.indexOf("brain is required");
  check(cfgAt < brainAt && brainAt > 0,
    `${file}: /api/livekit-token checks LiveKit config BEFORE validating the body`,
    `config at ${cfgAt}, body guard at ${brainAt}`);
}

/* Self-check: a static audit that silently matches nothing reports success forever. */
check(token.length > 2000 && worker.length > 1500 && client.length > 4000,
  "the audited files were actually read");

console.log(failures ? `\n${failures} voice-contract failure(s)` : "ok    voice pipeline  (18 checks)");
process.exit(failures ? 1 : 0);
