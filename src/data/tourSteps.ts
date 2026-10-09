/* =============================================================================
   tourSteps — the guided tour a prospect gets on a shared demo
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: when a customer opens a shared demo for the first time,
   walk them through Agent Studio (voice, then SMS, each with its example) and
   finish on the reports — *"the user needs to see the value of our agent studio
   and SMS and voice features"*, and *"always talk about the value of each
   feature"*.

   ⚠️⚠️ **EVERY LINE IS DERIVED, NOT WRITTEN.** The prospect's own name, booking
   term, customer noun, service area and real agent voice are threaded through, so
   a hotel's tour says "reservation" and "guest" where a pest controller's says
   "service appointment" and "homeowner". Hardcoded sales copy would read as a
   template on the one surface that exists to feel built for them.

   ⚠️⚠️ **VALUE FIRST, MECHANISM SECOND, IN EVERY STEP.** The rule the request
   states twice. A step that says "this is the workflow diagram" has told them
   nothing; one that says "you can see exactly why a caller was routed, and change
   it yourself" has. `body` leads with the outcome; the feature is how it happens.

   ⚠️ **THE ORDER IS AGENTS FIRST, REPORTS LAST, AND THAT IS LOAD-BEARING.** The
   reports land after the SMS example precisely so the conversation they just had
   is sitting at the top of the report as their own data. Seeded rows would make the
   same point far more weakly, and this is how the product genuinely behaves — the
   capture is live.
   ============================================================================= */

import type { CustomerProfile } from "./schema";

export interface TourStep {
  id: string;
  /** Navigate here first. Omitted means "stay where we are". */
  route?: string;
  /** What to spotlight. Omitted renders a centred card, which is right for an
   *  opening or closing beat that is about the product rather than a control. */
  target?: string;
  title: string;
  body: string;
  /** Shown under the body as the explicit takeaway. */
  value?: string;
  /** Wait for the target rather than skipping — used where a click has to land first. */
  waitMs?: number;
  /** Click the target before showing the card (opens a drawer, a tab, a preview). */
  click?: boolean;
  /** Arm the scripted SMS conversation before this step. */
  autoplay?: boolean;
  /** Hold here until the scripted conversation has finished. */
  awaitAutoplay?: boolean;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function tourStepsFor(p: CustomerProfile): TourStep[] {
  const name = p.customerName;
  const booking = p.bookingTerm || "Appointment";
  const bookingLower = booking.toLowerCase();
  /* ⚠️ `customerNoun` is a TOP-LEVEL canonical term, not a playbook field — the same one
     every screen renders, so the tour cannot call them something the product does not. */
  const noun = p.customerNoun || "Customer";
  const nounLower = noun.toLowerCase();
  const area = p.reports?.agentConfig?.serviceArea || "";

  return [
    {
      id: "welcome",
      route: "/agent-studio",
      title: `${name}'s AI agents, end to end`,
      body:
        `Every call and text that reaches ${name} can be answered in seconds, around the clock, ` +
        `by an agent that knows your services and books real ${bookingLower}s. This is where those ` +
        `agents are built, tested and tuned — and it is all running on ${name}'s own data.`,
      value: "Take two minutes and you will have seen it answer, qualify, route and report.",
    },
    {
      id: "agents",
      target: ".as-table, table",
      title: "One brand, two channels",
      body:
        `A voice agent for the phone and an SMS agent for text, both live, both reading the same ` +
        `brand rules and the same knowledge. A ${nounLower} who calls and then texts gets the same ` +
        `answers either way.`,
      value: "No separate IVR vendor, no separate chatbot, no two versions of the truth.",
    },
    {
      id: "knowledge",
      route: "/agent-studio/agent/knowledge",
      target: "table",
      title: "It answers from your material, not from the internet",
      body:
        `These are the pages and documents the agent has learned. It answers from ${name}'s own ` +
        `services, coverage and policies — so it does not invent an offer you do not run or a ` +
        `location you do not serve.`,
      value: "Update a page here and the next conversation already knows about it.",
    },
    {
      id: "recommendations",
      route: "/agent-studio/agent/recommendations",
      target: ".air-card, .air-grid, table",
      title: "It gets better from real conversations",
      body:
        `The agent reads what callers actually asked and proposes new answers and follow-up ` +
        `questions. You approve what goes live — nothing changes behind your back.`,
      value: "The questions you get asked most become the answers you give best.",
    },

    /* ---------- VOICE ---------- */
    {
      id: "voice-tree",
      route: "/agent-studio/agent/workflow/voice",
      target: ".wf-canvas, .wf-scroll",
      title: "The voice agent, with nothing hidden",
      body:
        `This is the whole call: how it greets, what it asks, how it decides who the caller is ` +
        `and which team they belong to. Not a black box you have to trust — a flow you can read.`,
      value: "When somebody asks why a caller ended up where they did, the answer is on this screen.",
    },
    {
      id: "voice-node",
      target: ".wf-node",
      title: "Every step is yours to set",
      body:
        `Open any box and you can see the question it asks, the details it captures and the team ` +
        `it hands to. Change a question here and the very next caller hears it.`,
      value: `No ticket, no release — the people who own the ${nounLower} experience own the agent.`,
    },
    {
      id: "voice-call",
      target: ".wf-preview, .wf-preview-workflow",
      title: "Call it yourself",
      body:
        `Preview Workflow opens a real call with this agent. Say you need ${bookingLower.includes("appointment") ? "an appointment" : `a ${bookingLower}`}` +
        `${area ? `, give it a location in ${area}` : ""}, and listen to it qualify you and route the call.`,
      value: "This is the same agent that would answer your main line tomorrow.",
    },

    /* ---------- SMS ---------- */
    {
      id: "sms-tree",
      route: "/agent-studio/agent/workflow/sms",
      target: ".wf-canvas, .wf-scroll",
      title: "The same control over text",
      body:
        `Texts from your website forms and your main number land here. The agent sorts a new ` +
        `enquiry from an existing ${nounLower}, asks what it needs, and books.`,
      value: "Most people would rather text than wait on hold — this is how you let them.",
    },
    {
      id: "sms-open",
      target: ".wf-preview-agent",
      click: true,
      autoplay: true,
      waitMs: 1200,
      title: "Watch a real conversation start",
      body:
        `This is the agent's actual phone preview. We will send the first couple of messages for ` +
        `you, and the replies are live — ${name}'s agent answering for the first time.`,
      value: "Nothing here is a recording.",
    },
    {
      id: "sms-watch",
      target: ".phone-frame, .phone-shell, .sms-thread",
      awaitAutoplay: true,
      title: "Seconds, not hours",
      body:
        `It answered immediately, in ${name}'s voice, and it is already qualifying — the way it ` +
        `would at 9pm on a Sunday when nobody is at a desk.`,
      value: "Speed to lead is the single biggest driver of whether a lead converts.",
    },
    {
      id: "sms-try",
      target: ".phone-input, textarea, input[type=text]",
      title: "Now you try",
      body:
        `Type anything a real ${nounLower} would say — a question about price, a different service, ` +
        `an awkward one. It is a live agent, so push it.`,
      value: `Ask it something it should not answer and watch it stay inside ${name}'s rules.`,
    },

    /* ---------- REPORTS ---------- */
    {
      id: "reports",
      waitMs: 5000,
      route: "/reports",
      target: "table",
      title: "Every conversation, captured automatically",
      body:
        `Nothing had to be logged or tagged by hand. Every call and every text the agents handle ` +
        `arrives here, transcribed and scored, ready to read.`,
      value: "Your team stops listening to calls to find out what happened.",
    },
    {
      id: "report-sms",
      waitMs: 6000,
      route: "/reports/sms-conversation-intelligence",
      target: ".ci-calls-list, .ci-calls",
      title: "That is the chat you just had",
      body:
        `Top of the list. The full thread, who it was with, what the agent captured — the ` +
        `conversation you ran a minute ago is already a record.`,
      value: "What the agent does and what you can report on are never out of step.",
    },
    {
      id: "report-signals",
      target: ".ci-analysis, .ci-tabs",
      title: "Scored without anybody listening",
      body:
        `Every conversation is read for the things you care about — intent, the ${bookingLower}, ` +
        `objections, competitors — and tagged automatically.`,
      value: "You can finally answer “what are people actually asking us?” from all of it, not a sample.",
    },
    {
      id: "report-voice",
      waitMs: 6000,
      route: "/reports/voice-conversation-intelligence",
      target: ".ci-calls-list, .ci-calls",
      title: "The same for every call",
      body:
        `Calls land here the same way, with the transcript and the signals. Voice and text in one ` +
        `place, measured the same way.`,
      value: "One view of every conversation with a " + nounLower + ", whichever channel it came in on.",
    },
    {
      id: "end",
      title: `That is ${name}'s agent, working`,
      body:
        `Answering instantly on both channels, staying inside your brand rules, booking real ` +
        `${bookingLower}s and writing up every conversation on its own.`,
      value: "Anything you would want changed, your team changes — no engineering queue.",
    },
  ].map((s) => ({ ...s, title: cap(s.title) }));
}

/**
 * The two lines the tour types into the phone for them.
 *
 * ⚠️⚠️ **THEY ARE DELIBERATELY NOT PERFECT CUSTOMERS.** A scripted lead who states their
 * service, postcode and budget in one tidy sentence proves nothing — real enquiries are
 * vague and the agent earning its keep IS the part worth watching. The first line is a
 * half-formed ask, the second is the detail it should have had to come back for.
 * ⚠️ Re-skinned per prospect like everything else, so a hotel's script asks about a stay
 * and a pest controller's about a yard.
 */
export function autoOpeners(p: CustomerProfile): string[] {
  const booking = (p.bookingTerm || "appointment").toLowerCase();
  const first = p.reports?.agentConfig?.smsPlaybook?.qualifyingQuestions?.[0] ?? "";
  return [
    `Hi, I think I need a ${booking} — not totally sure what I need though`,
    first ? "Sure — and roughly what does that usually run?" : "How soon could someone come out?",
  ];
}
