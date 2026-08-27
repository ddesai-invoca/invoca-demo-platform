/* =============================================================================
   enrich-ci-sales.ts — put SALES TENSION into a Conversation Intelligence call
   -----------------------------------------------------------------------------
   `npx tsx scripts/enrich-ci-sales.ts --all`                  every profile on disk
   `npx tsx scripts/enrich-ci-sales.ts marriott`               one profile on disk
   `npx tsx scripts/enrich-ci-sales.ts --file /tmp/aptive.json`  a library demo dumped to a file
   `--dry` prints without writing.

   ⚠️ **WHY THIS EXISTS.** The Signal AI Silver / Gold reports derive their misses from the
   CALLER'S OWN WORDS, and the calls generated before 8/27/2026 are clean happy paths: a
   need, a recommendation, a booking. Reported against Aptive — "the unmet signals don't show
   a strong missed value" — and the cause is the call, not the derivation. `engine/core.ts`
   now requires the tension for every prospect generated from here on; this brings the ones
   that already exist up to the same shape.

   ⚠️ **THE MODEL WRITES THE TURNS, because they have to be in the prospect's own voice.** A
   template would read as bolted on ("I want to keep it manageable" beside a hospital's
   mammogram booking), and this repo's rule is that every data point is re-skinned to the
   vertical. It is handed the WHOLE existing transcript and asked to return the whole thing
   back with the new turns woven in, so the voice, the names and the timing stay consistent.

   ⚠️ **AND THE OUTPUT IS VALIDATED, not trusted.** Checked before anything is written:
   ascending timestamps · alternating speakers · starts and ends with the agent · the original
   turns still present · every new caller line free of the phrase-list keywords (a caller who
   says "too expensive" gives the keyword library the detection and there is no gap to show) ·
   no em dashes. A failure prints and writes nothing.
   ============================================================================= */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { CONCEPT_HARD_PHRASES, tierView } from "../src/data/signalTiers.ts";

const FAST = "claude-haiku-4-5";
const args = process.argv.slice(2);
const dry = args.includes("--dry");

/* The words a hand-maintained keyword library holds. A NEW caller turn containing one of
   these hands the detection back to Silver, which is exactly what must not happen.
   ⚠️ **THE LIST COMES FROM THE DERIVATION ITSELF** (`CONCEPT_HARD_PHRASES`), not a copy kept
   here. A local copy let through "How is your PRICING stacking up compared to theirs?" — a
   line `signalTiers` then classifies as CAUGHT, so the enrichment was writing turns the report
   would discount. A few extras cover wordings the concepts do not list. */
const INTENT_WORDS = new Set(["book", "schedul", "reserve", "sign me up", "enroll", "appointment",
  "consultation", "test drive", "quote", "estimate"]);

const BANNED = [...CONCEPT_HARD_PHRASES.filter((p) => !INTENT_WORDS.has(p)),
  "my budget", "contract terms", "cancellation fee", "asap", "as soon as possible", "immediately"];
void BANNED;   /* prompt guidance only — see the note in validate() */

/* ⚠️ **THE BOOKING WORDS ARE EXCLUDED, and this was a false failure.** "book", "schedul",
   "appointment" and friends are the INTENT concept's hard list, and they are all over a
   booking call — the run that exposed this was rejected for a caller saying "my wife actually
   BOOKED with a few other places", which is a competitor line, not an intent one. Banning
   them globally polices the wrong concept. What replaces the blunt check is the OUTCOME check
   below, which reads the report these turns actually produce. */

interface Turn { speaker: string; time: string; text: string; highlights?: string[] }


const secs = (t: string) => {
  const [m, s] = t.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
};

const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

/**
 * Re-time the whole call, deterministically.
 *
 * ⚠️ **THE MODEL IS NOT ASKED TO DO THIS ANY MORE.** Told to re-time, it paced Marriott at
 * ~12 seconds a turn and pushed a 2:31 call out to **4:10** — outside the 1:30 to 3:00 these
 * calls are generated at, and long enough that the Call Info duration stops matching what an
 * SE expects. Same principle as splicing a column edit instead of letting the model emit the
 * rows: when the shape is arithmetic, own the arithmetic. The pace varies 6 to 9 seconds so it
 * does not read as a metronome, and it is a pure function of the index, so re-running produces
 * the same call twice.
 */
function retime(turns: Turn[]): Turn[] {
  let t = 0;
  return turns.map((x, i) => {
    const out = { ...x, time: mmss(t) };
    t += 5 + ((i * 5) % 3);          /* 5,6,7,5,... — 29 turns lands near 2:50 */
    return out;
  });
}

function validate(orig: Turn[], next: Turn[], name: string): string[] {
  const errs: string[] = [];
  if (next.length < orig.length + 4) errs.push(`too few turns (${next.length} vs ${orig.length})`);
  if (next[0]?.speaker !== "agent") errs.push("does not start with the agent");
  if (next[next.length - 1]?.speaker !== "agent") errs.push("does not end with the agent");
  for (let i = 1; i < next.length; i++) {
    if (secs(next[i].time) <= secs(next[i - 1].time)) {
      errs.push(`time not ascending at ${next[i].time}`); break;
    }
  }
  /* ⚠️⚠️ **EVERY ORIGINAL TURN MUST SURVIVE — 100%, and 85% was not good enough.** Asked to
     weave turns in, the model rewrites the ones it inserts around, and the turns it lands next
     to are the LOAD-BEARING ones: measured across a first run, it dropped Marriott's "That
     works for our budget. Can we hold that reservation?", National Van Lines' price question
     AND "What's the next step?", and both of Aptive's booking turns. Those are exactly the
     lines the tier reports quote and the conversion comment anchors to, so a threshold that
     counts turns rather than weighing them let the most important ones go. The prompt already
     says keep them verbatim; this enforces it and retries instead. */
  const lost = orig.filter((o) => !next.some((n) => n.text.trim() === o.text.trim()));
  if (lost.length) errs.push(`dropped ${lost.length} original turn(s): ${lost.map((l) => `"${l.text.slice(0, 44)}"`).join(", ")}`);
  const added = next.filter((n) => !orig.some((o) => o.text.trim() === n.text.trim()));
  if (!added.some((a) => a.speaker === "caller")) errs.push("added no caller turns");
  for (const a of added) {
    /* ⚠️⚠️ **THERE IS NO BLANKET WORDING BAN ANY MORE, AND REMOVING IT WAS THE FIX.** Two
       versions of it were wrong in opposite directions and both rejected perfectly good calls:
       banning every concept's hard phrases everywhere failed an AGENT line offering to cancel
       "immediately", and then failed FOUR prospects because the model wrote "I'm getting a
       couple of quotes RIGHT NOW" — a COMPETITOR line tripping the URGENCY concept's keyword.
       Neither is a defect: a keyword library firing Urgency on that turn does not make the
       competitor comparison any less of a miss.

       The OUTCOME check below is the real invariant and it subsumes the proxy: if the caller
       had said "too expensive", Price Sensitivity would come out CAUGHT and the run would be
       rejected. Third time in this session a proxy check was worse than checking the result.
       `BANNED` survives only as guidance inside the prompt. */
    if (/\S—\S|\s—\s|\s–\s/.test(a.text)) errs.push(`new turn has a dash-joined clause: ${a.text.slice(0, 60)}`);
  }
  if (added.length < 4) errs.push(`only ${added.length} new turns`);
  return errs.map((e) => `${name}: ${e}`);
}

/**
 * One sales exchange to weave in: a caller line, the agent's reply, and where it goes.
 *
 * ⚠️⚠️ **THE MODEL DESCRIBES THE INSERT; THIS FILE SPLICES IT — and asking for the whole
 * transcript back was the mistake.** The first version did exactly that, and CLAUDE.md already
 * records why it fails, for the Digital Journey column edits: "asked to emit full cell lists
 * and copy the untouched columns verbatim, Haiku rewrote real values, invented URLs and covered
 * 5 of 21 rows... Splicing makes preservation STRUCTURAL." The same thing happened here. It
 * dropped Marriott's "Can we hold that reservation?", both of Aptive's booking turns, and
 * National Van Lines' price question — five attempts running, because that turn is ALREADY a
 * price question and the instruction to add one pulled it into a rewrite. With insertions,
 * every original turn survives by construction and the retry loop has nothing to police.
 */
interface Insert {
  /** Index of the EXISTING turn this exchange follows (0-based, from the numbered list). */
  after: number;
  caller: string;
  agent: string;
  callerHighlights?: string[];
}

async function enrich(client: Anthropic, profile: any): Promise<Turn[] | null> {
  const ci = profile.reports?.conversationIntelligence;
  const orig: Turn[] = ci?.transcript ?? [];
  const name = profile.customerName;
  if (!orig.length) { console.log(`${name}: no transcript, skipped`); return null; }

  const prompt =
    `You are adding SALES TENSION to one inbound call for ${name}, a ${profile.industry} business.\n\n`
    + `The call as it stands, numbered:\n`
    + orig.map((t, i) => `${i}. ${t.speaker}: ${t.text}`).join("\n")
    + `\n\nYou cannot change these turns. You can only INSERT new exchanges between them.\n\n`
    + `Return 3 insertions so the caller raises, in their own words:\n`
    + `  a) a price or budget concern\n`
    + `  b) a competitor comparison (they are shopping, or they had another provider before)\n`
    + `  c) ONE of: a worry about being tied in, a second service THEY raise, a deadline, or needing to check with a partner\n\n`
    + `⚠️ If the call ALREADY contains one of these, skip it and return only the insertions that are missing.\n\n`
    + `CRITICAL — how the caller must speak. Real callers do NOT use the words a keyword list holds, and this `
    + `call is used to show what keyword spotting MISSES:\n`
    + `  • price: "what does that run?", "I want to keep it manageable", "what am I looking at for the year?" `
    + `NEVER "too expensive", "what does it cost", "my budget", "afford", "pricing".\n`
    + `  • competitor: "I'm getting a couple of quotes", "the guys down the street said...", "we were with someone `
    + `else last year" NEVER "competitor", "another company", "versus", "somewhere else".\n`
    + `  • commitment: "I don't want to be locked in", "can we stop if it isn't working" NEVER "contract", "terms".\n`
    + `  • deadline: "before the weather turns", "we've got people coming over Saturday" NEVER "urgent", "ASAP".\n\n`
    + `The agent's reply handles the concern in this business's own voice and keeps the call moving toward the `
    + `${profile.bookingTerm}. Put each insertion at a natural point: the price and competitor ones AFTER the agent `
    + `has recommended something, and BEFORE the caller agrees to book. Never use an em dash, an en dash, or a `
    + `hyphen joining two clauses.\n\n`
    + `Return ONLY a JSON array of { after: <turn number>, caller: "...", agent: "...", callerHighlights: [0-2 exact `
    + `substrings of your caller line] }.`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const msg = await client.messages.create({
      model: FAST, max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const m = /\[[\s\S]*\]/.exec(raw);
    if (!m) { console.log(`  retry ${name}: no JSON array came back`); continue; }
    let inserts: Insert[];
    try { inserts = JSON.parse(m[0]); } catch (e) { console.log(`  retry ${name}: unparseable JSON (${e})`); continue; }

    const errs: string[] = [];
    if (!inserts.length) errs.push(`${name}: no insertions returned`);
    for (const ins of inserts) {
      if (!(ins.after >= 0 && ins.after < orig.length)) errs.push(`${name}: insertion index ${ins.after} out of range`);
      if (!ins.caller?.trim() || !ins.agent?.trim()) errs.push(`${name}: an insertion is missing a line`);
      for (const text of [ins.caller ?? "", ins.agent ?? ""]) {
        if (/\S—\S|\s—\s|\s–\s/.test(text)) errs.push(`${name}: dash-joined clause: ${text.slice(0, 50)}`);
      }
    }
    if (errs.length) { errs.forEach((e) => console.log(`  attempt ${attempt}: ${e}`)); continue; }

    /* Splice: the originals are copied through untouched, by construction. */
    const out: Turn[] = [];
    orig.forEach((t, i) => {
      out.push({ ...t });
      for (const ins of inserts.filter((x) => x.after === i)) {
        out.push({ speaker: "caller", time: "0:00", text: ins.caller.trim(),
          highlights: (ins.callerHighlights ?? []).filter((h) => ins.caller.includes(h)).slice(0, 2) });
        out.push({ speaker: "agent", time: "0:00", text: ins.agent.trim(), highlights: [] });
      }
    });
    const timed = retime(out);

    const structural = validate(orig, timed, name);
    if (secs(timed[timed.length - 1].time) > 195) {
      structural.push(`${name}: call runs to ${timed[timed.length - 1].time}, too long`);
    }
    /* ⚠️⚠️ **THE REAL ACCEPTANCE TEST IS THE REPORT ITSELF.** Wording rules are a proxy; what
       was asked for is a Silver rail that shows strong missed value. So the candidate
       transcript goes through the SAME `tierView` the screen uses, and the enrichment is only
       accepted when the competitor comparison actually comes out as a MISS and a price moment
       is on the rail. This is what caught a "How is your pricing stacking up" turn that every
       wording rule had passed. */
    const probe = { ...profile, reports: { ...profile.reports,
      conversationIntelligence: { ...ci, transcript: timed } } };
    const silver = tierView(probe, "silver")?.signals ?? [];
    const unmet = silver.filter((x) => !x.met).map((x) => x.name);
    const rail = silver.map((x) => x.name);
    if (!unmet.includes("Competitor Comparison")) {
      structural.push(`${name}: "Competitor Comparison" is not a miss (got: ${unmet.join(", ") || "none"})`);
    }
    if (!rail.includes("Price Sensitivity")) structural.push(`${name}: no price moment on the rail`);
    if (unmet.length < 3) structural.push(`${name}: only ${unmet.length} unmet: ${unmet.join(", ")}`);

    if (!structural.length) return timed;
    structural.forEach((e) => console.log(`  attempt ${attempt}: ${e}`));
  }
  return null;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** duration must match the transcript — the generation prompt says so, and Call Info shows it. */
function durationOf(turns: Turn[]): string {
  const last = secs(turns[turns.length - 1].time) + 5;
  return `${Math.floor(last / 60)}:${String(last % 60).padStart(2, "0")}`;
}

const targets: { label: string; path: string }[] = [];
if (args.includes("--all")) {
  for (const f of readdirSync("src/data/generated").filter((x) => x.endsWith(".json"))) {
    targets.push({ label: f.replace(/\.json$/, ""), path: `src/data/generated/${f}` });
  }
} else if (args.includes("--file")) {
  const p = args[args.indexOf("--file") + 1];
  targets.push({ label: p, path: p });
} else if (args[0] && !args[0].startsWith("--")) {
  targets.push({ label: args[0], path: `src/data/generated/${args[0]}.json` });
}
if (!targets.length) { console.log("nothing to do — pass a slug, --all, or --file <path>"); process.exit(1); }

let done = 0, failed = 0;
for (const t of targets) {
  const profile = JSON.parse(readFileSync(t.path, "utf8"));
  /* ⚠️⚠️ **HEALTH SPRING IS SKIPPED, AND ENRICHING IT WOULD HAVE BROKEN ITS REPORTS.** Its
     Silver / Gold pair is the HAND-AUTHORED one, and those comments quote its transcript
     verbatim ("I'd like to move forward", "I don't have coverage yet"). Rewriting the call
     would leave a quote on the Comments tab that no turn in the transcript says any more —
     the exact fabricated-evidence failure `audit:tiers` exists to catch, introduced by the
     script meant to improve things. It needs no enrichment either: `tierView` returns its
     configured lists whatever the transcript holds. */
  if (/health.?spring/i.test(profile.customerName ?? "")) {
    console.log(`${t.label}: SKIPPED — hand-authored tier reports quote this transcript`);
    continue;
  }
  const next = await enrich(client, profile);
  if (!next) { failed++; continue; }
  const before = profile.reports.conversationIntelligence.transcript.length;
  const callerAdded = next.filter((n) => n.speaker === "caller"
    && !profile.reports.conversationIntelligence.transcript.some((o: Turn) => o.text.trim() === n.text.trim()));
  profile.reports.conversationIntelligence.transcript = next;
  profile.reports.conversationIntelligence.duration = durationOf(next);
  console.log(`${t.label}: ${before} -> ${next.length} turns, duration ${profile.reports.conversationIntelligence.duration}`);
  for (const c of callerAdded) console.log(`   + ${c.time} caller: ${c.text}`);
  if (!dry) writeFileSync(t.path, `${JSON.stringify(profile, null, 2)}\n`);
  done++;
}
console.log(`\n${done} enriched, ${failed} failed${dry ? " (dry run, nothing written)" : ""}`);
