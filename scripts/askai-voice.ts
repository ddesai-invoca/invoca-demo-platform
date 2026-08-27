/* =============================================================================
   askai-voice.ts — drive the Ask AI voice-agent flow from the terminal
   -----------------------------------------------------------------------------
   `npx tsx scripts/askai-voice.ts <slug> "<instruction>" ["caller line" ...]`

   e.g. npx tsx scripts/askai-voice.ts autonation \
          "greet callers as Max and qualify them by buy vs service" \
          "hi" "i need service" "90210" "Dev Desai"

   Builds the object the workflow page registers (the diagram PLUS `agent`), sends the
   instruction to the real `/api/ai-assistant`, applies the returned edits through the REAL
   `editGuard` (so anything the guard would refuse is refused here too), then talks to the
   agent those edits produced.

   ⚠️ It reports applied / blocked / locked per edit ON PURPOSE. Every bug this feature had
   was an edit that LANDED and changed nothing downstream, so "the drawer said yes" is not
   evidence — seeing the resulting prompt behave is.

   ⚠️ Needs `npm run dev`. RESTART it after touching `engine/assistant.ts` or `engine/chat.ts`:
   both are dynamically imported and Node-cached, and a stale one answers with the old prompt.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { getByPath, isStructuralChange, isLockedEdit } from "../src/data/editGuard";
import { voiceSpecFor, agentConfigOf, specWithConfig, type VoiceAgentConfig } from "../src/data/voiceAgentSpec";
import { collectNames } from "../src/data/workflowDrawers";
import { treeToVoicePaths } from "../src/data/voicePaths";

const slug = process.argv[2], question = process.argv[3];
const p = JSON.parse(readFileSync(`src/data/generated/${slug}.json`, "utf8"));
const spec = voiceSpecFor(p);

/* The object AgentWorkflow registers: the tree PLUS the agent's config. */
const page: Record<string, unknown> = {
  title: `${p.customerName} - Voice workflow`,
  variant: "voice", triggeredBy: "2 campaigns and 0 forms", startLabel: "Voice · classify intent", chromeLocked: true,
  branches: [
    { title: "Sales Inquiry", subtitle: spec.intent.split("\n")[0], locked: true,
      leaves: [{ title: "All Sales Inquiry Users", action: "Qualify", locked: true,
        paths: spec.segments.map((t) => ({ title: t, action: "Inform & Route", chips: collectNames("inform") })) }] },
    { title: "Need Support", subtitle: "Existing customer", locked: true,
      leaves: [{ title: "All Support Users", action: "Support & Escalate", locked: true }] },
  ],
  agent: agentConfigOf(spec),
};

const r = await fetch("http://localhost:5173/api/ai-assistant", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerName: p.customerName, dashboardTitle: `${p.customerName} - Voice workflow`,
    dataContext: JSON.stringify(page), question, focus: null, history: [],
  }),
});
const { result, error } = await r.json();
if (!result) { console.log("ERROR", error ?? JSON.stringify(await r.text()).slice(0, 300)); process.exit(1); }
console.log(`KIND: ${result.kind}`);
console.log(`ANSWER: ${result.answer}\n`);

/* Apply exactly the way AiAssistantContext.applyEdits does: guard, then set. */
function setByPath(root: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: Record<string, unknown> = root;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
}
let applied = 0, blocked = 0, locked = 0;
for (const e of result.edits ?? []) {
  let v: unknown; try { v = JSON.parse(e.value); } catch { v = e.value; }
  const before = getByPath(page, e.path);
  if (isLockedEdit(page, e.path)) { locked++; console.log(`  LOCKED  ${e.path}`); continue; }
  if (isStructuralChange(before, v, e.path)) { blocked++; console.log(`  BLOCKED ${e.path}`); continue; }
  setByPath(page, e.path, v); applied++;
  console.log(`  ok      ${e.path} = ${JSON.stringify(v).slice(0, 110)}`);
}
console.log(`\napplied ${applied}, blocked ${blocked}, locked ${locked}`);

const after = specWithConfig(spec, page.agent as VoiceAgentConfig);
console.log(`\n--- RESULTING AGENT ---`);
console.log(`greeting: ${after.greeting}`);
console.log(`serviceZips: ${JSON.stringify(after.serviceZips)}`);
console.log(`steps:\n${after.informSteps.map((s) => "  " + s).join("\n")}`);
console.log(`\n--- RESULTING DIAGRAM PATHS ---`);
for (const vp of treeToVoicePaths(page as never)) {
  for (const rt of vp.routes) console.log(`  ${vp.intent} > ${rt.need ?? rt.team} [${(rt.collect ?? []).join(", ")}]`);
}

/* ⚠️ THE ONLY PROOF THAT MATTERS: talk to the agent the edits just produced. Everything above
   shows the edits LANDED; this shows they took effect on the phone. */
const lines = process.argv.slice(4);
if (lines.length) {
  const brain = {
    customerName: p.customerName, industry: p.industry ?? "",
    serviceArea: p.reports.agentConfig?.serviceArea,
    serviceZips: after.serviceZips, outOfAreaScript: after.outOfAreaScript,
    voiceGreeting: after.greeting, voiceQualify: after.qualifyQuestion, voiceRules: after.rules, voiceSteps: after.informSteps,
    voicePaths: treeToVoicePaths(page as never),
  };
  const msgs: { role: "user" | "assistant"; content: string }[] = [{ role: "assistant", content: after.greeting }];
  console.log(`\n--- LIVE CALL ---\nAGENT:  ${after.greeting}`);
  for (const line of lines) {
    msgs.push({ role: "user", content: line });
    const rr = await fetch("http://localhost:5173/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ brain, messages: msgs, voice: true }),
    });
    const jj = await rr.json();
    if (!jj.reply) { console.log("ERROR", JSON.stringify(jj).slice(0, 200)); break; }
    console.log(`CALLER: ${line}`);
    console.log(`AGENT:  ${jj.reply}`);
    msgs.push({ role: "assistant", content: jj.reply });
  }
}
