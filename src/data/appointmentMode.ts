/* =============================================================================
   appointmentMode — HOW a booked appointment happens (10/21/2026).

   Reported against Sylvan Learning: the SMS agent confirmed a time and nothing else, then
   told the customer to meet at their home address, then said someone would call with the
   real address. Asked for: "let the user know how the appointment will happen, instead of
   just letting them know 'Okay, the appointment is set'": a call at the time, a location
   with its address, or the customer's own home.

   The prospect's own `smsPlaybook.bookingType` already says it, measured across 184
   profiles: "virtual consultation" (30), "in-home …" (~30), "in-office / in-clinic /
   in-store …", "in-person community tour", and "in-person or virtual …". So this reads that
   phrase; no regeneration, no new field. DOM-free so engine/ can import it.
   ============================================================================= */

const HOME_TRADES = /\b(home care|in-home|home health|senior care|caregiv|plumb|pest|hvac|heating|cooling|roof|restoration|water damage|cleaning|landscap|lawn|pool|security|alarm|moving|movers?|relocation|remodel|window treatment|blinds|solar|electric(al|ian)|garage door|pest control)\b/i;

export type AppointmentMode = "home" | "location" | "phone" | "video" | "either";

export function appointmentMode(bookingType: string | undefined, industry?: string): AppointmentMode {
  const t = (bookingType ?? "").toLowerCase();
  const virtual = /\b(virtual|video|online|remote|phone|call|telehealth|zoom)\b/.test(t);
  const inPerson = /\b(in[- ]person|in[- ]office|in[- ]clinic|in[- ]store|in[- ]branch|in[- ]center|in[- ]boutique|in[- ]shop|boutique|dealer|showroom|tour|test drive|visit|location|clinic|office|store|shop|center|centre)\b/.test(t);
  /* In-home first: "in-home consultation" also says "consultation", and a home visit is not
     a trip to a location. */
  if (/\b(in[- ]home|at[- ]home|home visit|on[- ]site|onsite|in your home)\b/.test(t)) return "home";
  if (virtual && inPerson) return "either";
  if (virtual) return /\b(video|demo|zoom)\b/.test(t) ? "video" : "phone";
  /* A business that works AT the customer's address (home care, plumbing, pest control, a
     mover's estimate) comes to them when the booking type names no place: Comfort Keepers'
     "Care Assessment" is in the home. */
  if (!inPerson && HOME_TRADES.test(industry ?? "")) return "home";
  /* A quote or a session with an agent and no place named happens on the phone. */
  if (/\b(quote|agent|advis|strategy|enrollment|prequalif)\w*/.test(t) && !inPerson) return "phone";
  return "location";
}

/** What the SMS brain carries so the agent can say HOW the appointment happens. `place` is
 *  filled in by the server (engine/chat.ts) from Google Places, never by the browser. */
export interface AppointmentInfo {
  mode: AppointmentMode;
  /** The prospect's own location names, from `opsDashboard.locationHandling`. */
  locations?: string[];
  /** The number a phone appointment comes from: the same toll-free line the SMS thread shows. */
  callbackNumber?: string;
  /** The real location nearest the customer, looked up by the server. */
  place?: { name: string; address: string; phone?: string };
}

/**
 * The booking box's "say how it happens" line (10/21/2026). One sentence per mode, so the
 * workflow drawer describes exactly what the agent is told (engine/chat.ts `appointmentBlock`).
 */
export function howItHappensLine(mode: AppointmentMode, term: string, number?: string): string {
  const t = term.toLowerCase();
  switch (mode) {
    case "home":
      return `Then say how the ${t} happens: a specialist comes to their home, so confirm the full street address it is at and give an arrival window.`;
    case "location":
      return `Then say how the ${t} happens: give the name and full street address of the location nearest them, and ask them to arrive 10 minutes early.`;
    case "phone":
      return `Then say how the ${t} happens: a specialist calls them at that time${number ? ` from ${number}` : ""}, so they just need to pick up.`;
    case "video":
      return `Then say how the ${t} happens: it is a video visit, and a join link is texted to this number at the start time.`;
    case "either":
      return `Ask whether they would like the ${t} in person or virtually, then say how it happens: the full street address of the nearest location, or that a specialist calls them at that time${number ? ` from ${number}` : ""}.`;
  }
}
