/* =============================================================================
   test-copy-paths.ts — walk every path of Aptive's "SMS Test" and "Voice Test"
   -----------------------------------------------------------------------------
   `npx tsx scripts/test-copy-paths.ts sms|voice [--dump] [--only=N]`

   Asked for 10/13/2026: make Preview Agent / Preview Workflow do what the workflow diagram
   says for the two test copies, and *"test all 7 of the paths to confirm its working"*.

   It builds the brain the way the previews do — the copy's own saved tree, else the
   original's (a copy starts as the original's state), else the template — with the same
   read-time repairs the page applies, then holds a scripted conversation down each path
   against the real `/api/chat`. Needs `npm run dev`, restarted after editing `engine/`.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { CustomerProfile } from "../src/data/schema.ts";
import { withoutDefaultPricing, withoutReminderPromises } from "../src/data/agentDefaults.ts";
import { builtInWorkflowBase } from "../src/data/workflowBase.ts";
import { effectiveSmsConfig, repairSalesShape, repairSmsSegments, twoPathGreeting } from "../src/data/smsTemplate.ts";
import { repairSupportUseCases } from "../src/data/voiceUseCases.ts";
import { smsWorkflowFlow } from "../src/data/workflowDrawers.ts";
import { buildSmsBrain, resolveGreeting } from "../src/data/smsBrain.ts";
import { voiceSpecFor, specWithConfig, DEFAULT_SUPPORT_QUALIFY_QUESTION } from "../src/data/voiceAgentSpec.ts";
import { treeToVoicePaths } from "../src/data/voicePaths.ts";
import { smsSystemPromptForAudit, voiceSystemPrompt } from "../engine/chat.ts";

const channel = process.argv[2] === "voice" ? "voice" : "sms";
const dump = process.argv.includes("--dump");
const only = Number(process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? 0);

const demo = JSON.parse(readFileSync(".data/demos/aptive.json", "utf8"));
/* The app's load-time defaults (no pricing unless an SE turns it on), as `ProfileContext` applies them. */
const p = withoutReminderPromises(withoutDefaultPricing(CustomerProfile.parse(demo.profile)));
const ov = demo.customizations?.overrides ?? {};
const ac = { ...(p.reports.agentConfig ?? {}), ...(ov["/agent-studio/agent/preview"] ?? {}) } as never;

const copyPath = `/agent-studio/agent/workflow/${channel}-test`;
const origPath = `/agent-studio/agent/workflow/${channel}`;
const raw = (ov[copyPath] ?? ov[origPath] ?? builtInWorkflowBase(p, channel === "sms")) as any;
const branches = repairSupportUseCases(
  channel === "sms" ? repairSalesShape(repairSmsSegments(raw.branches ?? []), p) : (raw.branches ?? []),
  p, { builtIn: true, withRoute: channel === "voice" },
);
const tree = { ...raw, branches };

let brain: Record<string, unknown>;
let system: string;
let opener: string;
if (channel === "sms") {
  const cfg = effectiveSmsConfig(p, tree.sms);
  const flow = smsWorkflowFlow(p, tree, cfg);
  brain = buildSmsBrain(p, ac, undefined, null, flow, {
    workflowLeads: true, greeting: String(tree.sms?.greeting ?? "").trim() || twoPathGreeting(p),
  }) as never;
  system = smsSystemPromptForAudit(brain as never);
  opener = resolveGreeting((brain as any).openingMessage ?? "", p);
} else {
  const spec = specWithConfig(voiceSpecFor(p)!, tree.agent);
  brain = {
    customerName: p.customerName, industry: p.industry,
    rules: (ac as any)?.brandConversationRules ?? [],
    qaPairs: (ac as any)?.aiRecommendations?.find((r: any) => r.qaPairs?.length)?.qaPairs ?? [],
    knowledge: ((ac as any)?.knowledgeSources ?? []).map((k: { name: string }) => k.name),
    playbook: (ac as any)?.smsPlaybook, serviceArea: (ac as any)?.serviceArea,
    voicePaths: treeToVoicePaths(tree, p, { boxDefaults: true }), voiceWorkflowLeads: true,
    serviceZips: spec?.serviceZips, outOfAreaScript: spec?.outOfAreaScript,
    voiceGreeting: spec?.greeting, voiceQualify: spec?.qualifyQuestion,
    voiceSupportQualify: spec?.supportQualifyQuestion ?? DEFAULT_SUPPORT_QUALIFY_QUESTION,
    voiceRules: spec?.rules, voiceSteps: spec?.informSteps,
  };
  system = voiceSystemPrompt(brain as never);
  opener = String(spec?.greeting ?? "");
}

/* Every path in the diagram, sales then support, as the agent should see it. */
const paths: string[] = [];
for (const b of branches) for (const l of b.leaves ?? []) for (const x of l.paths ?? []) paths.push(`${b.title} › ${x.title}`);

if (dump) {
  console.log(`# ${channel.toUpperCase()} Test — ${paths.length} paths\n${paths.map((x, i) => `  ${i + 1}. ${x}`).join("\n")}`);
  console.log(`\n# opener\n${opener}\n\n# prompt\n${system}`);
  process.exit(0);
}

/* One scripted customer per path. Answers are written to satisfy whichever follow-up the
   agent asks next, so the script does not depend on exact wording. */
const SMS_SCRIPTS: string[][] = [
  ["Hi, we've got ants all over the kitchen and some spiders in the garage.", "About 2,000 square feet.", "Indoor and outdoor please, no mosquito or rodent add-ons.", "This week if possible.", "85018", "The first time works.", "Dana Whitfield"],
  ["We have wasps nesting under the deck and a lot of mosquitoes in the yard.", "Around 1,800 square feet with a big backyard.", "Outdoor mainly, and yes to mosquito protection.", "As soon as you can.", "85018", "The second option please.", "Marco Reyes"],
  ["I'd like to sign up for a recurring quarterly pest plan for my house.", "About 2,400 square feet.", "Both indoor and outdoor, plus rodent protection.", "Next week is fine.", "85018", "Either works, take the first.", "Priya Shah"],
  ["You treated my house a few weeks ago but the ants are back already.", "4521 Desert Palm Drive, Phoenix 85018.", "About a week after the visit, mostly in the kitchen.", "Thursday morning, the first option.", "Great, thanks."],
  ["I need to move my service appointment, I can't do next Tuesday anymore.", "Dana Whitfield, 4521 Desert Palm Drive.", "This Thursday afternoon, around 2pm.", "Yes, that works, thank you."],
  ["There's a charge on my card from Aptive I don't recognize.", "It's under Marco Reyes, charged on the 3rd.", "Okay that makes sense, thanks."],
  ["Can I update the gate code for my technician?", "4521 Desert Palm Drive, Phoenix.", "The new code is 2468.", "Thanks!"],
];
const VOICE_SCRIPTS: string[][] = [
  /* Each sales path's answers follow what its box collects: ZIP (the service-area gate), then the
     box's own fields, in order. */
  ["Hi, I'm interested in starting pest control service, I'm ready to book.", "85018", "Dana Whitfield", "4521 Desert Palm Drive, Phoenix.", "As soon as possible.", "Yes, go ahead."],
  ["I'm just comparing a few pest companies right now, what do you offer?", "85018", "Marco Reyes", "marco.reyes@example.com", "1200 East Camelback Road, Phoenix.", "Sure, go ahead."],
  ["I manage a few rental properties and want service for all of them.", "85018", "Priya Shah", "Three homes.", "Within the next month.", "Yes please."],
  ["You treated my house recently and the ants came back.", "4521 Desert Palm Drive, Phoenix 85018.", "About a week after the visit, mostly in the kitchen.", "Thursday morning works.", "Yes, thanks."],
  ["I need to reschedule my upcoming service appointment.", "Dana Whitfield, 4521 Desert Palm Drive.", "This Thursday afternoon, around 2pm.", "Yes, that works, thanks."],
  ["I have a question about a charge on my bill.", "Marco Reyes, it was on the 3rd.", "Okay, thank you."],
  ["I want to update the gate code for my technician.", "4521 Desert Palm Drive, Phoenix.", "It's 2468.", "Thanks."],
];
const scripts = channel === "sms" ? SMS_SCRIPTS : VOICE_SCRIPTS;

/* ── --sim: a simulated customer answers whatever the agent actually asks ───────────── */
const PERSONAS: string[] = [
  "You are Dana Whitfield, a new customer. You have ants in the kitchen and spiders in the garage and want to book. Home is about 2,000 sq ft, you want indoor and outdoor, no mosquito or rodent add-ons, as soon as possible this week. ZIP 85018, address 4521 Desert Palm Drive, Phoenix. Email dana.whitfield@example.com.",
  "You are Marco Reyes, a new customer comparing pest companies. Wasps under the deck and mosquitoes in the yard. About 1,800 sq ft with a big backyard, outdoor mainly, yes to mosquito protection, as soon as possible. ZIP 85018, address 1200 East Camelback Road, Phoenix. Email marco.reyes@example.com.",
  "You are Priya Shah. You want a recurring quarterly pest plan; you manage three rental homes but mainly want your own 2,400 sq ft home covered first, indoor and outdoor plus rodent protection, next week. ZIP 85018, address 77 North Seventh Street, Phoenix. Email priya.shah@example.com.",
  "You are Dana Whitfield, an existing customer. Aptive treated your home at 4521 Desert Palm Drive, Phoenix 85018 a few weeks ago and the ants came back about a week later, mostly in the kitchen. You want them fixed; Thursday morning suits you.",
  "You are Dana Whitfield, an existing customer at 4521 Desert Palm Drive, Phoenix. Your appointment is next Tuesday and you need to move it to this Thursday afternoon around 2pm.",
  "You are Marco Reyes, an existing customer. There is a $149 charge on your card from Aptive on the 3rd that you do not recognise. Your account is under your name, address 1200 East Camelback Road, Phoenix.",
  "You are Dana Whitfield, an existing customer at 4521 Desert Palm Drive, Phoenix. You want to update the gate code for your technician to 2468.",
];
const OPENERS_SMS = [SMS_SCRIPTS, ""].length ? SMS_SCRIPTS.map((x) => x[0]) : [];
const OPENERS_VOICE = VOICE_SCRIPTS.map((x) => x[0]);
async function say(b: Record<string, unknown>, msgs: { role: string; content: string }[], voice: boolean): Promise<string> {
  const res = await fetch("http://localhost:5173/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brain: b, messages: msgs, ...(voice ? { voice: true } : {}) }),
  });
  const j = (await res.json()) as { reply?: string; error?: string };
  return j.reply ?? `(error ${res.status} ${j.error ?? ""})`;
}
if (process.argv.includes("--sim")) {
  for (let i = 0; i < PERSONAS.length; i++) {
    if (only && only !== i + 1) continue;
    console.log(`\n=========== PATH ${i + 1}: ${paths[i]} ===========`);
    const caller = {
      customerName: "Customer", customSystem:
        `${PERSONAS[i]}\nYou are the CUSTOMER talking to ${p.customerName}'s AI agent by ${channel === "sms" ? "text message" : "phone"}. ` +
        `Answer exactly what the agent just asked, briefly and naturally, using the details above; never volunteer a detail it did not ask for. ` +
        `If it offers times, pick the first one that fits you. Once it has confirmed what you wanted, or says it is transferring you, reply with a short thanks and the word DONE.`,
    };
    const agentMsgs: { role: string; content: string }[] = opener ? [{ role: "assistant", content: opener }] : [];
    if (opener) console.log(`AGENT : ${opener}`);
    /* The customer answers the GREETING itself, so the opener is what steers them down a path. */
    let line = opener
      ? (await say(caller, [{ role: "user", content: "(the agent picks up)" }, { role: "user", content: opener }].slice(1).map((m) => ({ ...m, role: "user" })), false)).replace(/\s+/g, " ").trim()
      : (channel === "sms" ? OPENERS_SMS : OPENERS_VOICE)[i];
    for (let turn = 0; turn < 9; turn++) {
      agentMsgs.push({ role: "user", content: line });
      console.log(`USER  : ${line}`);
      if (/\bDONE\b/.test(line)) break;
      const reply = await say(brain, agentMsgs, channel === "voice");
      agentMsgs.push({ role: "assistant", content: reply });
      console.log(`AGENT : ${reply}`);
      /* The caller sees the conversation with the roles flipped. */
      const flipped = agentMsgs.map((m) => ({ role: m.role === "user" ? "assistant" : "user", content: m.content }));
      if (flipped[0]?.role === "assistant") flipped.unshift({ role: "user", content: "(the agent picks up)" });
      line = (await say(caller, flipped, false)).replace(/\s+/g, " ").trim();
    }
  }
  process.exit(0);
}

for (let i = 0; i < scripts.length; i++) {
  if (only && only !== i + 1) continue;
  console.log(`\n=========== PATH ${i + 1}: ${paths[i] ?? "(no matching path)"} ===========`);
  const messages: { role: string; content: string }[] = opener ? [{ role: "assistant", content: opener }] : [];
  if (opener) console.log(`AGENT : ${opener}`);
  for (const line of scripts[i]) {
    messages.push({ role: "user", content: line });
    const res = await fetch("http://localhost:5173/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brain, messages, ...(channel === "voice" ? { voice: true } : {}) }),
    });
    const j = (await res.json()) as { reply?: string; error?: string };
    const reply = j.reply ?? `(error ${res.status} ${j.error ?? ""})`;
    messages.push({ role: "assistant", content: reply });
    console.log(`USER  : ${line}\nAGENT : ${reply}`);
  }
}
