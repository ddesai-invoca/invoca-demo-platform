/* =============================================================================
   voiceBooking.ts — the voice agent that BOOKS instead of routing
   -----------------------------------------------------------------------------
   Asked for 9/3/2026: a third Avi & Co voice workflow, "Avi & Co - booking", that runs the
   same call as the routing agent but ends by booking the appointment itself:

     greeting -> caller wants to schedule -> name + ZIP -> timeline -> weekday -> a time from
     the ones offered -> the agent confirms the booking with all the details.

   ⚠️⚠️ **THE OFFERED TIMES ARE DERIVED, NOT INVENTED BY THE MODEL.** They are baked into the
   prompt as a fixed table, so the same weekday offers the same three slots on every run and an
   SE can rehearse against the call. A model picking fresh times each time cannot be rehearsed
   against, and this repo's standing rule is that a number never changes once it has been
   shown. Same reasoning as `salesforceEvent.ts`, which derives its slot rather than reading
   one out of the chat.

   ⚠️ **AND THE AGENT SAYS A WEEKDAY AND A TIME, NEVER A CALENDAR DATE.** The Salesforce
   Calendar places the booked appointment on that weekday of the current week, so a date spoken
   aloud would be a second, independent claim that could contradict the screen the SE opens
   next. One of the two has to own the date; the screen does.
   ============================================================================= */

/** Booking days. Sunday is deliberately absent — a boutique is not open. */
export const BOOKING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type BookingDay = typeof BOOKING_DAYS[number];

/** The pool the three offered slots are drawn from — boutique hours, on the half hour. */
const SLOT_POOL = [
  "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
  "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM",
  "4:00 PM", "4:30 PM", "5:00 PM",
];

/* ⚠️ `>>>`, NOT `>>`. A 32-bit hash above 2^31 goes NEGATIVE under a signed shift, and `%`
   keeps the sign — the bug that once put a 3am appointment on a business calendar
   (see the Salesforce Calendar note in CLAUDE.md). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Three times per weekday, stable for a given prospect.
 *
 * Spread across morning / early afternoon / late afternoon rather than picked at random, so
 * the caller is offered a real choice instead of three slots twenty minutes apart.
 */
export function bookingSlots(profileId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const day of BOOKING_DAYS) {
    const h = hash(`${profileId}:${day}`);
    const morning = SLOT_POOL.slice(0, 5);      // 10:00 - 12:00
    const midday = SLOT_POOL.slice(5, 10);      // 12:30 - 2:30
    const late = SLOT_POOL.slice(10);           // 3:00 - 5:00
    out[day] = [
      morning[(h >>> 2) % morning.length],
      midday[(h >>> 8) % midday.length],
      late[(h >>> 14) % late.length],
    ];
  }
  return out;
}

/** Rendered for the prompt, one line per day, so the model can only read these out. */
export function slotTable(slots: Record<string, string[]>): string {
  return BOOKING_DAYS.map((d) => `   ${d}: ${(slots[d] ?? []).join(", ")}`).join("\n");
}
