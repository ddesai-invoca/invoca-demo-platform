/* =============================================================================
   demo-voice-sim.ts — talk to a LIBRARY demo's voice agent, with its AI edits applied
   -----------------------------------------------------------------------------
   `npx tsx scripts/demo-voice-sim.ts <demo-id> "caller line" ["line" ...]`
   `npx tsx scripts/demo-voice-sim.ts avi-co --prompt`      (print the built prompt)

   e.g. npx tsx scripts/demo-voice-sim.ts avi-co "hi" "i want to buy a watch" "80202"

   ⚠️ WHY THIS EXISTS ALONGSIDE `voice-sim.mts` AND `askai-voice.ts`. Both of those read
   `src/data/generated/<slug>.json`, so neither can reach a prospect that lives only in the
   shared demo LIBRARY — which is most real ones, and every one an SE has actually tuned with
   Ask AI. Avi & Co's three-showroom bug was in a library demo's saved override layer and was
   invisible to both existing harnesses.

   It rebuilds the brain exactly as `useBrain` does — the page's effective tree and `agent`
   laid over the base spec — then talks to the real `/api/chat`, so what you read here is what
   a caller hears.

   ⚠️ Needs `npm run dev`, and a RESTART after touching `engine/chat.ts` or
   `engine/assistant.ts`: both are dynamically imported and Node-cached, so a stale one
   answers with the old prompt and the run looks like a code failure.
   ============================================================================= */
import { readFileSync, readdirSync } from "node:fs";
import { voiceSpecFor, specWithConfig } from "../src/data/voiceAgentSpec.ts";
import { bookingSlots } from "../src/data/voiceBooking.ts";
import { treeToVoicePaths } from "../src/data/voicePaths.ts";
import { voiceSystemPrompt } from "../engine/chat.ts";

const DIR = process.env.DATA_DIR ? `${process.env.DATA_DIR}/demos` : ".data/demos";
const VOICE_PATH = "/agent-studio/agent/workflow/voice";
const AGENT_PATH = "/agent-studio/agent/preview";

const id = process.argv[2];
if (!id) {
  console.log(`usage: npx tsx scripts/demo-voice-sim.ts <demo-id> "line" ...\n\navailable:`);
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) console.log(`   ${f.replace(".json", "")}`);
  process.exit(1);
}
const demo = JSON.parse(readFileSync(`${DIR}/${id}.json`, "utf8"));
const p = demo.profile;
const ov = demo.customizations?.overrides ?? {};
const tree = ov[VOICE_PATH];
/* The Preview Agent page's scope governs `agentConfig` for BOTH channels — the same reason
   `useBrain` reads it there rather than off the profile. */
const ac = { ...(p.reports.agentConfig ?? {}), ...(ov[AGENT_PATH] ?? {}) };
const spec = specWithConfig(voiceSpecFor(p)!, tree?.agent);

const brain: Record<string, unknown> = {
  customerName: p.customerName,
  industry: p.industry,
  rules: ac?.brandConversationRules ?? [],
  qaPairs: ac?.aiRecommendations?.find((r: { qaPairs?: unknown[] }) => r.qaPairs?.length)?.qaPairs ?? [],
  knowledge: (ac?.knowledgeSources ?? []).map((k: { name: string }) => k.name),
  playbook: ac?.smsPlaybook,
  serviceArea: ac?.serviceArea,
  voicePaths: treeToVoicePaths(tree),
  serviceZips: spec?.serviceZips,
  outOfAreaScript: spec?.outOfAreaScript,
  voiceGreeting: spec?.greeting,
  voiceQualify: spec?.qualifyQuestion,
  voiceRules: spec?.rules,
  voiceSteps: spec?.informSteps,
};

/* ⚠️ `--wf=<slug>` DRIVES AN EXTRA VOICE WORKFLOW, mirroring what `AgentWorkflow` passes as
   `brainOpts.booking`. Without it this harness could only ever exercise the prospect's
   built-in routing agent — and a booking workflow whose prompt is never built is exactly the
   kind of thing that ships looking right and behaves like the old agent. */
const wfArg = process.argv.slice(3).find((a) => a.startsWith("--wf="))?.slice(5);
if (wfArg) {
  const wf = (p.reports.extraWorkflows ?? []).find((w: { slug: string }) => w.slug === wfArg);
  if (!wf) { console.log(`no workflow "${wfArg}" on ${id}`); process.exit(1); }
  if (!wf.bookingLocations?.length) { console.log(`"${wfArg}" is not a booking workflow`); process.exit(1); }
  const wfTree = ov[`/agent-studio/agent/workflow/${wfArg}`];
  brain.voiceBooking = true;
  brain.voiceBookingLocations = wf.bookingLocations;
  brain.voiceBookingSlots = bookingSlots(p.id);
  brain.voiceGreeting = wfTree?.agent?.greeting || wf.openingMessage;
  /* The booking flow owns the location policy; the routing gate and steps must not also be
     in the prompt — see the note in voiceSession.ts. */
  brain.serviceZips = undefined;
  brain.outOfAreaScript = undefined;
  brain.voiceQualify = undefined;
  brain.voiceSteps = undefined;
  brain.voiceRules = undefined;   // the routing workflow's rules are not this one's
  brain.voicePaths = [];
}

const lines = process.argv.slice(3).filter((a) => !a.startsWith("--"));
if (!lines.length || lines[0] === "--prompt") {
  console.log(`# ${demo.prospect} — the prompt the agent is actually given\n`);
  console.log(voiceSystemPrompt(brain as never));
  process.exit(0);
}

console.log(`# ${demo.prospect}  (edits applied: ${tree?.agent ? Object.keys(tree.agent).join(", ") : "none"})`);
const messages: { role: string; content: string }[] = [];
for (const line of lines) {
  messages.push({ role: "user", content: line });
  const res = await fetch("http://localhost:5173/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brain, messages, voice: true }),
  });
  const j = (await res.json()) as { reply?: string };
  const reply = j.reply ?? `(error ${res.status})`;
  messages.push({ role: "assistant", content: reply });
  console.log(`\nCALLER: ${line}`);
  console.log(`AGENT : ${reply}`);
}
