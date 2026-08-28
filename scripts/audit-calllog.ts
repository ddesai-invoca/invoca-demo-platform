/* Checks the Invoca Call Log derivation across every profile on disk: the auto-number
   format, the Recently Viewed order, the count agreeing with the rows, stability across
   calls, and the cross-screen invariant that Seller Home names a record from THIS list.
   Run: npx tsx scripts/audit-calllog.ts */
import { readFileSync, readdirSync } from "node:fs";
import { salesforceCallLog, newestCallLogName } from "../src/data/salesforceCallLog.ts";
import type { CustomerProfile } from "../src/data/schema.ts";

const dir = "src/data/generated";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const NAME = /^INVOCA-\d{8}$/;
let bad = 0;

/** "Recently Viewed" is by view time, so a strictly descending list means we sorted by name. */
function notNumericallySorted(names: string[]): boolean {
  const n = names.map((s) => Number(s.slice(7)));
  return n.some((v, i) => i > 0 && v > n[i - 1]);
}

const tops = new Map<string, string>();

for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as CustomerProfile;
  const v = salesforceCallLog(p);
  const again = salesforceCallLog(p);
  const errs: string[] = [];
  const names = v.records.map((r) => r.name);

  if (names.length !== 50) errs.push(`${names.length} records, expected 50`);
  for (const n of names) if (!NAME.test(n)) errs.push(`malformed name: ${n}`);
  if (new Set(names).size !== names.length) errs.push("duplicate record name");
  if (!v.statusLine.startsWith(`${names.length} item`)) errs.push(`status line disagrees: ${v.statusLine}`);
  if (!notNumericallySorted(names)) errs.push("records are in strict numeric order — that is 'sorted by name', not Recently Viewed");
  if (JSON.stringify(v.records) !== JSON.stringify(again.records)) errs.push("NOT STABLE across calls");

  /* ⚠️ THE CROSS-SCREEN INVARIANT THIS MODULE EXISTS FOR. Seller Home used to build its
     own `INVOCA-<callId>`, so the two screens named one record differently. */
  if (!names.includes(newestCallLogName(p))) errs.push("newestCallLogName is not in the list");
  if (newestCallLogName(p) !== names[0]) errs.push("newestCallLogName is not the newest row");

  tops.set(f, names[0]);
  const tag = errs.length ? "FAIL" : "ok  ";
  if (errs.length) bad++;
  console.log(`${tag} ${f.padEnd(44)} ${names[0]} … ${names[names.length - 1]}`);
  errs.forEach((e) => console.log(`       - ${e}`));
}

/* Two prospects sharing a block would show the same record ids in two demos. */
const distinct = new Set(tops.values()).size;
if (distinct < tops.size) {
  console.log(`\nFAIL only ${distinct} distinct starting numbers across ${tops.size} profiles`);
  bad++;
}

/* ⚠️ Seller Home must not go back to minting its own name. This is the one grep here,
   and it targets the exact shape of the bug rather than the helper's presence. */
const home = readFileSync("src/screens/SalesforceHome.tsx", "utf8");
if (/INVOCA-\$\{/.test(home)) { console.log("\nFAIL SalesforceHome builds its own INVOCA- name again"); bad++; }
if (!home.includes("newestCallLogName")) { console.log("\nFAIL SalesforceHome no longer reads newestCallLogName"); bad++; }

/* ⚠️ PROVE THE ORDER CHECK BITES — a sorted list must fail it, or it says nothing. */
const sample = salesforceCallLog(JSON.parse(readFileSync(`${dir}/${files[0]}`, "utf8")) as CustomerProfile)
  .records.map((r) => r.name);
if (!notNumericallySorted(sample)) { console.log("SELF-TEST FAIL: the real list should pass"); bad++; }
if (notNumericallySorted([...sample].sort().reverse())) { console.log("SELF-TEST FAIL: a sorted list should FAIL"); bad++; }
else console.log("\nself-test: the order check rejects a numerically sorted list, as it must");

console.log(bad ? `\n${bad} failure(s)` : `\nall ${files.length} profiles ok`);
process.exit(bad ? 1 : 0);
