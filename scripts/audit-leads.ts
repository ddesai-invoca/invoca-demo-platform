/* Checks the Leads list derivation across every profile on disk: that each lead is a
   person the profile actually names, that no row repeats, that the counts on the page
   are the row count rather than a typed number, and that the attribution id is stable
   and correctly shaped. Run: npx tsx scripts/audit-leads.ts */
import { readFileSync, readdirSync } from "node:fs";
import { liveBookedLead } from "../src/data/salesforceLiveLead.ts";
import { salesforceLeadDetail } from "../src/data/salesforceLeadDetail.ts";
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
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as CustomerProfile & Record<string, any>;
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

  /* ⚠️ THE LIST IS PADDED, so "every name is in the profile" is no longer the invariant —
     the one that matters now is that the prospect's OWN people are not buried under the
     filler. Derived here from the JSON rather than asked of the module, so it is a real
     check and not a restatement of the implementation. */
  const hay = JSON.stringify(p).toLowerCase();
  /* ⚠️ A FULL-NAME MATCH ALONE IS A FALSE NEGATIVE HERE: the CI-derived leads come from
     `firstName` / `lastName` stored as separate fields, so "James Mitchell" appears
     nowhere as one string and the check called a real lead filler. Either form counts. */
  const isReal = (l: { first: string; last: string }) =>
    hay.includes(`${l.first} ${l.last}`.trim().toLowerCase()) ||
    (hay.includes(`"${l.first.toLowerCase()}"`) && hay.includes(`"${l.last.toLowerCase()}"`));
  const lastReal = v.leads.map(isReal).lastIndexOf(true);
  const firstFiller = v.leads.map(isReal).indexOf(false);
  if (firstFiller !== -1 && lastReal > firstFiller) errs.push("a profile-named lead sits below a filler row");
  /* Every profile names at least its two screen-pop callers, so fewer than two real leads
     means a source stopped being read — which a looser "at least one" would not catch. */
  if (v.leads.filter(isReal).length < 2) errs.push("fewer than two leads came from the profile");
  /* A filler must be nobody the demo already names — an agent appearing as their own lead. */
  const fillers = v.leads.filter((l) => !isReal(l));
  for (const l of fillers) if (hay.includes(`${l.first} ${l.last}`.toLowerCase())) errs.push(`${l.first} ${l.last} collides with a name in the profile`);

  /* Filler rows must be safe to put on a projector: the reserved 555 exchange, the
     prospect's own area code, and a product this prospect actually sells. */
  const area = String(p.reports?.voiceScreenpop?.callerPhone ?? p.reports?.smsScreenpop?.callerPhone ?? "")
    .replace(/\D/g, "").slice(-10, -7);
  const catalogue = [p.reports?.voiceScreenpop?.products, p.reports?.smsScreenpop?.products]
    .flatMap((x) => String(x ?? "").split(",")).map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const l of v.leads) {
    if (isReal(l)) continue;
    /* ⚠️ `\d{4}`. This asked for three and so passed "(805) 555-466" — a nine-digit phone
       number rendered on screen, which the check was written to prevent. */
    if (!/^\(\d{3}\) 555-\d{4}$/.test(l.phone)) errs.push(`${l.first}: filler phone is not a 555 number (${l.phone})`);
    if (area && !l.phone.startsWith(`(${area})`)) errs.push(`${l.first}: filler phone is not the prospect's area code`);
    if (catalogue.length && !catalogue.includes(l.product)) errs.push(`${l.first}: "${l.product}" is not one of this prospect's products`);
  }

  /* The ask was ten. More is fine when the profile itself names more. */
  if (v.leads.length < 10) errs.push(`only ${v.leads.length} leads, expected at least 10`);

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


/* =============================================================================
   THE LEAD A BOOKED CALL CREATES
   -----------------------------------------------------------------------------
   Asked for 9/3/2026: the booking agent's call should create the lead, and the Calendar chip
   should open it. The whole beat ends in a NAVIGATION, and this file already records what
   that costs when it goes wrong — a derived value that becomes a LINK acquires an invariant
   it never had as a string, and two leads once hashed to one call-log record unnoticed for
   exactly that reason. So the checks are about the JOIN, not the pieces.
   ============================================================================= */
{
  /* ⚠️ THIS SCRIPT COUNTS with `let bad = 0` rather than calling `bad()` like `audit:ai` does.
     Local helpers keep that idiom instead of importing another file's. */
  const okL = (m: string) => console.log(`  ok    ${m}`);
  const badL = (m: string) => { console.log(`  FAIL  ${m}`); bad++; };
  const p = JSON.parse(readFileSync(`${dir}/${files[0]}`, "utf8")) as CustomerProfile;
  const prof = (p as unknown as { profile?: CustomerProfile }).profile ?? p;
  const call = (name: string, zip: string) => ([{
    id: "CAUD-1234567890AB", time: "9/3/26 11:42 am", active: true, date: "September 3, 2026",
    transcript: [], signals: [], voiceInfo: { callerId: "(212) 555-0147" },
    outcome: { transferred: false, routedTo: "", callerName: name, intent: "Book", location: zip,
      booked: true, bookedDay: "Thursday", bookedTime: "12:30 PM",
      bookedLocation: "the New York boutique", bookedZip: zip, bookedProduct: "" },
  }] as never);

  const base = salesforceLeads(prof);
  const existing = `${base.leads[1].first} ${base.leads[1].last}`;

  for (const [label, who] of [["a new caller", "Elena Marchetti"], ["an existing lead", existing]] as const) {
    const c = call(who, "10001");
    const live = liveBookedLead(prof, c);
    if (!live) { badL(`${label}: no lead was created from a booked call`); continue; }
    const view = salesforceLeads(prof, c);
    const names = view.leads.map((l) => `${l.first} ${l.last}`);

    /* ⚠️ THE TOP ROW, because the list is sorted by Created Date and this is the row the SE
       just created. A first version replaced an existing caller in place and left them
       mid-list while a filler held the top. */
    names[0] === who ? okL(`${label}: is the top row`) : badL(`${label}: top row is ${names[0]}, not ${who}`);
    /* ⚠️ AND NEVER TWICE. The booking caller is often ALREADY a lead (Avi & Co's is its own
       screen-pop caller), and a blind prepend put one person on two rows. */
    names.length === new Set(names).size ? okL(`${label}: nobody appears twice`) : badL(`${label}: a person is duplicated`);
    view.leads.length === base.leads.length
      ? okL(`${label}: the list keeps its length`) : badL(`${label}: list length changed to ${view.leads.length}`);
    /* ⚠️ THE COUNT LINE AND THE TILES ARE DERIVED, so they must agree with the rows. */
    view.statusLine.startsWith(`${view.leads.length} item`)
      ? okL(`${label}: the count line matches the rows`) : badL(`${label}: count line disagrees with the rows`);

    /* ⚠️⚠️ THE JOIN THE CALENDAR CHIP DEPENDS ON. The chip navigates to this slug; if the
       record page cannot resolve it the beat ends on "Lead not found". */
    const d = salesforceLeadDetail(prof, live.lead.slug, c);
    d ? okL(`${label}: the chip's slug resolves on the record page`)
      : badL(`${label}: the record page cannot resolve ${live.lead.slug}`);
    if (d) {
      d.description?.includes("12:30 PM")
        ? okL(`${label}: the record names the booked time`) : badL(`${label}: the booked time is not on the record`);
      d.leadSource === "Inbound Call"
        ? okL(`${label}: Lead Source says the call created it`) : badL(`${label}: Lead Source is ${d.leadSource}`);
    }
  }

  /* Fails closed: an unbooked call creates nothing, and the derived list is untouched. */
  const unbooked = [{ id: "C1", time: "x", active: true, date: "x", transcript: [], signals: [],
    outcome: { transferred: true, routedTo: "", callerName: "Nobody Here", intent: "", location: "", booked: false } }] as never;
  !liveBookedLead(prof, unbooked) ? okL("an unbooked call creates no lead") : badL("an unbooked call created a lead");
  !liveBookedLead(prof, undefined) ? okL("and neither does no call at all") : badL("no call at all created a lead");
  /* ⚠️ HALF A NAME IS NOT A LEAD — the list renders a first AND last name. */
  const oneName = call("Cher", "10001");
  !liveBookedLead(prof, oneName) ? okL("a caller with only one name creates no lead") : badL("a one-name caller became a lead");
  /* An unrecognised ZIP leaves the address alone rather than half-writing it. */
  const oddZip = call("Elena Marchetti", "12345");
  const dz = salesforceLeadDetail(prof, liveBookedLead(prof, oddZip)!.lead.slug, oddZip);
  dz && dz.address === undefined
    ? okL("an unrecognised ZIP leaves the address blank") : badL(`an unrecognised ZIP produced ${dz?.address}`);
  /* And a DERIVED lead's Address / Additional Information stay blank, as captured. */
  const plain = salesforceLeadDetail(prof, base.leads[0].slug);
  plain && plain.address === undefined && plain.description === undefined
    ? okL("a derived lead's blank sections are still blank") : badL("a derived lead gained call-only fields");
}

console.log(bad ? `\n${bad} profile(s) failed` : `\nall ${files.length} profiles ok`);
process.exit(bad ? 1 : 0);
