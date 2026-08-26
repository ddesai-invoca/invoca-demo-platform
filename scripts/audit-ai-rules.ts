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
