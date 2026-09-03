import type { SfLead } from "./salesforceLeads";
import { resolvePlace } from "./voiceAiArtifacts";
import type { CustomerProfile, VoiceConversation } from "./schema";

/* =============================================================================
   The Salesforce Lead a BOOKED voice call creates
   -----------------------------------------------------------------------------
   Asked for 9/3/2026: "which the voice agent books the appointment and it shows up in
   salesforce calendar, i also want you to create that new lead in the leads tab and also when
   i click on appointment in the calendar, it should take me to the lead and with lead form
   filled out from the information from the call, and then you can make up the other
   information needed in the lead form as long as it matches the story."

   ⚠️⚠️ **ONE DEFINITION, THREE READERS — the Leads list, the Lead record page and the
   Calendar's link all resolve the lead through here.** The Calendar chip navigates to a slug;
   if the list built that slug one way and the record page another, the chip would open "Lead
   not found" and the whole beat would break at its last click. That is not hypothetical: the
   lead-to-call-log link in this same family of screens shipped with exactly that class of bug
   (two leads hashing to one record), and it was invisible until a value became a LINK.

   ⚠️ **WHAT COMES FROM THE CALL vs WHAT IS INVENTED, stated rather than left to be guessed.**
   From the call: the caller's name, their ZIP (hence city/state/area code), the product they
   named, the boutique, and the time the call happened. Invented but consistent: the email
   address (built from their own name, as the pre-call artifacts already do), the street, and
   the marketing attribution — which is taken as ONE WHOLE `digitalInsights` row rather than
   field by field, because cycling those independently is what produced "Medium: Bing, Source:
   Paid Search" on a neighbouring screen.

   ⚠️ **AND IT FAILS CLOSED.** No booked outcome, or one whose day/time did not survive
   validation, yields null — the Leads list is then exactly the ten it has always been, the
   Calendar keeps its derived chip, and nothing links anywhere.
   ============================================================================= */

/* ⚠️ `leadSlug` LIVES HERE, NOT IN `salesforceLeads`, TO KILL A RUNTIME IMPORT CYCLE. The list
   needs `liveBookedLead` and this needs the slug function; with the slug on the other side the
   two modules imported each other at runtime. It happens to work (function declarations are
   hoisted) and it is exactly the kind of fragility that breaks on an unrelated refactor. The
   type import above is erased at build, so the dependency now points one way.
   ⚠️ ONE SLUG FUNCTION, and it must stay that way: the Calendar chip navigates to a slug the
   record page has to resolve, so two implementations means a chip that opens "Lead not found". */
/** "Jessica Harper" -> "jessica-harper". Names are deduped, so this is unique per list. */
export function leadSlug(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface LiveLead {
  lead: SfLead;
  /** The capture this came from, so the record page can cite the same call. */
  call: VoiceConversation;
  /** Resolved from the caller's own ZIP; null when the ZIP is unknown or unrecognised. */
  place: { city: string; state: string; zip: string; area: string } | null;
  /** "the New York boutique" or "Virtual consultation". */
  where: string;
  /** "Thursday" / "12:30 PM", for the chip and the story. */
  day: string;
  time: string;
}

type Booked = NonNullable<VoiceConversation["outcome"]>;

function isBooked(o: VoiceConversation["outcome"]): o is Booked {
  return !!o && o.booked === true && !!o.bookedDay?.trim() && !!o.bookedTime?.trim();
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/* Stable hex from a seed, so an id never moves between reloads. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hex(seed: string, n: number): string {
  let out = "";
  for (let i = 0; out.length < n; i++) out += hash(`${seed}:${i}`).toString(16).toUpperCase().padStart(8, "0");
  return out.slice(0, n);
}

/**
 * The newest call that actually booked something, as a Lead.
 *
 * Newest only — one pair of screens per rehearsal, the same rule the two (Voice AI) report
 * rows already follow. A lead per practice run would bury the prospect's own people.
 */
export function liveBookedLead(
  profile: CustomerProfile,
  voiceCalls?: VoiceConversation[],
): LiveLead | null {
  const call = (voiceCalls ?? []).find((c) => isBooked(c.outcome));
  if (!call) return null;
  const o = call.outcome as Booked;
  const { first, last } = splitName(o.callerName || "");
  /* ⚠️ A LEAD WITH NO NAME IS NOT A LEAD. The list renders a first and last name in its
     widest column and the record page's title is the person; half a name reads as a broken
     row rather than as a new one. */
  if (!first || !last) return null;

  const place = o.bookedZip ? resolvePlace(o.bookedZip) : null;
  const seed = `booked:${profile.id}:${call.id}`;
  /* ⚠️ THE CALL'S OWN NUMBER, and the 555 exchange is preserved — a demo number must not be
     able to ring a real business, the same care the Google Search ad's call extension takes. */
  const phone = call.voiceInfo?.callerId?.trim()
    || `(${place?.area ?? "805"}) 555-${String(1000 + (hash(`p:${seed}`) % 9000))}`;

  const product = (o.bookedProduct ?? "").trim();
  return {
    call,
    place,
    where: (o.bookedLocation ?? "").trim(),
    day: (o.bookedDay ?? "").trim(),
    time: (o.bookedTime ?? "").trim(),
    lead: {
      slug: leadSlug(first, last),
      first,
      last,
      phone,
      status: "New",
      smsOptIn: "Yes",
      product: product.toLowerCase(),
      /* ⚠️ ONE PRODUCT, TWO CASES — never derived twice. The record page prints Product of
         Interest beside Product Name, and deriving the second independently once gave one
         person two different products on adjacent rows. */
      productName: product,
      /* Invented, and built from the caller's own name exactly as the pre-call artifacts do,
         so the two screens name one person rather than two. */
      email: first && last ? `${first.toLowerCase()}.${last.toLowerCase()}@gmail.com` : "",
      attributionId: `${hex(`net:${seed}`, 4)}/${hex(`promo:${seed}`, 4)}/i-${hex(`u:${seed}`, 12).toLowerCase()}`,
      created: call.time,
      /* ⚠️ ABOVE EVERY DERIVED ROW BY CONSTRUCTION, not by luck. The list sorts on this, and
         the whole point is that the call an SE just made is the row at the top. */
      sortKey: Number.MAX_SAFE_INTEGER,
    },
  };
}
