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
import { treeToVoicePaths } from "../src/data/voicePaths";
import { deriveUseCases } from "../src/data/voiceUseCases";

const slug = process.argv[2], question = process.argv[3];
const p = JSON.parse(readFileSync(`src/data/generated/${slug}.json`, "utf8"));
const spec = voiceSpecFor(p);

/* The object AgentWorkflow registers: the tree PLUS the agent's config.
   ⚠️⚠️ **THIS READ `spec.segments`, AND THAT FIELD HAS NOT EXISTED SINCE 8/27/2026** — the
   fixed pair of sales segments became `useCases` so both user-group nodes could branch. So
   the harness had been dead with `Cannot read properties of undefined` ever since, and
   nobody noticed, because it is only ever run by hand. The USE CASES now come from the real
   `deriveUseCases`, so the part that actually varies cannot drift again.
   ⚠️ The chrome around them is still spelled out here rather than taken from the screen's
   own `deriveTree`: that function is private to `AgentWorkflow.tsx`, which reaches
   `profiles.ts` and its Vite-only `import.meta.glob`, so Node cannot import it — the same
   wall that sent the chrome constants to `workflowChrome.ts`. Move `deriveTree` to a data
   module if this ever needs to be exact. */
const uc = spec.useCases ?? deriveUseCases(p);
/* ⚠️ THE FIELD IS `collect`, RENDERED AS `chips` — one list, two names, and reading `u.chips`
   here fed the model paths with NO chips at all. That produced a convincing false positive:
   the answers looked like they were deleting the prospect's collected fields when there had
   never been any to delete. Sixth probe-not-code fault recorded in this repo. */
const leafPaths = (list: typeof uc.sales) =>
  list.map((u) => ({ title: u.title, action: "Inform & Route", route: u.route, chips: u.collect }));
const page: Record<string, unknown> = {
  title: `${p.customerName} - Voice workflow`,
  variant: "voice", triggeredBy: "2 campaigns and 0 forms", startLabel: "Voice · classify intent", chromeLocked: true,
  branches: [
    { title: "Sales Inquiry", subtitle: spec.intent.split("\n")[0], locked: true,
      leaves: [{ title: "All Sales Inquiry Users", action: "Qualify", locked: true, paths: leafPaths(uc.sales) }] },
    { title: "Need Support", subtitle: "Existing customer", locked: true,
      leaves: [{ title: "All Support Users", action: "Support & Escalate", locked: true, paths: leafPaths(uc.support) }] },
  ],
  agent: agentConfigOf(spec),
};

/* ⚠️ STREAMS, like the drawer does — so this exercises the SSE path and the director model
   rather than a transport nothing in the app uses any more. Progress is printed as it
   arrives, which is also the quickest way to see the bar is fed by real events. */
const r = await fetch("http://localhost:5173/api/ai-assistant", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerName: p.customerName, dashboardTitle: `${p.customerName} - Voice workflow`,
    dataContext: JSON.stringify(page), question, focus: null, history: [], stream: true,
  }),
});
let result: any, error = "";
{
  const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  const t0 = Date.now();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "progress") process.stdout.write(`\r  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${String(Math.round(ev.pct)).padStart(3)}%  ${ev.phase.padEnd(28)}`);
      else if (ev.type === "done") result = ev.result;
      else if (ev.type === "error") error = ev.error;
    }
  }
  process.stdout.write("\n\n");
}
if (!result) { console.log("ERROR", error || "stream closed with no result"); process.exit(1); }
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
