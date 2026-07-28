/* One-time (and re-runnable) sweep that removes em dashes, en dashes and
   dash-joined clauses from prospect DATA: the generated profile JSONs, any local
   demo-library records, and the Shady Blinds seed.

   Why a script and not a regex in an editor: this rewrites call transcripts and
   summaries that SEs read aloud, so every replacement is printed for review and
   the rules are narrow enough to be auditable. `--dry` prints without writing.

   The engine now forbids dashes at generation time (NO_DASH_RULE in
   engine/core.ts) and the live agents strip them from output
   (stripDashes in engine/chat.ts). This handles the profiles that already exist.

   Deliberately NOT touched:
     - hyphens inside compound words: "pre-owned", "rear-ended", "24-48h"
     - date and numeric ranges: "1/1/2026-1/31/2026", "$40-60"
     - URLs, domains, ids and slugs (a dash there is structural)
     - keys — only string VALUES are rewritten
*/
import fs from "node:fs";
import path from "node:path";
/* Rules live in engine/dashSweep.ts so this script and the server-side boot
   migration cannot drift apart. */
import { fixProse } from "../engine/dashSweep.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

const SKIP_KEY = /^(id|slug|url|href|domain|brandDomain|websiteUrl|dateRange|range|path|icon)$/i;
const LOOKS_STRUCTURAL = (s: string) =>
  /^https?:\/\//.test(s) || /^[\w.-]+\.(com|net|org|io|gov|edu)/i.test(s) ||
  /^\d[\d/\-.]*$/.test(s);

let changes: { where: string; before: string; after: string }[] = [];

function walk(node: any, where: string): any {
  if (typeof node === "string") {
    if (LOOKS_STRUCTURAL(node)) return node;
    const next = fixProse(node);
    if (next !== node) changes.push({ where, before: node, after: next });
    return next;
  }
  if (Array.isArray(node)) return node.map((v, i) => walk(v, `${where}[${i}]`));
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = SKIP_KEY.test(k) && typeof v === "string" ? v : walk(v, `${where}.${k}`);
    }
    return out;
  }
  return node;
}

function sweepJson(file: string) {
  const raw = fs.readFileSync(file, "utf8");
  const before = changes.length;
  const next = walk(JSON.parse(raw), path.basename(file));
  const n = changes.length - before;
  if (n && !DRY) fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`${n ? "✎" : "·"} ${path.relative(REPO, file)}  ${n} change(s)`);
}

/* The seed is TypeScript, not JSON, so it gets a textual pass over quoted
   strings only. Comments and code are left alone: an em dash in a code comment
   is never shown to a prospect. */
function sweepSeed(file: string) {
  const src = fs.readFileSync(file, "utf8");
  let n = 0;
  const out = src.replace(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g, (m, q, body) => {
    if (LOOKS_STRUCTURAL(body)) return m;
    const fixed = fixProse(body);
    if (fixed !== body) { n++; changes.push({ where: path.basename(file), before: body, after: fixed }); }
    return q + fixed + q;
  });
  if (n && !DRY) fs.writeFileSync(file, out);
  console.log(`${n ? "✎" : "·"} ${path.relative(REPO, file)}  ${n} change(s)`);
}

const targets: string[] = [];
for (const dir of ["src/data/generated", ".data/demos"]) {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) if (f.endsWith(".json")) targets.push(path.join(abs, f));
}
targets.forEach(sweepJson);
sweepSeed(path.join(REPO, "src/data/profiles/shadyBlinds.ts"));

console.log(`\n${DRY ? "[dry run] " : ""}total: ${changes.length} replacement(s)`);
console.log("--- sample for review ---");
for (const c of changes.slice(0, 12)) {
  console.log(`  ${c.where}\n    - ${c.before.slice(0, 110)}\n    + ${c.after.slice(0, 110)}`);
}
