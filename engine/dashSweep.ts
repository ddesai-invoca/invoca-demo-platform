/* Shared dash-stripping rules, used by BOTH scripts/strip-dashes.ts (local files)
   and the boot migration in server.ts (demos on Render's disk). One module on
   purpose: the same rules diverging between a script and the server is exactly
   how "it's clean locally but not live" happens.

   Why a server-side migration exists at all: PATCH /api/demos/:id is
   creator-only, so a user sweeping from their browser physically cannot fix a
   teammate's demo (charles-schwab, marriott, big-o-tires, audigy all 403'd).
   Code running on the server isn't acting as any user, so it can finish the job
   without weakening the ownership rule. */
import fs from "node:fs";
import path from "node:path";

/* Keys whose VALUES are structural — a dash there means something. */
const SKIP_KEY = /^(id|slug|url|href|domain|brandDomain|websiteUrl|dateRange|range|path|icon)$/i;

const looksStructural = (s: string) =>
  /^https?:\/\//.test(s) ||
  /^[\w.-]+\.(com|net|org|io|gov|edu)/i.test(s) ||
  /^\d[\d/\-.]*$/.test(s);

export function fixProse(v: string): string {
  /* A value that is ONLY dashes is a table placeholder meaning "no value".
     Rewriting it to ", " breaks the table; a placeholder dash is normal UI, not
     an AI tell. This is why a swept profile still reports ~10 dashes left. */
  if (/^[\s—–\-/]+$/.test(v)) return v;

  /* Ranges keep a plain hyphen. Turning "$22K–$28K" into "$22K, $28K" would
     change what the number means. */
  let out = v.replace(
    /(\$?[\d.,]+\s*[KMB%]?)\s*[—–]\s*(\$?[\d.,]+\s*[KMB%]?)/g,
    "$1-$2",
  );
  out = out
    .replace(/\s*[—–]\s*/g, ", ")                                  // prose em/en dash
    .replace(/([A-Za-z0-9)\]%])\s+-\s+([A-Za-z])/g, "$1, $2")      // spaced connector
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?;:])/g, "$1")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s{2,}/g, " ");
  return out;
}

/** Rewrites string values in place-ish (returns a new tree), counting changes. */
export function sweepValue(node: unknown, count: { n: number }): unknown {
  if (typeof node === "string") {
    if (looksStructural(node)) return node;
    const next = fixProse(node);
    if (next !== node) count.n++;
    return next;
  }
  if (Array.isArray(node)) return node.map((v) => sweepValue(v, count));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = SKIP_KEY.test(k) && typeof v === "string" ? v : sweepValue(v, count);
    }
    return out;
  }
  return node;
}

/* Runs once per data directory. The marker means a redeploy doesn't re-walk
   every demo on every boot, and it names the version so a future rule change
   can ship as v2. */
const MARKER = ".dash-sweep-v1";

export function migrateDemoDashes(dataDir: string): void {
  const marker = path.join(dataDir, MARKER);
  if (fs.existsSync(marker)) return;

  const demosDir = path.join(dataDir, "demos");
  if (!fs.existsSync(demosDir)) return;

  let files = 0, changed = 0, total = 0;
  for (const name of fs.readdirSync(demosDir)) {
    if (!name.endsWith(".json")) continue;
    files++;
    const file = path.join(demosDir, name);
    try {
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      const count = { n: 0 };
      const next = sweepValue(rec, count);
      if (count.n) {
        /* BUMP updatedAt. The frontend caches profiles in localStorage and only
           refetches when the library's updatedAt is newer than the copy it cached
           (see the SELF-HEAL note in DemoLibraryContext.tsx). Writing the file
           WITHOUT touching updatedAt made this migration invisible to that check:
           the server was correct and every already-loaded browser kept rendering
           the old content forever. That is exactly the "Bill is still seeing the
           old conversation" failure the self-heal was added to fix, and it could
           never fire because nothing here moved the timestamp it watches. */
        (next as { updatedAt?: string }).updatedAt = new Date().toISOString();
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
        changed++; total += count.n;
        console.log(`   ✎ ${name}: ${count.n} replacement(s)`);
      }
    } catch (e) {
      // One malformed file must not stop the migration or the boot.
      console.warn(`   ! ${name}: skipped (${(e as Error).message})`);
    }
  }
  try {
    fs.writeFileSync(marker, new Date().toISOString());
  } catch { /* if the marker can't be written it just runs again next boot */ }
  console.log(`🧹 Dash sweep: ${changed}/${files} demo(s) updated, ${total} replacement(s)`);
}
