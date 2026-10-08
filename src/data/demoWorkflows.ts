import type { CustomerProfile, ExtraWorkflow, WorkflowBranch } from "./schema";
import { isProspect } from "./prospect";
import { areaCodeOf, demoPhone, signalOptions } from "./workflowDrawers";

/* =============================================================================
   demoWorkflows — six reusable agentic workflows, derived per prospect
   -----------------------------------------------------------------------------
   Asked for 10/8/2026 after ranking the use cases that apply across Invoca's
   customer base: three SMS and three voice, built so one SE can demo the same
   story on a pest-control account, a hospital or an insurer.

   ⚠️⚠️ **DERIVED, NOT AUTHORED AS DATA — and that is what makes them reusable.**
   Nothing here is typed per prospect: every noun comes from the profile's own
   `bookingTerm`, `customerNoun`, `serviceArea` and Signal Manager list, so the same
   six read correctly on any account and a prospect generated next month gets them
   with no engine phase, no schema slice and no regeneration.
   ⚠️ They are also NOT written into either `aptive.json`. That prospect exists in
   BOTH stores — a tracked `src/data/generated/aptive.json` and a git-ignored
   `.data/demos/aptive.json` that overrides it — so authoring into one is invisible
   when the other serves. Code travels by push and survives both.

   ⚠️⚠️ **GATED TO ONE PROSPECT ON PURPOSE (`SHOW_FOR`).** Asked for as *"for right
   now just do it for aptive until we finalize which flows i want to keep"*. Widening
   is deleting the gate, which is why the gate is one line and the CONTENT is already
   prospect-agnostic. Matched by NAME through the shared `isProspect`, never a guessed
   id — this prospect's id differs between the two stores it lives in.

   ⚠️⚠️ **EVERY ACTION DRAWER FIELD IS FILLED, which is a requirement rather than
   polish.** `extraDrawerFor` reads a node's own `instruction` / `signal` / `phone` /
   `chips` / `route`, and Apply writes back to those same paths. A field left unset
   would render as an empty box an SE then edits into nothing — and because the write
   is `undefined -> string`, `editGuard` would refuse it as a TYPE FLIP and the edit
   would vanish silently. Seeded fields keep every write string -> string.

   ⚠️ **DEPTH: only a Qualify nests.** Its answers are the nodes below it; the other
   four actions are terminal, so a child under one is a node the agent can never
   reach. `extraTree` enforces it, and not every workflow uses the sixth row — a
   Qualify whose answers are both terminal is the common shape.
   ============================================================================= */

/** Widen by deleting this line and the `isProspect` call below. */
const SHOW_FOR = "aptive";

/* ---- the prospect's own vocabulary ----------------------------------------- */
type V = {
  term: string; termLower: string; noun: string; nounLower: string;
  area: string; phone: string; support: string; brand: string; host: string;
  sites: string[];
  sig: (...want: string[]) => string;
};

/** ⚠️ A signal is only offered if this prospect ACTUALLY has it — the drawer's own
 *  rule. Falls back to "" (the "Select a signal..." empty state) rather than naming
 *  a signal the Signal Manager screen does not list. */
function vocab(p: CustomerProfile): V {
  const all = signalOptions(p);
  return {
    term: p.bookingTerm,
    termLower: p.bookingTerm.toLowerCase(),
    noun: p.customerNoun,
    nounLower: p.customerNoun.toLowerCase(),
    area: p.reports.agentConfig?.serviceArea?.trim() || "the areas we serve",
    phone: demoPhone(areaCodeOf(p as never)),
    /* ⚠️ A SECOND NUMBER, NOT THE SAME ONE: these workflows hand a sales caller to one line
       and a support caller to another, and printing one number in both drawers would say the
       opposite. Toll-free, on the reserved 555 exchange, like every other number this repo
       prints — so a demo can never ring a real business. */
    support: demoPhone("800"),
    brand: p.customerName,
    /* ⚠️ THE PROSPECT'S OWN SITES, read off the rows every Location dashboard already renders
       — so the booking agent offers places that exist on another screen rather than a pair it
       invented. The first column is the location name; found by HEADER, never by index, the
       rule Location Comparison already follows. Falls back to the brand itself rather than to
       nothing, because the presence of this list is what MARKS the workflow a booking one. */
    sites: siteNames(p),
    host: (p.brandDomain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "example.com",
    sig: (...want: string[]) =>
      all.find((s) => want.some((w) => s.toLowerCase().includes(w.toLowerCase()))) ?? "",
  };
}

function siteNames(p: CustomerProfile): string[] {
  const lh = p.reports.opsDashboard?.locationHandling;
  const at = lh?.columns?.findIndex((c) => /location|branch|store|site|facility/i.test(c)) ?? -1;
  const names = (lh?.rows ?? [])
    .map((r) => String(r.cells?.[at >= 0 ? at : 0] ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return names.length ? names : [p.customerName];
}

const wf = (o: ExtraWorkflow): ExtraWorkflow => o;

/* ---- SMS 1: speed to lead -------------------------------------------------- */
/* The highest-leverage inbound pattern there is: a form converts and the agent is
   already texting before the lead cools. Qualify nests, because "comparing quotes"
   splits on WHY — price or timing — and those are different next steps. */
function smsSpeedToLead(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: `Ready to Book`, action: "Schedule Callback", intent: "sales",
      instruction: "",
      signal: v.sig("(conversion)", "booked"),
      chips: ["Consumer Name", "Serviceable Zip", "Product Category"],
    },
    {
      title: "Comparing Quotes", action: "Qualify", intent: "sales",
      instruction: `They are weighing us against someone else. Ask what is driving the comparison so you can answer the real objection: is it the price, or is it how soon we can get there?`,
      paths: [
        {
          title: "Price Is the Concern", action: "Inform",
          instruction: `Explain what the plan includes and why it is priced that way. Do not discount and do not quote a number you have not been given. Offer to book a no-charge assessment so they get a real figure for their own home.`,
          signal: v.sig("price", "sensitivity", "(intent)", "quote"),
          chips: ["Consumer Name", "Product Category", "Lead Score"],
        },
        {
          title: "Timing Is the Concern", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", "Serviceable Zip"],
        },
      ],
    },
    {
      title: "Outside the Service Area", action: "Inform", intent: "sales",
      instruction: `Tell them plainly that we do not cover their area yet, thank them, and do not route them anywhere. Do not take an ${v.termLower} we cannot keep.`,
      /* ⚠️ NOT the quote signal: a caller we turn away was never quoted, and tagging the
         refusal with a sales signal is a contradiction an SE would be asked about. */
      signal: v.sig("(industry)", "discussed"),
      chips: ["Serviceable Zip", "Disposition"],
    },
    {
      title: `Already a ${v.noun}`, action: "Support & Escalate", intent: "support",
      destination: v.support,
      instruction: `They already have an account, so this is not a new sale. Confirm who they are, find out what they need, and hand them to the service team with the thread attached.`,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", `Existing ${v.noun}`],
    },
  ];
  return wf({
    slug: "sms-speed-to-lead",
    label: `${v.brand} - SMS - Speed to Lead`,
    channel: "SMS",
    status: "Live",
    triggeredBy: "2 Campaigns, 3 Forms, and 1 Inbound SMS",
    startLabel: "SMS · new web lead",
    branches,
    openingMessage: `Hi {name}, it's ${v.brand}. Thanks for reaching out just now. I can get you a ${v.termLower} this week. What are you seeing at the property?`,
    playbookSteps: [
      `Text back within seconds of the form arriving, and refer to what they asked for.`,
      `Ask at most two qualifying questions before offering a time — speed is the point.`,
      `Confirm the ZIP against ${v.area}.`,
      `Offer two concrete ${v.termLower} windows rather than asking when suits.`,
      `If they are comparing quotes, find out whether it is price or timing before answering.`,
      `Never quote an exact price over text.`,
    ],
    systemPrompt: `You are ${v.brand}'s SMS agent answering a brand-new web lead within seconds of it arriving. Your job is to qualify briefly and book a ${v.termLower}. You are quick, specific and warm. Keep every message under two sentences. Ask one question at a time. Never quote an exact price over text — offer a no-charge assessment instead. Confirm the ZIP is inside ${v.area} before booking anything.`,
  });
}

/* ---- SMS 2: inbound / missed-call text back -------------------------------- */
/* The backbone pattern, as an EXTRA rather than the built-in default: it starts from
   an unanswered call rather than a form, which is the half the default does not show. */
function smsMissedCall(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: "New Service Request", action: "Qualify", intent: "sales",
      instruction: `Ask for their ZIP code first so you can check it against ${v.area}, then confirm what they need. Do not offer a time before the ZIP is confirmed.`,
      paths: [
        {
          title: "In the Service Area", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", "Serviceable Zip", `New ${v.noun}`],
        },
        {
          title: "Outside the Service Area", action: "Inform",
          instruction: `Say we do not cover that ZIP yet, thank them for calling, and end there. Do not route them and do not take details we cannot act on.`,
          signal: v.sig("(industry)", "discussed"),
          chips: ["Serviceable Zip", "Disposition"],
        },
      ],
    },
    {
      title: "General Question", action: "Inform", intent: "sales",
      instruction: `Answer from the knowledge base in one or two sentences. If they sound ready to move, offer a ${v.termLower}; if not, leave the door open and do not push.`,
      signal: v.sig("quote", "needs assessment", "(industry)"),
      chips: ["Consumer Name", "Product Category"],
    },
    {
      title: "Existing Service Issue", action: "Inform & Route", intent: "support",
      instruction: `Confirm who they are and what went wrong, answer it if the knowledge base covers it, and otherwise route them to the service team with the full thread attached so they do not repeat themselves.`,
      destination: `https://${v.host}/support`,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", `Existing ${v.noun}`, "Disposition"],
    },
    {
      title: "Billing Question", action: "Support & Escalate", intent: "support",
      instruction: `Do not attempt to resolve anything about an invoice, a charge or a refund. Confirm who they are and escalate to billing with the thread attached.`,
      destination: v.support,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", `Existing ${v.noun}`],
    },
  ];
  return wf({
    slug: "sms-missed-call",
    label: `${v.brand} - SMS - Missed Call Text Back`,
    channel: "SMS",
    status: "Live",
    triggeredBy: "1 Campaign, 0 Forms, and 1 Inbound SMS",
    startLabel: "SMS · missed call follow-up",
    branches,
    openingMessage: `Hi {name}, this is ${v.brand}. Sorry we missed your call just now. I can help right here by text. What can I do for you?`,
    playbookSteps: [
      `Open by acknowledging the missed call — they rang us, not the other way round.`,
      `Work out in one question whether this is new business or an existing account.`,
      `For new business, confirm the ZIP against ${v.area} before anything else.`,
      `For an existing account, never try to resolve billing — escalate it.`,
      `Attach the whole thread on any hand-off so nobody has to repeat themselves.`,
    ],
    systemPrompt: `You are ${v.brand}'s SMS agent following up a call we did not answer. Open by acknowledging that. Your first job is to tell new business apart from an existing ${v.nounLower}. New business: confirm the ZIP against ${v.area}, qualify briefly, offer a ${v.termLower}. Existing ${v.nounLower}: find out what they need and route them, and never attempt to resolve a billing question yourself. Keep messages short and ask one thing at a time.`,
  });
}

/* ---- SMS 3: confirm and reschedule ----------------------------------------- */
/* The post-booking half, which the other two do not touch. No-shows are revenue
   every vertical loses, and handling a move in-thread is what makes it agentic
   rather than a reminder blast. */
function smsConfirmReschedule(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: "Confirms the Time", action: "Inform", intent: "sales",
      instruction: `Thank them, repeat the date, the window and the address back once so there is no doubt, and tell them what to expect on the day. Do not ask anything else.`,
      signal: v.sig("(conversion)", "booked"),
      chips: ["Consumer Name", "Disposition"],
    },
    {
      title: "Needs a Different Time", action: "Qualify", intent: "sales",
      instruction: `Do not cancel anything yet. Ask how soon they need it instead — whether later this week still works, or whether it has to move further out.`,
      paths: [
        {
          title: "Later This Week Works", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", "Disposition"],
        },
        {
          title: "Needs to Push It Out", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", "Disposition"],
        },
      ],
    },
    {
      title: "Wants to Cancel", action: "Support & Escalate", intent: "support",
      instruction: `Ask once, without pressure, whether moving it would work instead of cancelling. If they still want to cancel, say it is done, confirm nothing will be charged, and pass it to the service team to close out.`,
      destination: v.support,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", `Existing ${v.noun}`, "Disposition"],
    },
  ];
  return wf({
    slug: "sms-confirm-reschedule",
    label: `${v.brand} - SMS - Confirm & Reschedule`,
    channel: "SMS",
    status: "Live",
    triggeredBy: "0 Campaigns, 1 Form, and 1 Inbound SMS",
    startLabel: `SMS · ${v.termLower} reminder`,
    branches,
    openingMessage: `Hi {name}, this is ${v.brand} confirming your ${v.termLower} tomorrow. Reply YES to confirm, or tell me if you need a different time.`,
    playbookSteps: [
      `Open with the date and window already stated — do not make them ask.`,
      `A plain YES is a confirmation: thank them and stop.`,
      `If they want to move it, never cancel first. Ask how soon they need it.`,
      `Offer two concrete windows rather than asking when suits.`,
      `If they want to cancel, offer to move it once, then let it go gracefully.`,
    ],
    systemPrompt: `You are ${v.brand}'s SMS agent confirming a booked ${v.termLower} the day before. Most replies are a simple confirmation — thank them and stop. If they need a different time, do NOT cancel the existing one first: find out how soon they need it, then offer two concrete windows. If they want to cancel outright, offer to move it once without pressure, then close it out gracefully. Keep every message under two sentences.`,
  });
}

/* ---- VOICE 1: qualify and route -------------------------------------------- */
function voiceQualifyRoute(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: "New Service Inquiry", action: "Qualify", intent: "sales",
      instruction: `Before routing anyone who wants new service, ask for their ZIP code and capture it. Check it against ${v.area}. If they are outside it, say so politely and end the call without routing. If they are inside it, confirm we serve their area and carry on.`,
      paths: [
        {
          title: "Inside the Service Area", action: "Inform & Route",
          instruction: `Confirm we cover their ZIP, ask what they need in their own words, then transfer them to new business and say the team's name aloud as you go.`,
          route: `${v.term}, New ${v.noun}`,
          phone: v.phone,
          signal: v.sig("needs assessment", "(industry)", "discussed"),
          chips: ["Consumer Name", "Serviceable Zip", `New ${v.noun}`],
        },
        {
          title: "Outside the Service Area", action: "Inform",
          instruction: `Tell them we do not cover their area yet, thank them for calling, and end the call. Do not transfer them anywhere and do not take an ${v.termLower}.`,
          phone: v.phone,
          signal: v.sig("(industry)", "discussed"),
          chips: ["Serviceable Zip", "Disposition"],
        },
      ],
    },
    {
      title: `Existing ${v.noun}`, action: "Inform & Route", intent: "support",
      instruction: `Confirm who they are, find out whether this is about an upcoming visit or a past one, and transfer them to the service team. Name the team aloud before you transfer.`,
      route: "Existing Service Support",
      phone: v.phone,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", `Existing ${v.noun}`],
    },
    {
      title: "Urgent or Unhappy", action: "Support & Escalate", intent: "support",
      instruction: `Do not try to resolve it and do not offer anything. Acknowledge the problem once in plain words, then transfer to a supervisor straight away with everything captured so far.`,
      route: "Supervisor Escalation",
      phone: v.phone,
      destination: v.phone,
      signal: v.sig("(industry)", "discussed"),
      chips: ["Consumer Name", "Disposition"],
    },
  ];
  return wf({
    slug: "voice-qualify-route",
    label: `${v.brand} - Voice - Qualify & Route`,
    channel: "Voice",
    status: "Live",
    triggeredBy: "2 Campaigns, 0 Forms, and 0 Inbound SMS",
    startLabel: "Voice · classify intent",
    branches,
    playbookSteps: [
      `Greet, give the brand name, and ask how you can help.`,
      `Work out in one question whether this is new business or an existing account.`,
      `For new business, take the ZIP and check it against ${v.area} before anything else.`,
      `Never quote a price, a promotion or an availability window yourself.`,
      `Name the team aloud before transferring, and never transfer somewhere they have not agreed to.`,
    ],
    systemPrompt: `You are ${v.brand}'s voice agent answering the main line. You qualify and route — you never sell, never quote a price and never resolve an issue yourself. Work out quickly whether the caller is new business or an existing ${v.nounLower}. New business: take the ZIP, check it against ${v.area}, and either route them to new business or politely tell them we do not cover their area. Existing ${v.nounLower}: route to service. Anyone urgent or upset goes to a supervisor immediately. Always say the team's name aloud before transferring.`,
  });
}

/* ---- VOICE 2: booking agent ------------------------------------------------ */
/* The one that completes the transaction instead of routing it — the strongest
   live-demo moment, because the caller books a real slot and never reaches a person. */
function voiceBooking(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: "Ready to Book", action: "Schedule Callback", intent: "sales",
      instruction: "",
      signal: v.sig("(conversion)", "booked"),
      chips: ["Consumer Name", "Serviceable Zip", "Product Category"],
    },
    {
      title: "Wants a Figure First", action: "Qualify", intent: "sales",
      instruction: `They will not commit without knowing roughly what it costs. Ask what they need covered and how big the property is, so the estimate you hand over is grounded rather than invented.`,
      paths: [
        {
          title: "Happy With the Estimate", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", "Serviceable Zip", "Product Category"],
        },
        {
          title: "Wants to Think About It", action: "Inform",
          instruction: `Do not push and do not discount. Tell them what the plan includes, offer to hold a slot for twenty-four hours, and leave it there.`,
          phone: v.phone,
          signal: v.sig("price", "sensitivity", "(intent)", "quote"),
          chips: ["Consumer Name", "Lead Score"],
        },
      ],
    },
    {
      title: `Moving an Existing ${v.term}`, action: "Schedule Callback", intent: "support",
      instruction: "",
      signal: v.sig("(conversion)", "booked"),
      chips: ["Consumer Name", `Existing ${v.noun}`, "Disposition"],
    },
  ];
  return wf({
    slug: "voice-booking",
    label: `${v.brand} - Voice - Booking Agent`,
    channel: "Voice",
    status: "Live",
    triggeredBy: "1 Campaign, 0 Forms, and 0 Inbound SMS",
    startLabel: `Voice · book a ${v.termLower}`,
    branches,
    /* ⚠️ ITS PRESENCE IS WHAT MARKS THIS A BOOKING WORKFLOW — there is deliberately no
       separate mode flag to drift out of step with it. `voiceSession` then drops the
       routing machinery, whose step 3 names a team to hand off to and whose service-area
       gate can REFUSE a caller: both contradict an agent whose job is to end the call
       with a confirmed appointment. */
    bookingLocations: v.sites,
    playbookSteps: [
      `Greet, give the brand name, and ask what they need done.`,
      `Take the ZIP and confirm it against ${v.area} before offering any time.`,
      `Offer a weekday and two concrete windows — never ask "when suits you?".`,
      `Say a weekday and a time, never a calendar date: the calendar owns the date.`,
      `Read the whole booking back once — day, window, address — before ending.`,
    ],
    systemPrompt: `You are ${v.brand}'s voice booking agent. Your job is to end the call with a confirmed ${v.termLower}, not to transfer anyone. Take the ZIP first and confirm it against ${v.area}. Offer a weekday and two concrete windows rather than asking when suits them. Say a weekday and a time, never a calendar date. If they want a rough figure before committing, ask what needs covering and how large the property is, give a range, and never discount. Read the booking back once before you finish.`,
  });
}

/* ---- VOICE 3: after-hours triage ------------------------------------------- */
/* The one that shows JUDGEMENT rather than classification: the agent decides what can
   wait until morning and what cannot, which is the real difference from a phone tree. */
function voiceAfterHours(v: V): ExtraWorkflow {
  const branches: WorkflowBranch[] = [
    {
      title: "New Inquiry, Can Wait", action: "Schedule Callback", intent: "sales",
      instruction: "",
      signal: v.sig("(conversion)", "booked"),
      chips: ["Consumer Name", "Serviceable Zip", `New ${v.noun}`],
    },
    {
      title: "Wants Details Tonight", action: "Inform", intent: "sales",
      phone: v.phone,
      instruction: `Answer what the knowledge base covers — what we do, what the plans include, which areas we serve. Be clear the office is closed, and offer a callback first thing rather than pretending someone is available.`,
      signal: v.sig("quote", "needs assessment", "(industry)"),
      chips: ["Consumer Name", "Product Category"],
    },
    {
      title: "Existing Account, Urgent", action: "Qualify", intent: "support",
      instruction: `Find out whether this can safely wait until the morning. Ask what is happening right now and whether anyone is at risk or any property is being damaged — then decide, and say which it is.`,
      paths: [
        {
          title: "Cannot Wait", action: "Support & Escalate",
          instruction: `Treat it as live. Do not book anything and do not take a message. Transfer to the on-call line immediately with everything captured so far, and stay on until it connects.`,
          route: "On-Call Escalation",
          phone: v.phone,
          destination: v.phone,
          signal: v.sig("(industry)", "discussed"),
          chips: ["Consumer Name", `Existing ${v.noun}`, "Disposition"],
        },
        {
          title: "Can Wait Until Morning", action: "Schedule Callback",
          instruction: "",
          signal: v.sig("(conversion)", "booked"),
          chips: ["Consumer Name", `Existing ${v.noun}`],
        },
      ],
    },
  ];
  return wf({
    slug: "voice-after-hours",
    label: `${v.brand} - Voice - After Hours Triage`,
    channel: "Voice",
    status: "Live",
    triggeredBy: "1 Campaign, 0 Forms, and 0 Inbound SMS",
    startLabel: "Voice · after-hours triage",
    branches,
    playbookSteps: [
      `Say plainly that the office is closed — never imply someone is available.`,
      `Decide first whether this can safely wait until the morning.`,
      `Ask directly whether anyone is at risk or property is being damaged.`,
      `If it cannot wait, transfer to the on-call line and do not take a message instead.`,
      `If it can wait, book the first morning slot rather than promising a call.`,
    ],
    systemPrompt: `You are ${v.brand}'s after-hours voice agent. The office is closed and you say so plainly — never imply a person is standing by. Your first job on every call is a judgement: can this safely wait until the morning? Ask directly whether anyone is at risk or property is being damaged. If it cannot wait, transfer to the on-call line immediately and stay on until it connects — do not take a message instead. If it can wait, book the first available morning ${v.termLower} rather than promising that somebody will ring. Never quote a price.`,
  });
}

/**
 * The six, for a prospect that should see them.
 *
 * ⚠️ Returns [] rather than being called conditionally, so the caller stays a plain
 * spread and widening this later touches one line.
 */
export function demoWorkflowsFor(p: CustomerProfile): ExtraWorkflow[] {
  if (!isProspect(p, SHOW_FOR)) return [];
  const v = vocab(p);
  return [
    smsSpeedToLead(v),
    smsMissedCall(v),
    smsConfirmReschedule(v),
    voiceQualifyRoute(v),
    voiceBooking(v),
    voiceAfterHours(v),
  ];
}
