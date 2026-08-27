/* =============================================================================
   voice-sim.mts — talk to ANY prospect's voice agent from the terminal
   -----------------------------------------------------------------------------
   `npx tsx scripts/voice-sim.mts <profile-slug> "line one" "line two" ...`

   e.g.  npx tsx scripts/voice-sim.mts autonation "book a test drive" "30097" "Dev Desai"
         npx tsx scripts/voice-sim.mts orlando-health "book an appointment" "30097"

   ⚠️ **THE SIBLING `voice-call-sim.mts` IS COMFORT KEEPERS ONLY**, with its own assertions
   for that prospect's configured spec. This one is the counterpart for the DERIVED template
   every other prospect now gets: it builds the same brain `VoiceCall.tsx` builds, from the
   same tree the diagram draws, and POSTs to the real `/api/chat`. Keep both — one guards the
   configured shape, one lets you hear the derived shape on any prospect.

   ⚠️ Needs `npm run dev` running. `engine/chat.ts` is dynamically imported and Node-cached,
   so RESTART the dev server after editing the prompt or you are testing the old one.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { voiceSpecFor } from "../src/data/voiceAgentSpec";
import { treeToVoicePaths } from "../src/data/voicePaths";
import { collectNames } from "../src/data/workflowDrawers";

const slug = process.argv[2];
const p = JSON.parse(readFileSync(`src/data/generated/${slug}.json`, "utf8"));
const spec = voiceSpecFor(p);
const paths = treeToVoicePaths({
  variant: "voice",
  branches: [
    { title: "Sales Inquiry", subtitle: spec.intent.split("\n")[0],
      leaves: [{ title: "All Sales Inquiry Users", action: "Qualify",
        paths: spec.segments.map((t: string) => ({ title: t, action: "Inform & Route", chips: collectNames("inform") })) }] },
    { title: "Need Support", subtitle: "Existing customer",
      leaves: [{ title: "All Support Users", action: "Support & Escalate" }] },
  ],
} as never);

const brain = {
  customerName: p.customerName, industry: p.industry ?? "",
  serviceArea: p.reports.agentConfig?.serviceArea,
  serviceZips: spec.serviceZips, outOfAreaScript: spec.outOfAreaScript,
  voiceGreeting: spec.greeting, voiceRules: spec.rules, voiceSteps: spec.informSteps,
  voicePaths: paths,
};

const said = process.argv.slice(3);
const messages: { role: "user" | "assistant"; content: string }[] = [];
messages.push({ role: "assistant", content: spec.greeting });
console.log(`\n=== ${p.customerName} ===\nAGENT: ${spec.greeting}\n`);
for (const line of said) {
  messages.push({ role: "user", content: line });
  const r = await fetch("http://localhost:5173/api/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ brain, messages, voice: true }),
  });
  const j = await r.json();
  if (!j.reply) { console.log("ERROR", JSON.stringify(j).slice(0, 300)); break; }
  console.log(`CALLER: ${line}`);
  console.log(`AGENT:  ${j.reply}\n`);
  messages.push({ role: "assistant", content: j.reply });
}
