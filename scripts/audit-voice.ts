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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isStructuralChange } from "../src/data/editGuard";
import { voiceSystemPrompt, smsSystemPromptForAudit } from "../engine/chat";
import { emptyWorkflowGreeting } from "../src/data/workflowChrome";
import { treeToVoicePaths } from "../src/data/voicePaths";
import { voiceSpecFor, deriveVoiceSpec, agentConfigOf, specWithConfig, stepsForZips, toSteps, GREETING_RULE_PREFIX, type VoiceAgentSpec } from "../src/data/voiceAgentSpec";
import { voiceCopy } from "../src/data/voiceCopy";
import { VOICE_OPTIONS, DEFAULT_VOICE_ID, liveKitVoiceModel, isKnownVoice, voiceOption } from "../src/data/voiceOptions";
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
    /* ⚠️⚠️ **"ASKED FOR" NO LONGER MEANS "THE LITERAL CHIP LABEL APPEARS" (9/2/2026), because
       the prompt now deliberately does NOT re-ask Consumer Zip / Consumer Name inside a path's
       own collect line when the service-area check already gathered it — see the "don't ask
       twice" note in engine/chat.ts. Denver Health's own step says "ask for their zip code and
       capture it", never the UI label "Consumer Zip", so a bare prompt.includes(field) started
       failing on the very profiles the fix was correct for. The field is still asked; it just
       moved earlier and changed its wording. Two narrow exceptions, checked SEMANTICALLY
       rather than assumed: a service-area check of any shape always asks for a ZIP (that
       block's only purpose), and the generic wording for a name is "full name". Any OTHER
       field, Destination, Travel Dates, Care Location, still has to appear literally, so this
       stays a real check on everything that isn't one of the two deduped fields — verified by
       forcing an unrelated field to drop out, which still fails the check. */
    const hasServiceAreaCheck = !!(spec.serviceZips?.length || spec.informSteps?.length
      || profile.reports.agentConfig?.serviceArea);
    const nameAskedGenerically = /\bfull name\b/i.test(prompt);
    for (const vp of [...spec.useCases.sales, ...spec.useCases.support]) {
      for (const field of vp.collect) {
        const norm = field.trim().toLowerCase();
        const dedupedElsewhere = (norm === "consumer zip" && hasServiceAreaCheck)
          || (norm === "consumer name" && nameAskedGenerically);
        if (!prompt.includes(field) && !dedupedElsewhere) {
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
  const vc = read("src/data/voiceSession.ts");
  check(/specWithConfig\(/.test(vc) && /effTree\?\.agent/.test(vc),
    "the voice session builds its brain from the page's EFFECTIVE agent config");

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
  check(pop.cartId === profile.reports.voiceScreenpop.cartId
    && pop.estimatedValue === profile.reports.voiceScreenpop.estimatedValue,
    "place-free CRM fields the call cannot establish stay as the prospect's own");

  /* ⚠️⚠️ **NO FIELD MAY STILL NAME THE SEEDED CITY ONCE THE CALLER NAMED A DIFFERENT ONE.** This
     is the reported bug in one assertion: a caller who said "New York" was shown "luxury hotels
     Las Vegas weekend", "Calling Page: St. Regis Las Vegas", "Pages Viewed: W Hotels Las Vegas",
     "Location: Las Vegas, NV", a campaign called "Las Vegas Acquisition" and a 702 area code —
     the attribution panel contradicting the transcript printed beside it. Asserted over the
     WHOLE serialised artifact rather than per field, so a field added later is covered too. */
  const seededCity = profile.reports.voiceScreenpop.city;
  const moved = { ...ok, outcome: { ...ok.outcome, location: "New York" } };
  const mr = voiceAiRouting(profile, moved as never)!;
  const mp = voiceAiScreenpop(profile, moved as never)!;
  const blob = JSON.stringify({ mr, mp });
  check(!new RegExp(seededCity, "i").test(blob),
    `no artifact field still names the seeded city after the caller named another`,
    (blob.match(new RegExp(`.{0,40}${seededCity}.{0,20}`, "i")) ?? [])[0]);
  check(/New York/.test(mr.attribution.map((a) => a.value).join(" ")),
    "the attribution panel follows the call's location");
  /* ⚠️ THE AREA CODE TOO — 702 sat directly above the word "New York" on the caller card, and
     the 555 exchange must survive so a demo number cannot ring a real business. */
  check(/\(212\)/.test(mr.callerPhone) && /555/.test(mr.callerPhone),
    "the caller's area code follows the city and keeps the 555 exchange", mr.callerPhone);
  check(/^[a-z]+\.[a-z]+@gmail\.com$/.test(mp.email),
    "the email is derived from whoever actually called", mp.email);

  /* ⚠️⚠️ **A ZIP IS A LOCATION TOO, and for a serviceable-address prospect it IS the caller's
     address** — asked for directly with 30097 as the example. So the address block has to move to
     it, street included: "4521 Desert Palm Drive, Duluth, GA 30097" would leave the last field
     telling the Las Vegas story. */
  const ck = JSON.parse(read("src/data/generated/comfort-keepers.json"));
  const zipCall = { ...ok, outcome: { ...ok.outcome, location: "30097", routedTo: "Care Assessment. New Project" } };
  const zr = voiceAiRouting(ck, zipCall as never)!;
  const zp = voiceAiScreenpop(ck, zipCall as never)!;
  check(zp.zip === "30097" && zp.city === "Duluth" && zp.state === "GA",
    "a ZIP the caller gave resolves the whole address block",
    `${zp.city}, ${zp.state} ${zp.zip}`);
  check(/\(770\)/.test(zr.callerPhone), "the area code follows a ZIP too", zr.callerPhone);
  /* ⚠️ THE STREET MUST CARRY NO PLACE FLAVOUR once the address moves — see `neutralStreet`. */
  check(zp.street !== ck.reports.voiceScreenpop.street && /^\d+\s/.test(zp.street),
    "the street becomes place-neutral when the address moves", zp.street);
  /* ⚠️ AND AN UNRESOLVED ZIP LEAVES THE BLOCK ALONE rather than half-rewriting it: a city with
     someone else's state is worse than a seeded address the call never claimed to know. */
  const unknown = voiceAiScreenpop(profile, { ...ok, outcome: { ...ok.outcome, location: "12345" } } as never)!;
  const seededPop = profile.reports.voiceScreenpop;
  check(unknown.city === seededPop.city && unknown.zip === seededPop.zip && unknown.street === seededPop.street,
    "an unresolved ZIP leaves the address block untouched");

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

/* ⚠️ 12. **BOTH CALL ENGINES MUST SHARE ONE CAPTURE PATH (8/27/2026).** `VoiceCall` (browser
      speech) and `VoiceCallLive` (LiveKit) each had their own copy of "capture the call, then
      POST /api/analyze". When the routing destinations and the `outcome` were added, they went
      into the OLD engine only — so a real LiveKit call, which is what every configured
      environment actually runs, captured perfectly and stored no outcome, and the two
      (Voice AI) rows silently never appeared. Reported as "I had the conversation, it
      transferred me, and it wasn't there."

      Checked STRUCTURALLY rather than by feature, because the next divergence will be a
      different field: exactly one of them may own the fetch, and both must call the shared
      helper. */
{
  /* ⚠️ THE SECOND ENGINE IS GONE (9/3/2026) — the browser-speech pipeline went with Deepgram
     and ElevenLabs. The invariant it created still matters though: the capture lives in ONE
     place, and the engine calls it rather than carrying its own copy. That is what stopped a
     real LiveKit call from silently storing no outcome once. */
  const shared = read("src/data/voiceSession.ts");
  const live = read("src/screens/VoiceCallLive.tsx");
  const fetches = (src: string) => (src.match(/fetch\(\s*["'`]\/api\/analyze/g) ?? []).length;
  check(fetches(shared) + fetches(live) === 1,
    "exactly ONE /api/analyze call exists across the voice session and its engine",
    `shared ${fetches(shared)}, live ${fetches(live)}`);
  check(/export function captureVoiceCall\(/.test(shared), "captureVoiceCall is the shared capture path");
  check(/captureVoiceCall\(profile/.test(live), "VoiceCallLive captures through the shared path");
  /* And the shared path must carry BOTH things the artifacts depend on. */
  check(/destinations:/.test(shared), "the shared capture sends the workflow's routing destinations");
  check(/patch\.outcome = d\.outcome/.test(shared), "the shared capture stores the analysed outcome");
}

/* Self-check: a static audit that silently matches nothing reports success forever. */
/* ===========================================================================
   Previewing an EMPTY workflow (8/27/2026)
   Asked for directly: "the preview workflow on an empty tree should introduce itself, thank
   them for calling the prospect, ask how it can help; then decide sales or support, tell
   them, and transfer." These BUILD the real prompt for both channels and read it.
   =========================================================================== */
{
  const min = { customerName: "Marriott", industry: "hotels", rules: [], qaPairs: [], knowledge: [],
    voiceMinimal: true, voiceGreeting: emptyWorkflowGreeting("Marriott") };
  const vp = voiceSystemPrompt(min as never);
  /* ⚠️ **THIS ASSERTED `vp.includes(emptyWorkflowGreeting(...))` AND SO COULD NOT FAIL** —
     both sides came from the same function, so rewording the greeting to "Please hold."
     changed the expectation with it and the check stayed green. Caught by breaking it on
     purpose. It now asserts the three things the request actually named. */
  check(/thanks for calling Marriott/i.test(vp), "it thanks them for calling the prospect");
  check(/AI assistant/i.test(vp), "it introduces itself");
  check(/How can I help you today\?/.test(vp), "it asks how it can help, verbatim");
  check(/the sales team/.test(vp) && /the support team/.test(vp),
    "it names both destinations");
  check(/Transferring you to the sales team now\./.test(vp)
    && /Transferring you to the support team now\./.test(vp),
    "it scripts the transfer line for each");
  /* ⚠️ THE GATE, NOT THE WORD. "ZIP" appears in this prompt's PROHIBITIONS ("no ZIP code"),
     so matching the bare word would fail on a correct prompt — the same trap that made the
     earlier `/zip code/i` check match a conversation rule instead of the imperative. */
  check(!/SERVICE-AREA CHECK/.test(vp) && !/ask for their ZIP code/.test(vp),
    "no service-area gate reaches a workflow with nothing configured");
  check(!/PATH: /.test(vp) && !/Collect these/.test(vp),
    "none of the configured path machinery reaches it");
  check(/ASK NOTHING BEYOND THE FLOW ABOVE/.test(vp),
    "the ask-nothing cap still applies");

  /* The SMS side of the same empty workflow: hand off rather than transfer. */
  const sp = smsSystemPromptForAudit(min);
  check(/handing you over to the sales team now\./.test(sp)
    && /handing you over to the support team now\./.test(sp),
    "the empty workflow's CHAT preview hands off to the same two teams");
  check(/plain text only/.test(sp), "and it keeps the SMS format rules");

  /* ⚠️ THE FLAG MUST NOT LEAK. Without `voiceMinimal` the configured flow has to come back,
     or one created workflow would flatten every prospect's agent. */
  const conf = voiceSystemPrompt({ ...min, voiceMinimal: false,
    voicePaths: [{ intent: "Sales Inquiry", routes: [{ team: "Reservations", action: "Inform & Route", collect: ["Travel Dates"] }] }] } as never);
  check(/PATH: SALES INQUIRY/.test(conf) && /Travel Dates/.test(conf),
    "without the flag the configured path flow is unchanged");
}

/* ---- the multi-location / out-of-area contract (added 9/2/2026) ------------
   ⚠️ ALL FIVE OF THESE FAILED ON A REAL DEMO. Asked to serve three showrooms and offer the
   nearest one when a caller's ZIP was outside them, Avi & Co's agent hung up on those callers
   instead. The instruction had landed correctly in the stored config; three separate things
   between there and the prompt undid it. */
{
  /* 1. Object-shaped steps must be NORMALISED, not filtered away. The model wrote its steps
        as `{step, action, description}` and a `typeof r === "string"` filter dropped both. */
  const objSteps = toSteps(
    [{ step: 1, action: "Ask for ZIP code", description: "Offer the nearest of Miami, New York and Aspen." }],
    ["BASE"],
  );
  check(objSteps.length === 1 && /Miami/.test(objSteps[0]) && /Ask for ZIP code/.test(objSteps[0]),
    "object-shaped informSteps are normalised, not dropped", objSteps.join(" | "));
  check(JSON.stringify(toSteps([{}, { step: 2 }], ["BASE"])) === JSON.stringify(["BASE"]),
    "steps that normalise to nothing fall back to the base rather than emptying the list");
  check(JSON.stringify(toSteps("not an array", ["BASE"])) === JSON.stringify(["BASE"]),
    "a non-array informSteps keeps the base");

  /* 2. `stepsForZips` states ONE out-of-area policy. It used to refuse in step 3 and offer the
        script in step 5, so a nearest-location script contradicted a hang-up ahead of it. */
  const gen = stepsForZips(["33101", "10001"], "Our closest showroom is in Miami. Would that work?").join("\n");
  check(!/end the call without routing/i.test(gen) && !/we do not serve their area/i.test(gen),
    "stepsForZips no longer hardcodes a refusal beside the script", gen.split("\n")[2]);
  check(gen.includes("Our closest showroom is in Miami. Would that work?"),
    "and the script is what states the policy");

  /* 3. A bracketed placeholder must never be spoken. The model's script carried the literal
        token `[CLOSEST_LOCATION]`, which nothing downstream substitutes. */
  /* ⚠️ NO `voiceSteps` HERE, AND THAT IS THE POINT. When the SE's own steps win, the script is
     not emitted at all, so there is no bracket in the prompt to guard — the guard exists for
     the allow-list branch, which quotes the script verbatim. Written the other way round this
     check failed while the guard was working, which is how the branch got documented. */
  const withPh = voiceSystemPrompt({
    customerName: "Avi & Co", voicePaths: [{ intent: "Sales Inquiry",
      routes: [{ team: "Boutique", action: "Inform & Route", collect: ["Consumer Zip"] }] }],
    serviceZips: ["33101"], outOfAreaScript: "Our closest showroom is in [CLOSEST_LOCATION].",
  } as never);
  check(/PLACEHOLDERS:/.test(withPh) && withPh.includes("[CLOSEST_LOCATION]"),
    "an unresolved [PLACEHOLDER] gets an explicit resolve-it instruction");
  check(/never read a square bracket/i.test(withPh),
    "and the agent is told not to speak the bracket");
  const noPh = voiceSystemPrompt({
    customerName: "Avi & Co", voicePaths: [{ intent: "Sales Inquiry",
      routes: [{ team: "Boutique", action: "Inform & Route", collect: ["Consumer Zip"] }] }],
    voiceSteps: ["1. Ask for the ZIP."],
  } as never);
  check(!/PLACEHOLDERS:/.test(noPh), "and a prompt with no placeholder gains no such line");

  /* 4. An allow-list reaches the prompt even when the SE's own steps win, or the agent knows
        the policy and not the ZIPs it applies to. */
  const zipsPlusSteps = voiceSystemPrompt({
    customerName: "Avi & Co", voicePaths: [{ intent: "Sales Inquiry",
      routes: [{ team: "Boutique", action: "Inform & Route", collect: ["Consumer Zip"] }] }],
    serviceZips: ["33101"], voiceSteps: ["1. Ask for the ZIP.", "2. Offer the nearest showroom."],
  } as never);
  check(/Service-area ZIP codes: 33101/.test(zipsPlusSteps),
    "the ZIP allow-list reaches the prompt alongside the SE's own steps");
  /* And the script is NOT also quoted there, or the steps and a verbatim line would both
     claim to be the out-of-area policy — the contradiction this whole block exists for. */
  check(!/say exactly this/.test(zipsPlusSteps),
    "and the allow-list branch's own wording does not double up on the steps");
  const reciting = voiceSystemPrompt({
    customerName: "X", voicePaths: [{ intent: "Sales Inquiry",
      routes: [{ team: "T", action: "Inform & Route", collect: ["Consumer Zip"] }] }],
    serviceZips: ["30097"], voiceSteps: ["2. Check the zip against 30097."],
  } as never);
  check(!/Service-area ZIP codes:/.test(reciting),
    "and is not repeated when the steps already recite it");

  /* 5. THE REGRESSION ITSELF, end to end: object steps + an allow-list must produce a prompt
        that names the locations and does NOT hang up on an out-of-area caller. */
  const spec = specWithConfig(
    { prospect: "Avi & Co", greeting: "Hi.", rules: [], informSteps: [] } as never,
    { serviceZips: ["33101", "10001", "81611"],
      outOfAreaScript: "Our closest showroom is in [CLOSEST_LOCATION]. Would that work?",
      informSteps: [{ step: 1, action: "Ask for ZIP code",
        description: "If outside Miami, New York or Aspen, offer the closest showroom and ask if that is ok." }] } as never,
  );
  const full = voiceSystemPrompt({
    customerName: "Avi & Co", voicePaths: [{ intent: "Sales Inquiry",
      routes: [{ team: "Boutique", action: "Inform & Route", collect: ["Consumer Zip"] }] }],
    serviceZips: spec.serviceZips, outOfAreaScript: spec.outOfAreaScript, voiceSteps: spec.informSteps,
  } as never);
  check(/Miami/.test(full) && /Aspen/.test(full),
    "the multi-location instruction survives to the prompt");
  check(!/end the call without routing/i.test(full),
    "and the prompt does not also tell the agent to hang up");
}


/* =============================================================================
   THE AGENT'S VOICE — the Details tab's picker, and the chain that makes it audible
   -----------------------------------------------------------------------------
   Four links, and every one of them has failed silently in this repo before in some other
   guise: a picker writing a field nothing reads, a string the worker cannot parse, an
   allow-list that lets our own key be spent freely, and a default that quietly re-voices
   every existing demo. These call the real functions rather than grepping for them.
   ============================================================================= */
{
  /* Ids are real Deepgram Aura-2 models and unique — a typo here is a call that connects
     and then cannot speak, which the SE reads as the whole feature being broken. */
  check(VOICE_OPTIONS.length > 0 && VOICE_OPTIONS.every((v) => /^[a-z]+$/.test(v.id)),
    "every voice id is a bare gateway voice name");
  check(new Set(VOICE_OPTIONS.map((v) => v.id)).size === VOICE_OPTIONS.length,
    "no two voices share an id");
  check(VOICE_OPTIONS.every((v) => new RegExp(`^${v.id}\\b`, "i").test(v.label)),
    "each label names its own voice, so the picker cannot mislabel one");

  /* The composite string is what the worker parses; verified against the installed SDK,
     which sets `opts.voice` from exactly this shape. */
  check(liveKitVoiceModel("arcas") === "deepgram/aura-2:arcas",
    "a choice becomes the LiveKit composite the worker parses");
  check(liveKitVoiceModel("british-butler") === `deepgram/aura-2:${DEFAULT_VOICE_ID}`,
    "an invented voice falls back rather than travelling to the worker");
  check(liveKitVoiceModel(undefined) === `deepgram/aura-2:${DEFAULT_VOICE_ID}`,
    "and so does an absent one");

  /* ⚠️ THE DEFAULT MUST STAY A REAL, EXPLICIT VOICE. It is what an untouched demo speaks in,
     so a drift here silently re-voices every prospect on the platform and nobody would
     attribute it to this picker. */
  check(isKnownVoice(DEFAULT_VOICE_ID) && liveKitVoiceModel(undefined) === `deepgram/aura-2:${DEFAULT_VOICE_ID}`,
    "the default voice is explicit and known");

  /* ⚠️ THE PICKED VOICE AND THE WORKER'S OWN FALLBACK MUST NAME THE SAME MODEL. If the worker
     falls back to a different family than the picker offers, an unparseable voice changes how
     the agent sounds rather than merely which voice it uses. */
  const workerModel = /VOICE_TTS_MODEL\?\.trim\(\) \|\| "([^"]+)"/.exec(worker)?.[1];
  check(!!workerModel && liveKitVoiceModel("thalia").startsWith(`${workerModel}:`),
    "the picker and the worker's fallback share one model", `worker=${workerModel}`);

  /* The preview endpoint is reachable from a browser and spends LiveKit inference. */
  const prev = read("engine/voicePreview.ts");
  check(/isKnownVoice\(opts\.voice\)/.test(prev),
    "the preview endpoint allow-lists the voice before synthesizing");
  check(/liveKitVoiceModel\(opts\.voice\)/.test(prev),
    "and builds the SAME model string the call uses, so the two cannot diverge");
  check(!isKnownVoice("zeus") && !isKnownVoice("../../etc/passwd"),
    "a real Aura-2 voice we do NOT offer, and a junk id, are both refused");

  /* An unknown id degrades instead of throwing — this is read on every render. */
  check(voiceOption("nonsense").id === DEFAULT_VOICE_ID && voiceOption(null).id === DEFAULT_VOICE_ID,
    "reading an unknown voice yields the default rather than undefined");

  /* ⚠️ THE CONFIG PATH: `agent.voice` is absent until somebody picks one, so the FIRST pick
     is an undefined -> string write. Without CREATABLE_WHEN_ABSENT the picker is refused on
     its first use and works on every use after — call the real guard rather than trust it. */
  check(!isStructuralChange(undefined, "arcas", "agent.voice"),
    "editGuard lets the first voice pick through");
  check(!isStructuralChange("thalia", "arcas", "agent.voice"),
    "and lets a later change through");

  /* Validation on the merge, so an AI-written voice cannot break a call. */
  const vSpec = { prospect: "x", greeting: "Hi.", rules: [], informSteps: [] } as unknown as VoiceAgentSpec;
  check(specWithConfig(vSpec, { voice: "athena" } as never).voice === "athena",
    "a real voice survives specWithConfig");
  check(specWithConfig(vSpec, { voice: "made-up" } as never).voice === undefined,
    "an invented one is dropped at the merge");

  /* The two ends of the wire, structurally — the same reason `audit:voice` counts
     `/api/analyze` fetches rather than testing a feature. */
  check(/voice:\s*liveKitVoiceModel\(req\.voice\)/.test(token),
    "the token puts the resolved voice in the dispatch metadata");
  check(/fromModelString/.test(worker) && /tts:\s*ttsFor\(brief\)/.test(worker),
    "the worker builds its TTS per call from that metadata");
  check(!/tts:\s*new inference\.TTS\(\{ model: TTS_MODEL \}\)/.test(worker),
    "and no longer pins one voice for every call in the process");
  check(/voice\b/.test(client) && /greeting, voice/.test(client),
    "the client sends the voice with the token request");
}


/* =============================================================================
   NO DIRECT TTS VENDOR, ANYWHERE — the standing rule from 9/3/2026
   -----------------------------------------------------------------------------
   "Completely delete everything related to elevenlabs or deepgram... everything to do with
   Voice agents has to go through LiveKit." Deleting the code was the easy half; this is what
   stops it drifting back the next time somebody wants a quick preview or a fallback voice.

   ⚠️ `deepgram/aura-2` and `deepgram/nova-3` are MODEL NAMES inside LiveKit's inference
   gateway, not vendor API calls — so these checks look for the ENDPOINTS and the KEYS, never
   for the word "deepgram", which would fire on a correct file and get deleted as a nuisance.
   ============================================================================= */
{
  const files = ["engine/voicePreview.ts", "server.ts", "vite.config.ts", "src/data/voiceSession.ts",
    "src/screens/AgentWorkflowDetails.tsx", "src/data/liveKitVoice.ts", "agent/voiceAgent.js"];
  /* ⚠️ COMMENTS ARE STRIPPED FIRST, and that is not laziness — the check fired on its own
     documentation. Several files legitimately NAME the retired endpoints while explaining why
     they are gone, and a rule that reddens on a correct file gets deleted as a nuisance. The
     rule is about code, so only code is searched. Line comments are matched anchored to the
     line start so a `https://` inside a string is not mistaken for one. */
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const joined = files.map((f) => stripComments(read(f))).join("\n");
  check(!/api\.deepgram\.com|api\.elevenlabs\.io/.test(joined),
    "no direct Deepgram or ElevenLabs endpoint is called anywhere");
  check(!/process\.env\.(DEEPGRAM_API_KEY|ELEVENLABS_API_KEY)|env\.(DEEPGRAM_API_KEY|ELEVENLABS_API_KEY)/.test(joined),
    "neither vendor's API key is read anywhere");
  /* The retired provider layer must stay retired. */
  check(!existsSync("engine/tts.ts"), "engine/tts.ts is gone");
  check(!existsSync("src/screens/VoiceCall.tsx"), "the browser-speech engine is gone");
  /* ⚠️ BOTH TWINS, because a route living in only one of them is the drift this repo has
     already paid for with /api/status and the demo library. */
  const [dev, prod] = [read("vite.config.ts"), read("server.ts")];
  for (const [name, src] of [["dev plugin", dev], ["server.ts", prod]] as const) {
    check(/\/api\/voice-preview/.test(src), `${name} serves /api/voice-preview`);
    check(!/["'`]\/api\/tts/.test(src), `${name} no longer serves /api/tts`);
  }
  /* The preview must refuse rather than guess when LiveKit is absent — it is the ONLY
     provider now, so an unconfigured server has no voice at all and should say so. */
  check(/LiveKit is not configured/.test(prod) && /LiveKit is not configured/.test(dev),
    "an unconfigured server says LiveKit is missing instead of failing obscurely");
}

check(token.length > 2000 && worker.length > 1500 && client.length > 4000,
  "the audited files were actually read");

console.log(failures ? `\n${failures} voice-contract failure(s)` : "ok    voice pipeline  (87 checks + per-profile)");
process.exit(failures ? 1 : 0);
