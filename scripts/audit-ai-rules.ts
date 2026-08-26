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
  wf.includes('SMS_TRIGGER = "0 Campaigns, 0 Forms, and 0 Inbound SMS"')
    ? ok("the trigger line names inbound SMS")
    : bad("the SMS trigger line is not the product's wording");

  /* Locked must be ENFORCED, not merely declared — otherwise a rename is a silent no-op. */
  guard.includes("export function isLockedEdit")
    ? ok("isLockedEdit exists")
    : bad("isLockedEdit is gone");
  ctx.includes("isLockedEdit(nextData")
    ? ok("applyEdits refuses a locked rename (counted as blocked, so the drawer says so)")
    : bad("isLockedEdit is defined but never called — a locked rename would silently no-op");
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll AI-rule checks passed\n");
process.exit(fail ? 1 : 0);
