/* =============================================================================
   npm run audit:sources — the Marketing Source rename is scoped and lossless
   -----------------------------------------------------------------------------
   Guards `src/data/marketingSources.ts`. The risk this exists for is NOT that the rename
   fails to happen — that is visible on screen in a second. It is that the rename reaches
   somewhere it must not: a Marketing MEDIUM legitimately IS "Facebook" (measured: 370 medium
   values and 366 landing-page URLs carry these words, against 97 source rows), and a
   breakdown's rows are a partition whose metrics must still sum to the prospect's own call
   total.

   Run over every profile on disk — the bundled ones, the 59 event seeds and any local demo.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { renameMarketingSources, renamedSource } from "../src/data/marketingSources.ts";

let bad = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { bad++; console.log(`  FAIL  ${m}`); };

function profiles(): { file: string; profile: any }[] {
  const dirs = ["src/data/generated", "engine/event-seeds", ".data/demos"];
  const out: { file: string; profile: any }[] = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
      const raw = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      out.push({ file: `${d}/${f}`, profile: raw.profile ?? raw });
    }
  }
  return out;
}

const all = profiles();
console.log(`\nMarketing Source rename — ${all.length} profiles\n`);

/* ---- 1. the exact-match rule, including the compounds it must refuse ------- */
const accepts = ["Facebook", "facebook", " YouTube "];
const refuses = ["Facebook / Instagram", "Paid Social (Facebook/Instagram)", "Facebook Ads",
  "Facebook Messenger", "Meta (Facebook/Instagram)", "Google", "Paid Search", ""];
accepts.every((v) => renamedSource(v))
  ? ok("standalone Facebook/YouTube are renamed, case- and space-insensitive")
  : no("a standalone value was not renamed");
refuses.every((v) => renamedSource(v) === null)
  ? ok("compound sources (Facebook / Instagram, Paid Social (…)) are left alone")
  : no(`a compound or unrelated source was renamed: ${refuses.find((v) => renamedSource(v))}`);
renamedSource("Facebook") === "Google LSA" && renamedSource("YouTube") === "ChatGPT"
  ? ok("Facebook -> Google LSA, YouTube -> ChatGPT")
  : no("the mapping changed");

/* ---- 2. nothing outside a Marketing Source position may move --------------- */
let changed = 0, lsa = 0, gpt = 0;
const leaks: string[] = [];
for (const { file, profile } of all) {
  const before = JSON.parse(JSON.stringify(profile));
  const after: any = renameMarketingSources(profile);
  if (JSON.stringify(after) !== JSON.stringify(before)) changed++;

  const eq = (label: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) leaks.push(`${file}: ${label}`);
  };
  /* The Digital Journey report is deliberately untouched — its row prints source, medium AND
     the landing URL together, so the tuple can only move as a whole. */
  eq("digitalInsights", before.reports?.digitalInsights, after.reports?.digitalInsights);

  for (const key of ["marketingDashboard", "aiAgentConversion"] as const) {
    const b = before.reports?.[key]?.breakdowns ?? [];
    const a = after.reports?.[key]?.breakdowns ?? [];
    if (b.length !== a.length) leaks.push(`${file}: ${key} breakdown count`);
    b.forEach((bd: any, i: number) => {
      if (bd.rows.length !== a[i].rows.length) leaks.push(`${file}: ${key}[${i}] row count`);
      eq(`${key}[${i}] metrics`, bd.rows.map((r: any) => r.metrics), a[i].rows.map((r: any) => r.metrics));
      const isSource = /source/i.test(bd.dimensionColumn ?? "");
      if (!isSource) eq(`${key}[${i}] non-source row names`, bd.rows.map((r: any) => r.name), a[i].rows.map((r: any) => r.name));
      else a[i].rows.forEach((r: any) => { if (r.name === "Google LSA") lsa++; if (r.name === "ChatGPT") gpt++; });
    });
  }
  for (const [i, sec] of (before.reports?.opsDashboard?.marketingSections ?? []).entries()) {
    const as = after.reports.opsDashboard.marketingSections[i];
    if (!/source/i.test(sec.table.columns[0] ?? "")) {
      eq(`ops[${i}] non-source table`, sec.table, as.table);
      eq(`ops[${i}] non-source chart`, sec.chart, as.chart);
    } else {
      eq(`ops[${i}] metrics`, sec.table.rows.map((r: any) => r.cells.slice(1)), as.table.rows.map((r: any) => r.cells.slice(1)));
      eq(`ops[${i}] bar values`, sec.chart.bars.map((b: any) => b.values ?? b.value), as.chart.bars.map((b: any) => b.values ?? b.value));
      /* The chart plots the table's own rows, so a rename that reached one and not the other
         would put two different source lists side by side in the same section.
         ⚠️⚠️ **MEASURED AS "DID THE RENAME MAKE IT WORSE", NOT AS AN ABSOLUTE — and the first
         version of this check was the absolute one and FAILED ON CORRECT CODE.** Five profiles
         already ship a chart bar the table beside it does not list (Hopscotch Primary Care's
         chart says "Paid Social" where its table says "Facebook (Paid Social)"), which is a
         GENERATOR inconsistency that predates this work; the rename left both untouched, since
         both are compounds. Asserting the absolute invariant reported a defect that was not
         ours and would have got this check deleted as a nuisance. */
      const diverge = (sec2: any) => {
        const t = sec2.table.rows.map((r: any) => r.cells[0]);
        return sec2.chart.bars.map((b: any) => b.name).filter((n: string) => !t.includes(n)).length;
      };
      if (diverge(as) > diverge(sec)) leaks.push(`${file}: ops[${i}] the rename split the chart from its table`);
    }
  }
}
leaks.length === 0
  ? ok(`nothing outside a source position moved (mediums, landing URLs, journey rows, row counts, every metric)`)
  : no(`${leaks.length} leak(s), first: ${leaks.slice(0, 3).join(" | ")}`);
ok(`${changed} of ${all.length} profiles changed; ${lsa} Google LSA and ${gpt} ChatGPT source rows`);

/* ---- 3. no Facebook/YouTube survives in a source position ------------------ */
const survivors: string[] = [];
for (const { file, profile } of all) {
  const a: any = renameMarketingSources(profile);
  const check = (n: string, where: string) => {
    if (/^(facebook|youtube)$/i.test(n.trim())) survivors.push(`${file} ${where}`);
  };
  for (const key of ["marketingDashboard", "aiAgentConversion"] as const)
    for (const bd of a.reports?.[key]?.breakdowns ?? [])
      if (/source/i.test(bd.dimensionColumn ?? "")) bd.rows.forEach((r: any) => check(r.name, key));
  for (const sec of a.reports?.opsDashboard?.marketingSections ?? [])
    if (/source/i.test(sec.table.columns[0] ?? "")) {
      sec.table.rows.forEach((r: any) => check(r.cells[0], "ops table"));
      sec.chart.bars.forEach((b: any) => check(b.name, "ops chart"));
    }
}
survivors.length === 0
  ? ok("no dashboard Marketing Source row still reads Facebook or YouTube")
  : no(`${survivors.length} survived, first: ${survivors.slice(0, 3).join(" | ")}`);

/* ---- 4. pure and idempotent ----------------------------------------------- */
const one = all[0].profile;
const a1: any = renameMarketingSources(one);
renameMarketingSources(a1) === a1
  ? ok("idempotent — a second pass is a no-op and returns the same object")
  : no("not idempotent");
const untouched = all.find((p) => renameMarketingSources(p.profile) === p.profile);
untouched
  ? ok("a profile with no such source keeps its referential identity (nothing re-renders)")
  : no("every profile was rewritten, so the no-op path is dead");

/* ---- 5. the engine asks for it, at ALL THREE prompts that make source rows -- */
/* ⚠️ ADJACENT TEMPLATE LITERALS ARE JOINED FIRST. The rule is built as `…Marketing ` + `MEDIUM…`
   across a line break, so a regex looking for the finished SENTENCE finds nothing in the raw
   source and reports the rule missing when it is right there. */
const core = fs.readFileSync("engine/core.ts", "utf8").replace(/`\s*\+\s*`/g, "");
const calls = (core.match(/\$\{sourceRows\(\)\}/g) ?? []).length;
calls >= 3
  ? ok(`engine/core.ts injects sourceRows() into ${calls} prompts (channels, ops, AI conversion)`)
  : no(`sourceRows() reaches only ${calls} prompt(s) — a source list is generated in three phases`);
/[Nn]EVER use "Facebook" or "YouTube" as a Marketing SOURCE/.test(core)
  ? ok("the prompt forbids Facebook/YouTube as a SOURCE")
  : no("the prompt no longer forbids them as a source");
/remain fine as a Marketing\s+MEDIUM/.test(core)
  ? ok("the prompt still permits them as a MEDIUM (or the model scrubs them everywhere)")
  : no("the prompt no longer protects the medium");

console.log(bad ? `\n${bad} source check(s) FAILED\n` : "\nAll Marketing Source checks passed\n");
process.exit(bad ? 1 : 0);
