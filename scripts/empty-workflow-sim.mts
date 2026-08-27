/* =============================================================================
   empty-workflow-sim.mts — hear the preview of a workflow Create Workflow just built
   -----------------------------------------------------------------------------
   `npx tsx scripts/empty-workflow-sim.mts <profile-slug> "line one" "line two" ...`

   e.g.  npx tsx scripts/empty-workflow-sim.mts marriott "i want to book a room in new york"
         npx tsx scripts/empty-workflow-sim.mts marriott "i need to cancel my reservation"

   Builds the SAME minimal brain `useBrain({ minimal: true })` builds for a created
   workflow's Preview Workflow drawer, and POSTs to the real `/api/chat`. The point is the
   behaviour asked for: greet, ask how it can help, decide sales or support from the answer,
   say which, transfer, and ask NOTHING else.

   ⚠️ Its sibling `voice-sim.mts` drives the CONFIGURED workflow. Keep both: one hears what a
   prospect's real agent does, this one hears what an empty workflow does, and the whole point
   of the minimal flow is that those two are different.
   ⚠️ Needs `npm run dev` running, and `engine/chat.ts` is Node-cached — RESTART the dev
   server after editing the prompt or you are hearing the old one.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { emptyWorkflowGreeting } from "../src/data/workflowChrome";

const slug = process.argv[2];
const p = JSON.parse(readFileSync(`src/data/generated/${slug}.json`, "utf8"));
const greeting = emptyWorkflowGreeting(p.customerName);

/* ⚠️ EVERY CONFIGURED FIELD IS DELIBERATELY ABSENT — no serviceArea, no serviceZips, no
   steps, no rules, no paths. That is what `useBrain` passes when `minimal` is set, and
   including any of them here would test a brain the app never builds. */
const brain = {
  customerName: p.customerName,
  industry: p.industry ?? "",
  voiceMinimal: true,
  voiceGreeting: greeting,
};

const said = process.argv.slice(3);
const messages: { role: "user" | "assistant"; content: string }[] = [];
messages.push({ role: "assistant", content: greeting });
console.log(`\n=== ${p.customerName} — empty workflow ===\nAGENT:  ${greeting}\n`);
let last = "";
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
  last = j.reply;
}

/* The two things that must be true of the last line, and the things that must never appear. */
const norm = last.replace(/[‘’]/g, "'");   /* the curly-apostrophe trap */
const team = /sales team/i.test(norm) ? "sales" : /support team/i.test(norm) ? "support" : "none";
console.log(`transferred to: ${team}`);
const banned = [/zip/i, /travel date/i, /confirmation number/i, /what is your name/i];
const leaked = banned.filter((b) => messages.some((m) => m.role === "assistant" && b.test(m.content)));
console.log(leaked.length ? `LEAKED configured questions: ${leaked.join(", ")}` : "asked nothing beyond the flow");
