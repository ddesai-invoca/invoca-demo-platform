import type { CustomerProfile } from "./schema";

/* Facts behind the Connect AI report (Insights & Analytics -> Connect AI).

   The screen tells ONE story in every tile: rolling out the AI agent lifted answer rate
   and bookings. The capture (network 2160, insights/dashboard/c925e7d5, 8/6/2026) frames it
   as three phases across a single month — Pre Agentic, Voice Agentic Only, Full Agentic —
   and every number on the page is that month cut by phase.

   DERIVED, no engine phase and no schema slice. The month's real volume and revenue come
   from reports.marketingDashboard (the same rows the Marketing Performance dashboard and
   the Insights Summary Dashboard use, so the three agree), the consumer intents come from
   aiMessagingImpact.commonTopicsChart (already re-skinned per vertical), and the handle
   time behind FTE Hours Saved comes from callDetail. Everything else is a pure function of
   those plus the profile id, so an SE revisiting sees the identical report.

   WHAT IS DESIGNED RATHER THAN MEASURED: the phase split itself. No profile records "when
   did this prospect switch on the voice agent", because it never happened — the report is
   the pitch. So the rollout curve (answer rate 49% -> 73% -> 90%, booking rate 19% -> 25%
   -> 44%) is the shape the capture shows, jittered per prospect. The TOTALS it splits are
   real, which is what keeps it honest: the three phase revenues sum to the month's revenue
   and the three appointment counts sum to the headline. */

export interface ConnectAiPhase {
  key: "pre" | "voice" | "full";
  /* "Pre Agentic" — the chart legend and the table's first column. */
  label: string;
  /* "Phase 1" / "Non Agentic Baseline" — the small caption on the revenue tiles. */
  phase: string;
  tileLabel: string;
  interactions: number;
  answered: number;
  appointments: number;
  revenue: number;
  cancellationsSaved: number;
  /* Answered / interactions, and appointments / interactions. Both are computed from the
     counts rather than stored, so a tile can never disagree with the table beside it. */
  answerRate: number;
  scheduleRate: number;
}

export interface MediumRow {
  name: string;
  interactions: number;
  voiceAgent: number;
  messagingAgent: number;
  highIntent: number;
  appointmentRate: number;
}

export interface IntentRow {
  name: string;
  /* One per entry point, aligned to ENTRY_POINTS. */
  byEntry: number[];
  voiceAgent: number;
  messagingAgent: number;
}

/* Invoca's own vocabulary for how an interaction reaches the agent, and for why the agent
   did not finish the job. Left verbatim per the platform-labels convention (the same reason
   "Marketing Source" and "UNIQUE COUNT" are not re-skinned) — these are product features,
   not this prospect's words. "Outside Service Area" is the one that leans on the profile:
   every vertical has a service area, and agentConfig.serviceArea carries it. */
export const ENTRY_POINTS = ["Inbound Call", "Inbound Form Fill", "Inbound SMS"];

const NOT_COMPLETED = [
  "No Availability",
  "Offered Times Declined",
  "Outside Service Area",
  "Slot Taken",
  "Escalated to Live Agent",
];
/* Descending, and NOT round or evenly spaced — the capture reads 22 / 12 / 7 / 4 / 3. */
const REASON_SHARE = [0.44, 0.24, 0.14, 0.10, 0.08];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return Math.abs(h);
}

/* A seeded stream, so every jitter below is stable per prospect but independent of the
   others (one shared counter would make them move together). */
function rng(seed: string) {
  let h = hash(seed) || 1;
  return () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const money = (s: string) => Number(String(s).replace(/[^\d.]/g, "")) || 0;
const count = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;

/* The x-axis prints "Apr 01" but the hover panel prints "04/07/2026", so both forms come
   off the same walk of the dashboard's own range — the axis and the tooltip cannot drift. */
function dailyDates(range: string, days: number) {
  const start = new Date(String(range).split("-")[0]?.trim() || "2026-01-01");
  const bad = isNaN(+start);
  return Array.from({ length: days }, (_, i) => {
    if (bad) return { short: `Day ${i + 1}`, full: `Day ${i + 1}` };
    const d = new Date(start); d.setDate(d.getDate() + i);
    return {
      short: d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      full: d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
    };
  });
}

export function connectAiFacts(profile: CustomerProfile) {
  const md = profile.reports.marketingDashboard;
  const mediumBreakdown = md.breakdowns.find((b) => /Medium/i.test(b.title));
  const mediums = (mediumBreakdown?.rows ?? []).map((r) => ({
    name: r.name,
    calls: count(r.metrics[0] ?? "0"),
    answeredPct: parseFloat(String(r.metrics[1] ?? "0")) || 0,
    convPct: parseFloat(String(r.metrics[2] ?? "0")) || 0,
    revenue: money(r.metrics[3] ?? "0"),
  }));

  const totalInteractions = mediums.reduce((s, m) => s + m.calls, 0);
  const totalRevenue = mediums.reduce((s, m) => s + m.revenue, 0);
  const rnd = rng(profile.id);

  /* THE ROLLOUT CURVE. Order is guaranteed by construction — each phase's rate is the
     previous one plus a positive step — so a jitter can never invert the story the way a
     plain random offset could. */
  const jitter = (spread: number) => (rnd() - 0.5) * spread;
  const answerRates = [0.49 + jitter(0.05), 0.73 + jitter(0.05), 0.90 + jitter(0.04)];
  const scheduleRates = [0.19 + jitter(0.03), 0.26 + jitter(0.04), 0.44 + jitter(0.05)];
  /* Volume barely moves across the phases (same month, same demand) — the capture reads
     1.18K / 1.2K / 1.22K. Revenue moves a lot, because the booking rate does. */
  const volumeWeights = [0.325, 0.33, 0.345];
  const revenueWeights = [0.187, 0.291, 0.522];

  const META = [
    { key: "pre", label: "Pre Agentic", phase: "Phase 1", tileLabel: "Non Agentic Baseline" },
    { key: "voice", label: "Voice Agentic Only", phase: "Phase 2", tileLabel: "Voice Agent" },
    { key: "full", label: "Full Agentic", phase: "Phase 3", tileLabel: "Voice and Messaging Agents" },
  ] as const;

  /* Cancellations saved needs a whole number per phase that also sums to the tile at the
     bottom of the page, so it is apportioned and the remainder is given to the last phase
     rather than each phase rounding independently. */
  const savedTotal = Math.max(3, Math.round(totalInteractions * 0.0075));
  const savedShare = [0, 0.41, 0.59];

  /* ⚠️ REVENUE IS SNAPPED TO THE DISPLAY GRID. The tiles show two decimals, so at K scale a
     tile is exact to $10 and three of them always re-add to the headline; at M scale a tile is
     only exact to $10,000 and three independent roundings drift. continuing-life read
     "$0.72M + $1.12M + $2.01M" under a "$3.84M" headline — a prospect adding the row gets
     $3.85M. Rounding the three revenues to the grid the tiles are printed on, with the
     remainder given to the last phase, makes the displayed numbers add up as well as the
     underlying ones. The voice/messaging split is snapped the same way for the same reason. */
  const grid = totalRevenue >= 1_000_000 ? 10_000 : 10;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const snappedTotal = snap(totalRevenue);
  const phaseRevenue = [snap(totalRevenue * revenueWeights[0]!), snap(totalRevenue * revenueWeights[1]!)];
  phaseRevenue.push(snappedTotal - phaseRevenue[0]! - phaseRevenue[1]!);

  const phases: ConnectAiPhase[] = META.map((m, i) => {
    const interactions = Math.round(totalInteractions * volumeWeights[i]!);
    const answered = Math.round(interactions * answerRates[i]!);
    const appointments = Math.round(interactions * scheduleRates[i]!);
    const cancellationsSaved = i === 2
      ? savedTotal - Math.round(savedTotal * savedShare[1]!)
      : Math.round(savedTotal * savedShare[i]!);
    return {
      key: m.key, label: m.label, phase: m.phase, tileLabel: m.tileLabel,
      interactions, answered, appointments,
      revenue: phaseRevenue[i]!,
      cancellationsSaved,
      answerRate: interactions ? answered / interactions : 0,
      scheduleRate: interactions ? appointments / interactions : 0,
    };
  });

  /* Headline revenue is the SUM of the phase tiles, not the profile's total, so the six
     numbers on screen reconcile exactly. Rounding each phase separately loses a few
     dollars against the profile; showing the sum is the honest way to spend that. */
  const revenue = phases.reduce((s, p) => s + p.revenue, 0);
  const appointments = phases.reduce((s, p) => s + p.appointments, 0);
  const full = phases[2]!;

  /* Not-completed reasons are scaled off the FULL phase's unanswered volume, so the bar
     chart explains that phase's gap rather than being a free-floating set of counts. */
  const missed = Math.max(5, full.interactions - full.answered);
  const reasons = NOT_COMPLETED.map((name, i) => ({
    name, value: Math.max(1, Math.round(missed * REASON_SHARE[i]!)),
  }));
  const escalated = reasons[reasons.length - 1]!.value;

  /* CONTAINMENT is answered WITHOUT a human: the agent handled it and did not escalate.
     Deriving it this way ties the headline percent to the bar chart above it. */
  const containment = full.interactions
    ? (full.answered - escalated) / full.interactions : 0;

  /* FTE HOURS SAVED = contained interactions x the prospect's own average handle time.
     callDetail.duration is the one real handle time on the profile, so the number has a
     provenance rather than being picked to look impressive. */
  const dur = profile.reports.callDetail?.duration ?? "3m 30s";
  const mm = /(\d+)\s*m/.exec(dur), ss = /(\d+)\s*s/.exec(dur);
  const handleMinutes = ((mm ? +mm[1] * 60 : 0) + (ss ? +ss[1] : 0)) / 60 || 3.5;
  const contained = full.answered - escalated;
  const fteHours = (contained * handleMinutes) / 60;

  /* Voice vs messaging revenue. Phase 2 is voice only; phase 3 runs both, so its revenue
     splits between them. Phase 1 is the non-agentic baseline and belongs to neither, which
     makes voice + messaging + phase 1 add up to the headline exactly. */
  const voiceShareOfFull = snap(full.revenue * 0.62);
  const voiceRevenue = phases[1]!.revenue + voiceShareOfFull;
  const messagingRevenue = full.revenue - voiceShareOfFull;

  /* ---- the daily conversion-rate chart -------------------------------------------
     One point per day, coloured by the phase that day falls in. Each phase's band rises
     over the last, and WITHIN a band the line moves up and down — a monotonic ramp inside
     a phase reads as generated, the same lesson the weekly trend tile taught. */
  const DAYS = 30;
  const perPhase = Math.ceil(DAYS / 3);
  const bands: [number, number][] = [[0.18, 0.50], [0.31, 0.66], [0.75, 1.0]];
  const dayRnd = rng(`${profile.id}|days`);
  const dailyPoints = Array.from({ length: DAYS }, (_, i) => {
    const pi = Math.min(2, Math.floor(i / perPhase));
    const [lo, hi] = bands[pi]!;
    const within = (i % perPhase) / Math.max(1, perPhase - 1);
    /* A gentle climb across the band plus a wobble, so the shape trends up without every
       step being upward. */
    const base = lo + (hi - lo) * (0.35 + within * 0.5);
    const v = Math.max(lo, Math.min(hi, base + (dayRnd() - 0.5) * (hi - lo) * 0.55));
    return { value: +v.toFixed(2), phase: pi };
  });

  /* ---- per-medium tables ----------------------------------------------------------
     The Pre Agentic table has ZEROS in both AI columns — that is the point of the pair:
     before rollout no interaction was answered by an agent. The Full Agentic table splits
     the answered volume between voice and messaging and books at a much higher rate. */
  const rowsFor = (kind: "pre" | "full"): MediumRow[] => {
    const r = rng(`${profile.id}|${kind}`);
    const share = kind === "pre" ? volumeWeights[0]! : volumeWeights[2]!;
    const rate = kind === "pre" ? scheduleRates[0]! : scheduleRates[2]!;
    return mediums.map((m, i) => {
      const interactions = Math.max(1, Math.round(m.calls * share));
      const answered = kind === "pre" ? 0 : Math.round(interactions * answerRates[2]!);
      const voiceAgent = kind === "pre" ? 0 : Math.round(answered * (0.45 + r() * 0.25));
      /* Ranked by appointment rate the way the capture's tables are, with the spread
         coming from each medium's own conversion percent so a medium that converts well on
         the Marketing dashboard also converts well here. */
      const lift = 1 + (m.convPct - (mediums[0]?.convPct ?? m.convPct)) / 100;
      const appointmentRate = Math.max(0.08, Math.min(0.72,
        rate * (1.25 - i * 0.06) * lift + (r() - 0.5) * 0.03));
      return {
        name: m.name,
        interactions,
        voiceAgent,
        messagingAgent: answered - voiceAgent,
        highIntent: Math.round(interactions * (0.28 + r() * 0.35)),
        appointmentRate,
      };
    }).sort((a, b) => b.appointmentRate - a.appointmentRate);
  };

  /* ---- consumer intents ----------------------------------------------------------
     WHY NOT Common Topics. aiMessagingImpact.commonTopicsChart is the obvious source and it
     is already re-skinned per vertical, but its series are TOPICS, not intents: for a
     blinds company they read "Blinds / Shades / Shutters / Drapes / Motorization", and a
     tile headed "Consumer Intents during Agentic Interactions" listing product categories
     is wrong in a way a prospect will notice.

     The capture's own list is mostly generic service intents (Reschedule, New Appointment,
     General Info, Cancel, Billing) with ONE vertical-specific entry (Prescription Refill).
     So the intents are built the same way: four generic ones plus the booking term, plus
     the prospect's top topic for the vertical-specific slot.

     Ordered descending alphabetically, which is the order the real heatmap comes back in. */
  const topTopic = profile.reports.aiMessagingImpact?.commonTopicsChart?.series?.[0]?.name;
  const primary = `New ${profile.bookingTerm}`;
  const names = [primary, "Reschedule", "Cancel", "Billing", "General Info",
    ...(topTopic ? [topTopic] : [])]
    .sort((a, b) => b.localeCompare(a));

  const intentRnd = rng(`${profile.id}|intents`);
  /* The intents PARTITION the full phase's interactions — they are the same interactions
     cut a different way. Weighting and then normalising is what makes that true; weighting
     against a fraction of the phase let the heatmap total exceed the phase's own volume,
     so the two tiles disagreed about how many interactions there were. The first intent (a
     new booking) still carries by far the most. */
  const weights = names.map((n) => (n === primary ? 2.6 : 1) * (0.7 + intentRnd() * 0.6));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const totals = weights.map((w) => Math.round((w / wSum) * full.interactions));
  totals[totals.length - 1]! += full.interactions - totals.reduce((a, b) => a + b, 0);

  const intents: IntentRow[] = names.map((name, i) => {
    /* Inbound calls dominate, form fills next, SMS smallest — the capture's shape. The
       remainder lands on the last bucket so the three add up to the intent's total. */
    const total = totals[i]!;
    const call = Math.round(total * 0.62), form = Math.round(total * 0.28);
    const byEntry = [call, form, Math.max(0, total - call - form)];
    const voiceAgent = Math.round(total * (0.5 + intentRnd() * 0.2));
    return { name, byEntry, voiceAgent, messagingAgent: total - voiceAgent };
  });

  return {
    /* re-skinned headline labels */
    bookingTerm: profile.bookingTerm,
    dateRange: md.dateRange,
    dailyDates: dailyDates(md.dateRange, DAYS),
    dailyPoints,
    phases, revenue, appointments, containment, fteHours,
    voiceRevenue, messagingRevenue,
    reasons,
    savedTotal: phases.reduce((s, p) => s + p.cancellationsSaved, 0),
    /* The last tile is headed "Cancellations Saved" with "Revenue Retained" under it, and
       the real one puts a COUNT under that label — 27 cancellations shown as revenue. Rather
       than copy that through, the tile shows what the label says: the saved cancellations
       valued at this month's own revenue per booking. A demo where a label contradicts its
       number invites the one question you do not want. */
    revenueRetained: appointments
      ? Math.round((revenue / appointments) * phases.reduce((s, p) => s + p.cancellationsSaved, 0))
      : 0,
    topMediums: mediums.slice(0, 5).map((m) => ({ label: m.name, value: m.calls })),
    preRows: rowsFor("pre"),
    fullRows: rowsFor("full"),
    intents,
  };
}
