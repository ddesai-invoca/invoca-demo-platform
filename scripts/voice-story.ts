/* =============================================================================
   voice-story.ts — drive the whole (Voice AI) story from the terminal
   -----------------------------------------------------------------------------
   `npx tsx scripts/voice-story.ts <slug> "line" "line" ...`

   Has the call through the real `/api/chat`, sends the transcript to the real `/api/analyze`,
   then builds BOTH artifacts exactly as My Reports does and reports what they contain. The one
   thing that matters is that the department on the routing demo and the screenpop is the
   department the agent actually said — so this prints all three side by side.

   ⚠️ Needs `npm run dev`, and a RESTART after editing engine/analyze.ts or engine/chat.ts.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { voiceSpecFor } from "../src/data/voiceAgentSpec";
import { treeToVoicePaths } from "../src/data/voicePaths";
import { latestTransferredCall, voiceAiRouting, voiceAiScreenpop } from "../src/data/voiceAiArtifacts";
import { renderArtifact, VOICE_AI_ROUTING_ID, VOICE_AI_SCREENPOP_ID } from "../src/artifacts";

const slug = process.argv[2];
const lines = process.argv.slice(3);
const p = JSON.parse(readFileSync(`src/data/generated/${slug}.json`, "utf8"));
const spec = voiceSpecFor(p);
const node = (u: { title: string; collect: string[]; route?: string }) => ({
  title: u.title, action: "Inform & Route", chips: u.collect, ...(u.route ? { route: u.route } : {}),
});
const voicePaths = treeToVoicePaths({ variant: "voice", branches: [
  { title: "Sales Inquiry", leaves: [{ title: "All Sales Inquiry Users", action: "Qualify", paths: spec.useCases.sales.map(node) }] },
  { title: "Need Support", leaves: [{ title: "All Support Users", action: "Support & Escalate",
    ...(spec.useCases.support.length ? { paths: spec.useCases.support.map(node) } : {}) }] },
]} as never);

const brain = { customerName: p.customerName, industry: p.industry ?? "",
  serviceArea: p.reports.agentConfig?.serviceArea, serviceZips: spec.serviceZips,
  outOfAreaScript: spec.outOfAreaScript, voiceGreeting: spec.greeting,
  voiceQualify: spec.qualifyQuestion, voiceRules: spec.rules, voiceSteps: spec.informSteps, voicePaths };

const msgs: { role: "user" | "assistant"; content: string }[] = [{ role: "assistant", content: spec.greeting }];
console.log(`\n=== ${p.customerName} ===\nAGENT:  ${spec.greeting}`);
for (const line of lines) {
  msgs.push({ role: "user", content: line });
  const r = await fetch("http://localhost:5173/api/chat", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ brain, messages: msgs, voice: true }) });
  const j = await r.json();
  if (!j.reply) { console.log("CHAT ERROR", JSON.stringify(j).slice(0, 200)); process.exit(1); }
  console.log(`CALLER: ${line}\nAGENT:  ${j.reply}`);
  msgs.push({ role: "assistant", content: j.reply });
}

const transcript = msgs.map((m) => ({ speaker: m.role === "assistant" ? "agent" : "consumer", text: m.content }));
const ar = await fetch("http://localhost:5173/api/analyze", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ customerName: p.customerName, bookingTerm: p.bookingTerm,
    customerNoun: p.customerNoun, channel: "voice", transcript,
    destinations: [...new Set(voicePaths.flatMap((v) => v.routes.map((r) => r.team)).filter(Boolean))] }) });
const { signals, outcome } = await ar.json();
console.log(`\n--- ANALYZE ---\noutcome: ${JSON.stringify(outcome)}\nsignals: ${(signals ?? []).map((s: never) => (s as never as {name:string}).name).join(" | ")}`);

const conv = { id: "TEST", time: "", active: true, date: "", transcript, signals: signals ?? [], outcome } as never;
const call = latestTransferredCall([conv]);
if (!call) { console.log("\nNo artifacts: the call did not end in a transfer (this is the gate working)."); process.exit(0); }

const routing = voiceAiRouting(p, call)!;
const pop = voiceAiScreenpop(p, call)!;
console.log(`\n--- VOICE ROUTING DEMO (Voice AI) ---`);
console.log(`winner queue : ${routing.queues[0].name}`);
console.log(`other queues : ${routing.queues.slice(1).map((q) => q.name).join(" | ")}`);
console.log(`subtitle     : ${routing.routedSubtitle}`);
console.log(`turns        : ${routing.convo.length} (signals attached: ${routing.convo.reduce((n, t) => n + t.sigs.length, 0)})`);
console.log(`confidence   : ${routing.convo.map((t) => t.q[0]).join(" -> ")}`);
console.log(`\n--- VOICE SCREENPOP (Voice AI) ---`);
console.log(`callerName   : ${pop.callerName}`);
console.log(`intent       : ${pop.intent}`);
console.log(`coverage     : ${pop.coverage}`);
console.log(`switchIntent : ${pop.switchIntent}`);
console.log(`tagBlue      : ${pop.tagBlue}`);
console.log(`greeting     : ${pop.greeting}`);
const h1 = renderArtifact(p, VOICE_AI_ROUTING_ID, { voiceRoutingDemo: routing });
const h2 = renderArtifact(p, VOICE_AI_SCREENPOP_ID, { voiceScreenpop: pop });
console.log(`\nrendered: routing ${h1 ? h1.length + " bytes" : "FAILED"}, screenpop ${h2 ? h2.length + " bytes" : "FAILED"}`);
