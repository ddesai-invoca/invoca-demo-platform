/* Checks the Leads list derivation across every profile on disk: that each lead is a
   person the profile actually names, that no row repeats, that the counts on the page
   are the row count rather than a typed number, and that the attribution id is stable
   and correctly shaped. Run: npx tsx scripts/audit-leads.ts */
import { readFileSync, readdirSync } from "node:fs";
import { salesforceLeads } from "../src/data/salesforceLeads.ts";
import type { CustomerProfile } from "../src/data/schema.ts";

const dir = "src/data/generated";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const ID = /^\d{4}\/\d{10}\/i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let bad = 0;

/** One row per person, however their number is written. */
function noRepeatedPerson(leads: { first: string; last: string }[]): boolean {
  const names = leads.map((l) => `${l.first} ${l.last}`.trim().toLowerCase().replace(/\s+/g, " "));
  return new Set(names).size === names.length;
}

for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as CustomerProfile;
  const v = salesforceLeads(p);
  const again = salesforceLeads(p);
  const errs: string[] = [];

  if (v.kpis[0].value !== v.leads.length) errs.push("Total Leads is not the row count");
  if (v.kpis[1].value !== v.leads.length) errs.push("No Activity is not the row count");
  if (!v.statusLine.startsWith(`${v.leads.length} item`)) errs.push("status line count disagrees");

  /* ⚠️ THIS CHECK USED THE DEDUP'S OWN KEY (name + phone) AND SO COULD NEVER FAIL —
     it passed 13 profiles while four of them rendered the same person on two rows
     under two phone numbers. It now asks the question the screen actually cares
     about ("does one person appear twice?"), and `noRepeatedPerson` is proved to
     bite below rather than assumed to. */
  if (!noRepeatedPerson(v.leads)) errs.push("the same person appears on two rows");

  for (const l of v.leads) {
    if (!ID.test(l.attributionId)) errs.push(`attribution id malformed: ${l.attributionId}`);
    if (!l.first) errs.push("lead with no name");
    if (!l.phone) errs.push(`${l.first}: no phone`);
    if (!l.product) errs.push(`${l.first}: no product of interest`);
  }
  /* Stability: the SE re-opens the tab mid-demo and the ids must not move. */
  if (JSON.stringify(v.leads) !== JSON.stringify(again.leads)) errs.push("NOT STABLE across calls");

  /* Every name must appear somewhere in the profile's own text. */
  const hay = JSON.stringify(p).toLowerCase();
  for (const l of v.leads) if (!hay.includes(l.first.toLowerCase())) errs.push(`${l.first} is not named in the profile`);

  const tag = errs.length ? "FAIL" : "ok  ";
  if (errs.length) bad++;
  console.log(`${tag} ${f.padEnd(44)} ${v.leads.length} leads  ${v.leads.map((l) => `${l.first} ${l.last}`).join(", ")}`);
  errs.forEach((e) => console.log(`       - ${e}`));
}
/* ⚠️ PROVE THE CHECK BITES. A duplicate-detector that is quietly vacuous is worse
   than none, which is exactly what the previous version of this file was. */
const sample = salesforceLeads(JSON.parse(readFileSync(`${dir}/${files[0]}`, "utf8")) as CustomerProfile).leads;
if (!noRepeatedPerson(sample)) { console.log("SELF-TEST FAIL: real leads should pass"); bad++; }
if (noRepeatedPerson([...sample, ...sample])) { console.log("SELF-TEST FAIL: doubled leads should FAIL"); bad++; }
else console.log("\nself-test: the duplicate check fails a doubled list, as it must");

console.log(bad ? `\n${bad} profile(s) failed` : `\nall ${files.length} profiles ok`);
process.exit(bad ? 1 : 0);
