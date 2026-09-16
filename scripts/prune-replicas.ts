/* =============================================================================
   npm run capture:prune  [--dry]
   -----------------------------------------------------------------------------
   Deletes captures in the persistent store past `TTL_DAYS`. Expiry degrades to
   the live render path rather than breaking anything — see `captureAgeDays`.
   ============================================================================= */
import { listReplicas, deleteReplica } from "../engine/replicaStore.ts";
import { TTL_DAYS, captureAgeDays } from "../src/data/leadFields.ts";

const dry = process.argv.includes("--dry");
const now = new Date();
console.log(`\nCaptures expire after ${TTL_DAYS} days${dry ? "   (dry run)" : ""}\n`);

let freed = 0, removed = 0;
for (const r of listReplicas()) {
  const age = captureAgeDays(r.capturedAt, now);
  const mb = r.bytes / 1048576;
  const size = mb < 1 ? `${(r.bytes / 1024).toFixed(0)}KB` : `${mb.toFixed(1)}MB`;
  if (age >= TTL_DAYS) {
    console.log(`  ${r.slug.padEnd(14)} ${String(age).padStart(3)}d  ${size.padStart(8)}  ${dry ? "would delete" : "DELETED"}`);
    if (!dry) deleteReplica(r.slug);
    freed += r.bytes; removed++;
  } else {
    console.log(`  ${r.slug.padEnd(14)} ${String(age).padStart(3)}d  ${size.padStart(8)}  ${TTL_DAYS - age}d left`);
  }
}
console.log(removed ? `\n${dry ? "Would free" : "Freed"} ${(freed / 1048576).toFixed(1)}MB from ${removed} capture(s).\n` : `\nNothing to prune.\n`);
