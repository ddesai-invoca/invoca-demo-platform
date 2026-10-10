/* =============================================================================
   audit:custom-prompt — the launch form's custom prompt, its plan, and the pass
   that applies it
   -----------------------------------------------------------------------------
   Asked for 10/9/2026: a prompt under "Make this demo shareable" that is read back
   as a plan and, once confirmed, both steers the generation and applies per-screen
   edits afterwards.

   ⚠️⚠️ **THE CHECK THAT MATTERS MOST IS THE BASE-MATCH ONE.** `applyEdits` reads
   `overrides[key] ?? base`, edits it, and stores the WHOLE result back as the
   override. So a surface whose `base` is merely CLOSE to what its screen registers
   does not degrade gracefully, it REPLACES that page's data with the near-miss and
   nothing anywhere reports it. Two screens fold derived values in, so both were
   extracted rather than copied, and the checks below assert the screens still call
   the shared builder rather than growing a second copy.

   ⚠️ FUNCTIONAL WHERE POSSIBLE. `sanitizePlan` and `applyPlan` are CALLED, against
   stubs, never grepped: a source match passes against `if (false)`, which this repo
   has been bitten by three times.
   ============================================================================= */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");
/* Comments stripped before any source match — audits here have fired on their own
   documentation before, and a check that reddens on correct code gets deleted. */
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const { SURFACES, surfaceById, surfacesFor, surfaceKey } = await import("../src/data/demoSurfaces.ts");
const { sanitizePlan } = await import("../engine/demoPlan.ts");
const { applyPlan } = await import("../src/data/applyPlan.ts");
const { CustomerProfile } = await import("../src/data/schema.ts");
const { builtInWorkflowBase, deriveTree } = await import("../src/data/workflowBase.ts");
const { marketingBase, MARKETING_LABELS } = await import("../src/data/marketingBase.ts");

const profile = CustomerProfile.parse(JSON.parse(read("src/data/generated/aptive.json")));

/* ── the surface catalogue ───────────────────────────────────────────────── */
console.log("\nThe surfaces a prompt can reach\n");

SURFACES.length >= 12
  ? ok(`${SURFACES.length} surfaces are offered`)
  : bad(`only ${SURFACES.length} surfaces — the catalogue has been gutted`);

new Set(SURFACES.map((s) => s.id)).size === SURFACES.length
  ? ok("every surface id is unique")
  : bad("two surfaces share an id — the plan could not tell them apart");

new Set(SURFACES.map((s) => s.path)).size === SURFACES.length
  ? ok("every surface path is unique")
  : bad("two surfaces share a path — their edits would collide on one scope key");

/* ⚠️ A PATH IS HALF OF A SCOPE KEY AND ALSO A REAL ROUTE. One that is not routed would
   store edits under a key no screen ever reads: a success nobody can see. */
const routes = code("src/App.tsx");
/* ⚠️ THREE ROUTE SHAPES, AND THE FIRST VERSION OF THIS CHECK KNEW ONLY ONE — it reddened
   on four perfectly good surfaces. `path="/x"` is the common one; the in-shell screens are
   also declared as keys of a nav map (`"/signal": <SignalManager />`); and the two
   workflows are reached through a PARAM route (`/agent-studio/agent/workflow/:channel`).
   A check that fails on correct code gets deleted as a nuisance, so it understands all
   three — and it still catches a path that is genuinely routed nowhere. */
const patterns = [
  ...[...routes.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
  ...[...routes.matchAll(/^\s*"(\/[^"]*)":\s*</gm)].map((m) => m[1]),
];
const routed = (p: string) => patterns.some((pat) => {
  if (pat === p) return true;
  const a = pat.split("/"), b = p.split("/");
  return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
});
const unrouted = SURFACES.filter((s) => !routed(s.path));
!unrouted.length
  ? ok("every surface path is a real route in App.tsx")
  : bad(`a surface points at a route that does not exist: ${unrouted.map((s) => s.path).join(", ")}`);

SURFACES.every((s) => s.what.length > 30 && s.label.length > 3)
  ? ok("every surface describes itself to the planner")
  : bad("a surface has no usable description — the planner cannot target it");

/* ⚠️⚠️ EVERY BASE MUST BUILD, FOR A REAL PROFILE, AND BE A NON-EMPTY OBJECT. A base that
   throws takes the whole apply pass down; one that comes back empty would REPLACE the
   page's data with nothing the moment a single edit lands on it. */
const broken: string[] = [];
for (const s of surfacesFor(profile)) {
  try {
    const b = s.base(profile);
    if (!b || typeof b !== "object" || !Object.keys(b as object).length) broken.push(`${s.id} (empty)`);
  } catch (e: any) { broken.push(`${s.id} (threw: ${e?.message})`); }
}
!broken.length
  ? ok(`all ${surfacesFor(profile).length} of this prospect's bases build and are non-empty`)
  : bad(`a surface base is unusable: ${broken.join(", ")}`);

/* A prospect genuinely missing a slice must not be offered that surface. */
const stripped = JSON.parse(JSON.stringify(profile));
delete stripped.reports.callReview;
delete stripped.reports.signalManager;
!surfacesFor(stripped).some((s) => s.id === "call-review" || s.id === "signal")
  ? ok("a prospect without a slice is not offered that surface")
  : bad("a surface is offered for a slice the prospect does not have");

surfaceKey("acme", "/signal") === "acme::/signal"
  ? ok("the scope key is `<demoId>::<path>`, which is the prefix the demo PATCH slices on")
  : bad("the scope key is not `<demoId>::<path>` — these edits would never sync to the record");

/* ── the two extracted bases ─────────────────────────────────────────────── */
console.log("\nThe bases that are NOT plain profile slices\n");

/* ⚠️⚠️ THE SCREEN MUST CALL THE SHARED BUILDER. A second copy is the whole failure this
   extraction exists to prevent, and it is invisible until a page renders a gap. */
const mkt = code("src/screens/MarketingDashboard.tsx");
mkt.includes("marketingBase(") && mkt.includes('from "../data/marketingBase"')
  ? ok("MarketingDashboard registers the shared marketingBase")
  : bad("MarketingDashboard no longer calls marketingBase — its base can now drift");
!/function\s+deriveLeadFormGroup/.test(mkt)
  ? ok("MarketingDashboard does not re-declare deriveLeadFormGroup")
  : bad("deriveLeadFormGroup is back in the screen — there are two copies again");

const awf = code("src/screens/AgentWorkflow.tsx");
awf.includes("deriveTree(") && awf.includes('from "../data/workflowBase"')
  ? ok("AgentWorkflow builds its tree from the shared deriveTree")
  : bad("AgentWorkflow no longer calls the shared deriveTree");
!/function\s+deriveTree/.test(awf)
  ? ok("AgentWorkflow does not re-declare deriveTree")
  : bad("deriveTree is back in the screen — there are two copies again");

/* The marketing base must carry the derived group AND the labels, or the Lead Form card
   disappears the first time an edit lands on that page. */
const mb = marketingBase(profile as never) as Record<string, unknown>;
"leadFormSummary" in mb && Object.keys(mb).length > 3
  ? ok("the marketing base carries the derived Lead Form group")
  : bad("the marketing base has lost leadFormSummary — an edit would blank that card");
MARKETING_LABELS.leadFormSummary && MARKETING_LABELS.leadFormCount
  ? ok("the marketing labels are exported for both readers")
  : bad("the marketing labels are missing");

/* The workflow base must carry the TREE plus the half its channel owns. */
const smsBase = builtInWorkflowBase(profile, true) as any;
const voiceBase = builtInWorkflowBase(profile, false) as any;
smsBase.branches?.length && smsBase.sms && !smsBase.agent
  ? ok("the SMS workflow base carries the tree and its sms half, and no agent half")
  : bad("the SMS workflow base is the wrong shape");
voiceBase.branches?.length && voiceBase.agent && !voiceBase.sms
  ? ok("the voice workflow base carries the tree and its agent half, and no sms half")
  : bad("the voice workflow base is the wrong shape");
/* The registry must hand back the SAME object the builder makes, not an approximation. */
/* ⚠️⚠️ **ADDED AFTER A SABOTAGE WENT UNDETECTED.** The voice surface had this check and
   marketing did not, so pointing the marketing surface at the raw slice (dropping the
   derived Lead Form group) passed a green suite — which is precisely the near-miss base
   this whole file exists to catch. Every surface with a non-trivial base is pinned to its
   builder's own output now. */
JSON.stringify(surfaceById("marketing")!.base(profile)) === JSON.stringify(mb)
  ? ok("the marketing surface's base IS marketingBase, byte for byte")
  : bad("the marketing surface builds its own base — the Lead Form card would vanish");
JSON.stringify(surfaceById("sms-workflow")!.base(profile)) === JSON.stringify(smsBase)
  ? ok("the SMS workflow surface's base IS builtInWorkflowBase, byte for byte")
  : bad("the SMS workflow surface builds its own base — it can drift from the screen");
JSON.stringify(surfaceById("voice-workflow")!.base(profile)) === JSON.stringify(voiceBase)
  ? ok("the voice surface's base IS builtInWorkflowBase, byte for byte")
  : bad("the voice surface builds its own base — it can drift from the screen");
JSON.stringify(deriveTree(profile, true, "SMS").branches) === JSON.stringify(smsBase.branches)
  ? ok("the built-in base's branches are deriveTree's own")
  : bad("the workflow base's branches are not deriveTree's");

/* ── the plan ────────────────────────────────────────────────────────────── */
console.log("\nThe plan, and what it refuses\n");

const cat = SURFACES.map((s) => ({ id: s.id, label: s.label, what: s.what }));

/* ⚠️⚠️ AN ITEM NAMING A SCREEN THAT DOES NOT EXIST MUST BE DROPPED HERE, where there is
   still a list to check against. Shown on the confirm screen it would read as a change
   that is going to happen, and then apply to nothing. */
const withGhost = sanitizePlan({
  understood: "u", steer: "s", cannot: [],
  items: [
    { surface: "sms-agent", says: "a", instruction: "do a" },
    { surface: "not-a-screen", says: "b", instruction: "do b" },
  ],
}, cat);
withGhost.items.length === 1 && withGhost.items[0].surface === "sms-agent"
  ? ok("an item naming a screen that does not exist is dropped")
  : bad("sanitizePlan kept an item for a surface that does not exist");

const dup = sanitizePlan({
  understood: "u", steer: "", cannot: [],
  items: [
    { surface: "signal", says: "a", instruction: "first" },
    { surface: "signal", says: "b", instruction: "second" },
  ],
}, cat);
dup.items.length === 1 && dup.items[0].instruction === "first"
  ? ok("two items for one screen collapse to the first")
  : bad("sanitizePlan allows two items on one surface — the second would edit a replaced base");

sanitizePlan({ understood: "u", steer: "s", cannot: [],
  items: [{ surface: "signal", says: "a", instruction: "" }] }, cat).items.length === 0
  ? ok("an item with no instruction is dropped")
  : bad("an empty instruction survives — it would be sent to the assistant as nothing");

sanitizePlan({}, cat).items.length === 0 && sanitizePlan(null, cat).understood === ""
  ? ok("a malformed plan degrades to an empty one rather than throwing")
  : bad("sanitizePlan throws or invents on malformed input");

const many = sanitizePlan({ understood: "u", steer: "", cannot: [],
  items: Array.from({ length: 40 }, (_, i) => ({ surface: SURFACES[i % SURFACES.length].id, says: "x", instruction: "y" })) }, cat);
many.items.length <= 10
  ? ok(`the item list is capped (${many.items.length})`)
  : bad(`${many.items.length} items survived — one prompt could run 40 Opus calls`);

/* The planner must be shown every surface id, or it writes for screens that are not
   offered and `sanitizePlan` silently drops the lot. */
const planSrc = read("engine/demoPlan.ts");
planSrc.includes("input.surfaces.map((s) => `- ${s.id}") && planSrc.includes("Use the id exactly")
  ? ok("the planner is shown the surface ids and told to use them verbatim")
  : bad("the planner is not shown the surface catalogue");
/* ⚠️ FOUND ON THE FIRST REAL RUN: a plan whose summary promised three screen changes and
   whose items array was empty. The rule and the UI line are both pinned, because either
   alone leaves the confirm screen free to contradict itself. */
/It must describe ONLY what this plan actually contains/.test(planSrc)
  ? ok("the planner may only describe what its plan actually contains")
  : bad("the summary can promise edits the plan does not have");
/plan\.steer && !plan\.items\.length/.test(code("src/components/CustomPrompt.tsx"))
  ? ok("a plan with no per-screen edits says so rather than hiding the block")
  : bad("zero items renders as an absent block, which reads as changes that will happen");

/\bcannot\b/.test(planSrc) && planSrc.includes("Design:") && /chart a built-in tile is/.test(planSrc)
  ? ok("the planner is told what this platform cannot do, so it says so up front")
  : bad("the planner no longer refuses design and chart-type requests");

/* ⚠️ THE STANDING RULE, and this is prose a person reads on the confirm screen. */
const emProse = [
  "engine/demoPlan.ts", "src/components/CustomPrompt.tsx", "src/data/applyPlan.ts",
].filter((f) => {
  /* Only the STRINGS, not the commentary: this file's own notes legitimately use them. */
  const body = code(f);
  return [...body.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .some((m) => /[—–]/.test(m[1] ?? m[2] ?? ""));
});
!emProse.length
  ? ok("no em dash in any string a person reads")
  : bad(`an em dash is back in user-facing copy: ${emProse.join(", ")}`);

/* ── the apply pass ──────────────────────────────────────────────────────── */
console.log("\nApplying a confirmed plan\n");

const applySrc = code("src/data/applyPlan.ts");
applySrc.includes("deps.registerBase(") && !applySrc.includes("registerScope")
  ? ok("the pass seeds with registerBase, never registerScope")
  : bad("the pass calls registerScope — it would repoint the top bar's sparkle");

/* ⚠️ ORDERING: the base must be seeded BEFORE the assistant is asked, or the answer
   arrives seconds later with nowhere to land and applyEdits returns 0. */
applySrc.indexOf("deps.registerBase(") < applySrc.indexOf("await askOne(")
  ? ok("the base is seeded before the assistant is asked")
  : bad("the assistant is asked before the base is seeded — every edit would be a no-op");

/* ---- functional: a stubbed assistant, so the walk is really exercised ------ */
const realFetch = (globalThis as any).fetch;
function stubFetch(reply: (q: string) => any) {
  (globalThis as any).fetch = async (_u: string, init: any) => {
    const body = JSON.parse(init.body);
    const r = reply(body.question);
    if (r instanceof Error) throw r;
    return { ok: true, json: async () => ({ result: r }) } as any;
  };
}
function deps() {
  const written: { key: string; edits: any[] }[] = [];
  const tiles: { key: string; tile: any }[] = [];
  const based: string[] = [];
  return {
    written, tiles, based,
    d: {
      registerBase: (k: string) => { based.push(k); },
      applyEdits: (k: string, e: any[]) => { written.push({ key: k, edits: e }); return e.length; },
      addTile: (k: string, t: any) => { tiles.push({ key: k, tile: t }); },
      effectiveData: () => ({}),
    },
  };
}
/* ⚠️⚠️ **A THROWN PASS MUST REPORT AS FAIL, NOT CRASH THE SUITE.** Sabotaging the
   "one failure does not stop the walk" check made `applyPlan` rethrow, and the script died
   with a stack trace instead of naming the problem — which is a much worse thing to hand
   whoever broke it, and the trap `audit:replicas` already records. Every functional block
   below runs through this. */
async function guard(label: string, body: () => Promise<void>) {
  try { await body(); } catch (e: any) { bad(`${label} (it threw: ${e?.message})`); }
}

const plan2 = (ids: string[]) => ({
  understood: "u", steer: "", cannot: [],
  items: ids.map((id) => ({ surface: id, says: `change ${id}`, instruction: `change ${id}` })),
});

await guard("each item lands on its own scope key", async () => {
  stubFetch(() => ({ kind: "editData", edits: [{ path: "x", value: '"y"' }] }));
  const { written, based, d } = deps();
  const res = await applyPlan(plan2(["signal", "call-review"]) as any, profile, "demo-1", d);
  res.applied === 2 && written.length === 2
    && written[0].key === "demo-1::/signal" && written[1].key === "demo-1::/call-review"
    && based.length === 2
    ? ok("each item lands on its own surface's scope key")
    : bad(`the pass wrote ${written.length} edits to ${written.map((w) => w.key).join(", ")}`);
});

await guard("one surface failing does not stop the rest", async () => {
  /* ⚠️⚠️ ONE FAILURE MUST NOT STOP THE WALK. The demo is already published by the time
     this runs, so a thrown assistant call costs one screen, never the three minutes. */
  stubFetch((q) => (q.includes("signal") ? new Error("boom") : { kind: "editData", edits: [{ path: "x", value: '"y"' }] }));
  const { written, d } = deps();
  const res = await applyPlan(plan2(["signal", "call-review"]) as any, profile, "demo-2", d);
  res.items[0].state === "failed" && res.items[1].state === "done" && written.length === 1
    ? ok("one surface failing does not stop the rest")
    : bad(`a failure stopped the walk: ${res.items.map((i) => i.state).join(", ")}`);
});

await guard("a refusal is reported with its reason", async () => {
  /* An `answer` is the model declining. It must be REPORTED, never counted as applied. */
  stubFetch(() => ({ kind: "answer", answer: "I cannot change the colours." }));
  const { written, d } = deps();
  const res = await applyPlan(plan2(["signal"]) as any, profile, "demo-3", d);
  res.applied === 0 && written.length === 0 && res.items[0].state === "skipped" && !!res.items[0].detail
    ? ok("a refusal is reported with its reason, not counted as applied")
    : bad("a refusal reads as success — the silent no-op this feature exists to remove");
});

await guard("refused edits are reported as refused", async () => {
  /* editGuard refusing everything must not read as done either. */
  stubFetch(() => ({ kind: "editData", edits: [{ path: "x", value: '"y"' }] }));
  const { d } = deps();
  d.applyEdits = () => 0;
  const res = await applyPlan(plan2(["signal"]) as any, profile, "demo-4", d);
  res.applied === 0 && res.items[0].state === "skipped" && /refused/.test(res.items[0].detail ?? "")
    ? ok("edits the guard refused are reported as refused")
    : bad("refused edits read as applied");
});

await guard("an absent surface is skipped", async () => {
  /* A surface this prospect does not have is skipped rather than asked about. */
  stubFetch(() => { throw new Error("should not be called"); });
  const { d, based } = deps();
  const res = await applyPlan(plan2(["call-review"]) as any, stripped, "demo-5", d);
  res.items[0].state === "skipped" && !based.length
    ? ok("a surface the prospect does not have is skipped before any call is made")
    : bad("the pass asked about a screen this prospect does not have");
});

await guard("a tile lands only where one can be drawn", async () => {
  /* ⚠️ A TILE ONLY WHERE ONE CAN BE DRAWN — the same rule the drawer follows. A tile
     created on a screen that renders none is stored and never seen. */
  stubFetch(() => ({ kind: "create", tile: { tileType: "kpi", kpis: [] } }));
  const { tiles, d } = deps();
  await applyPlan(plan2(["marketing"]) as any, profile, "demo-6", d);
  const dashTiles = tiles.length;
  const { tiles: t2, d: d2 } = deps();
  const res2 = await applyPlan(plan2(["sms-workflow"]) as any, profile, "demo-7", d2);
  dashTiles === 1 && t2.length === 0 && res2.items[0].state === "skipped"
    ? ok("a tile is created on a dashboard and refused on a workflow page")
    : bad(`tiles landed wrongly: dashboard ${dashTiles}, workflow ${t2.length}`);
});

await guard("the dash sweep runs on assistant output", async () => {
  /* ⚠️ THE DASH SWEEP, ON EVERY STRING THE ASSISTANT WROTE. No human reads these edits
     before they land, so instruct-then-enforce applies with no reviewer in between. */
  stubFetch(() => ({ kind: "editData", edits: [{ path: "x", value: JSON.stringify("Fast service — same day") }] }));
  const { written, d } = deps();
  await applyPlan(plan2(["signal"]) as any, profile, "demo-8", d);
  !/[—–]/.test(written[0]?.edits[0]?.value ?? "")
    ? ok("an em dash the assistant wrote is swept before it lands")
    : bad("an assistant-written em dash reached the demo");
});
(globalThis as any).fetch = realFetch;

/* ── the wiring ──────────────────────────────────────────────────────────── */
console.log("\nThe launch form, and both server twins\n");

const launch = code("src/screens/Launch.tsx");
/* ⚠️ The confirm step is on the LAUNCH click, which is what was asked for. */
launch.includes("if (wanted && (!plan || planFor !== wanted))")
  ? ok("a written prompt is read back on the first Launch click, not generated")
  : bad("the confirm step is gone — a prompt would generate without being read back");
launch.includes("planFor === customPrompt.trim()")
  ? ok("the review is shown only for the exact text it was built from")
  : bad("the review can be shown for text it was not built from");
/\bif \(plan\) setPlan\(null\)/.test(launch)
  ? ok("editing the prompt invalidates a confirmed plan")
  : bad("editing after confirming would build the old plan under the new words");

/* ⚠️⚠️ ORDERING: the pass runs AFTER the demo is created and hydrated, and cannot fail it. */
const iCreate = launch.indexOf("const demo = await createDemo(");
const iApply = launch.indexOf("await applyPlan(");
iCreate > 0 && iApply > iCreate
  ? ok("the apply pass runs after the demo is published")
  : bad("the apply pass runs before the demo exists — there would be nothing to write to");
/applyPlan\([\s\S]{0,400}?\} catch \{/.test(launch)
  ? ok("a failed pass cannot lose the generated demo")
  : bad("applyPlan is not caught — one bad surface would discard a three-minute build");

/* The steer half rides the path that already existed, and ONLY when there is one. */
const gs = code("src/data/generateStream.ts");
gs.includes("...(steer?.trim() ? { steer: steer.trim() } : {})")
  ? ok("an empty prompt sends the byte-identical two-field body")
  : bad("the generate body changed shape for everyone, not just prompt users");
launch.includes("...(confirmed?.steer ? { steer: confirmed.steer } : {})")
  ? ok("a confirmed plan's steer reaches /api/generate")
  : bad("the steer half never reaches the generation");

/* Both twins, per the standing rule for these endpoint pairs. */
const srv = code("server.ts"), vite = code("vite.config.ts");
srv.includes('app.post("/api/demo-plan"') ? ok("server.ts serves POST /api/demo-plan")
  : bad("server.ts does not serve /api/demo-plan — the feature is dev-only");
vite.includes("'/api/demo-plan'") ? ok("the dev twin serves POST /api/demo-plan")
  : bad("the dev twin does not serve /api/demo-plan — it would 404 in dev");

/* ⚠️ The planner must NOT read the catalogue server-side: the client owns it because the
   client owns each surface's base, and a second copy is how they come to disagree. */
!/demoSurfaces/.test(code("engine/demoPlan.ts"))
  ? ok("the planner takes the catalogue as input rather than importing a second copy")
  : bad("engine/demoPlan.ts imports the surface registry — two lists that can drift");

/* Bulk: one prompt for the roster, same confirm step. */
const blk = code("src/components/BulkGenerate.tsx");
blk.includes("bulk: true") && blk.includes("<CustomPrompt bulk")
  ? ok("Bulk Generation carries one prompt for the whole roster")
  : bad("the roster prompt is missing");
blk.includes("planFor !== wanted") && blk.includes("await build()")
  ? ok("the roster is read back before an hour of generation starts")
  : bad("the roster would build without confirming — an hour on a misread prompt");

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll checks passed\n");
process.exit(fail ? 1 : 0);
