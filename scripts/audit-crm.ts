/* =============================================================================
   audit-crm — the Custom CRM calendar the SMS agent books into (10/15/2026)
   -----------------------------------------------------------------------------
   Calls the real functions. Three things have to hold for the demo beat to be
   true: the calendar is a believable week, the conversation is read against it
   without inventing anything, and the agent is handed exactly that calendar.
   ============================================================================= */
import { readFileSync } from "node:fs";
import { crmCalendar, crmStateFrom, crmPromptCalendar, bookingId, crmDetails } from "../src/data/customCrm.ts";
import { smsSystemPromptForAudit } from "../engine/chat.ts";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const check = (cond: unknown, good: string, wrong: string) => (cond ? ok(good) : bad(wrong));

console.log("\nThe calendar\n");
const NOW = new Date(2026, 9, 15, 11, 30); // a Thursday
const days = crmCalendar("aptive", NOW);
check(days.length === 7 && days[0].date === "2026-10-15", "seven days, starting today", `calendar starts ${days[0]?.date} with ${days.length} days`);
check(days.filter((d) => new Date(d.date + "T12:00").getDay() === 0).every((d) => d.closed && !d.open.length && !d.busy.length), "Sunday is closed", "Sunday has openings or bookings");
check(days[0].open.length === 0, "nothing left to offer today", "today still offers openings");
const future = days.slice(1).filter((d) => !d.closed);
check(future.filter((d) => !d.open.length).length === 1, "exactly one future weekday is fully booked", `${future.filter((d) => !d.open.length).length} future weekdays are full`);
check(future.filter((d) => d.open.length).every((d) => d.open.length === 2), "every other day offers two openings", "a day offers other than two openings");
check(days.every((d) => d.open.every((o) => !d.busy.includes(o))), "an opening is never also a booked block", "an opening overlaps a booking");
check(JSON.stringify(crmCalendar("aptive", NOW)) === JSON.stringify(days), "the same prospect gets the same week", "the calendar moves between calls");
check(JSON.stringify(crmCalendar("marriott", NOW)) !== JSON.stringify(days), "prospects get different weeks", "every prospect has the same calendar");

console.log("\nReading the conversation\n");
const open = future.find((d) => d.open.length)!;
const full = future.find((d) => !d.open.length)!;
const T = (speaker: "agent" | "consumer", text: string) => ({ speaker, text, time: "" });
const base = [
  T("agent", "Hi there! How can I help?"),
  T("consumer", "I need someone to come out"),
  T("agent", "What's your ZIP code? I'll check that we service your area."),
  T("consumer", "60004"),
  T("agent", "What day in the next seven days works best?"),
  T("consumer", full.weekday.slice(0, 3).toLowerCase()),
  T("agent", `${full.weekday} is fully booked. I have ${open.label} open at ${open.open.join(" or ")}. Would either work?`),
];
const s1 = crmStateFrom({ id: "C1", transcript: base } as never, days);
check(s1.zip === "60004", "the ZIP answer is the service-area ZIP", `zip read as ${s1.zip}`);
check(s1.offers.length === 2 && s1.offers.every((o) => o.date === open.date && open.open.includes(o.time)), "the two offered openings are the calendar's own", `offers read as ${JSON.stringify(s1.offers)}`);
check(s1.checked.some((c) => c.date === full.date && c.found === 0), "the fully booked day is marked checked and full", "the full day was not recorded");
check(!s1.booking, "nothing is booked while openings are only being offered", "an offer was read as a booking");

const pick = open.open[1];
const hold = [...base, T("consumer", pick.replace(":00 ", "").toLowerCase()),
  T("agent", `Perfect. I have you down for ${open.label} at ${pick}. What is your full name?`), T("consumer", "kyle smith")];
const s2 = crmStateFrom({ id: "C1", transcript: hold } as never, days);
/* The bug a real run found: the slot held while the agent was still asking for details read as a booking. */
check(s2.selected?.time === pick && !s2.booking, "a slot held while the agent still asks for details is picked, not booked", `booking ${JSON.stringify(s2.booking)}`);
check(s2.lead.name === "Kyle Smith", "the answer to the name question is the name", `name read as ${s2.lead.name}`);

const done = [...hold,
  T("agent", "What's the best phone number?"), T("consumer", "2244220265"),
  T("agent", "What is the street address for the visit?"), T("consumer", "810 n haddow ave arlington heights il 60004"),
  T("agent", "What email should we send the confirmation to?"), T("consumer", "kyle@example.com"),
  T("agent", `Kyle, you're all set for ${open.label} at ${pick}.`)];
const s3 = crmStateFrom({ id: "C1", transcript: done } as never, days);
check(s3.booking?.date === open.date && s3.booking?.time === pick, "the final confirmation books the picked slot", `booking ${JSON.stringify(s3.booking)}`);
check(s3.lead.phone === "(224) 422-0265" && s3.lead.email === "kyle@example.com" && /^810 N Haddow Ave/.test(s3.lead.address ?? ""), "phone, address and email are filed under their questions", `lead ${JSON.stringify(s3.lead)}`);
check(s3.booking?.id === bookingId("C1") && bookingId("C1") === bookingId("C1"), "the booking number is stable for a conversation", "the booking number moves");

const invented = crmStateFrom({ id: "C2", transcript: [T("agent", `I have ${open.label} at 7:00 AM. Does that work?`)] } as never, days);
check(invented.offers.length === 0, "a time that is not on the calendar is never drawn as an offer", "an invented time was drawn");

console.log("\nProject details\n");
{
  const tags = crmDetails("spiders around the garage. house is about 2,500 sq ft. indoor and outdoor please, single family, 2 dogs",
    ["Pest Type Identified: Spiders", "Additional Service Added: Mosquito Protection", "Service Area Confirmed: 75201", "Property Size Captured: 2500 sq ft", "Qualified Lead"],
    ["Recurring Residential Pest Plans"]);
  check(tags[0] === "2,500 sq ft" && tags.includes("Indoor + outdoor"), "the home's size and indoor/outdoor are read from what the customer said", `tags ${JSON.stringify(tags)}`);
  check(tags.includes("Spiders") && tags.includes("Mosquito Protection"), "the AI-extracted signals add the vertical's own facts", `tags ${JSON.stringify(tags)}`);
  check(!tags.some((t) => /75201|service area/i.test(t)), "nothing the panel already shows is repeated as a tag", `tags ${JSON.stringify(tags)}`);
  check(tags.filter((t) => /2,?500/.test(t)).length === 1, "the same fact from both sources appears once", `tags ${JSON.stringify(tags)}`);
  check(!crmDetails("no garage, it's a condo", [], []).includes("Garage"), "a detail the customer ruled out is not tagged", "a negated detail was tagged");
}

console.log("\nThe agent is handed the same calendar\n");
const cal = crmPromptCalendar({ id: "aptive", bookingTerm: "Service Appointment" }, NOW);
const brain = { customerName: "Aptive", industry: "Pest Control", crmCalendar: cal } as never;
const prompt = smsSystemPromptForAudit(brain);
check(/LIVE CALENDAR/.test(prompt) && days.filter((d) => d.open.length).every((d) => d.open.every((o) => prompt.includes(o)) && prompt.includes(d.label)),
  "every opening the CRM draws is in the agent's prompt", "the prompt and the calendar disagree");
check(prompt.includes(`${full.label}: fully booked`), "the full day is told to the agent as fully booked", "the agent does not know which day is full");
check(!/LIVE CALENDAR/.test(smsSystemPromptForAudit({ customerName: "Aptive", industry: "Pest Control" } as never)),
  "with the CRM disconnected the prompt carries no calendar", "the calendar leaks into an unconnected agent");

console.log("\nWiring\n");
const brainSrc = readFileSync("src/data/smsBrain.ts", "utf8");
check(/!wf && crmConnected\(profile\.id\) \? \{ crmCalendar: crmPromptCalendar\(profile\) \}/.test(brainSrc),
  "the built-in agent gets the calendar only while the CRM is connected", "the calendar is not gated on the connect switch");
const screen = readFileSync("src/screens/CustomCrm.tsx", "utf8");
check(/c\.date === longDate\(now\)/.test(screen), "only today's conversation is shown", "an old conversation could land on today's calendar");
check(/crmCalendar\(profile\.id/.test(screen) && /crmStateFrom\(conv, days\)/.test(screen), "the screen draws the same calendar it reads the conversation against", "the screen builds its own calendar");
check(/path="\/integrations\/custom-crm"/.test(readFileSync("src/App.tsx", "utf8")) && /to: "\/integrations\/custom-crm"/.test(readFileSync("src/screens/Integrations.tsx", "utf8")),
  "the Integrations tile opens the Custom CRM", "the Custom CRM is not reachable from Integrations");

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll Custom CRM checks passed\n");
process.exit(fail ? 1 : 0);
