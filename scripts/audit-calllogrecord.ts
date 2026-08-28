/* Checks the Invoca Call Log RECORD page across every profile on disk: that every row in
   the Call Log tab opens a page, that the lead-to-record link round-trips, that the three
   sections the user asked to be reshaped really are reshaped, and that the utm values agree
   with the landing page URL printed beside them.
   Run: npx tsx scripts/audit-calllogrecord.ts */
import { readFileSync, readdirSync } from "node:fs";
import { salesforceCallLog } from "../src/data/salesforceCallLog.ts";
import { salesforceLeads } from "../src/data/salesforceLeads.ts";
import { salesforceLeadDetail } from "../src/data/salesforceLeadDetail.ts";
import { salesforceCallLogRecord } from "../src/data/salesforceCallLogRecord.ts";
import type { CustomerProfile } from "../src/data/schema.ts";

const dir = "src/data/generated";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
let bad = 0;

/** The demographic block the reduced Enriched section deliberately does not invent. */
const NEVER_ENRICHED = [/age range/i, /gender/i, /marital/i, /has children/i, /education/i,
  /household income/i, /home market value/i, /high net worth/i, /occupation/i];

/** utm params carried on a URL, so a row can be checked against the link it names. */
function utmOf(url: string, key: string): string | undefined {
  return new RegExp(`[?&]${key}=([^&#\\s]+)`, "i").exec(url ?? "")?.[1];
}

for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as CustomerProfile;
  const errs: string[] = [];
  const list = salesforceCallLog(p).records;

  /* ⚠️ EVERY ROW IN THE LIST IS A LINK NOW, so a name that does not resolve is a dead end
     mid-demo. This is the check that had to exist before those rows stopped being inert. */
  for (const rec of list) {
    if (!salesforceCallLogRecord(p, rec.name)) errs.push(`row does not resolve: ${rec.name}`);
  }
  if (salesforceCallLogRecord(p, "INVOCA-99999999") !== null) {
    errs.push("does NOT fail closed on a record this org has no row for");
  }

  /* The round trip: a lead names a record, and that record names the lead back. Before the
     record page existed the lead's card pointed at the LIST, so nothing could disagree;
     now the two pages can, and this is what stops them. */
  for (const lead of salesforceLeads(p).leads) {
    const named = salesforceLeadDetail(p, lead.slug)?.callLogName;
    if (!named) { errs.push(`${lead.slug}: no call log record`); continue; }
    const rec = salesforceCallLogRecord(p, named);
    if (!rec) { errs.push(`${lead.slug}: names ${named}, which does not resolve`); continue; }
    if (rec.lead?.slug !== lead.slug) {
      errs.push(`${lead.slug} -> ${named} -> ${rec.lead?.slug ?? "(nobody)"} — the link does not round-trip`);
    }
  }

  /* Sample the sections on the record the first lead points at, which is the one an SE
     actually opens, plus a record with no lead behind it. */
  const firstNamed = salesforceLeadDetail(p, salesforceLeads(p).leads[0].slug)?.callLogName;
  const unlinked = list.find((rec) => !salesforceCallLogRecord(p, rec.name)?.lead)?.name;
  for (const nm of [firstNamed, unlinked].filter(Boolean) as string[]) {
    const d = salesforceCallLogRecord(p, nm)!;
    const tag = nm === firstNamed ? "linked" : "unlinked";

    /* REDUCED, which is the ask — the capture has 23 enriched fields and 25 custom pairs. */
    if (d.enriched.length > 10) errs.push(`${tag}: ${d.enriched.length} enriched fields, expected <= 10`);
    if (d.customData.length > 12) errs.push(`${tag}: ${d.customData.length} custom pairs, expected <= 12`);
    /* ⚠️ AND WHAT WAS DROPPED MATTERS AS MUCH AS HOW MANY. Filling these would mean
       inventing a named caller's income and marital status to decorate a demo. */
    for (const re of NEVER_ENRICHED) {
      const hit = d.enriched.find((x) => re.test(x.name));
      if (hit) errs.push(`${tag}: enriched carries an invented demographic — ${hit.name}`);
    }

    /* Signals: one row per signal, and the names are the PROSPECT'S OWN off the call the
       rest of the demo shows, never invented here. */
    const met = (p.reports as Record<string, any>).callDetail?.metSignals ?? [];
    const unmet = (p.reports as Record<string, any>).callDetail?.unmetSignals ?? [];
    const known = new Set<string>([...met, ...unmet]);
    if (!d.signals.length) errs.push(`${tag}: no signal rows`);
    for (const s of d.signals) {
      if (!known.has(s.name)) errs.push(`${tag}: signal "${s.name}" is not one of this prospect's`);
    }
    if (met.length && !d.signals.some((s) => s.fired)) errs.push(`${tag}: no signal fired`);
    if (unmet.length && !d.signals.some((s) => !s.fired)) errs.push(`${tag}: every signal fired`);

    /* ⚠️ THE utm ROWS MUST AGREE WITH THE calling_page PRINTED BESIDE THEM. The first
       version read `utm_source = Paid Search` two rows above a URL saying
       `utm_source=google` — a contradiction anyone comparing the rows would catch. */
    const kv = new Map(d.customData.map((x) => [x.name, x.value]));
    const page = kv.get("calling_page") ?? "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const onUrl = utmOf(page, key);
      if (onUrl && kv.get(key) !== onUrl) {
        errs.push(`${tag}: ${key} is "${kv.get(key)}" but the calling_page says "${onUrl}"`);
      }
    }

    /* Every number on the page is on the reserved 555 exchange, so a promo number on a
       projector cannot ring a real business. */
    for (const fld of [...d.callData, ...d.callerData]) {
      if (!/phone|promo number$|caller id/i.test(fld.name)) continue;
      const digitsOnly = fld.value.replace(/\D/g, "");
      if (digitsOnly.length >= 10 && digitsOnly.slice(-7, -4) !== "555") {
        errs.push(`${tag}: ${fld.name} is not on the 555 exchange — ${fld.value}`);
      }
    }

    /* Stable across calls, or an SE cannot rehearse against the screen. */
    if (JSON.stringify(d) !== JSON.stringify(salesforceCallLogRecord(p, nm))) {
      errs.push(`${tag}: NOT STABLE across calls`);
    }
  }

  if (errs.length) bad++;
  console.log(`${errs.length ? "FAIL" : "ok  "} ${f.padEnd(44)} ${list.length} records`);
  errs.slice(0, 6).forEach((e) => console.log(`       - ${e}`));
  if (errs.length > 6) console.log(`       … and ${errs.length - 6} more`);
}

/* ⚠️ PROVE THE CHECKS BITE. Four tautological checks are already recorded in CLAUDE.md,
   so each of these is exercised against the exact shape that broke a real build. */
let selfFail = 0;
const expect = (label: string, ok: boolean) => { if (!ok) { console.log(`SELF-TEST FAIL: ${label}`); selfFail++; } };

expect("a matching utm pair passes",
  utmOf("https://x.com/?utm_source=google&utm_medium=cpc", "utm_source") === "google");
expect("the channel label FAILS against the URL",
  utmOf("https://x.com/?utm_source=google", "utm_source") !== "Paid Search");
expect("a URL with no utm params is exempt",
  utmOf("https://x.com/services", "utm_source") === undefined);
expect("the demographic guard rejects the fields it names",
  NEVER_ENRICHED.some((re) => re.test("Enriched Household Income"))
  && NEVER_ENRICHED.some((re) => re.test("Enriched Marital Status")));
expect("the demographic guard passes the fields we DO show",
  !NEVER_ENRICHED.some((re) => re.test("Enriched Carrier"))
  && !NEVER_ENRICHED.some((re) => re.test("Enriched Line Type"))
  && !NEVER_ENRICHED.some((re) => re.test("Enriched Zipcode")));
/* ⚠️ THE 555 TEST HAD TO BE PROVED ON A REAL FORMAT. The Leads audit's own version asked
   for three digits after the exchange and so agreed with a nine-digit phone number it was
   written to catch — the check, not the data, was wrong. */
const ex = (v: string) => v.replace(/\D/g, "").slice(-7, -4);
expect("555 passes on both formats this page renders",
  ex("(805) 555-0142") === "555" && ex("877-555-0961") === "555" && ex("805-555-1234") === "555");
expect("a real exchange FAILS", ex("(805) 962-0142") !== "555");

if (!selfFail) console.log("\nself-test: the utm, demographic and 555 checks reject the shapes that broke real builds");
bad += selfFail;

console.log(bad ? `\n${bad} failure(s)` : `\nall ${files.length} profiles ok`);
process.exit(bad ? 1 : 0);
