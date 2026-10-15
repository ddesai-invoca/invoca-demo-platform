/* =============================================================================
   audit-sync — the workflow always matches what the agent does
   -----------------------------------------------------------------------------
   Asked for 10/14/2026: any Ask AI change to the SMS or voice agent must show in the workflow
   (branches, drawers, pills, collected fields), and the other way round. Calls the real
   functions against real profiles; nothing here is a grep of the source except the wiring.
   ============================================================================= */
import fs from "node:fs";
import { CustomerProfile } from "../src/data/schema";
import { syncAgentWorkflow, workflowShapeOk, questionsInBook, bookWithQuestions, lastQuestion } from "../src/data/agentWorkflowSync";
import { builtInWorkflowBase } from "../src/data/workflowBase";
import { previewAgentBase, extraWorkflowFlowText } from "../src/data/smsBrain";
import { effectiveSmsConfig } from "../src/data/smsTemplate";
import { smsWorkflowFlow } from "../src/data/workflowDrawers";
import { treeToVoicePaths } from "../src/data/voicePaths";
import { voiceSpecFor, specWithConfig } from "../src/data/voiceAgentSpec";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const load = (slug: string) => CustomerProfile.parse(JSON.parse(fs.readFileSync(`src/data/generated/${slug}.json`, "utf8")));
const p = load("cleveland-clinic");
const pid = p.id;
const PK = `${pid}::/agent-studio/agent/preview`;
const WK = `${pid}::/agent-studio/agent/workflow/sms`;
const VK = `${pid}::/agent-studio/agent/workflow/voice`;
const store: Record<string, unknown> = {
  [PK]: previewAgentBase(p),
  [WK]: builtInWorkflowBase(p, true),
  [VK]: builtInWorkflowBase(p, false),
};
const read = (k: string) => store[k];
const apply = (k: string, next: Record<string, unknown>) => {
  const before = store[k];
  const out = syncAgentWorkflow(k, before, next, read);
  store[k] = out.find((o) => o.key === k)?.data ?? next;
  for (const o of out) if (o.key !== k) store[o.key] = o.data;
  return out;
};
type Any = Record<string, any>;

console.log("\nSMS: an edit on the Preview Agent moves the workflow\n");
{
  const pv = store[PK] as Any;
  const qs = ["What kind of care do you need today?", "Is this for you or a family member?", "Do you have insurance with us?", "What ZIP code are you in?"];
  apply(PK, { ...pv, smsPlaybook: { ...pv.smsPlaybook, qualifyingQuestions: qs } });
  const wf = store[WK] as Any;
  wf.sms.qualify.root.question === qs[0] ? ok("the workflow's Qualify question becomes the agent's new first question") : bad(`root question is "${wf.sms.qualify.root.question}"`);
  JSON.stringify(questionsInBook(wf.sms.inform.book)) === JSON.stringify(qs.slice(1)) ? ok("the service-line boxes now list the agent's new follow-up questions") : bad(`book lists ${JSON.stringify(questionsInBook(wf.sms.inform.book))}`);
  /^Sorry, I didn't quite catch that\. What kind of care/.test(wf.sms.qualify.root.fallback) ? ok("the reprompt follows the new question") : bad("reprompt is stale");
  const flow = smsWorkflowFlow(p, wf as never, effectiveSmsConfig(p, wf.sms));
  JSON.stringify(flow).includes(qs[2]) ? ok("the agent's workflow block carries the new question") : bad("the agent's workflow block does not carry the new question");
  const rules = ["Tone: calm and brief.", "Never ask for a full Social Security number."];
  apply(PK, { ...(store[PK] as Any), brandConversationRules: rules });
  JSON.stringify((store[WK] as Any).sms.intents.sales.rules) === JSON.stringify(rules) ? ok("brand rules edited on the Preview Agent show in the Sales Inquiry drawer") : bad("the intent drawer still shows the old rules");
}

console.log("\nSMS: an edit on the workflow moves the agent\n");
{
  const wf = store[WK] as Any;
  const next = JSON.parse(JSON.stringify(wf));
  next.sms.qualify.root.question = "Which Cleveland Clinic service can I help you with?";
  next.sms.inform.book = bookWithQuestions(next.sms.inform.book, ["Is this your first visit with us?", "What ZIP code are you in?"]);
  next.sms.intents.sales.rules = ["Tone: warm."];
  apply(WK, next);
  const pv = store[PK] as Any;
  JSON.stringify(pv.smsPlaybook.qualifyingQuestions) === JSON.stringify(["Which Cleveland Clinic service can I help you with?", "Is this your first visit with us?", "What ZIP code are you in?"])
    ? ok("the Qualify question and the box's questions become the agent's question list") : bad(`agent asks ${JSON.stringify(pv.smsPlaybook.qualifyingQuestions)}`);
  JSON.stringify(pv.brandConversationRules) === JSON.stringify(["Tone: warm."]) ? ok("rules edited in the intent drawer become the agent's brand rules") : bad("brand rules did not follow");
  const unrelated = JSON.parse(JSON.stringify(store[WK]));
  unrelated.title = "renamed";
  syncAgentWorkflow(WK, store[WK], unrelated, read).length === 0 ? ok("an edit that touches no shared fact changes nothing else") : bad("an unrelated edit rewrote the agent");
}

console.log("\nVoice: the greeting and its question are one fact\n");
{
  const v = store[VK] as Any;
  const g = "Hi, thanks for calling Cleveland Clinic. Are you scheduling a visit, or calling about care you already have?";
  apply(VK, { ...v, agent: { ...v.agent, greeting: g } });
  const a = (store[VK] as Any).agent;
  a.qualifyQuestion === "Are you scheduling a visit, or calling about care you already have?" ? ok("a new greeting's question becomes the Qualify drawer's question") : bad(`qualify is "${a.qualifyQuestion}"`);
  a.rules.some((r: string) => r.endsWith(g)) ? ok("the greeting's copy in the rules follows") : bad("the rules still quote the old greeting");
  apply(VK, { ...(store[VK] as Any), agent: { ...a, qualifyQuestion: "Is this a new visit, or one already on the books?" } });
  const b = (store[VK] as Any).agent;
  b.greeting.endsWith("Is this a new visit, or one already on the books?") ? ok("a new Qualify question becomes what the greeting asks") : bad(`greeting is "${b.greeting}"`);
  const spec = specWithConfig(voiceSpecFor(p)!, b);
  spec.intent.includes(b.greeting) ? ok("the Sales Inquiry drawer quotes the greeting the caller hears") : bad("the intent drawer quotes a stale greeting");
  lastQuestion("Hello there.") === null ? ok("a greeting with no question leaves the Qualify question alone") : bad("lastQuestion invented a question");
}

console.log("\nThe diagram's structure is what the voice agent follows\n");
{
  const v = JSON.parse(JSON.stringify(store[VK])) as Any;
  const path = v.branches[0].leaves[0].paths[0];
  path.action = "Qualify"; path.actionKind = "qualify";
  path.paths = [{ title: "First visit", action: "Inform & Route", actionKind: "informRoute", chips: ["Consumer Name"], route: "New Patient Team" },
                { title: "Follow-up visit", action: "Inform & Route", actionKind: "informRoute", chips: ["Patient ID"], route: "Scheduling" }];
  v.agent["extra__path-0-0-0__question"] = "Is this your first visit, or a follow-up?";
  const routes = treeToVoicePaths(v, p).flatMap((x) => x.routes);
  routes.some((r) => /First visit/.test(r.need ?? "") && /first visit, or a follow-up/.test(r.need ?? "") && r.team === "New Patient Team")
    ? ok("a Qualify added under a use case is asked, and each answer routes where the diagram says") : bad("the nested Qualify did not reach the call");
  workflowShapeOk(v) ? ok("two Qualify layers is a valid tree") : bad("a valid two-layer tree was refused");
  const deep = JSON.parse(JSON.stringify(v));
  deep.branches[0].leaves[0].paths[0].paths[0].paths = [{ title: "x", action: "Inform" }];
  !workflowShapeOk(deep) ? ok("a third Qualify layer is refused") : bad("a fourth row was allowed");
  const terminal = JSON.parse(JSON.stringify(store[VK]));
  terminal.branches[0].leaves[0].paths[1].paths = [{ title: "x", action: "Inform" }];
  !workflowShapeOk(terminal) ? ok("answers under a terminal action are refused") : bad("a terminal action was allowed answers");
  const boxes = treeToVoicePaths(store[VK] as never, p, { boxDefaults: true }).find((x) => /Support/.test(x.intent))?.routes ?? [];
  boxes.every((r) => r.instruction) ? ok("every support box's drawer text reaches the call") : bad("a support box's text does not reach the call");
}

console.log("\nExtra workflows: the diagram reaches the agent\n");
{
  const t = extraWorkflowFlowText([{ title: "Sales Inquiry", leaves: [{ title: "All Sales Inquiry Users", action: "Qualify", paths: [{ title: "Wants care sooner", action: "Inform", chips: ["Consumer Name"], instruction: "Offer the nearest urgent care." }] }] }]) ?? "";
  /Wants care sooner \[Inform\]: collect Consumer Name; how: Offer the nearest urgent care\./.test(t) ? ok("an extra workflow's use case, fields and instruction reach its agent") : bad(`flow text was: ${t}`);
}

console.log("\nWiring\n");
{
  const ctx = fs.readFileSync("src/data/AiAssistantContext.tsx", "utf8");
  /syncAgentWorkflow\(key, base, nextData, read\)/.test(ctx) ? ok("every applyEdits runs the sync") : bad("applyEdits does not run the sync");
  /const live = liveOverrides\.current;/.test(ctx) && /liveOverrides\.current = o;/.test(ctx)
    ? ok("back-to-back writes read the latest state, so a second write cannot undo the first") : bad("applyEdits reads a stale render snapshot");
  const guarded = ["src/screens/PhonePreview.tsx", "src/components/WorkflowChatPreview.tsx", "src/screens/AgentWorkflow.tsx", "src/data/voiceSession.ts"]
    .every((f) => /profile\.id === profileId\)? ?(registerBase|registerOtherBase)\(|profile\.id === profileId\) registerOtherBase\(/.test(fs.readFileSync(f, "utf8")) || /&& profile\.id === profileId\) register/.test(fs.readFileSync(f, "utf8")));
  guarded ? ok("no base is registered while the profile is still the loading default") : bad("a base can be registered from the wrong profile");
  /workflowShapeOk\(base\) && !workflowShapeOk\(nextData\)/.test(ctx) ? ok("applyEdits refuses a tree the diagram cannot draw") : bad("the shape guard is not wired");
  const chat = fs.readFileSync("src/components/WorkflowChatPreview.tsx", "utf8");
  /linkKey: `\$\{profileId\}::\$\{copyPath \?\? SMS_WORKFLOW_SCOPE_PATH\}`/.test(chat) ? ok("the SMS Preview Workflow sparkle can edit the workflow") : bad("the chat sparkle is not linked to the workflow");
  const pp = fs.readFileSync("src/screens/PhonePreview.tsx", "utf8");
  /registerBase\(`\$\{profileId\}::\$\{builtInPath\}`, wfBase\)/.test(pp) ? ok("the Preview Agent tab registers the workflow's base") : bad("the Preview Agent tab cannot write the workflow");
  const asst = fs.readFileSync("engine/assistant.ts", "utf8");
  /THE WORKFLOW DIAGRAM IS WHAT THE AGENT DOES/.test(asst) ? ok("Ask AI is told the diagram is the agent") : bad("the assistant prompt does not describe the workflow");
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll agent/workflow sync checks passed\n");
process.exit(fail ? 1 : 0);
