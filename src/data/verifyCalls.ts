import type { CustomerProfile, CallDetailTurn } from "./schema";

/* =============================================================================
   verifyCalls — the five calls behind the Verify Labels screen.
   -----------------------------------------------------------------------------
   DERIVED, NOT GENERATED. Two of the five are REAL transcripts the profile
   already carries (`reports.callDetail.transcript` and
   `reports.conversationIntelligence.transcript`), which are prospect-specific and
   already validated; the other three are templates filled from `customerName` /
   `bookingTerm` / `customerNoun`. Nothing here touches the engine, so generation
   time is unchanged and every profile already on disk gets the screen. Adding a
   generation phase instead would have left the ~60 saved demos with an empty
   screen until each one was regenerated.

   THE AI IS DELIBERATELY WRONG ON ONE OF THE FIVE (call 4).

   If it were right on all five, the SE clicks True five times, accuracy sits at
   100%, and no prospect believes the screen. Call 4 is a price shopper who uses
   every scheduling phrase in the book ("how soon could someone come out",
   "Thursday could work") and then declines to commit. The AI predicts True; the
   honest answer is False. That is the moment the screen exists for: a human
   correcting the model, and the accuracy visibly dropping when they do.

   Note what the accuracy actually measures: how often the human AGREED with the
   AI. The human is the ground truth, so nothing here needs to record the "real"
   answer -- only what the AI predicted. Which call is designed to be the miss is
   a fact about the writing, not a field the UI reads.
   ============================================================================= */

export interface VerifyCall {
  id: string;                 // "08F1-0987AC987F22", the real page's format
  date: string;               // "Jan 12, 2:28 PM"
  duration: string;           // "01:17"
  convStart: string;          // "00:15" -- the Estimated Conversation Start marker
  turns: CallDetailTurn[];
  predicted: boolean;         // what the AI predicted for this label
  /* True only for the two transcripts that came from the profile's own generated
     data. Not shown to a prospect; used by the audit script to confirm the real
     transcripts are actually being picked up rather than silently falling back to
     a template. */
  fromProfile: boolean;
}

/* ---- deterministic helpers ------------------------------------------------ */

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/* Call IDs match the live format: 4 hex, dash, 12 hex. Hashed off the profile so
   an SE screenshots the same ids twice and a refresh does not reshuffle them. */
function callId(seed: number, i: number): string {
  const a = hash(`${seed}:${i}:a`).toString(16).toUpperCase().padStart(8, "0").slice(0, 4);
  const b = (hash(`${seed}:${i}:b`).toString(16) + hash(`${seed}:${i}:c`).toString(16))
    .toUpperCase().padStart(12, "0").slice(0, 12);
  return `${a}-${b}`;
}

/* Anchored to the demo's own January 2026 window, never `new Date()`, for the
   same reason as the model list: a screen whose dates move on every open cannot
   be rehearsed against. */
const ANCHOR = Date.UTC(2026, 0, 12, 14, 0, 0);
function callDate(seed: number, i: number): string {
  const d = new Date(ANCHOR - ((seed + i * 7919) % 9) * 86400000 - (i % 5) * 3600000);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  const h24 = 9 + ((seed + i) % 8);
  const mins = (seed + i * 13) % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  return `${mon} ${d.getUTCDate()}, ${h24 % 12 || 12}:${String(mins).padStart(2, "0")} ${ampm}`;
}

/* CallDetail writes "00:04"; Conversation Intelligence writes "0:04". The column
   is fixed-width on this screen, so a mixed set makes the transcript look ragged.
   Normalised to M:SS-padded MM:SS. */
function padTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : t;
}

function secs(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/* WHERE THE "Estimated Conversation Start" MARKER GOES.
   Returns the index to draw it BEFORE, or -1 for "do not draw it".

   Compared in seconds, not as strings, and this is not a nicety. Real profile data
   breaks string equality in both directions: the Shady Blinds seed carries
   convStart "00:00", and three of the saved demos carry "00:16" with no turn at
   exactly that second, so an exact match drew no marker at all and did it
   silently.

   Above the OPENING line is a legitimate position, checked against all 11
   profiles: 7 of them have a first turn at exactly 00:16, and a marker there says
   the call record began 16 seconds before anyone spoke, which is true and is what
   the timestamp column is measuring from. An earlier version of this refused
   index 0 and so drew nothing on those 7. The only vacuous case is convStart
   00:00, which marks nothing and is the one we suppress. */
export function convStartIndex(turns: CallDetailTurn[], convStart: string): number {
  const target = secs(convStart);
  if (target <= 0) return -1;
  return turns.findIndex((t) => secs(t.time) >= target);   // -1 when past the last turn
}

function lastTime(turns: CallDetailTurn[]): string {
  const t = turns.length ? turns[turns.length - 1].time : "00:00";
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return "01:00";
  const secs = Number(m[1]) * 60 + Number(m[2]) + 4;
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

/* ---- templates ------------------------------------------------------------
   Written to be industry-generic on purpose: an order-status call, a price
   shopper and a reschedule happen at a blinds installer, a moving company and a
   clinic alike, so substituting the brand and the booking term is enough and no
   template ever claims something false about the prospect's business.

   No em dashes anywhere in this file's prose: dash-joined clauses are the single
   clearest tell that copy was machine-written, and these lines are read aloud to
   prospects. */

interface Tpl { turns: [CallDetailTurn["speaker"], string, string][]; predicted: boolean; convStart: string }

function templates(brand: string, term: string, agent: string): Tpl[] {
  const t = term.toLowerCase();
  return [
    /* 1 -- FALLBACK for the real callDetail transcript: an intake call that books. */
    { predicted: true, convStart: "00:12", turns: [
      ["agent",  "00:00", `Thank you for calling ${brand}. This is ${agent}. How can I help you today?`],
      ["caller", "00:06", `Hi, I would like to set up a ${t} if you have anything this week.`],
      ["agent",  "00:12", "Of course. Can I start with your first and last name?"],
      ["caller", "00:16", "It is ****."],
      ["agent",  "00:21", "Thank you. I have Wednesday at ten or Thursday at three open."],
      ["caller", "00:28", "Thursday at three works better for me."],
      ["agent",  "00:32", `Booked. Your ${t} is confirmed for Thursday at three, and I have sent a confirmation to your email.`],
      ["caller", "00:40", "Great, thank you."],
      ["agent",  "00:42", `Thank you for calling ${brand}. We will see you Thursday.`],
    ] },

    /* 2 -- no booking, and no scheduling language for the AI to latch onto. */
    { predicted: false, convStart: "00:11", turns: [
      ["agent",  "00:00", `Thank you for calling ${brand}. This is ${agent}. How can I help you today?`],
      ["caller", "00:06", "Hi, I placed an order a couple of weeks ago and I am just checking on the status."],
      ["agent",  "00:11", "Happy to look that up. Can I get the name on the order?"],
      ["caller", "00:15", "It is ****."],
      ["agent",  "00:20", "Thank you. I see it here. It shipped Tuesday and it is due to arrive Friday."],
      ["caller", "00:27", "Perfect, that is all I needed."],
      ["agent",  "00:30", "Anything else I can help with today?"],
      ["caller", "00:33", "No, that is it. Thanks."],
      ["agent",  "00:35", `Thank you for calling ${brand}. Have a great day.`],
    ] },

    /* 3 -- FALLBACK for the real Conversation Intelligence transcript. */
    { predicted: true, convStart: "00:10", turns: [
      ["agent",  "00:00", `${brand}, this is ${agent}. How can I help?`],
      ["caller", "00:04", `Hi, a neighbour of mine used you and said I should book a ${t}.`],
      ["agent",  "00:10", "That is great to hear. Are mornings or afternoons easier for you?"],
      ["caller", "00:15", "Mornings, ideally before nine thirty."],
      ["agent",  "00:20", "I can do Tuesday at eight thirty or Friday at nine."],
      ["caller", "00:26", "Tuesday at eight thirty."],
      ["agent",  "00:30", `You are all set for Tuesday at eight thirty. Can I get the best number to reach you?`],
      ["caller", "00:36", "It is ****."],
      ["agent",  "00:41", `Thank you. Your ${t} is confirmed. Have a good afternoon.`],
    ] },

    /* 4 -- THE MISS. Every scheduling cue is present and the caller commits to
       nothing. The AI predicts True; the honest verdict is False. */
    { predicted: true, convStart: "00:12", turns: [
      ["agent",  "00:00", `Thank you for calling ${brand}. This is ${agent}. How can I help you today?`],
      ["caller", "00:05", `Hi, I am gathering a few quotes right now and wanted to ask what a ${t} involves.`],
      ["agent",  "00:12", `Happy to walk you through it. There is no charge for the ${t}, and it usually takes about an hour.`],
      ["caller", "00:20", "Good to know. And how soon could someone come out?"],
      ["agent",  "00:24", "We have openings as early as Thursday afternoon, or Saturday morning if that is easier."],
      ["caller", "00:31", "Thursday could work. Let me check with my partner first."],
      ["agent",  "00:36", "Of course. Would you like me to hold Thursday at two while you check?"],
      ["caller", "00:41", "I would rather not commit yet. I am still waiting on two other quotes."],
      ["agent",  "00:47", "Understood. I will email you the details so you have them."],
      ["caller", "00:52", "That would be great, thank you."],
      ["agent",  "00:55", `Thank you for calling ${brand}. Talk soon.`],
    ] },

    /* 5 -- a reschedule still fixes a specific date and time on the call, so the
       label genuinely applies. Worth an SE pointing out. */
    { predicted: true, convStart: "00:11", turns: [
      ["agent",  "00:00", `Thank you for calling ${brand}. This is ${agent}. How can I help you today?`],
      ["caller", "00:05", `Hi, I have a ${t} booked for tomorrow morning and I need to move it.`],
      ["agent",  "00:11", "No problem at all. Can I get the name on the booking?"],
      ["caller", "00:15", "It is ****."],
      ["agent",  "00:19", "Thank you. I see tomorrow at nine. What day works better?"],
      ["caller", "00:24", "Would Friday afternoon be possible?"],
      ["agent",  "00:28", "I have two o'clock or four o'clock on Friday."],
      ["caller", "00:32", "Two o'clock is better."],
      ["agent",  "00:35", `Done. Your ${t} is confirmed for Friday at two, and the new confirmation is on its way to you.`],
      ["caller", "00:43", "Perfect, thank you."],
      ["agent",  "00:45", `Thank you for calling ${brand}. See you Friday.`],
    ] },
  ];
}

/* ---- the five calls ------------------------------------------------------- */

export function buildVerifyCalls(profile: CustomerProfile): VerifyCall[] {
  const seed = hash(profile.id || profile.customerName || "x");
  const brand = profile.customerName;
  const term = profile.bookingTerm || "Appointment";
  const r = profile.reports as Partial<CustomerProfile["reports"]>;

  /* The agent's name is real per-prospect data when Call Review generated it, so
     the same person answers the phone here as on the Call Detail screen. */
  const agent = (r.callDetail?.agent || "").trim().split(/\s+/)[0]
    || ["Emily", "Marcus", "Priya", "Daniel"][seed % 4];

  const tpls = templates(brand, term, agent);
  const real1 = r.callDetail?.transcript;
  const real2 = r.conversationIntelligence?.transcript;

  /* Slots 1 and 3 prefer the profile's OWN transcripts; the templates for those
     slots exist only so a profile missing either report still shows five calls
     rather than three. Both reports are required by GenerationOutput, so the
     fallback is for hand-edited and legacy profiles. */
  const sources: { turns: CallDetailTurn[]; predicted: boolean; convStart: string; fromProfile: boolean }[] = [
    real1?.length
      ? { turns: real1.map((t) => ({ ...t, time: padTime(t.time) })), predicted: true,
          convStart: padTime(r.callDetail?.convStart || "00:12"), fromProfile: true }
      : { ...fromTpl(tpls[0]), fromProfile: false },
    { ...fromTpl(tpls[1]), fromProfile: false },
    real2?.length
      ? { turns: real2.map((t) => ({ speaker: t.speaker, time: padTime(t.time), text: t.text })),
          predicted: true, convStart: "00:10", fromProfile: true }
      : { ...fromTpl(tpls[2]), fromProfile: false },
    { ...fromTpl(tpls[3]), fromProfile: false },
    { ...fromTpl(tpls[4]), fromProfile: false },
  ];

  return sources.map((s, i) => ({
    id: callId(seed, i),
    date: callDate(seed, i),
    duration: lastTime(s.turns),
    convStart: s.convStart,
    turns: s.turns,
    predicted: s.predicted,
    fromProfile: s.fromProfile,
  }));
}

function fromTpl(t: Tpl) {
  return {
    turns: t.turns.map(([speaker, time, text]) => ({ speaker, time, text })) as CallDetailTurn[],
    predicted: t.predicted,
    convStart: t.convStart,
  };
}

/* ---- the label under verification ---------------------------------------- */

/* The sentence the real page shows under the label name. Built from the booking
   term so it describes THIS prospect's conversion rather than a generic one. */
/* "a consultation" but "an estimate". Booking terms are ordinary nouns, so a vowel
   check is enough, and without it every vowel-initial term ("Estimate",
   "Appointment", "Inspection", "Evaluation") read as "a estimate" in a sentence a
   prospect is looking straight at. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function labelDescription(label: string, bookingTerm: string): string {
  const t = (bookingTerm || "appointment").toLowerCase();
  if (/_set$|_scheduled$/.test(label)) {
    return `The caller and agent agree a specific date and time for ${article(t)} ${t}, confirming the arrangement during the call.`;
  }
  if (/qualified_lead$/.test(label)) {
    return "The caller is in market, has the authority to proceed, and the agent captures enough detail to follow up.";
  }
  return `The call contains evidence of ${label.replace(/_/g, " ")}.`;
}

/* ---- accuracy ------------------------------------------------------------- */

export interface Tally { total: number; agree: number; t: number; f: number }

/* A round opens part-way through, the way the live page does (it showed
   "T: 9  F: 10" at Round 5), so the screen never reads as an empty form. Seeded
   off the profile so it is stable per prospect. */
export function seedTally(profileId: string, round: number): Tally {
  const h = hash(`${profileId}:tally:${round}`);
  const total = 11 + (h % 4);                 // 11..14
  const agree = total - (1 + ((h >> 3) % 2)); // 85% .. 91%
  const t = Math.round(total * 0.55) + (h >> 5) % 2;
  return { total, agree, t, f: total - t };
}

export interface Accuracy { point: number; lo: number; hi: number }

/* A 95% Wald interval on the agreement rate, which is why it NARROWS as calls are
   verified: that shrinking band is the whole point of the screen.

   Two deliberate departures from textbook Wald, both to keep the bar readable:
   the variance is floored so a perfect run still shows a band instead of
   collapsing to a zero-width line, and the ends are clamped to [40, 99] because
   an interval drawn past 100% would render outside the track. */
export function accuracy(tally: Tally): Accuracy {
  const n = Math.max(tally.total, 1);
  const p = tally.agree / n;
  const hw = 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.0025) / n) * 100;
  const clamp = (v: number) => Math.max(40, Math.min(99, v));
  return { point: clamp(p * 100), lo: clamp(p * 100 - hw), hi: clamp(p * 100 + hw) };
}

/* How full the "Verified Calls" bar is. A round's worth of work, not a share of
   the five rotating transcripts, so the bar keeps climbing as an SE keeps going. */
export const ROUND_TARGET = 25;
export function verifiedPercent(tally: Tally): number {
  return Math.max(0, Math.min(100, (tally.total / ROUND_TARGET) * 100));
}
