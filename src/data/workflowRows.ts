
/* =============================================================================
   workflowRows.ts — WHERE EACH ROW OF THE WORKFLOW DIAGRAM SITS
   -----------------------------------------------------------------------------
   ⚠️ **A DATA MODULE, FOR THE SAME TWO REASONS `workflowChrome.ts` IS ONE.** It holds no JSX
   and imports no React, so (a) `npm run audit:ai` can call `rowLayout` directly and sweep it
   over thousands of height combinations instead of eyeballing one tree, and (b) exporting a
   plain function from `WorkflowTree.tsx` would break that file's fast refresh (`oxlint`'s
   `only-export-components`, which this repo already carries three of).

   Nothing about the values or the arithmetic changed when it moved out of the component.
   ============================================================================= */

/* Row geometry per channel, matched to the two real pages. Voice nodes are 248px
   and carry a subtitle, so every row sits lower. */
export const GEO = {
  /* ⚠️ `leafBus` and `path` are the FOURTH ROW, and `pathHeight` is only used when a leaf
     actually has paths — so a tree without them keeps its signed-off canvas height exactly. */
  /* ⚠️ `pathBus` and `sub` are the SIXTH ROW, and `subHeight` is only used when a PATH itself
     has children — so a tree without them keeps its signed-off canvas height exactly, the same
     opt-in rule `leafBus`/`path` already follow one row up. Derived as one more `path`-to-`sub`
     pitch, matching the gap this variant already puts between the leaf row and the path row. */
  sms:   { nodeW: 220, gap: 26, trigger: 8, start: 122, intent: 240, subBus: 300, leaf: 344, leafBus: 462, path: 500, pathBus: 618, sub: 656, height: 470, pathHeight: 660, subHeight: 816, triggerW: 200, startW: 230 },
  /* ⚠️⚠️ **THE MEASURED SMS PAGE, AND IT IS NOT `sms` (9/17/2026).**
     `reference/agent-workflow/sms-tree.html` puts every node at **248 wide on a 296 pitch**
     (248 + 48) with a uniform **168 row pitch** — read off the react-flow transforms, and
     corroborated by its edge paths, which run between node CENTRES at x = left + 124. Node
     heights fall out of the same edges: trigger 93, Conversation Start 69, intent 93, segment 81.
     So the real SMS page is far closer to our `voice` geometry than to `sms`.
     ⚠️ **A THIRD ENTRY RATHER THAN A CORRECTION TO `sms`, and that is deliberate.** `sms` is
     drawn by seven signed-off extra workflows (Orlando Health's five ER trees, Avi & Co - New,
     the generated quote-request ones); editing it would restyle all of them for a change asked
     about the built-in workflow. Opt in per model, the rule this component already follows. */
  smsV2: { nodeW: 248, gap: 48, trigger: 8, start: 176, intent: 344, subBus: 470, leaf: 512, leafBus: 644, path: 680, pathBus: 812, sub: 848, height: 700, pathHeight: 880, subHeight: 1052, triggerW: 248, startW: 248 },
  voice: { nodeW: 248, gap: 32, trigger: 8, start: 176, intent: 344, subBus: 470, leaf: 528, leafBus: 660, path: 700, pathBus: 832, sub: 872, height: 700, pathHeight: 880, subHeight: 1052, triggerW: 248, startW: 248 },
} as const;

/**
 * The SHORTEST a connector may be, in design units.
 *
 * ⚠️⚠️ **THE ROW CONSTANTS IN `GEO` ARE FIXED AND NODE HEIGHTS ARE MEASURED, SO EVERY GAP IN
 * THE DIAGRAM VARIED WITH ITS TEXT (9/8/2026).** Reported directly: "there isnt any symmetry
 * in the branch in the tree diagram... the branch line is too close to the Conversation Start
 * box." Measured across the seven Orlando Health workflow pages, the stub between the
 * Conversation Start box and the branch bus came out at **4px** on the two whose `startLabel`
 * wraps to a second line ("SMS · branch on the patient record"), 23px on the five that fit one
 * line, and 73px on the voice tree. One tree away from a THIRD line it would have inverted and
 * pointed upwards, which is the failure already recorded at the top of `FALLBACK`.
 *
 * Every row now sits at `max(its constant, the measured row above + this)`, so a row is pushed
 * DOWN when its text grows and never crowds the row above. Monotone on purpose: nothing that
 * has room today moves, so the voice tree is byte-identical.
 *
 * ⚠️ 30 IS THE PRODUCT'S OWN DROP, not a taste: `busY` was written as `g.intent - 30`, so the
 * bus-to-intent connector has always been 30. Using the same number everywhere is what makes
 * the whole diagram read as one rhythm instead of five.
 */
const MIN_GAP = 30;

/** Node heights, one per ROW — see `levelRow` for why a row has a single height. */
export interface RowHeights { trigger: number; start: number; intent: number; leaf: number; path?: number }

/** Every y the diagram needs, in design units. */
export interface RowLayout {
  triggerBottom: number; startTop: number; startBottom: number; busY: number;
  intentTop: number; intentBottom: number; subBusY: number;
  leafTop: number; leafBottom: number; leafBusY: number; pathTop: number;
  /* The sixth row. Zero unless a path actually has children — see `rowAt`'s own warning about
     asking it for a row this tree never draws. */
  pathBottom: number; pathBusY: number; subTop: number;
}

/**
 * One SHARED downward shift, grown as needed — not a `max` per row.
 *
 * ⚠️⚠️ **THE PER-ROW `max` WAS THE FIRST ATTEMPT AND IT TRADED ONE INCONSISTENCY FOR
 * ANOTHER.** Clamping each row independently fixed the crowding, but a row pushed down while
 * the row BELOW stayed on its constant just ate the next gap instead: measured, the
 * intent-to-leaf stem came out 54px on five workflows and **35px on the two whose subtitle
 * wraps**. Symmetric within a tree, still ragged across the left-nav list of them.
 *
 * Accumulating ONE shift and applying it to every row below means each variant's DESIGNED
 * gaps survive intact — a row that has to move takes everything under it along. Verified
 * across all seven Orlando Health pages: 30 under Conversation Start, 30 into the intent
 * row, 61 into the leaves, 30 into the leaf bus and 38 into the use cases, on every one.
 *
 * ⚠️ **STILL MONOTONE, SO NOTHING WITH ROOM MOVES.** The voice tree's own gaps (103 / 73 /
 * 100) all exceed MIN_GAP already, so `shift` stays 0 there and its geometry — which was
 * measured off a real capture — is byte-identical.
 *
 * ⚠️ **CALL IT ONLY FOR ROWS THIS TREE ACTUALLY DRAWS.** It mutates `shift`, so asking it
 * about the sub-bus on a tree with no split grew the shift by 13px and pushed every row below
 * down for a bus that is never rendered. Caught while checking the arithmetic, not on screen.
 */
export function rowLayout(
  variant: keyof typeof GEO,
  h: RowHeights,
  opts: { split: boolean; paths: boolean; subs?: boolean },
): RowLayout {
  const g = GEO[variant];
  let shift = 0;
  const rowAt = (rowConst: number, prevBottom: number): number => {
    shift = Math.max(shift, prevBottom + MIN_GAP - rowConst);
    return rowConst + shift;
  };
  const triggerBottom = g.trigger + h.trigger;
  const startTop = rowAt(g.start, triggerBottom);
  const startBottom = startTop + h.start;
  const busY = rowAt(g.intent - MIN_GAP, startBottom);
  const intentTop = rowAt(g.intent, busY);
  /* Row-uniform now — see the note on the height state. Every stem leaving this row is
     therefore the same length, on every branch, which is the reported asymmetry. */
  const intentBottom = intentTop + h.intent;
  const subBusY = opts.split ? rowAt(g.subBus, intentBottom) : 0;
  const leafTop = rowAt(g.leaf, opts.split ? subBusY : intentBottom);
  const leafBottom = leafTop + h.leaf;
  const leafBusY = opts.paths ? rowAt(g.leafBus, leafBottom) : 0;
  const pathTop = opts.paths ? rowAt(g.path, leafBusY) : 0;
  /* ⚠️ GATED ON `subs`, NOT ON `paths`. Every tree with a use-case row would otherwise grow two
     rows it never draws, because `rowAt` mutates the shared shift — the trap this file already
     records for the sub-bus. `h.path` falls back to the leaf height for the frame before the
     sixth row has been measured. */
  const pathBottom = opts.subs ? pathTop + (h.path ?? h.leaf) : 0;
  const pathBusY = opts.subs ? rowAt(g.pathBus, pathBottom) : 0;
  const subTop = opts.subs ? rowAt(g.sub, pathBusY) : 0;
  return { triggerBottom, startTop, startBottom, busY, intentTop, intentBottom, subBusY,
    leafTop, leafBottom, leafBusY, pathTop, pathBottom, pathBusY, subTop };
}
