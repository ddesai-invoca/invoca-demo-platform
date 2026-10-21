/* =============================================================================
   `npx tsx scripts/test-appointment-endings.ts <profile-or-demo-id> "<persona>"`
   -----------------------------------------------------------------------------
   Books an appointment over SMS with a SIMULATED customer and prints the conversation, so the
   ending can be read: does the agent say HOW the appointment happens (home, location with a
   real address, phone, video)? Asked for 10/21/2026. Builds the brain exactly as the Preview
   Agent does for the regular SMS workflow; needs `npm run dev` (it calls /api/chat).
   ============================================================================= */
import { readFileSync, existsSync } from "node:fs";
import { CustomerProfile } from "../src/data/schema.ts";
import { withoutDefaultPricing, withoutReminderPromises } from "../src/data/agentDefaults.ts";
import { builtInWorkflowBase } from "../src/data/workflowBase.ts";
import { effectiveSmsConfig, repairSalesShape, repairSmsSegments, twoPathGreeting } from "../src/data/smsTemplate.ts";
import { repairSupportUseCases } from "../src/data/voiceUseCases.ts";
import { smsWorkflowFlow } from "../src/data/workflowDrawers.ts";
import { buildSmsBrain, resolveGreeting } from "../src/data/smsBrain.ts";

const id = process.argv[2];
const persona = process.argv[3] ?? "You want to book the soonest appointment. Your name is Dana Whitfield, ZIP 32806.";
const paths = [`.data/demos/${id}.json`, `src/data/generated/${id}.json`, `engine/event-seeds/${id}.json`];
const file = paths.find((f) => existsSync(f));
if (!id || !file) { console.error(`usage: test-appointment-endings.ts <id> "<persona>"`); process.exit(1); }
const raw = JSON.parse(readFileSync(file, "utf8"));
const p = withoutReminderPromises(withoutDefaultPricing(CustomerProfile.parse(raw.profile ?? raw)));
const ov = raw.customizations?.overrides ?? {};
const ac = { ...(p.reports.agentConfig ?? {}), ...(ov["/agent-studio/agent/preview"] ?? {}) } as never;
const tree0 = (ov["/agent-studio/agent/workflow/sms"] ?? builtInWorkflowBase(p, true)) as any;
const branches = repairSupportUseCases(repairSalesShape(repairSmsSegments(tree0.branches ?? []), p), p, { builtIn: true, withRoute: false });
const tree = { ...tree0, branches };
const cfg = effectiveSmsConfig(p, tree.sms);
const brain = buildSmsBrain(p, ac, undefined, null, smsWorkflowFlow(p, tree, cfg), {
  workflowLeads: true, greeting: String(tree.sms?.greeting ?? "").trim() || twoPathGreeting(p),
}) as any;
const opener = resolveGreeting(brain.openingMessage ?? "", p);
console.log(`# ${p.customerName} — appointment mode: ${brain.appointment?.mode}\n`);

async function say(b: unknown, msgs: { role: string; content: string }[]): Promise<string> {
  const res = await fetch("http://localhost:5173/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brain: b, messages: msgs }),
  });
  const j = (await res.json()) as { reply?: string; error?: string };
  return j.reply ?? `(error ${res.status} ${j.error ?? ""})`;
}
const caller = {
  customerName: "Customer", customSystem:
    `${persona}\nYou are the CUSTOMER texting ${p.customerName}'s AI agent. Answer exactly what it just asked, briefly, using the details above; never volunteer a detail it did not ask for. ` +
    `If it offers times, pick the first. After it confirms the booking, ask ONE follow-up: "How does it work, where do I go?" Then, once it answers, reply with a short thanks and the word DONE.`,
};
const msgs: { role: string; content: string }[] = [{ role: "assistant", content: opener }];
console.log(`AGENT : ${opener}`);
let line = (await say(caller, [{ role: "user", content: opener }])).replace(/\s+/g, " ").trim();
for (let turn = 0; turn < 12; turn++) {
  msgs.push({ role: "user", content: line });
  console.log(`USER  : ${line}`);
  if (/\bDONE\b/.test(line)) break;
  const reply = await say(brain, msgs);
  msgs.push({ role: "assistant", content: reply });
  console.log(`AGENT : ${reply}`);
  const flipped = msgs.map((m) => ({ role: m.role === "user" ? "assistant" : "user", content: m.content }));
  if (flipped[0]?.role === "assistant") flipped.unshift({ role: "user", content: "(the agent texts)" });
  line = (await say(caller, flipped)).replace(/\s+/g, " ").trim();
}
