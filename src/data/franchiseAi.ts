import type { CustomerProfile } from "./schema";
import { apportion, leadFormFacts } from "./leadForms";
import { vocabFor } from "./insightsCatalog";
import { isProspect, COMFORT_KEEPERS } from "./prospect";

/* =============================================================================
   AI Conversion by <Location> — the org total, then the same numbers per franchise.
   -----------------------------------------------------------------------------
   Requested 8/24/2026: a dashboard whose top row is the whole organization and which then
   breaks down by franchise, carrying call data AND the AI Agent Conversion dashboard's
   figures, with the AI side split into **Lead Form**, **Voice Agent** and **After Hours**.

   DERIVED, like the Location Performance Comparison it sits beside: no schema slice and no
   engine phase, so every prospect already on disk gets it and generation time is unchanged.
   Everything comes from three slices the other dashboards already publish —
   `opsDashboard.locationHandling`, `aiAgentConversion.conversionCards` and the Marketing
   dashboard's KPI totals — so the numbers AGREE with those screens rather than being a
   second, conflicting set.

   ⚠️ THE ORG ROW IS THE SUM OF THE FRANCHISE ROWS, BY CONSTRUCTION. `locationHandling` is a
   complete partition of the call total, and every apportioned column goes through
   `apportion()`, which forces the parts to sum EXACTLY to their published total. A prospect
   can add up any column on this screen and it will reconcile — the thing that gives a demo
   away when it does not.

   ⚠️ LEAD FORM AND VOICE AGENT ARE READ, NOT MODELLED. The six `conversionCards` are three
   LEAD FORM variants and three Voice Agent variants; each channel's revenue is the sum of its
   own three cards (the same anchor `leadForms.ts` already uses for the Marketing dashboard's
   lead-form card, so the two screens cannot disagree), and each channel's conversion rate is
   the revenue-weighted mean of its three cards' rates — NOT a straight mean, which would let
   the smallest cohort drag the headline the way the Location Comparison note describes.

   ⚠️⚠️ AFTER HOURS IS THE ONE MODELLED CHANNEL, AND IT IS FLAGGED RATHER THAN HIDDEN.
   No profile carries an after-hours field — checked every slice; the phrase appears once in
   19 profiles and not as data. So rather than invent a share, it is built on the calls the
   prospect DID miss, which are real and per-location: `locationHandling`'s own
   "Call Not Answered (Count)". Those are the calls that rang out, and after-hours demand is
   exactly where they concentrate. The conversion rate applied to them is the AI-ONLY variant
   of the Voice Agent cards (the card whose chips say "Live Agent Call: No"), which is the
   right rate for a principled reason rather than a convenient one: after hours there IS no
   live agent, so the AI-only cohort is the only comparable one. Revenue then follows at the
   prospect's own revenue-per-booking.

   That makes the after-hours story defensible on screen — "these are the calls you missed,
   and this is what the agent converts them at" — while every input to it is a figure the
   prospect can find on another dashboard. Swap it for a real field the moment one exists.
   ============================================================================= */

const num = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

/** One franchise / location row. */
export interface FranchiseRow {
  name: string;
  calls: number;
  unanswered: number;
  bookingRate: number;
  booked: number;
  revenue: number;
  forms: number;
  /** Per channel: interactions, conversion rate, revenue. */
  leadForm: ChannelCell;
  voiceAgent: ChannelCell;
  afterHours: ChannelCell;
}

export interface ChannelCell {
  interactions: number;
  rate: number;
  revenue: number;
}

export interface ChannelTotal extends ChannelCell {
  label: string;
  /** The filter chips the AI Agent Conversion dashboard shows for this channel. */
  chips: string[];
  /** True for the one channel that is modelled rather than read. */
  modelled?: boolean;
}

export interface FranchiseAiView {
  /** "Franchise" for a franchise network, "Facility" for a hospital — the prospect's own. */
  locationNoun: string;
  org: {
    calls: number;
    forms: number;
    bookingRate: number;
    booked: number;
    revenue: number;
    interactions: number;
  };
  channels: ChannelTotal[];
  rows: FranchiseRow[];
}

/**
 * What this prospect calls one of its locations, on THIS screen.
 *
 * ⚠️ **COMFORT KEEPERS CALLS THEM FRANCHISES, AND `vocabFor` SAYS "Community".** That is the
 * right word for a senior-living operator's own sites and the wrong one for a FRANCHISE
 * NETWORK, whose `locationHandling` rows are literally "Comfort Keepers of Memphis" — those
 * are franchisees, not communities. The dashboard was asked for as a franchise breakdown, so
 * the screen it is scoped to should say so.
 *
 * ⚠️ **OVERRIDDEN HERE, NOT IN `vocabFor`.** That helper feeds the Insights column catalogue,
 * the Configuration drawer's field list and the question catalogue, so changing it would
 * rename things on screens nobody asked about — the standing "a change for one screen stays
 * on that screen" rule. Every other prospect still gets `vocabFor`'s answer.
 */
function locationNoun(p: { id: string; customerName: string }, fallback: string): string {
  return isProspect(p, COMFORT_KEEPERS) ? "Franchise" : fallback;
}

/**
 * Plural of a location noun.
 *
 * ⚠️ **"All Communitys" WAS ON SCREEN.** The org card read `All ${noun}s`, which is fine for
 * Franchise / Showroom / Store / Branch and visibly broken for the two nouns ending in **y**
 * — Community and Facility — so Orlando Health has been reading "All Facilitys" since this
 * screen shipped. A naive `+ "s"` is only correct until the vocabulary grows one word.
 */
export function pluralNoun(noun: string): string {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** Find a column by HEADER, never by index — the engine owns the column order. */
const colIndex = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h));

/** The revenue-weighted mean rate across a set of cards. */
function weightedRate(cards: { rate: number; revenue: number }[]): number {
  const rev = cards.reduce((s, c) => s + c.revenue, 0);
  if (!rev) return cards.length ? cards.reduce((s, c) => s + c.rate, 0) / cards.length : 0;
  return cards.reduce((s, c) => s + c.rate * c.revenue, 0) / rev;
}

/** Pull the rate + revenue out of a ConversionCard's two tiles. */
function cardFigures(card: { tiles?: { label?: string; value?: string }[] }) {
  const tiles = card.tiles ?? [];
  const pct = tiles.find((t) => /percent|%/i.test(t.label ?? ""));
  const rev = tiles.find((t) => /revenue/i.test(t.label ?? ""));
  return { rate: num(pct?.value), revenue: num(rev?.value) };
}

export function franchiseAiView(profile: CustomerProfile): FranchiseAiView | null {
  const ops = profile.reports.opsDashboard;
  const md = profile.reports.marketingDashboard;
  const ac = profile.reports.aiAgentConversion;
  const table = ops?.locationHandling;
  const headers = table?.columns ?? [];
  const rawRows = table?.rows ?? [];
  if (!headers.length || !rawRows.length) return null;

  const v = vocabFor(profile);
  const totalRevenue = num(md?.kpiGroups?.[0]?.tiles?.find((t) => /revenue/i.test(t.label))?.value);

  const iCalls = colIndex(headers, /call count/i);
  const iUnans = colIndex(headers, /not answered/i);
  const iBook = colIndex(headers, /scheduled|booked/i);

  const base = rawRows.map((r) => {
    const cells = r.cells ?? [];
    const calls = iCalls >= 0 ? num(cells[iCalls]) : 0;
    const bookingRate = iBook >= 0 ? num(cells[iBook]) : 0;
    return {
      name: String(cells[0] ?? v.location),
      calls,
      unanswered: iUnans >= 0 ? num(cells[iUnans]) : 0,
      bookingRate,
      booked: Math.round(calls * (bookingRate / 100)),
    };
  });

  const orgCalls = base.reduce((s, l) => s + l.calls, 0);
  const orgBooked = base.reduce((s, l) => s + l.booked, 0);
  const orgUnans = base.reduce((s, l) => s + l.unanswered, 0);
  /* Revenue per booking, from the prospect's own totals — this is what turns an
     after-hours conversion count into an after-hours revenue figure. */
  const revPerBooking = orgBooked ? totalRevenue / orgBooked : 0;

  /* ---- the two channels that are READ ---- */
  const cards = (ac?.conversionCards ?? []).map((c) => ({
    title: c.title, chips: c.chips ?? [], ...cardFigures(c),
  }));
  const leadCards = cards.filter((c) => /lead form/i.test(c.title));
  const voiceCards = cards.filter((c) => /voice/i.test(c.title));

  /* ⚠️ THE LEAD FORM CHANNEL COMES FROM `leadFormFacts`, NOT FROM A SECOND SUM OF THE SAME
     CARDS. That helper already publishes the form count, the revenue-weighted conversion
     rate and the lead-form revenue, and the Marketing dashboard's lead-form card reads the
     same values — so this screen and that card cannot disagree. Re-deriving them here would
     be a second copy of one rule, which is the drift `leadForms.ts` exists to prevent. */
  const facts = leadFormFacts(profile);
  const leadRevenue = facts?.revenue ?? leadCards.reduce((s, c) => s + c.revenue, 0);
  const leadRate = facts?.conversionPct ?? weightedRate(leadCards);
  const voiceRevenue = voiceCards.reduce((s, c) => s + c.revenue, 0);
  const voiceRate = weightedRate(voiceCards);

  /* ---- After Hours: the modelled one (see the header note) ---- */
  const aiOnly = voiceCards.find((c) => /live agent call: no/i.test(c.chips.join(" ")));
  const afterRate = aiOnly?.rate ?? voiceRate;
  const afterBooked = Math.round(orgUnans * (afterRate / 100));
  const afterRevenue = Math.round(afterBooked * revPerBooking);

  /* ⚠️ INTERACTIONS ARE COUNTED, NOT SUBTRACTED FROM A SUMMARY FIGURE — the first version
     did `summaryInteractions - forms - unanswered` and produced **0** voice interactions on
     Orlando Health, because that account's AI "Interactions" tile (1,247) and its Form
     Submits (1,247) happen to be the same number. Two unrelated slices agreeing by accident
     silently emptied a column.
     The partition is now made of figures that are each real on their own:
       Voice Agent = calls that were ANSWERED   (orgCalls - orgUnans)
       After Hours = calls that were NOT        (orgUnans)
       Lead Form   = form submits               (a separate channel, not part of the calls)
     So the two voice channels sum EXACTLY to the call total, and every one of the three is a
     number the prospect can find on another screen. */
  const formCount = facts?.count ?? 0;
  const answered = Math.max(0, orgCalls - orgUnans);

  const channels: ChannelTotal[] = [
    { label: "Lead Form", chips: ["Interaction Type: Form Fill"],
      interactions: formCount, rate: leadRate, revenue: leadRevenue },
    { label: "Voice Agent", chips: ["Interaction Type: Voice"],
      interactions: answered, rate: voiceRate, revenue: voiceRevenue },
    { label: "After Hours", chips: ["Business Hours: Outside", "Live Agent Call: No"],
      interactions: orgUnans, rate: afterRate, revenue: afterRevenue, modelled: true },
  ];

  /* ---- per franchise: every column apportioned so it sums to its org total ---- */
  const callWeights = base.map((l) => l.calls);
  const bookedWeights = base.map((l) => l.booked);
  const unansWeights = base.map((l) => l.unanswered);

  const revenues = apportion(Math.round(totalRevenue), bookedWeights);
  const formCounts = apportion(formCount, callWeights);
  /* Each channel's revenue splits on the weight that actually drives it: form revenue by
     form volume, voice revenue by bookings, after-hours revenue by MISSED calls — which is
     why a franchise that answers its phones shows little after-hours upside and one that
     does not shows a lot. That contrast is the point of the screen. */
  const leadRevs = apportion(Math.round(leadRevenue), formCounts);
  const voiceRevs = apportion(Math.round(voiceRevenue), bookedWeights);
  const afterRevs = apportion(afterRevenue, unansWeights);
  const leadInts = apportion(formCount, callWeights);

  const rows: FranchiseRow[] = base.map((l, i) => ({
    ...l,
    revenue: revenues[i],
    forms: formCounts[i],
    /* ⚠️ THE RATE IS THE FRANCHISE'S OWN, not the org's: each one converts at the channel
       rate scaled by how its booking rate compares to the company's. A single shared rate
       would make every row identical in the only column a manager is reading. */
    leadForm: { interactions: leadInts[i], revenue: leadRevs[i],
      rate: scaleRate(leadRate, l.bookingRate, orgCalls ? (orgBooked / orgCalls) * 100 : 0) },
    /* Answered calls per franchise — a real subtraction on that row, so the column sums to
       the org figure without needing apportion at all. */
    voiceAgent: { interactions: Math.max(0, l.calls - l.unanswered), revenue: voiceRevs[i],
      rate: scaleRate(voiceRate, l.bookingRate, orgCalls ? (orgBooked / orgCalls) * 100 : 0) },
    afterHours: { interactions: l.unanswered, revenue: afterRevs[i],
      rate: scaleRate(afterRate, l.bookingRate, orgCalls ? (orgBooked / orgCalls) * 100 : 0) },
  }));

  return {
    locationNoun: locationNoun(profile, v.location),
    org: {
      calls: orgCalls, forms: formCount,
      bookingRate: orgCalls ? (orgBooked / orgCalls) * 100 : 0,
      booked: orgBooked, revenue: Math.round(totalRevenue),
      interactions: formCount + orgCalls,
    },
    channels,
    rows,
  };
}

/**
 * A franchise's rate for a channel: the company rate moved by how that franchise's own
 * booking rate compares to the company's, and clamped so the scaling can never produce a
 * rate above 100% or below zero.
 */
function scaleRate(channelRate: number, locRate: number, orgRate: number): number {
  if (!orgRate) return channelRate;
  return Math.max(0, Math.min(99, channelRate * (locRate / orgRate)));
}
