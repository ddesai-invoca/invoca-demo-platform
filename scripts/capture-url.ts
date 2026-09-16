/* =============================================================================
   npm run capture -- <url> [slug] ["Label"] [--linked]
   -----------------------------------------------------------------------------
   The terminal twin of the Replicate button: same `captureReplica()` pipeline
   (engine/replicaCapture.ts), same persistent store (engine/replicaStore.ts) —
   so a capture made from here is indistinguishable from one the button made,
   and both survive a restart.

   `--linked` is the small/fast escape hatch: page HTML only, assets left on the
   site via `<base href>`. No expiry, but it follows the site as the site changes.
   ============================================================================= */
import { fetchReplica, sanitizeReplica } from "../engine/replicate.ts";
import { markLeadFields } from "../engine/replicaCapture.ts";
import { captureReplica } from "../engine/replicaCapture.ts";
import { saveReplica } from "../engine/replicaStore.ts";

const args = process.argv.slice(2);
const linked = args.includes("--linked");
const [url, slugArg, labelArg] = args.filter((a) => !a.startsWith("--"));
if (!url) {
  console.error('usage: npm run capture -- <url> [slug] ["Label"] [--linked]');
  process.exit(2);
}
const slug = (slugArg || new URL(url).hostname.replace(/^www\./, "").split(".")[0])
  .toLowerCase().replace(/[^a-z0-9-]+/g, "-");

const started = Date.now();
console.log(`\ncapturing ${url}  (${linked ? "linked" : "frozen"})`);

let html: string;
let finalUrl = url;
let title = "";
let map;
let formIndex = -1;
let fieldsMarked = 0;

if (linked) {
  const r = await fetchReplica(url);
  finalUrl = r.finalUrl;
  title = r.title;
  console.log(`  fetched   ${r.bytes.toLocaleString()} bytes via ${r.via} in ${r.ms}ms`);
  const clean = sanitizeReplica(r.html, r.finalUrl);
  const m = markLeadFields(clean.html);
  html = m.html;
  map = m.map;
  formIndex = m.formIndex;
  fieldsMarked = m.marked;
} else {
  const r = await captureReplica(url);
  if (!r.ok) {
    console.error("\nREFUSED — nothing was written:");
    for (const reason of r.reasons) console.error(`  ✗ ${reason}`);
    process.exit(1);
  }
  html = r.html;
  finalUrl = r.finalUrl;
  title = r.title;
  map = r.map;
  formIndex = r.formIndex;
  fieldsMarked = r.fieldsMarked;
}
console.log(`  title     ${title}`);
console.log(`  form      #${formIndex}, ${fieldsMarked} field(s) marked`);
for (const [k, v] of Object.entries(map)) {
  if (v && (!Array.isArray(v) || v.length) && Object.keys(v).length !== 0) console.log(`    ${k.padEnd(8)} ${JSON.stringify(v)}`);
}
if (!map.name.length) {
  console.error("\nREFUSED — no name field was identified, so nothing was written.");
  process.exit(1);
}

const host = new URL(finalUrl).hostname.replace(/^www\./, "");
const file = `${slug}.html`;
const rec = saveReplica(
  { slug, file, domain: host, sourceUrl: finalUrl, capturedAt: new Date().toISOString().slice(0, 10), label: labelArg || title.replace(/\s*[-|·].*$/, "").trim() || slug, fields: map },
  html,
);
console.log(`\n  wrote     ${rec.file}  (${(rec.bytes / 1048576).toFixed(1)}MB)  in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  saved to  the persistent replica store — the button will find this on its own.\n`);
