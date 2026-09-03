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
import { isLockedEdit } from "../src/data/editGuard.ts";
import { treeToVoicePaths } from "../src/data/voicePaths.ts";
import { collectNames } from "../src/data/workflowDrawers.ts";
import { emptyWorkflowTree, ZERO_TRIGGER } from "../src/data/workflowChrome.ts";
import { buildSmsBrain } from "../src/data/smsBrain.ts";
import { smsSystemPromptForAudit } from "../engine/chat.ts";

const SCREENS = "src/screens";
let fail = 0;
const bad = (msg: string) => { console.log(`  FAIL  ${msg}`); fail++; };
const ok = (msg: string) => console.log(`  ok    ${msg}`);

const files = fs.readdirSync(SCREENS).filter((f) => f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(SCREENS, f), "utf8");
/** Read anything in the repo — the voice-lock checks below span components/ and data/. */
const readAny = (f: string) => fs.readFileSync(f, "utf8");

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
  const wf = readAny("src/screens/AgentWorkflow.tsx");
  const extra = wf.slice(wf.indexOf("function extraTree"), wf.indexOf("function extraTree") + 3200);
  extra.includes("title: INTENT_SALES") && extra.includes("title: INTENT_SUPPORT")
    ? ok("extraTree draws the two chrome intents, not the authored branch titles")
    : bad("extraTree still draws authored branches as top-level intent nodes");
  extra.includes(`All \${INTENT_SALES} Users`) && extra.includes("SUPPORT_LEAF")
    ? ok("and the two chrome user-group leaves")
    : bad("extraTree does not use the chrome leaf titles");
  (extra.match(/locked: true/g) ?? []).length >= 4
    ? ok("all four chrome nodes are marked locked")
    : bad("fewer than four locked nodes in extraTree — one of the boxes is renameable");
  extra.includes("action: LEAF_QUALIFY") && extra.includes("action: LEAF_ESCALATE")
    ? ok("its leaves carry the same two default actions as the voice tree")
    : bad("extraTree's leaf actions are not the two defaults");
  !/leaves: wf\.branches\.map/.test(wf)
    ? ok("no authored branch is mapped straight onto a leaf again")
    : bad("extraTree maps authored branches onto leaves again");

  /* ⚠️ AND "LOCKED" MUST MEAN REFUSED, NOT MERELY DRAWN. Built here rather than grepped,
     because a flag that is set and never consulted is the silent no-op this file exists to
     stop — and `isLockedEdit` reads the NODE, so only a real tree exercises it. */
  const tree = {
    variant: "sms",
    branches: [
      { title: "Sales Inquiry", locked: true, leaves: [{ title: "All Sales Inquiry Users",
        action: "Qualify", locked: true, paths: [{ title: "Ready to Book", action: "Book Appointment", chips: ["Brand"] }] }] },
      { title: "Need Support", locked: true, leaves: [{ title: "All Support Users",
        action: "Support & Escalate", locked: true, paths: [{ title: "Human Requested", action: "Warm Hand-off" }] }] },
    ],
  };
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
  /greetingFallback:\s*wf\?\.openingMessage/.test(phone)
    ? ok("and the Preview Agent page tells it what that opener is")
    : bad("the Preview Agent page no longer passes the workflow's opener to the drawer");
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
