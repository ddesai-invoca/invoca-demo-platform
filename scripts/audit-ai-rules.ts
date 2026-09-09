/* =============================================================================
   audit-ai-rules — the four standing AI-button rules, checked in CI-ish form.
   -----------------------------------------------------------------------------
   These rules are easy to satisfy once and lose later: a screen added next month
   filters an array without keeping its index, or renders a card head with no id, and
   rule 3 silently degrades back to the model guessing — which is exactly the bug
   that started this. Run with `npm run audit:ai`.

   Static checks only, so it is fast and needs no browser. It cannot prove the model
   behaves; it proves the CODE still offers the guarantees.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { isLockedEdit, isStructuralChange } from "../src/data/editGuard.ts";
import { treeToVoicePaths } from "../src/data/voicePaths.ts";
import { collectNames } from "../src/data/workflowDrawers.ts";
import { emptyWorkflowTree, extraTree, ZERO_TRIGGER, INTENT_SALES, INTENT_SUPPORT, SUPPORT_LEAF } from "../src/data/workflowChrome.ts";
import { rowLayout } from "../src/data/workflowRows.ts";
import { buildSmsBrain, smsWorkflowAgentOf, smsWorkflowScopePath,
  type SmsWorkflowAgent } from "../src/data/smsBrain.ts";
import { smsSystemPromptForAudit } from "../engine/chat.ts";
import { CustomerProfile } from "../src/data/schema.ts";
import { sweepValue } from "../engine/dashSweep.ts";
import { tollFreeNumber } from "../src/data/smsContactNumber.ts";

const SCREENS = "src/screens";
let fail = 0;
const bad = (msg: string) => { console.log(`  FAIL  ${msg}`); fail++; };
const ok = (msg: string) => console.log(`  ok    ${msg}`);

const files = fs.readdirSync(SCREENS).filter((f) => f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(SCREENS, f), "utf8");
/** Read anything in the repo — the voice-lock checks below span components/ and data/. */
const readAny = (f: string) => fs.readFileSync(f, "utf8");
/** Every profile on disk, bundled or in the local demo library — same pattern audit-place.ts uses. */
function load(dir: string, unwrap: (j: any) => any) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => unwrap(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))))
    .filter((p) => p?.id);
}

console.log("\nRule 1 — presentation is never data");
{
  /* A data value reaching a style attribute would let an edit change appearance.
     Boolean toggles between designed states are allowed and are the only exception. */
  let offenders: string[] = [];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/style=\{\{[^}]*\}/g)) {
      const frag = m[0];
      /* width/left/height driven by a NUMBER we computed is layout maths, not a data
         string; flag anything interpolating a data string into colour or font. */
      if (/(color|font|background)[^:]*:\s*[^"'\s]*\b(d|data|profile|card|tile)\./.test(frag)) {
        offenders.push(`${f}: ${frag.slice(0, 70)}`);
      }
    }
  }
  offenders.length ? offenders.forEach(bad) : ok("no data value reaches a colour or font");
}

console.log("\nRule 3 — every card head carries a tile id");
{
  for (const f of files) {
    const s = read(f);
    /* Only heads WITHOUT a data-tile. The first version counted every head and so
       failed on files that were fully tagged — a check that cries wolf gets ignored,
       which is worse than no check. */
    const untagged = (s.match(/className="dash-card-head"(?!\s+data-tile)/g) || []).length;
    if (untagged > 0) bad(`${f}: ${untagged} card head(s) with no data-tile — focused edits there can hit another tile`);
  }
  if (!fail) ok("all card heads are tagged");
  /* A card with no path stamps its HEADING as the id instead; the drawer must fall
     back the same way or hiding those cards silently does nothing. */
  {
    const drawer = fs.readFileSync("src/components/AiAssistantDrawer.tsx", "utf8");
    const anyFallback = files.some((f) => read(f).includes("tileId(path) ?? title"));
    anyFallback && drawer.includes("tileId(resolved) ?? (target")
      ? ok("heads and the drawer agree on the heading fallback id")
      : bad("the heading fallback is wired on only one side — hiding will no-op");
  }
}

console.log("\nRule 3 — filtered lists keep their original index");
{
  for (const f of files) {
    const s = read(f);
    /* `.filter(...)` straight into `.map((x, i) =>` means `i` is the FILTERED index.
       Using it as a data path points at the wrong element. */
    if (/\.filter\([^)]*\)\s*\.map\(\([^,)]+,\s*i\)/.test(s) && /path=\{`[^`]*\$\{i\}/.test(s)) {
      bad(`${f}: builds a path from a filtered index — keep the original (map to {b,i} first)`);
    }
  }
  ok("no path is built from a filtered index");
}

console.log("\nRules 2 + 4 — the capabilities are wired");
{
  const drawer = fs.readFileSync("src/components/AiAssistantDrawer.tsx", "utf8");
  const prompt = fs.readFileSync("engine/assistant.ts", "utf8");
  const guard = fs.readFileSync("src/data/editGuard.ts", "utf8");
  drawer.includes("constrainToFocus") ? ok("rule 3 is enforced in code, not just prompted") : bad("constrainToFocus is not wired");
  drawer.includes("hideTile") ? ok("rule 2.3 hide/show is wired") : bad("hide/show is not wired");
  drawer.includes('pathname.startsWith("/reports/")') ? ok("rule 2.3 tiles work in Reports too") : bad("Reports cannot add tiles");
  guard.includes("\\bseries$") ? ok("rule 2.2 length changes are allowed for charts") : bad("chart length changes still blocked");
  prompt.includes("metricColumns") ? ok("rule 2.2 column ops cover breakdown tables") : bad("column ops are report-only");
  prompt.includes("WHICH KIND of chart") ? ok("rule 1 chart-type lock is in the prompt") : bad("chart type is not locked");
  /* A prompt that both allows and forbids the same thing is worse than either: the
     model picked the prohibition and refused to add a column. */
  prompt.includes("NEVER change the number of tiles/rows/series/xLabels")
    ? bad("prompt still carries the old blanket length prohibition — it contradicts rule 2")
    : ok("prompt does not contradict itself on length");
}

/* =============================================================================
   THE SMS WORKFLOW'S FOUR NODE NAMES ARE PRODUCT CHROME.
   -----------------------------------------------------------------------------
   The real Invoca page does not let a user rename the trigger, the conversation-start node
   or the two intent nodes, so the template must always read "Triggered by",
   "Conversation Start", "Sales Inquiry" and "Need Support" — for every prospect, including
   ones generated later. The tree is derived at RENDER time with no schema slice and no
   engine phase, so that is true by construction today; these checks stop it drifting back.

   The failure being guarded against is specific and has happened once: the intent titles
   were derived from each prospect's routing queues (`voiceCopy`), so Shady Blinds read
   "Design Consultation / Existing Order" where the product always shows the same two words.
   ============================================================================= */
console.log("\nThe SMS workflow template's node names are locked");
{
  const wf = fs.readFileSync("src/screens/AgentWorkflow.tsx", "utf8");
  const tree = fs.readFileSync("src/components/WorkflowTree.tsx", "utf8");
  const guard = fs.readFileSync("src/data/editGuard.ts", "utf8");
  const ctx = fs.readFileSync("src/data/AiAssistantContext.tsx", "utf8");

  /* The two literals live in the renderer and were never per-prospect. */
  tree.includes(">Triggered by<") && tree.includes(">Conversation Start<")
    ? ok('"Triggered by" and "Conversation Start" are renderer literals')
    : bad("the trigger / conversation-start titles are no longer literals in WorkflowTree");

  /* The SMS block must use the constants, not the prospect's queue names. */
  const sms = wf.slice(wf.indexOf("if (isSms)"), wf.indexOf("const shaped = SHAPE"));
  sms.includes("title: INTENT_SALES") && sms.includes("title: INTENT_SUPPORT")
    ? ok("the SMS intents come from the fixed constants")
    : bad("the SMS intent titles are not the fixed constants");
  /\btitle:\s*c\.(newQ|supQ)\b/.test(sms)
    ? bad("an SMS intent title is derived from the prospect's queues again (c.newQ / c.supQ)")
    : ok("no SMS intent title is derived from a prospect queue");
  sms.includes("locked: true")
    ? ok("the SMS intent nodes are marked locked")
    : bad("the SMS intent nodes are not marked locked — the AI could rename them");

  /* ⚠️ THE VOICE TREE IS LOCKED TOO NOW (8/26/2026), which OVERTURNS the note that used to
     sit in CLAUDE.md saying the voice intents were measured off Invoca's own Voice workflow
     page and must keep deriving from the prospect's queues. The user confirmed the real page
     shows the SAME two words as SMS, so that reading was wrong. Every voice tree now uses the
     constants — the derived default AND the National Van Lines split override, which is
     exactly the place a stale copy of a template survives. */
  const intents = [...wf.matchAll(/title:\s*INTENT_(?:SALES|SUPPORT)[^\n]*/g)].map((m) => m[0]);
  intents.length >= 8
    ? ok(`all five trees declare both intents from the constants (${intents.length})`)
    : bad(`only ${intents.length} intent titles use the constants — a tree names its own`);
  intents.every((l) => l.includes("locked: true"))
    ? ok("every intent node carrying a constant is also locked")
    : bad("an intent node uses a constant but is NOT locked — the AI could rename it");
  /* ⚠️ THE LEAF ROW IS CHROME TOO (8/26/2026). The voice tree's leaves read
     `All ${c.newQ} Users` / `Route to ${c.newQueue}` until the user confirmed the real page
     always shows the group named after the intent and one of a fixed set of actions. Only the
     CHIPS below stay per prospect. Checked because a leaf is the easiest place for a queue
     name to creep back in. */
  const voice = wf.slice(wf.indexOf("const shaped = SHAPE[profile.id]"));
  !/title:\s*`All \$\{c\.(newQ|supQ)\} Users`/.test(wf)
    ? ok("no leaf title derives from a prospect queue name")
    : bad("a leaf title is `All ${c.newQ|supQ} Users` again — the queue name is back");
  !/action:\s*`Route to \$\{c\.(newQueue|supQueue)\}`/.test(wf)
    ? ok("no leaf action derives from a prospect queue name")
    : bad("a leaf action is `Route to ${c.newQueue|supQueue}` again");
  voice.includes("action: LEAF_QUALIFY") && voice.includes("action: LEAF_ESCALATE")
    ? ok("the voice leaves default to Qualify and Support & Escalate")
    : bad("the voice leaf actions are not the two defaults");
  /\.\(title\|subtitle\|action\)\$/.test(readAny("src/data/editGuard.ts"))
    ? ok("LOCKED_KEYS covers action, so a locked leaf's action is refused too")
    : bad("LOCKED_KEYS does not cover action — a locked leaf's action is still editable");
  /locked\?: boolean/.test(readAny("src/components/WorkflowTree.tsx").slice(
      readAny("src/components/WorkflowTree.tsx").indexOf("export interface TreeLeaf"),
      readAny("src/components/WorkflowTree.tsx").indexOf("export interface TreeBranch")))
    ? ok("TreeLeaf declares locked")
    : bad("TreeLeaf no longer declares locked");
  /NEVER read out a user-group label/.test(readAny("engine/chat.ts"))
    ? ok("the voice prompt forbids saying a user-group label aloud")
    : bad("the prompt could have the agent say \"All Sales Inquiry Users\" on a call");

  /* ⚠️ THE FOURTH ROW HAS TO REACH THE PROMPT (8/26/2026). A Qualify leaf's paths are what
     the agent routes on; reading only the leaves would let an SE edit a path, watch the
     diagram redraw, and hear no change — the silent no-op that deriving the prompt from the
     tree exists to close, one row further down. CALLED, not grepped. */
  (() => {
    const t: any = { branches: [{ title: "I", leaves: [{ title: "G", action: "Qualify", chips: ["x"],
      paths: [{ title: "A", action: "Inform & Route", chips: ["p"] },
              { title: "B", action: "Inform & Route", chips: ["q"] }] }] }] };
    const r = treeToVoicePaths(t)[0]?.routes ?? [];
    return r.length === 2 && r.every((x: any) => x.need);
  })()
    ? ok("a Qualify leaf's PATHS reach the prompt, one route per answer")
    : bad("the prompt ignores the diagram's fourth row — editing a path would change nothing");
  (() => {
    /* A leaf with no paths must still contribute itself, or every tree without a fourth row
       loses its routing. */
    const t: any = { branches: [{ title: "I", leaves: [{ title: "G", action: "Route", chips: ["x"] }] }] };
    const r = treeToVoicePaths(t)[0]?.routes ?? [];
    return r.length === 1 && r[0].team === "G" && !r[0].need;
  })()
    ? ok("a leaf with no paths still contributes itself")
    : bad("a pathless leaf no longer produces a route");
  /* ⚠️ THE DIAGRAM'S PILLS ARE THE DRAWER'S "WHAT TO COLLECT" (8/26/2026), and only the row
     below the user groups carries any. Checked because a pill is a label an SE reads off the
     node and then expects to find in the drawer; two lists would drift silently. */
  (() => {
    const inform = collectNames("inform").join("|");
    return inform === "Consumer Zip|Consumer Name" && collectNames("qualify").length === 0;
  })()
    ? ok("the collect table drives the pills: inform collects Zip + Name, qualify collects nothing")
    : bad("the action collect table changed shape — the pills and the drawer can now disagree");
  /* And the prompt still gets a collect list for a leaf with no pills of its own. */
  (() => {
    const t: any = { branches: [{ title: "I", leaves: [{ title: "All Support Users", action: "Support & Escalate" }] }] };
    return (treeToVoicePaths(t)[0]?.routes?.[0]?.collect ?? []).length > 0;
  })()
    ? ok("a pill-less leaf still tells the agent what to collect, from its action")
    : bad("emptying a node's pills left the agent with nothing to collect — a silent no-op");
  !/chips: c\.(newChips|supChips)/.test(wf)
    ? ok("no node labels its pills from the prospect's own vocabulary")
    : bad("a node's pills are minted per prospect again instead of read from the collect table");

  /* The Qualify drawer's segments must READ the tree's path titles rather than rebuild them. */
  /\(l\.paths \?\? \[\]\)\.map\(\(x\) => x\.title\)/.test(readAny("src/data/workflowDrawers.ts"))
    ? ok("the Qualify drawer's segments are the leaf's own path titles")
    : bad("the Qualify drawer rebuilds its segments — it can disagree with the diagram");

  /\btitle:\s*"Book a Move"/.test(wf)
    ? bad("the National Van Lines override carries its own intent name again")
    : ok("the National Van Lines override uses the template's intent names");

  /* The trigger line and Conversation Start are chrome on BOTH channels; `chromeLocked` is
     what makes editGuard refuse them. Without it the AI can rewrite the product's wording. */
  (wf.match(/chromeLocked: true/g) ?? []).length >= 2
    ? ok("both the SMS and Voice trees set chromeLocked")
    : bad("a tree does not set chromeLocked — its trigger line is AI-editable");
  /chromeLocked\?: boolean/.test(readAny("src/components/WorkflowTree.tsx"))
    ? ok("WorkflowTreeModel declares chromeLocked")
    : bad("WorkflowTreeModel no longer declares chromeLocked");
  /* ⚠️ CALLED, NOT GREPPED. The first version of this check tested the SOURCE for
     `CHROME_KEYS.has(path)` and passed happily against `if (false && CHROME_KEYS.has(path))`
     — it was verified against that exact breakage and stayed silent. A text match cannot tell
     you a guard is reachable; running it can. */
  isLockedEdit({ chromeLocked: true, triggeredBy: "x" }, "triggeredBy")
    && isLockedEdit({ chromeLocked: true, startLabel: "x" }, "startLabel")
    ? ok("isLockedEdit actually refuses triggeredBy and startLabel when chromeLocked")
    : bad("isLockedEdit does NOT refuse the chrome fields — chromeLocked is decorative");
  isLockedEdit({ triggeredBy: "x" }, "triggeredBy")
    ? bad("isLockedEdit refuses triggeredBy even WITHOUT chromeLocked — too broad")
    : ok("an unlocked tree keeps its trigger line editable");
  /* ⚠️ THE CHECK IS ABOUT THE WORDING, AND IT READS THE VALUE NOW RATHER THAN THE SOURCE.
     It used to grep AgentWorkflow.tsx for `SMS_TRIGGER = "…"`; the constant was renamed
     `ZERO_TRIGGER` (two captures show the same line on a VOICE workflow) and moved to
     `workflowChrome.ts`, which Node can import — so the check asserts the STRING itself and
     no longer cares where it lives or what it is called. */
  ZERO_TRIGGER === "0 Campaigns, 0 Forms, and 0 Inbound SMS"
    ? ok("the trigger line names inbound SMS, and is one constant for both channels")
    : bad(`the trigger line is not the product's wording: ${ZERO_TRIGGER}`);

  /* ===========================================================================
     What Create Workflow builds: the EMPTY workflow (measured 8/27/2026)
     ⚠️ FUNCTIONAL, NOT GREPPED — these build the real tree and read it, because a text
     match cannot tell you `emptyWorkflowTree` is what the page actually renders.
     =========================================================================== */
  {
    const t = emptyWorkflowTree("Voice");
    const leaves = t.branches.flatMap((b) => b.leaves);
    t.branches.length === 2 && leaves.length === 2
      ? ok("the empty workflow has exactly the four chrome nodes and nothing else")
      : bad(`the empty workflow is not the bare tree (${t.branches.length} branches, ${leaves.length} leaves)`);
    /* The whole point of the empty state: an unconfigured leaf OFFERS an action rather
       than naming one, and advertises no fields it was never told to collect. */
    leaves.every((l) => l.addAction && !l.action && !l.chips?.length)
      ? ok("its user-group leaves offer + Add action, with no action text and no pills")
      : bad("an empty user-group leaf carries an action or pills it cannot have");
    /* A tone is the ACTION's colour; with no action there is no hue to paint. */
    leaves.every((l) => !l.tone)
      ? ok("its leaves are untinted, since a node takes its colour from its action")
      : bad("an empty leaf is tinted by an action nobody configured");
    /* Describing the caller is configuration the SE has not done yet. */
    t.branches.every((b) => !b.subtitle)
      ? ok("its intent nodes carry no caller-intent subtitle")
      : bad("an empty intent node describes a caller the SE never described");
    t.triggeredBy === "0 Campaigns, 0 Forms, and 0 Inbound SMS"
      ? ok("its trigger line is the product's all-zero wording")
      : bad(`its trigger line is not the measured wording: ${t.triggeredBy}`);
    /* Same lock as a configured tree — these four names are the product's either way. */
    t.chromeLocked && t.branches.every((b) => b.locked) && leaves.every((l) => l.locked)
      && isLockedEdit({ ...t, branches: t.branches }, "branches.0.title")
      ? ok("the empty workflow's chrome is locked, and isLockedEdit refuses renaming it")
      : bad("the empty workflow's chrome names are AI-editable");
  }
  /* The route must FAIL CLOSED on an id this prospect has no workflow for: without the
     guard, `isSms` defaults true and a pasted link renders a full SMS page for whichever
     prospect is active. Verified in the browser; pinned here so it cannot be deleted. */
  /if \(id && !created\)/.test(wf)
    ? ok("an unresolvable created-workflow id renders the not-found state")
    : bad("a created-workflow id from another prospect falls through to the SMS tree");

  /* Locked must be ENFORCED, not merely declared — otherwise a rename is a silent no-op. */
  guard.includes("export function isLockedEdit")
    ? ok("isLockedEdit exists")
    : bad("isLockedEdit is gone");
  ctx.includes("isLockedEdit(nextData")
    ? ok("applyEdits refuses a locked rename (counted as blocked, so the drawer says so)")
    : bad("isLockedEdit is defined but never called — a locked rename would silently no-op");
}

/* ---- an EXTRA workflow gets the same locked chrome (9/2/2026) --------------
   ⚠️ REPORTED, AND THIS FILE HAD RECORDED THE OPPOSITE AS DELIBERATE. The note under the SMS
   template said extra workflows "keep their own authored branch names, because a nurture
   flow's node is not 'Sales Inquiry'". That exception was wrong: the two intents and the two
   user groups are product chrome on EVERY SMS workflow, and what an authored workflow
   contributes is the USE CASES on the row beneath them. `extraTree` used to draw each branch
   as its own top-level intent node with an unlocked `${title} Users` leaf, so a new workflow
   rendered four intent nodes where the product always shows two, none of them locked. */
{
  /* ⚠️ **THESE USED TO GREP `AgentWorkflow.tsx` FOR `title: INTENT_SALES` AND COUNT
     `locked: true` OCCURRENCES, because that screen cannot be imported by node.** `extraTree`
     moved into `workflowChrome.ts` on 9/8/2026 for exactly that reason, so every check below
     now BUILDS a tree and reads it. This file already records why the difference matters: a
     grep once passed against `if (false && CHROME_KEYS.has(path))`. */
  const authored = [
    { title: "Ready to Book", action: "Book Appointment", tone: "green" as const, chips: ["Brand"], intent: "sales" as const },
    { title: "Human Requested", action: "Warm Hand-off", tone: "orange" as const, chips: ["Callback Window"], intent: "support" as const },
  ];
  const built = extraTree({
    slug: "probe", label: "Probe - SMS - Extra", channel: "SMS",
    startLabel: "SMS · probe", systemPrompt: "Probe.", branches: authored,
  } as never);

  built.branches.map((b) => b.title).join("|") === `${INTENT_SALES}|${INTENT_SUPPORT}`
    ? ok("extraTree draws the two chrome intents, not the authored branch titles")
    : bad(`extraTree's intent nodes are ${built.branches.map((b) => b.title).join("|")}`);
  const leaves = built.branches.flatMap((b) => b.leaves);
  leaves.map((l) => l.title).join("|") === `All ${INTENT_SALES} Users|${SUPPORT_LEAF}`
    ? ok("and the two chrome user-group leaves")
    : bad(`extraTree's leaf titles are ${leaves.map((l) => l.title).join("|")}`);
  built.branches.every((b) => b.locked) && leaves.every((l) => l.locked)
    ? ok("all four chrome nodes are marked locked")
    : bad("a chrome node in a built extra tree is not locked — one of the boxes is renameable");
  leaves.map((l) => l.action).join("|") === "Qualify|Support & Escalate"
    ? ok("its leaves carry the same two default actions as the voice tree")
    : bad(`extraTree's leaf actions are ${leaves.map((l) => l.action).join("|")}`);
  /* THE ORIGINAL DEFECT: each authored branch drawn as its own top-level intent node. */
  built.branches.length === 2 && leaves.length === 2
    ? ok("no authored branch is mapped onto an intent node or a leaf again")
    : bad(`extraTree drew ${built.branches.length} intents and ${leaves.length} leaves, not 2 and 2`);
  /* ...and each authored branch reaches the USE CASE row under the leaf its `intent` names. */
  leaves[0].paths?.map((pth) => pth.title).join() === "Ready to Book"
    && leaves[1].paths?.map((pth) => pth.title).join() === "Human Requested"
    ? ok("and each authored branch lands under the locked leaf its intent names")
    : bad("an authored branch landed under the wrong locked leaf");

  /* ⚠️ AND "LOCKED" MUST MEAN REFUSED, NOT MERELY DRAWN. Run against the tree just BUILT
     rather than a hand-written copy of it: a flag that is set and never consulted is the
     silent no-op this file exists to stop, and a literal here could drift from the builder. */
  const tree = built;
  const refused = ["branches.0.title", "branches.1.title",
    "branches.0.leaves.0.title", "branches.1.leaves.0.title",
    "branches.0.leaves.0.action", "branches.1.leaves.0.action"];
  refused.every((pth) => isLockedEdit(tree, pth))
    ? ok("every one of the four boxes (and both leaf actions) is REFUSED by editGuard")
    : bad(`a chrome edit is allowed: ${refused.find((pth) => !isLockedEdit(tree, pth))}`);
  const editable = ["branches.0.leaves.0.paths.0.title", "branches.0.leaves.0.paths.0.action",
    "branches.0.leaves.0.paths.0.chips.0", "branches.1.leaves.0.paths.0.title"];
  editable.every((pth) => !isLockedEdit(tree, pth))
    ? ok("and the use cases below stay editable, which is the whole point")
    : bad(`a use-case edit is refused: ${editable.find((pth) => isLockedEdit(tree, pth))}`);
}

/* =============================================================================
   AN Ask AI EDIT MUST REACH THE SMS AGENT, EVEN ON AN EXTRA WORKFLOW
   -----------------------------------------------------------------------------
   Reported 9/3/2026: "the AI said that they applied but none of them actually applied...
   the opening message still hasnt changed." Two independent silent no-ops, both only on a
   Preview Agent opened for an extra workflow:

     1. `wf.openingMessage` came FIRST in `buildSmsBrain`, ahead of the AI-editable
        `smsPlaybook.greeting` — and it is read from the RAW profile, so the edit could never
        win no matter how many times it was made.
     2. `buildSystem` returns early on `customSystem`, so the questions, rules, Q&A and
        knowledge were never rendered into the prompt at all.

   These call the real functions against a real workflow shape, because both defects were
   invisible to types and to every existing check.
   ============================================================================= */
console.log("\nAsk AI edits reach the SMS agent (extra workflows)");
{
  const wf = {
    slug: "sms-nurture", label: "Test - SMS - Nurture", channel: "sms" as const,
    openingMessage: "Hi {name}, this is the workflow's own scripted opener.",
    systemPrompt: "You are a nurture agent. Re-engage the customer warmly.",
    triggeredBy: "No-response follow-up", startLabel: "classify", branches: [],
  } as never;
  const profile = {
    customerName: "Testco", industry: "Testing",
    reports: { agentConfig: {
      brandConversationRules: ["Original rule."],
      smsPlaybook: { bookingType: "appointment", qualifyingQuestions: ["Original question?"] },
    }, voiceScreenpop: { callerName: "Dana Probe" }, extraWorkflows: [wf] },
  } as never;
  const raw = (profile as never as { reports: { agentConfig: unknown } }).reports.agentConfig as never;

  /* ⚠️ UNTOUCHED MUST BE BYTE-IDENTICAL. Appending a prospect's generic playbook to a
     hand-written nurture script nobody edited would contradict it — the self-contradicting
     prompt this repo has already paid for twice. */
  const b0 = buildSmsBrain(profile, raw, wf);
  b0.openingMessage === wf.openingMessage
    ? ok("an unedited workflow still opens with its own scripted line")
    : bad(`an unedited workflow's opener changed: ${b0.openingMessage}`);
  b0.overrides === undefined
    ? ok("and sends no config overrides")
    : bad(`an unedited workflow sent overrides: ${JSON.stringify(b0.overrides)}`);
  const p0 = smsSystemPromptForAudit(b0 as never);
  !/CONFIGURATION CHANGES/.test(p0)
    ? ok("so its prompt carries no override block")
    : bad("an unedited workflow's prompt gained an override block");

  /* THE REPORTED BUG: an edited greeting must win. */
  const edited = { ...raw, smsPlaybook: { ...raw.smsPlaybook, greeting: "Hi {name}, the edited opener." } };
  buildSmsBrain(profile, edited as never, wf).openingMessage === "Hi {name}, the edited opener."
    ? ok("an edited greeting BEATS the workflow's scripted opener")
    : bad("an edited greeting is still ignored — the reported no-op is back");

  /* THE SECOND BUG: edited questions must survive `customSystem`. */
  const qs = ["Edited question one?", "Edited question two?"];
  const b2 = buildSmsBrain(profile, { ...raw, smsPlaybook: { ...raw.smsPlaybook, qualifyingQuestions: qs } } as never, wf);
  const p2 = smsSystemPromptForAudit(b2 as never);
  qs.every((q) => p2.includes(q))
    ? ok("edited questions reach the prompt despite a custom system prompt")
    : bad("edited questions are still swallowed by customSystem");
  /* ...and must say which side wins, or the model picks one at random. */
  /THIS SECTION WINS/.test(p2)
    ? ok("and the override block states its own precedence")
    : bad("the override block does not say it outranks the playbook above");
  p2.includes(wf.systemPrompt)
    ? ok("while the workflow's own playbook is still there")
    : bad("appending the overrides dropped the workflow's playbook");
  /* An edited rule list travels the same way. */
  const b3 = buildSmsBrain(profile, { ...raw, brandConversationRules: ["A brand new rule."] } as never, wf);
  /A brand new rule\./.test(smsSystemPromptForAudit(b3 as never))
    ? ok("edited brand rules reach it too")
    : bad("edited brand rules are still swallowed");

  /* ⚠️ AND THE DRAWER MUST SHOW WHAT THE PHONE WILL SEND. Its row used to fall back to a
     DERIVED default, so on such a page it displayed an opening message the agent never sends
     and handed the model that same wrong text as the "current" one. */
  const drawer = readAny("src/components/AiAssistantDrawer.tsx");
  /active\.greetingFallback/.test(drawer)
    ? ok("the drawer's greeting row considers the workflow's own opener")
    : bad("the drawer can still show an opening message the agent never sends");
  const phone = readAny("src/screens/PhonePreview.tsx");
  /* ⚠️ WIDENED 9/8/2026, NOT WEAKENED. It required `greetingFallback:` to be followed
     IMMEDIATELY by `wf?.openingMessage`, and the value is now
     `wfAgent?.greeting ?? wf?.openingMessage` — the workflow page can edit that opener, so the
     authored one is only the last resort. The stricter half of what this check meant moved to
     its own assertion in the Ask AI section below, which pins the EFFECTIVE value. */
  /greetingFallback:[^,}]*wf\?\.openingMessage/.test(phone)
    ? ok("and the Preview Agent page tells it what that opener is")
    : bad("the Preview Agent page no longer passes the workflow's opener to the drawer");
}


/* =============================================================================
   ORLANDO HEALTH'S FIVE ER MESSAGING WORKFLOWS (9/8/2026)
   -----------------------------------------------------------------------------
   Built from the sign-off doc "Orlando Health - AI Messaging Scenarios for Demo Video":
   five scenarios, five `reports.extraWorkflows` entries. The doc's five ground rules apply
   to every scenario, so they are checked on every workflow rather than spot-checked on one.

   ⚠️ THESE ARE DATA CHECKS ON PURPOSE, and grepping DATA is not the anti-pattern this file
   warns about — the trap was an audit matching its own DOCUMENTATION (a comment naming the
   Geocoding API). A prompt string IS the deliverable here: if the ground rules are not in it,
   the agent does not have them.
   ============================================================================= */
console.log("\nOrlando Health's five ER messaging workflows");
{
  const profile = CustomerProfile.parse(
    JSON.parse(readAny("src/data/generated/orlando-health.json")),
  );
  const wfs = profile.reports.extraWorkflows ?? [];

  wfs.length === 5
    ? ok("all five scenarios are authored as workflows")
    : bad(`${wfs.length} extra workflows, expected five (one per scenario)`);
  new Set(wfs.map((w) => w.slug)).size === wfs.length
    ? ok("every slug is unique, so each routes to its own page")
    : bad("two workflows share a slug — one of them is unreachable");
  wfs.every((w) => w.channel === "SMS")
    ? ok("all five are SMS")
    : bad(`a scenario workflow is not SMS: ${wfs.find((w) => w.channel !== "SMS")?.slug}`);

  /* ⚠️ AN ABSENT `intent` SILENTLY DEFAULTS TO THE SALES SIDE. That is right for the
     workflows authored before the field existed and wrong here: a clinical or emotional
     reply must hang under the SUPPORT leaf, and a typo in the field name would put it
     quietly on the sales side with no visible symptom. */
  wfs.every((w) => w.branches.every((b) => b.intent === "sales" || b.intent === "support"))
    ? ok("every use case declares which locked leaf it hangs under")
    : bad(`a use case has no explicit intent: ${wfs.find((w) => w.branches.some((b) => !b.intent))?.slug}`);
  /* Ground rule 2: any clinical or emotional message hands off immediately, so every one of
     these trees needs a support path for that to be somewhere on the diagram. */
  wfs.every((w) => w.branches.some((b) => b.intent === "support"))
    ? ok("each has a support-side use case, which is where the doc's hand-off rule lands")
    : bad(`a workflow has no support path: ${wfs.find((w) => !w.branches.some((b) => b.intent === "support"))?.slug}`);
  /* Scenario 4's whole point is the context travelling, and the chips ARE that context. */
  wfs.every((w) => w.branches.every((b) => (b.chips?.length ?? 0) > 0))
    ? ok("every use case names what it collects, so the diagram shows what travels")
    : bad("a use case collects nothing, so the hand-off carries no context");

  /* ---- the doc's ground rules, on all five ------------------------------- */
  /* Ground rule 4: the opt-out language appears in the FIRST outbound message. */
  wfs.every((w) => /Reply STOP to opt out\./.test(w.openingMessage ?? ""))
    ? ok("every opening message carries the opt out line")
    : bad(`an opening message has no opt out line: ${wfs.find((w) => !/Reply STOP to opt out\./.test(w.openingMessage ?? ""))?.slug}`);
  /* Ground rule 3: the location is INFERRED from the facility they checked into, so the
     agent must never ask. A ZIP question is the shape this repo's other SMS playbooks use,
     which is exactly why it would be easy to paste in here. */
  const asksLocation = (s: string) => /\bzip\b|\bzip code\b|where are you/i.test(s);
  wfs.every((w) => !asksLocation(w.openingMessage ?? "") && !(w.playbookSteps ?? []).some(asksLocation))
    ? ok("none of them asks for a ZIP or where the patient is")
    : bad(`a workflow asks for the patient's location: ${wfs.find((w) => asksLocation(w.openingMessage ?? "") || (w.playbookSteps ?? []).some(asksLocation))?.slug}`);
  /* Ground rules 1, 5 and 6, checked as the promises the prompt has to contain. */
  const RULES: [string, RegExp][] = [
    ["never diagnoses or judges urgency", /never assess symptoms/i],
    ["hands off on a clinical or emotional message", /clinical or emotional message ends the flow/i],
    ["never books anything itself", /never book, schedule, move or cancel anything yourself/i],
    ["refers to scheduling with the context attached", /context of this conversation goes with them/i],
    ["never states a wait time as a number", /never state a wait time as a number/i],
    /* ⚠️ **CAUGHT IN A LIVE PREVIEW: THE AGENT MINTED A PHONE NUMBER.** Asked to refer a
       patient to scheduling, it produced "Call Orlando Health scheduling at 321-841-5111" —
       plausible, unverifiable, and shown to a real prospect in a demo video. The doc writes
       "Call [number]" and leaves it to us. 407-303-5910 is Orlando Health's own callback
       number ELSEWHERE IN THIS DEMO (a call transcript in `conversationIntelligence`), so
       naming it is deriving rather than inventing, and it keeps the five workflows consistent
       with the story around them. */
    ["is given the one real scheduling number", /407-303-5910/],
    ["is forbidden from inventing a number or a facility", /never invent a phone number/i],
  ];
  for (const [label, re] of RULES) {
    const missing = wfs.find((w) => !re.test(w.systemPrompt));
    missing
      ? bad(`${missing.slug}'s playbook does not say it ${label}`)
      : ok(`every playbook says the agent ${label}`);
  }

  /* ---- the trees ---------------------------------------------------------- */
  /* ⚠️ BUILT, NOT ASSUMED. This is what "make sure the Tree matches" means: five real
     workflows through the real `extraTree`, each drawing the same locked chrome the voice
     tree does with its authored use cases on the row below. */
  for (const w of wfs) {
    const t = extraTree(w);
    const lv = t.branches.flatMap((b) => b.leaves);
    const cases = lv.flatMap((l) => l.paths ?? []);
    const chromeOk = t.variant === "sms"
      && t.branches.map((b) => b.title).join("|") === `${INTENT_SALES}|${INTENT_SUPPORT}`
      && lv.map((l) => l.title).join("|") === `All ${INTENT_SALES} Users|${SUPPORT_LEAF}`
      && t.branches.every((b) => b.locked) && lv.every((l) => l.locked);
    chromeOk && cases.length === w.branches.length
      ? ok(`${w.slug}: locked chrome plus ${cases.length} use cases`)
      : bad(`${w.slug}: tree is wrong — ${t.branches.length} intents, ${lv.length} leaves, ${cases.length} of ${w.branches.length} use cases`);
    /* The four boxes must be REFUSED on this prospect's own trees, not just flagged. */
    ["branches.0.title", "branches.1.title", "branches.0.leaves.0.title", "branches.1.leaves.0.title"]
      .every((pth) => isLockedEdit(t, pth))
      ? ok(`  and its four chrome boxes are refused by editGuard`)
      : bad(`${w.slug}: a chrome box is renameable`);
  }
}

/* =============================================================================
   Ask AI ON AN SMS WORKFLOW BEHAVES LIKE THE VOICE ONE (9/8/2026)
   -----------------------------------------------------------------------------
   Asked for directly: "make sure the Ask AI performs the same way the Voice AI workflow
   does." The voice page registers `{ ...tree, agent }` as ONE object, so a single
   instruction reshapes the diagram AND configures the agent. An SMS extra workflow
   registered only the diagram, so "open with X" or "confirm the facility first" had nowhere
   to land: the model wrote the edit, `applyEdits` found no such path, and the drawer
   reported success. Same silent no-op, one channel over.

   ⚠️ EVERY CHECK BELOW READS THE BUILT PROMPT OR CALLS THE REAL GUARD. "The drawer said it
   applied" is not evidence — that lesson is recorded four times in CLAUDE.md.
   ============================================================================= */
console.log("\nAsk AI configures an SMS extra workflow, not just its diagram");
{
  const profile = CustomerProfile.parse(
    JSON.parse(readAny("src/data/generated/orlando-health.json")),
  );
  const ac = profile.reports.agentConfig as never;
  const wf = (profile.reports.extraWorkflows ?? [])[0];
  const prompt = (a?: SmsWorkflowAgent | null) =>
    smsSystemPromptForAudit(buildSmsBrain(profile as never, ac, wf as never, a) as never);

  /* ---- the base the page registers --------------------------------------- */
  const base = smsWorkflowAgentOf(wf as never);
  base.greeting === wf.openingMessage && base.steps?.length === wf.playbookSteps?.length
    ? ok("the agent half offers the workflow's own opener and its ordered flow")
    : bad(`the registered agent half is wrong: ${JSON.stringify(base)}`);
  /* ⚠️ THE DIAGRAM'S OWN FIELDS MUST NOT BE IN IT. One field, one home: a `branches` or
     `chips` copy under `agent` would duplicate the tree and the first edit to either would
     desync the diagram from the prompt — the cause of all three 8/27 voice bugs. */
  !("rules" in base) && !("questions" in base) && !("branches" in base)
    ? ok("and nothing the diagram draws, nor the prospect's shared rules and questions")
    : bad(`the agent half duplicates a field that has another home: ${Object.keys(base)}`);

  /* ---- unedited must be byte-identical ----------------------------------- */
  const p0 = prompt(null);
  (wf.playbookSteps ?? []).every((st) => p0.includes(st)) && p0.includes(wf.systemPrompt)
    ? ok("an unedited workflow's authored flow and playbook both reach the model")
    : bad("an unedited workflow's authored flow does not reach the prompt");
  p0 === prompt(undefined)
    ? ok("and passing no agent half at all is identical to passing null")
    : bad("the new parameter changes the prompt when it is absent");
  /THE FLOW\./.test(p0) && /1\. /.test(p0) && /do not reorder them/.test(p0)
    ? ok("the flow is numbered and forbidden from being reordered, not a bullet menu")
    : bad("the flow block is not numbered or does not forbid reordering");

  /* ---- THE REPORTED GAP: an edit has to reach the model ------------------ */
  const EDITED_OPENER = "This is Orlando Health, and this line was set by Ask AI.";
  buildSmsBrain(profile as never, ac, wf as never, { greeting: EDITED_OPENER }).openingMessage === EDITED_OPENER
    ? ok("an opener set on the workflow page is what the agent sends")
    : bad("an opener set on the workflow page is ignored — the no-op is back");
  const EDITED_STEPS = ["Confirm which facility they checked into.", "Then offer the nearest alternative."];
  const p1 = prompt({ steps: EDITED_STEPS });
  EDITED_STEPS.every((st) => p1.includes(st)) && !(wf.playbookSteps ?? []).some((st) => p1.includes(st))
    ? ok("an edited flow REPLACES the authored one in the prompt, rather than joining it")
    : bad("an edited flow does not replace the authored steps — the model gets two orderings");

  /* ---- and a workflow that states its flow in prose is untouched ---------- */
  const prose = { ...wf, playbookSteps: undefined } as never;
  const pProse = smsSystemPromptForAudit(buildSmsBrain(profile as never, ac, prose) as never);
  !/THE FLOW\./.test(pProse)
    ? ok("a workflow with no playbookSteps gains no flow block (Avi & Co and Reyes Law are untouched)")
    : bad("a prose-playbook workflow gained a flow block it never authored");

  /* ---- the guard has to allow the edits the feature is made of ------------ */
  isStructuralChange(["a", "b", "c"], ["a", "b"], "agent.steps") === false
    ? ok("editGuard lets the flow change length, so a step can be added or dropped")
    : bad("editGuard refuses a length change on agent.steps — 'add a step' is dead");
  /* ⚠️ **THE FIRST PROBE HERE WAS WRONG, AND IT MATTERS WHICH PATH IS USED.** It asserted
     that `series` was still blocked — but `/\bseries$/i` has been a length exemption since
     the standing AI-button rules, so the check failed on correct code. The thing to prove is
     that the new exemption is SCOPED: a BARE `steps` (some other screen's array) is still
     refused, while `agent.steps` is not. */
  isStructuralChange(["a", "b", "c"], ["a", "b"], "steps") === true
    ? ok("while a bare steps array elsewhere is still blocked, so the exemption stayed scoped")
    : bad("the agent.steps exemption widened rule 2 to every steps array in the app");

  /* ---- the write key and the read key must be the SAME key ---------------- */
  /* ⚠️ THE WORKFLOW PAGE WRITES IT AND A DIFFERENT TAB READS IT BACK. The Preview Agent
     opens at `/agent-studio/agent/preview?wf=<slug>`, so it cannot use `usePageData`'s own
     key and has to rebuild the workflow page's. If the two ever disagree the edit lands in a
     scope nobody consults, which looks exactly like an edit that applied and did nothing. */
  const route = readAny("src/App.tsx").includes('path="/agent-studio/agent/workflow/:channel"');
  route && smsWorkflowScopePath("probe-slug") === "/agent-studio/agent/workflow/probe-slug"
    ? ok("smsWorkflowScopePath rebuilds the workflow route's own pathname")
    : bad("smsWorkflowScopePath does not match the route the workflow page is mounted at");

  /* ---- the four surfaces have to be wired, and only a grep can see a screen -
     `AgentWorkflow.tsx` and `PhonePreview.tsx` both reach `import.meta.glob` through
     `useProfile`, so node cannot import them. These are the narrowest possible greps: each
     names the one call that closes one half of the loop, and the functional checks above
     already prove the code those calls reach actually works. */
  const page = readAny("src/screens/AgentWorkflow.tsx");
  /extra && isSms \? \{ agent: smsWorkflowAgentOf\(extra\) \}/.test(page)
    ? ok("the SMS workflow page registers the agent half beside its diagram")
    : bad("the SMS workflow page registers only the diagram again — Ask AI can only reshape the tree");
  /wfAgent=\{\(tree as/.test(page)
    ? ok("and hands the EFFECTIVE half to the Preview Workflow chat")
    : bad("Preview Workflow reads the raw workflow, so an edited opener would not show there");
  const phone = readAny("src/screens/PhonePreview.tsx");
  /smsWorkflowScopePath\(wf\.slug\)/.test(phone) && /buildSmsBrain\(profile, ac, wf, wfAgent\)/.test(phone)
    ? ok("and the Preview Agent tab reads that scope back across the tab boundary")
    : bad("the Preview Agent tab never reads the workflow's agent half — the edit is a no-op there");
  /* ⚠️⚠️ **THE DRAWER'S GREETING ROW MUST SHOW THE EFFECTIVE OPENER, and the first build of
     this feature did not — caught in the browser, not by a type.** With the opener edited on
     the workflow page, the phone's first bubble read the new line while the drawer's OPENING
     MESSAGE row still showed the authored one. That is defect 3 of the 9/3 report coming back
     through a new door, and it matters because the drawer hands the model that same text as
     "the current opening message". */
  /greetingFallback: wfAgent\?\.greeting \?\? wf\?\.openingMessage/.test(phone)
    ? ok("and the drawer's greeting row shows the EFFECTIVE opener, not the authored one")
    : bad("the drawer can show an opening message the agent no longer sends");
  /* ⚠️ **COMMENTS STRIPPED FIRST, AND THE FIRST VERSION OF THIS CHECK FAILED WITHOUT IT.**
     That file's own header says "It must NEVER call `usePageData`", so a bare grep matched
     its documentation rather than its code and reported the rule as broken. `audit:place`
     already carries this exact fix, for the same reason. */
  const chat = readAny("src/components/WorkflowChatPreview.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  !/usePageData/.test(chat)
    ? ok("the chat drawer still registers no scope, so the page's sparkle stays on the tree")
    : bad("WorkflowChatPreview calls usePageData — it would repoint the page's sparkle");

  /* ⚠️ AND THE DRAWER MUST OFFER THE RIGHT CHANNEL. Registering an `agent` half made the
     empty state fall into the VOICE branch: "Build Orlando Health's voice agent", suggesting
     an opener beginning "Thanks for calling", on a screen whose whole subject is texts. */
  /* ⚠️ **THE CONDITION IS ASSERTED VERBATIM, AND THE FIRST VERSION OF THIS CHECK DID NOT
     FIRE.** It located the SMS body by searching for `d?.variant === "sms"` and then read the
     copy inside it — so disabling the branch as `if (false && d?.variant === "sms")` left the
     search string in place and the check passed against dead code. That is the same failure
     this file records verbatim: "a grep passed against `if (false && CHROME_KEYS.has(path))`".
     Verified to fire, both by disabling the branch and by voicing its copy. */
  const drawer = readAny("src/components/AiAssistantDrawer.tsx");
  drawer.includes('if (d?.agent && d?.variant === "sms") {')
    ? ok("the drawer branches on the channel before offering to build an agent")
    : bad("the SMS branch's guard is gone or has been disabled");
  const smsHint = drawer.slice(drawer.indexOf('if (d?.agent && d?.variant === "sms") {'),
    drawer.indexOf("if (d?.agent) {"));
  smsHint.includes("SMS agent") && !smsHint.includes("Thanks for calling")
    ? ok("its empty state offers to build the SMS agent, not a voice one")
    : bad("the SMS workflow page's Ask AI still offers a VOICE agent");
  smsHint.includes("open with Hi {name}")
    ? ok("and its example opener uses the {name} token the agent actually resolves")
    : bad("the SMS hint's example opener is not in the shape resolveGreeting expects");
}

/* =============================================================================
   THE DASH SWEEP MUST LEAVE `playbookSteps` ALONE (9/8/2026)
   -----------------------------------------------------------------------------
   Same reasoning `systemPrompt` was exempted for on 9/2: these are instructions to the
   model, never shown to a patient, and `\s{2,}` collapsing a blank line turned Reyes Law's
   bulleted playbook into one comma-joined paragraph that is not recoverable. The LIST form
   is why it needed its own rule: the object walk skips a SKIP_KEY only when the value is a
   string, so an array keyed `playbookSteps` was recursed into and swept step by step.
   ============================================================================= */
console.log("\nThe dash sweep leaves a workflow's flow alone");
{
  const count = { n: 0 };
  const swept = sweepValue({
    playbookSteps: ["Ask the brand - then the reference.", "Confirm - and hand off."],
    openingMessage: "Hi there - this is a message to a patient.",
  }, count) as { playbookSteps: string[]; openingMessage: string };
  swept.playbookSteps[0] === "Ask the brand - then the reference."
    ? ok("a dash inside a step survives, as it does inside a systemPrompt")
    : bad(`the sweep rewrote a playbook step: ${swept.playbookSteps[0]}`);
  swept.openingMessage === "Hi there, this is a message to a patient."
    ? ok("while an openingMessage is still swept, because a patient reads it")
    : bad(`openingMessage was not swept: ${swept.openingMessage}`);
}

/* =============================================================================
   THE SMS THREAD HEADER SHOWS A TOLL-FREE NUMBER, NOT THE PROSPECT'S NAME (9/8/2026)
   -----------------------------------------------------------------------------
   Asked for directly, against the phone mockup's contact pill (selected element:
   ".sms-namepill", reading "Orlando Health"): *"For all prospects i want you to change the
   contact information from the name of the prospect to a random 1-800 number."* A real
   iPhone Messages thread only shows a NAME when the sender is a saved contact; this is a
   cold business number, so digits are the more faithful mockup even before the ask.

   `tollFreeNumber(profileId)` lives in `src/data/smsContactNumber.ts` — its own file, not
   inline in `PhonePreview.tsx`, for the same reason `workflowChrome.ts` and
   `workflowRows.ts` are their own files: that screen imports `useProfile`, which reaches
   `profiles.ts` and its Vite-only `import.meta.glob`, so node cannot import it and a
   function stranded there could only be grepped, not called and swept for real collisions.
   ============================================================================= */
console.log("\nThe SMS thread header shows a stable toll-free number, not the prospect's name");
{
  const profiles = [...load("src/data/generated", (j: any) => j),
    ...load(".data/demos", (j: any) => j.profile)];
  const seen = new Set<string>();
  const ids = profiles.filter((p) => p?.id && !seen.has(p.id) && seen.add(p.id)).map((p) => p.id as string);

  ids.length >= 10
    ? ok(`swept ${ids.length} real profile ids`)
    : bad(`only found ${ids.length} profiles to sweep — load() may be broken`);

  const numbers = ids.map((id) => tollFreeNumber(id));
  numbers.every((n) => /^\(800\) 555-0\d{3}$/.test(n))
    ? ok("every number is shaped (800) 555-0XXX, the reserved-for-fiction exchange")
    : bad(`a number is not in the 555-0XXX shape: ${numbers.find((n) => !/^\(800\) 555-0\d{3}$/.test(n))}`);

  new Set(numbers).size === numbers.length
    ? ok(`all ${numbers.length} prospects get a distinct number — zero collisions`)
    : bad(`two prospects share a number, over ${numbers.length} profiles`);

  ids.every((id) => tollFreeNumber(id) === tollFreeNumber(id))
    ? ok("the number is a pure function of the profile id — stable across calls")
    : bad("the number is not deterministic");

  /* ⚠️ THE 555-01XX BLOCK (100 VALUES) WAS TRIED FIRST AND COLLIDED TWICE OVER 17 REAL
     PROFILES — proof the wider 555-0XXX shape (1,000 values) is really in effect is that at
     least one real id lands OUTSIDE the narrower 100-value block. */
  const outside01xx = numbers.some((n) => !/^\(800\) 555-01\d{2}$/.test(n));
  outside01xx
    ? ok("at least one number falls outside the narrower 555-01XX block, proving the wider range is live")
    : bad("every number still fits the old 100-value 555-01XX block — the widening may have regressed");

  const phone = readAny("src/screens/PhonePreview.tsx");
  /tollFreeNumber\(profile\.id\)/.test(phone)
    ? ok("the contact pill renders the toll-free number, not profile.customerName")
    : bad("the sms-namepill no longer calls tollFreeNumber — the prospect's name may be back");
  !/sms-namepill">\{profile\.customerName\}/.test(phone)
    ? ok("and the old customerName render is gone, not just shadowed")
    : bad("the old customerName render is still present alongside the new one");
}

/* =============================================================================
   THE TREE'S ROWS ARE SYMMETRIC AND NEVER CROWDED (9/8/2026)
   -----------------------------------------------------------------------------
   Reported directly: *"There isnt any symmetry, in the branch in the tree diagram... Sometimes
   the sales Inquiry branch is different length to the Need support. or the the branch line is
   too close to the Conversation Start box."*

   Both halves were the same root cause: `GEO`'s row constants are FIXED while node heights are
   MEASURED, so every gap in the diagram was `(a constant) - (however tall the text made the row
   above)`. Measured before the fix, across the seven Orlando Health workflow pages: the stub
   under Conversation Start was **4px** on the two whose subtitle wraps to a second line, 23px
   on the five that fit one line and 73px on the voice tree; and the built-in SMS tree's sales
   leaf stood **142px against the support leaf's 75px** because it carries two chips.

   ⚠️ THESE CALL THE REAL `rowLayout` OVER ADVERSARIAL HEIGHTS rather than checking one tree.
   A single example passing is what let this ship: five of the seven pages looked fine.
   ============================================================================= */
console.log("\nThe workflow tree's rows are symmetric and never crowded");
{
  const MIN_GAP = 30;
  /* One-line through five-line boxes, and a deliberately absurd one, on both channels and
     with and without each optional row. */
  const HS = [43, 65, 84, 103, 142, 400];
  let worst = Infinity, worstCase = "";
  let inverted = 0, cases = 0;
  for (const variant of ["sms", "voice"] as const) {
    for (const split of [false, true]) {
      for (const paths of [false, true]) {
        for (const trigger of HS) for (const start of HS) for (const intent of HS) for (const leaf of HS) {
          cases++;
          const R = rowLayout(variant, { trigger, start, intent, leaf }, { split, paths });
          /* Every connector the tree DRAWS, as (from, to) pairs. A row that is not drawn
             (`subBusY`/`leafBusY`/`pathTop` are 0 then) is deliberately excluded. */
          const gaps: [string, number][] = [
            ["trigger->start", R.startTop - R.triggerBottom],
            ["start->bus", R.busY - R.startBottom],
            ["bus->intent", R.intentTop - R.busY],
            ...(split
              ? [["intent->subBus", R.subBusY - R.intentBottom] as [string, number],
                 ["subBus->leaf", R.leafTop - R.subBusY] as [string, number]]
              : [["intent->leaf", R.leafTop - R.intentBottom] as [string, number]]),
            ...(paths
              ? [["leaf->leafBus", R.leafBusY - R.leafBottom] as [string, number],
                 ["leafBus->path", R.pathTop - R.leafBusY] as [string, number]]
              : []),
          ];
          for (const [name, gap] of gaps) {
            if (gap < 0) inverted++;
            if (gap < worst) { worst = gap; worstCase = `${name} = ${gap} (${variant}, trigger ${trigger}, start ${start}, intent ${intent}, leaf ${leaf})`; }
          }
        }
      }
    }
  }
  inverted === 0
    ? ok(`no connector points upwards, over ${cases} height combinations`)
    : bad(`${inverted} connectors are inverted — a line drawn bottom-to-top renders as nothing`);
  worst >= MIN_GAP
    ? ok(`every connector is at least ${MIN_GAP} design units long (shortest seen ${worst})`)
    : bad(`a connector is only ${worst} units long: ${worstCase}`);

  /* ⚠️ MONOTONE, which is the promise that no signed-off diagram moved. Taller text may push a
     row DOWN and must never pull one up. */
  const base = rowLayout("sms", { trigger: 65, start: 65, intent: 43, leaf: 75 }, { split: false, paths: true });
  const taller = rowLayout("sms", { trigger: 84, start: 84, intent: 64, leaf: 142 }, { split: false, paths: true });
  (["startTop", "busY", "intentTop", "leafTop", "leafBusY", "pathTop"] as const)
    .every((k) => taller[k] >= base[k])
    ? ok("taller text only ever pushes a row down, never up")
    : bad("a row moved UP when the text above it grew");

  /* ⚠️ THE VOICE TREE MUST BE BYTE-IDENTICAL. Its own gaps (103 / 73 / 100) already exceed
     MIN_GAP, so the shift stays 0 and every row sits exactly on its measured constant. Pinned
     because those numbers came off a real Invoca capture, not from us. */
  const v = rowLayout("voice", { trigger: 65, start: 65, intent: 84, leaf: 75 }, { split: false, paths: true });
  v.startTop === 176 && v.busY === 314 && v.intentTop === 344 && v.leafTop === 528
    && v.leafBusY === 660 && v.pathTop === 700
    ? ok("the voice tree still sits on the constants measured from the capture")
    : bad(`the voice tree moved: ${JSON.stringify(v)}`);

  /* ⚠️ AND THE ROWS MUST BE LEVELLED, or the gaps above prove nothing: they are computed from
     ONE height per row, so a renderer that let siblings keep their own heights would draw
     unequal stems from the same row however clean this arithmetic is. */
  const tree = readAny("src/components/WorkflowTree.tsx");
  /const levelRow = /.test(tree) && /el\.style\.minHeight = ""/.test(tree)
    ? ok("levelRow clears minHeight before measuring, so a row shrinks as well as grows")
    : bad("row levelling is gone, or measures its own applied height and can only grow");
  /* ⚠️ THIS READS `workflowRows.ts`, NOT THE COMPONENT. The arithmetic moved there so the
     sweep above could call it without React; the check followed it one commit later than it
     should have, and reported a defect that did not exist. */
  const rows = readAny("src/data/workflowRows.ts");
  /\bintentBottom = intentTop \+ h\.intent\b/.test(rows) && /\bleafBottom = leafTop \+ h\.leaf\b/.test(rows)
    ? ok("and a row's bottom is one number, so every stem leaving it is the same length")
    : bad("per-node bottoms are back — two branches can be different lengths again");
}

/* =============================================================================
   THE VOICE AGENT DIRECTOR (9/3/2026)
   -----------------------------------------------------------------------------
   The drawer on the voice workflow runs a much stronger model so an SE can describe agent
   BEHAVIOUR and have it land. Three things have to stay true or the feature silently
   degrades back to what it was, and none of them shows up as a type error:
     • the strong model is reached at all (a stray edit to the gate sends every page to Haiku,
       which answers the easy half of an instruction and stops);
     • Haiku is NOT sent adaptive thinking or `effort` — it 400s on either, which would break
       Ask AI on every dashboard in the app;
     • the drawer streams exactly where the server reasons, or the SE watches a spinner for
       twenty seconds with no idea whether it is working.
   ============================================================================= */
{
  const a = readAny("engine/assistant.ts");

  /^const DIRECTOR_MODEL = "claude-opus-5";$/m.test(a)
    ? ok("the director runs on Opus 5")
    : bad("the director model is missing or is no longer Opus 5");

  /* ⚠️ ONE GATE, THREE READERS. The model choice, the transport and the prompt section must
     all key off the SAME test, or the drawer promises what the model was never briefed to
     do. Asserted as a called FUNCTION rather than three copies of the regex. */
  (a.match(/isVoiceAgentPage\(/g) ?? []).length >= 3
    ? ok("one gate decides the model, the prompt and the transport")
    : bad("the voice-agent gate has been inlined again and the three can now drift");

  /* ⚠️ THE FAST PATH MUST STAY FAST AND CHEAP. Every other screen in the app is on it. */
  /if \(!director\) \{/.test(a) && /model: FAST_MODEL/.test(a)
    ? ok("every other page still answers on Haiku")
    : bad("the fast Haiku path is gone — every dashboard edit now costs Opus latency");

  /* ⚠️ HAIKU 400s ON BOTH OF THESE (engine/core.ts records the same for generation), so they
     may only ever appear after the director branch has returned the fast path. */
  const fastPath = a.slice(a.indexOf("if (!director)"), a.indexOf("/* ---- the director path"));
  !/thinking:|effort:/.test(fastPath)
    ? ok("adaptive thinking and effort stay off the Haiku call")
    : bad("thinking/effort leaked onto the Haiku path — it 400s, breaking Ask AI everywhere");

  /* ⚠️ STREAMING IS A REQUIREMENT, NOT A NICETY: the SDK refuses a non-streaming call it
     estimates could exceed 10 minutes, which Opus plus adaptive thinking reaches. */
  /client\.messages\.stream\(/.test(a) && /finalMessage\(\)/.test(a)
    ? ok("the director call streams")
    : bad("the director call no longer streams — it will fail on long answers");

  /* ⚠️ "omitted" IS THE DEFAULT ON OPUS 5 and streams EMPTY thinking text, so the progress
     note would render blank and the bar would move on nothing. */
  /display:\s*"summarized"/.test(a)
    ? ok("thinking is summarized, so the progress note carries real reasoning")
    : bad("thinking display is back to omitted — the progress note will be empty");

  /* ⚠️ THE BAR MUST NEVER PRINT 100 BEFORE THE JSON HAS PARSED. */
  a.indexOf('pct: 100') > a.indexOf("JSON.parse(text)")
    ? ok("100% is reported only after the answer parses")
    : bad("the bar can reach 100% before there is an answer");

  /* The six voices are named so "make it a man's voice" resolves to a real id. */
  /VOICE_OPTIONS\.map\(/.test(a) && /agent\.voice/.test(a)
    ? ok("the prompt names the real voices from voiceOptions")
    : bad("the prompt no longer names the offered voices");

  /* ⚠️ A LIST EDIT IS A REPLACEMENT, and a short array is indistinguishable from a deliberate
     removal to editGuard — so the whole-list contract is instruction-only and worth pinning. */
  /REPLACES THE WHOLE LIST/.test(a)
    ? ok("the whole-list contract is stated")
    : bad("nothing tells the model a list edit replaces the whole list");

  /* ⚠️ AND THE OLD TIMIDITY MUST NOT COME BACK. These two lines were written to stop a WEAK
     model wrecking a working agent and are exactly what stopped a strong one doing the job. */
  !/leave them alone unless the user is changing which areas are served/i.test(a)
    ? ok("informSteps are no longer fenced off")
    : bad("the 'leave informSteps alone' fence is back — behaviour edits will be declined");
  !/THE OPENING QUESTION IS TWO-WAY AND STAYS THAT WAY/.test(a)
    ? ok("the opening question can be rewritten when asked")
    : bad("the two-way opening question fence is back");

  /* ⚠️ BOTH TWINS OR NEITHER — the standing rule for these endpoint pairs. */
  const vite = readAny("vite.config.ts"), server = readAny("server.ts");
  /input\?\.stream/.test(vite) && /input\?\.stream/.test(server)
    ? ok("both endpoint twins serve the progress stream")
    : bad("only one twin streams — dev and prod now disagree");
  /X-Accel-Buffering/.test(vite) && /X-Accel-Buffering/.test(server)
    ? ok("both twins disable proxy buffering")
    : bad("a proxy can buffer the stream into one jump at the end");

  /* ⚠️ A STREAM THAT ENDS WITHOUT `done` MUST FAIL LOUDLY. Falling through would report
     success having changed nothing — the silent no-op this repo has recorded five times. */
  const drawer2 = readAny("src/components/AiAssistantDrawer.tsx");
  /if \(!r\) throw new Error\("The connection closed/.test(drawer2)
    ? ok("a dropped stream reports a failure, not a silent success")
    : bad("a dropped stream falls through and reads as success");
  /aiad-prog-fill/.test(drawer2) && /aiad-prog-pct/.test(drawer2)
    ? ok("the drawer renders a bar and a percentage")
    : bad("the progress bar is gone");
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll AI-rule checks passed\n");
process.exit(fail ? 1 : 0);
