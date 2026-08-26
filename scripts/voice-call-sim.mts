/* =============================================================================
   voice-call-sim.mts — test the voice agent's LOGIC without a microphone
   -----------------------------------------------------------------------------
   `npx tsx scripts/voice-call-sim.mts` (needs the dev server running).

   Drives the REAL prompt through `/api/chat` with `voice: true` — the same endpoint, prompt
   and model the live call uses, minus speech — and asserts on what the agent actually said.

   ⚠️ **THIS EXISTS BECAUSE THE HAPPY PATH PROVES ALMOST NOTHING.** Scripted straight through,
   the agent looked perfect while quietly ignoring a configured rule: asked for a name and
   refused, it said "that's okay" and transferred, which the SE's own step 6 forbids. The cause
   was that the six numbered routing steps reached the DRAWER and never the prompt. A refusal
   turn found it in one run; no amount of happy-path testing would have.

   ⚠️ **AND IT NEEDS A DEV-SERVER RESTART AFTER ANY engine/chat.ts EDIT.** That module is
   dynamically imported and Node-cached, so a stale server answers with the old prompt and the
   run looks like the code is wrong. Twice caught this session.

   Keep the BRAIN below in step with `voiceAgentSpec.ts` — it is a copy on purpose, so the
   simulation fails loudly when the spec changes shape rather than silently testing nothing.
   ============================================================================= */
const BRAIN = {
  customerName: "Comfort Keepers",
  industry: "In-home senior care",
  rules: [
    "Intro and offer: Introduce yourself as Comfort Keepers's AI care coordinator helping arrange a personalized care plan and quote.",
    "Qualify one at a time: learn who needs care, which services fit, how many hours, when they would like care to begin, and their ZIP.",
    "Estimate then book: share a preliminary hourly range and book a complimentary in-home assessment.",
  ],
  qaPairs: [], knowledge: ["Homepage", "Care Services"], serviceArea: "",
  serviceZips: ["30097", "30096", "30095"],
  outOfAreaScript: "Thank you for calling Comfort Keepers. Unfortunately, we don't currently serve your area, but we'd encourage you to check back with us in the future or visit comfortkeepers.com to find a nearby location.",
  voiceGreeting: "Hi, thanks for calling Comfort Keepers, I'm here to help. Are you looking to arrange care services for yourself or a loved one, or are you interested in becoming a caregiver with us?",
  voiceSteps: [
    "1. Ask the caller for their zip code and capture it.",
    "2. Check the zip code against our current service area: 30097, 30096, 30095.",
    "3. If the zip code falls outside 30097, 30096, or 30095, politely inform the caller that we do not yet serve their area and end the call.",
    "4. If the zip code falls within our service area, ask the caller for their full name and capture it.",
    "5. If zip code does not fall within our service area say: Thank you for calling Comfort Keepers. Unfortunately, we don't currently serve your area, but we'd encourage you to check back with us in the future or visit comfortkeepers.com to find a nearby location.",
    "6. If the caller does not provide their full name, ask again before proceeding. Do not route the call without a captured full name.",
  ],
  voiceRules: [
    "If the caller is a prospective client or family member inquiring about care services, acknowledge their situation warmly before asking any qualifying questions.",
    "If the caller is inquiring about caregiver employment, respond professionally and briefly acknowledge that Comfort Keepers is always looking for compassionate caregivers before moving to next steps.",
    "As soon as this intent is recognized, determine whether the caller is looking to arrange care services or is interested in becoming a caregiver.",
    "When asking for the caller's zip code, explain that it's used to connect them with their local Comfort Keepers office.",
    "If asked about cost or pricing, do not provide specific numbers.",
  ],
  voiceRouting: { newQueue: "Care Assessment. New Project", supportQueue: "Existing Client Support", bookingTerm: "Care Assessment", who: "client" },
  voicePaths: [{
    intent: "Sales Inquiry",
    recognise: "The caller is reaching out about Comfort Keepers' home care services, either as a prospective client or family member, or as a job seeker interested in becoming a caregiver.",
    routes: [
      { team: "All Sales Inquiry Users", need: "Looking for care services", action: "Inform & Route", collect: ["Consumer Zip", "Consumer Name"] },
      { team: "All Sales Inquiry Users", need: "Interested in becoming a caregiver", action: "Inform & Route", collect: ["Consumer Zip", "Consumer Name"] },
    ],
  }],
};

async function say(messages: { role: "user" | "assistant"; content: string }[]) {
  const r = await fetch("http://localhost:5173/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brain: BRAIN, messages, voice: true }),
  });
  const d = await r.json();
  if (!d.reply) throw new Error("no reply: " + JSON.stringify(d).slice(0, 200));
  return d.reply as string;
}

async function run(label: string, turns: string[]) {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  let agent = await say(msgs);
  console.log(`  AGENT : ${agent}`);
  msgs.push({ role: "assistant", content: agent });
  for (const t of turns) {
    console.log(`  CALLER: ${t}`);
    msgs.push({ role: "user", content: t });
    agent = await say(msgs);
    console.log(`  AGENT : ${agent}`);
    msgs.push({ role: "assistant", content: agent });
  }
  return msgs;
}

async function main() {
const inArea = await run("SCENARIO 1 — care services, ZIP inside the service area",
  ["Hi, I'm looking for care for my mom.", "30097", "Dhruv Desai"]);

  const outArea = await run("SCENARIO 2 — care services, ZIP OUTSIDE the service area",
  ["I need help arranging care for my father.", "90210"]);

  const caregiver = await run("SCENARIO 3 — the caregiver path",
  ["Actually I'm interested in becoming a caregiver.", "30096", "Jordan Reyes"]);

/* ---- assertions on what actually happened ---- */
  const t = (m: typeof inArea) => m.filter((x) => x.role === "assistant").map((x) => x.content).join(" ");
  const asked = (s: string, re: RegExp) => re.test(s);
  const checks: [string, boolean][] = [
  ["opens with the scripted greeting verbatim", inArea[0].content.includes("thanks for calling Comfort Keepers") && /arrange care services for yourself or a loved one/i.test(inArea[0].content)],
  ["asks for the ZIP after the intent is known", asked(inArea[2].content, /zip/i)],
  ["asks for the full name after an in-area ZIP", asked(inArea[4].content, /name/i)],
  ["transfers once it has ZIP and name", /transfer|connect/i.test(inArea[6].content)],
  ["never asks about hours, schedule or services", !asked(t(inArea), /how many hours|what schedule|which services|when would you like care to begin/i)],
  ["never quotes a price", !asked(t(inArea), /\$\d|hourly rate is|per hour/i)],
  ["out-of-area: reads the script and does not route", /don't currently serve your area|do not currently serve your area/i.test(t(outArea)) && !/transferring you/i.test(outArea[outArea.length - 1].content)],
  ["out-of-area: never asks for a name", !asked(t(outArea), /your (full )?name/i)],
  ["caregiver path also asks ZIP then name", asked(t(caregiver), /zip/i) && asked(t(caregiver), /name/i)],
];
  console.log(`\n${"=".repeat(78)}\nLOGIC CHECKS\n${"=".repeat(78)}`);
  let bad = 0;
  for (const [label, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); }
  console.log(`\n  ${bad ? `${bad} check(s) failed` : "all checks passed"}`);

}
main();
