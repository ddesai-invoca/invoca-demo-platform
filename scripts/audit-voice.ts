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
import { readFileSync, readdirSync } from "node:fs";
import { isStructuralChange } from "../src/data/editGuard";
import { voiceSystemPrompt } from "../engine/chat";
import { treeToVoicePaths } from "../src/data/voicePaths";
import { voiceSpecFor, deriveVoiceSpec, agentConfigOf, specWithConfig, GREETING_RULE_PREFIX, type VoiceAgentSpec } from "../src/data/voiceAgentSpec";
import { voiceCopy } from "../src/data/voiceCopy";
import { latestTransferredCall, voiceAiRouting, voiceAiScreenpop } from "../src/data/voiceAiArtifacts";
import { collectNames } from "../src/data/workflowDrawers";

/* ⚠️ THE VOICE TREE'S SHAPE, mirroring `deriveTree` in AgentWorkflow.tsx. The prompt is only
   built when `voicePaths` is non-empty, so passing an empty tree here would skip the entire
   CALL FLOW block and every check below would pass against a prompt that was never built.
   That happened while writing these checks and read exactly like the feature working. */
function auditTreePaths(_p: never, spec: VoiceAgentSpec) {
  const node = (u: { title: string; collect: string[]; route?: string }) => ({
    title: u.title, action: "Inform & Route", chips: u.collect,
    ...(u.route ? { route: u.route } : {}),
  });
  return treeToVoicePaths({
    variant: "voice",
    branches: [
      { title: "Sales Inquiry", subtitle: spec.intent.split("\n")[0],
        leaves: [{ title: "All Sales Inquiry Users", action: "Qualify",
          paths: spec.useCases.sales.map(node) }] },
      { title: "Need Support", subtitle: "Existing customer",
        leaves: [{ title: "All Support Users", action: "Support & Escalate",
          ...(spec.useCases.support.length ? { paths: spec.useCases.support.map(node) } : {}) }] },
    ],
  } as never);
}

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

/* ⚠️ 9. THE TEMPLATE MUST REACH EVERY PROSPECT, NOT JUST THE CONFIGURED ONE (8/27/2026).
      The diagram draws "Consumer Zip" and "Consumer Name" pills for EVERY prospect, and
      before this the spec existed only for Comfort Keepers: measured across the 12 profiles
      on disk, 8 never asked for a ZIP and 11 never asked for a name. The pills promised two
      things the agent did not collect, and nothing failed — so this is checked by BUILDING
      the real prompt, not by grepping for a helper that might not be called. */
{
  const files = readdirSync("src/data/generated").filter((f) => f.endsWith(".json"));
  check(files.length >= 5, "generated profiles were found to audit", `${files.length} files`);
  let unasked = 0, noGreet = 0, invented = 0, noBranch = 0, smsLeak = 0;
  for (const f of files) {
    const profile = JSON.parse(read(`src/data/generated/${f}`));
    const spec = voiceSpecFor(profile);
    const derived = deriveVoiceSpec(profile);
    const isDerived = JSON.stringify(spec) === JSON.stringify(derived);
    const prompt = voiceSystemPrompt({
      customerName: profile.customerName,
      industry: profile.industry ?? "",
      serviceArea: profile.reports.agentConfig?.serviceArea,
      serviceZips: spec.serviceZips,
      outOfAreaScript: spec.outOfAreaScript,
      voiceGreeting: spec.greeting,
      voiceQualify: spec.qualifyQuestion,
      voiceRules: spec.rules,
      voiceSteps: spec.informSteps,
      voicePaths: auditTreePaths(profile, spec),
    } as never);

    /* ⚠️⚠️ **EVERY PILL THE DIAGRAM DRAWS MUST BE ASKED FOR — this replaced "asks for a ZIP
       and a name" (8/27/2026), which was the right check only while every branch collected the
       same two things.** Now a use case carries its OWN fields: Marriott's "Ready to book now"
       wants Destination and Travel Dates and would FAIL a hardcoded ZIP check while being
       perfectly correct. The invariant that actually matters has not changed and now
       generalises — a node must never advertise a field the agent never asks for. */
    for (const vp of [...spec.useCases.sales, ...spec.useCases.support]) {
      for (const field of vp.collect) {
        if (!prompt.includes(field)) {
          unasked++;
          console.log(`      pill never asked for: ${profile.customerName} — "${vp.title}" / ${field}`);
        }
      }
    }
    if (!/OPEN with exactly this line/.test(prompt)) { noGreet++; console.log(`      no scripted greeting: ${profile.customerName}`); }
    /* ⚠️ ZIP CODES ARE SE CONFIGURATION AND MUST NEVER BE MINTED. A fabricated allow-list
       would turn real callers away from a real company for a reason that does not exist. */
    if (isDerived && derived.serviceZips) { invented++; console.log(`      invented ZIPs: ${profile.customerName}`); }
    /* ⚠️ BOTH USER-GROUP NODES BRANCH for a derived prospect. The support leaf carried NO
       paths until 8/27/2026, so every support caller got the same two questions and one queue.
       A configured spec may legitimately define none, which is why this only checks derived. */
    if (isDerived && (!derived.useCases.sales.length || !derived.useCases.support.length)) {
      noBranch++; console.log(`      a user-group node has no use cases: ${profile.customerName}`);
    }
    for (const r of profile.reports.agentConfig?.brandConversationRules ?? []) {
      const probe = String(r).slice(0, 60);
      if (probe.length > 25 && prompt.includes(probe)) {
        smsLeak++; console.log(`      SMS playbook in voice prompt: ${profile.customerName} — "${probe}..."`);
        break;
      }
    }
  }
  check(smsLeak === 0, "the SMS sales playbook never reaches the voice prompt");
  check(unasked === 0, "every field a use-case node advertises is asked for in the prompt");
  check(noBranch === 0, "a derived prospect branches under BOTH user-group nodes");
  check(noGreet === 0, "every prospect opens with a scripted greeting");
  check(invented === 0, "no derived spec invents service ZIP codes");
}

/* ⚠️ 10. ASK AI MUST BE ABLE TO CONFIGURE THE AGENT, AND EVERY FIELD IT OFFERS MUST BITE
      (8/27/2026). Three bugs found while building this, each of which let an edit land and do
      nothing: `qualifyQuestion` reached the drawer and never the prompt; the greeting is COPIED
      into `rules` and the copy went stale when only the greeting changed; and a ZIP allow-list
      added without rewriting the steps was overridden by steps still saying "serves everywhere".
      All three are checked FUNCTIONALLY — by calling the code and reading the built prompt. */
{
  const profile = JSON.parse(read("src/data/generated/autonation.json"));
  const base = voiceSpecFor(profile);
  const cfg = agentConfigOf(base);

  /* The page must register the agent beside the diagram, or there is nothing to edit. */
  const wf = read("src/screens/AgentWorkflow.tsx");
  check(/agent:\s*agentConfigOf\(/.test(wf), "the voice workflow page registers the agent config beside its tree");
  /* ...and the CALL must read the edited one, not the profile's base. */
  const vc = read("src/screens/VoiceCall.tsx");
  check(/specWithConfig\(/.test(vc) && /effTree\?\.agent/.test(vc),
    "VoiceCall builds its brain from the page's EFFECTIVE agent config");

  /* A changed greeting must not leave the copy inside `rules` reciting the old one. */
  const reGreeted = specWithConfig(base, { ...cfg, greeting: "Totally new opening line." });
  check(!reGreeted.rules.some((r) => r.startsWith(GREETING_RULE_PREFIX) && !r.includes("Totally new opening line.")),
    "changing the greeting updates the copy of it inside the conversation rules");

  /* A ZIP allow-list must not be contradicted by steps nobody rewrote. */
  const zipped = specWithConfig(base, { ...cfg, serviceZips: ["90210"] });
  check(zipped.informSteps.some((x) => x.includes("90210"))
    && !zipped.informSteps.some((x) => /nationally|Do not turn anyone away/i.test(x)),
    "adding a ZIP allow-list rewrites steps that still said the agent serves everywhere");
  /* ...but steps somebody DID write are theirs. */
  const authored = specWithConfig(base, { ...cfg, serviceZips: ["90210"], informSteps: ["1. Say hello."] });
  check(JSON.stringify(authored.informSteps) === JSON.stringify(["1. Say hello."]),
    "steps written by hand are never rewritten by the ZIP repair");

  /* The qualifying question must actually reach the prompt. */
  const spoken = voiceSystemPrompt({
    customerName: profile.customerName, industry: profile.industry ?? "",
    voiceGreeting: "Thanks for calling, this is Max.",   // no "?", so the question is appended
    voiceQualify: "Are you buying or servicing?",
    voiceRules: base.rules, voiceSteps: base.informSteps,
    voicePaths: auditTreePaths(profile, base),
  } as never);
  check(spoken.includes("Are you buying or servicing?"),
    "the qualifying question reaches the voice prompt (editing it is not a no-op)");
  /* ...and must NOT be appended when the greeting already asks it, or the agent asks twice. */
  const ck = JSON.parse(read("src/data/generated/comfort-keepers.json"));
  const ckSpec = voiceSpecFor(ck);
  const ckPrompt = voiceSystemPrompt({
    customerName: ck.customerName, industry: ck.industry ?? "",
    voiceGreeting: ckSpec.greeting, voiceQualify: ckSpec.qualifyQuestion,
    voiceRules: ckSpec.rules, voiceSteps: ckSpec.informSteps,
    voicePaths: auditTreePaths(ck, ckSpec),
  } as never);
  check(!ckPrompt.includes(`Then ask exactly this, word for word: "${ckSpec.qualifyQuestion}"`),
    "a greeting that already asks the question does not get it appended twice");

  /* And the guard must permit what the feature promises. */
  check(!isStructuralChange(cfg.rules, [...cfg.rules, "another rule"], "agent.rules"),
    "editGuard allows the agent's rule list to change length");
  check(!isStructuralChange(undefined, ["30097"], "agent.serviceZips"),
    "editGuard allows a ZIP allow-list to be created");
  check(isStructuralChange(cfg.rules, "not a list", "agent.rules"),
    "editGuard still blocks a type flip on the agent's config");
  /* ⚠️ **THE DRAWER'S EMPTY STATE OFFERS "route cancellations to the retention team", so the
     guard has to permit it.** `TreePath.route` is OPTIONAL — a spec naming no teams renders
     exactly as before — which made that an `undefined -> string` write, i.e. a type flip, on
     precisely the prospects whose branches carry no route. The UI promised something the guard
     refused, and it would only have failed on those accounts. Checked by CALLING the guard
     against what the copy says, not by trying one prospect. */
  const routePath = "branches.1.leaves.0.paths.0.route";
  check(!isStructuralChange(undefined, "Retention", routePath),
    "editGuard lets a use case be given a destination it did not have");
  check(!isStructuralChange("Billing", "Retention", routePath),
    "editGuard lets a use case's destination be changed");
  check(isStructuralChange("Billing", ["a"], routePath),
    "editGuard still blocks a type flip on a destination");
}

/* ⚠️ 11. THE (Voice AI) STORY ARTIFACTS (8/27/2026). Two leave-behinds rebuilt from a real
      call. They NAME A DEPARTMENT on screen, so the gate matters more than the rendering: an
      artifact pointing at a queue nobody was sent to is the one thing on these screens a
      prospect would catch. */
{
  const profile = JSON.parse(read("src/data/generated/marriott.json"));
  const base = { id: "T", time: "", active: true, date: "",
    transcript: [{ speaker: "consumer", time: "", text: "book a wedding block" },
                 { speaker: "agent", time: "", text: "connecting you now" }],
    signals: [{ name: "Qualified Lead", badges: ["Rule"], count: 0 }] };
  const ok = { ...base, outcome: { transferred: true, routedTo: "Group Sales", callerName: "Dev Desai", intent: "Book a block.", location: "Orlando" } };

  check(!!latestTransferredCall([ok as never]), "a transferred call yields the (Voice AI) artifacts");
  /* Every way a call can fail to be a transfer must produce NOTHING. */
  check(!latestTransferredCall([{ ...ok, outcome: { ...ok.outcome, transferred: false } } as never]),
    "an untransferred call yields no (Voice AI) artifacts");
  check(!latestTransferredCall([{ ...ok, outcome: { ...ok.outcome, routedTo: "" } } as never]),
    "a transfer naming no department yields no artifacts");
  check(!latestTransferredCall([base as never]),
    "a call whose analysis failed (no outcome at all) yields no artifacts");
  check(!voiceAiRouting(profile, base as never) && !voiceAiScreenpop(profile, base as never),
    "the builders themselves refuse a call with no outcome");

  const routing = voiceAiRouting(profile, ok as never)!;
  const pop = voiceAiScreenpop(profile, ok as never)!;
  /* ⚠️ `queues[0]` IS THE WINNER — the renderer reads it positionally (`d.queues[0]?.name`). */
  check(routing.queues[0]?.name === "Group Sales", "the department the agent named is queues[0]",
    routing.queues[0]?.name);
  /* ⚠️ **THIS CASE HAS TO USE A DEPARTMENT THE PROSPECT ALREADY HAS**, or it proves nothing.
     Written first with "Group Sales" — which is a use-case destination, NOT one of Marriott's
     seeded queues — so the dedup branch was never entered and the check stayed green while the
     code was deliberately broken. The routed department can be either, and only the seeded case
     can produce a duplicate. */
  const seededQueue = profile.reports.voiceRoutingDemo.queues[1].name;
  const onSeeded = voiceAiRouting(profile, { ...ok, outcome: { ...ok.outcome, routedTo: seededQueue } } as never)!;
  check(onSeeded.queues[0]?.name === seededQueue, "a seeded department also leads the queue list");
  check(new Set(onSeeded.queues.map((q) => q.name)).size === onSeeded.queues.length,
    "the routed department is not duplicated when it is already a seeded queue",
    onSeeded.queues.map((q) => q.name).join(" | "));
  check(routing.convo.length === ok.transcript.length, "the routing demo replays the REAL transcript");
  check(routing.convo.reduce((n, t) => n + t.sigs.length, 0) === ok.signals.length,
    "every analysed signal is attached to a turn (the artifact prints a count)");
  check((routing.convo.at(-1)?.q[0] ?? 0) > (routing.convo[0]?.q[0] ?? 0),
    "confidence in the winning queue rises across the call");
  check(pop.callerName === "Dev Desai" && pop.tagBlue.includes("Group Sales"),
    "the screenpop carries the caller and the department from the call");
  /* ⚠️ THE AI PANEL IS THE CALL'S; THE CRM FIELDS ARE THE PROSPECT'S. Keeping the seeded
     coverage credited the agent with a service-area check it never ran. */
  check(pop.coverage.includes("Orlando"), "the AI panel's coverage comes from the call");
  check(pop.email === profile.reports.voiceScreenpop.email,
    "CRM fields the call cannot establish stay as the prospect's own");

  /* ⚠️ THE GENERATION TRAP. `toSchema()` marks every property required, so an `.optional()`
     field in a generated type is FORCED onto the model — which would fabricate a routing
     decision on a seeded conversation and render it as if a call had happened. Same class as
     `InteractionRow.cells`. */
  const core = read("engine/core.ts");
  check(/VoiceConversation\.omit\(\{\s*outcome:\s*true\s*\}\)/.test(core),
    "the voice CI generation schema OMITS the app-written `outcome`");
  for (const f of readdirSync("src/data/generated").filter((x) => x.endsWith(".json"))) {
    const pr = JSON.parse(read(`src/data/generated/${f}`));
    const bad = (pr.reports?.voiceConversationIntelligence?.conversations ?? []).some((c: { outcome?: unknown }) => c.outcome);
    check(!bad, `no generated conversation carries a fabricated outcome (${f})`);
  }
}

/* Self-check: a static audit that silently matches nothing reports success forever. */
check(token.length > 2000 && worker.length > 1500 && client.length > 4000,
  "the audited files were actually read");

console.log(failures ? `\n${failures} voice-contract failure(s)` : "ok    voice pipeline  (38 checks + per-profile)");
process.exit(failures ? 1 : 0);
