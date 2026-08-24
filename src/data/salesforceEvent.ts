import type { CustomerProfile } from "./schema";

/* =============================================================================
   The appointment the SMS AI agent booked — the record the Salesforce flow is about.
   -----------------------------------------------------------------------------
   The flow the user described: Sales Cloud -> Calendar -> see the appointment booked by the
   SMS agent in the conversation the SE just had -> open it and its fields are filled from
   that conversation.

   ⚠️ IT PREFERS A LIVE CAPTURE AND FALLS BACK TO THE SEEDED CONVERSATION. The Preview Agent
   writes every chat to `SmsCaptureContext` (localStorage, per prospect), so if the SE has
   just run one, THAT is the conversation this event comes from and the demo tells a true
   story. With no capture the event derives from the profile's own seeded SMS conversation,
   so the calendar is never empty — a screen that shows nothing until someone runs a chat is
   worse on a projector than one that always has the record.

   ⚠️ THE DAY AND TIME ARE DERIVED, NOT PARSED OUT OF THE CHAT. The agent confirms a day and
   time in prose ("does Thursday at 2 work?"), and reading that back out with a regex would
   be wrong the first time a model phrased it differently. Instead the slot is a pure
   function of the conversation id, so it is stable across reloads — an SE can rehearse
   against it — and it always lands on a weekday inside the shown week.
   ============================================================================= */

export interface BookedEvent {
  /** Subject line, e.g. "Consultation — Jessica Harper". */
  title: string;
  /** The customer the agent was talking to. */
  who: string;
  /** 0-6, Sunday-based, matching the week grid. */
  dayIndex: number;
  /** Start hour, 24h. */
  startHour: number;
  /** Length in hours. */
  hours: number;
  /** "1–2pm", the label the chip prints under its title. */
  timeLabel: string;
  /** True when this came from a chat the SE actually ran. */
  fromLiveCapture: boolean;
  /** The conversation this was booked in, for the detail screen. */
  conversationId: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** "1–2pm" / "11am–12pm", the capture's own en-dash form. */
function label(start: number, hours: number): string {
  const part = (h: number) => {
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  };
  const end = start + hours;
  /* Salesforce drops the meridiem on the start when both sides share it. */
  const same = (start >= 12) === (end >= 12);
  const startTxt = same ? String(start % 12 === 0 ? 12 : start % 12) : part(start);
  return `${startTxt}–${part(end)}`;
}

/**
 * The booked appointment for this prospect.
 *
 * `captured` is the newest SMS conversation from `SmsCaptureContext`, or undefined.
 */
export function bookedEvent(
  profile: CustomerProfile,
  captured?: { id: string; callerId?: string; messages?: unknown[] },
): BookedEvent {
  const booking = profile.bookingTerm || "Appointment";
  const seeded = profile.reports.smsConversationIntelligence?.conversations?.[0];
  const conversationId = captured?.id ?? seeded?.id ?? `${profile.id}-sms`;
  const who = profile.reports.voiceScreenpop?.callerName ?? "the customer";

  const h = hash(conversationId);
  /* Monday-Friday, and a business hour between 9 and 4 so the chip lands in the part of the
     day the grid opens on.
     ⚠️ `>>>`, NOT `>>` — and this was a real bug, not a style point. `hash` returns an
     UNSIGNED 32-bit value, so any hash above 2^31 becomes NEGATIVE under the signed shift,
     and JS's `%` keeps the sign: `9 + ((h >> 4) % 8)` produced **3**, i.e. a 3am
     appointment on a business calendar, for Shady Blinds' own conversation id. The
     expression reads as "9 plus 0..7" and silently is not. */
  const dayIndex = 1 + (h % 5);
  const startHour = 9 + ((h >>> 4) % 8);

  return {
    title: `${booking} — ${who}`,
    who,
    dayIndex,
    startHour,
    hours: 1,
    timeLabel: label(startHour, 1),
    fromLiveCapture: Boolean(captured),
    conversationId,
  };
}
