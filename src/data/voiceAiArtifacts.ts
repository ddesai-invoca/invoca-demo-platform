import type { CustomerProfile, VoiceConversation, VoiceRoutingDemo, VoiceScreenpop, CISignal } from "./schema";

/* =============================================================================
   voiceAiArtifacts.ts — the two leave-behinds built from a REAL captured call
   -----------------------------------------------------------------------------
   The demo story, in the user's own words: "the Caller calls in, then voice agent picks up and
   has the conversation, the Voice Routing Demo shows how we took that conversation, pulled out
   all the signals and routed them to the correct department, then the Voice Screenpop shows
   what the agent in the call center gets when that call got routed to him."

   The two seeded artifacts already tell that story with an INVENTED script. These two rebuild
   the same templates from the call the SE just had, so the transcript on the routing demo is
   the one they just spoke, the department is the one the agent actually named, and the
   screenpop carries what the agent actually established.

   ⚠️ **GATED ON A REAL TRANSFER, AND IT FAILS CLOSED.** `latestTransferredCall` returns a call
   only when `/api/analyze` came back with `transferred: true` AND a department name. A call
   that was refused as out of area, hung up, or whose analysis failed produces NOTHING — no
   rows, no artifacts. An artifact naming a department nobody was sent to is worse than an
   absent one, and this is the one thing on these screens a prospect would check.

   ⚠️ **NEWEST CALL ONLY** (agreed 8/27/2026). One pair of rows that always reflects the most
   recent transferred call, rather than a pair per practice run cluttering My Reports.

   ⚠️ **THE CALL OVERRIDES ONLY WHAT IT ESTABLISHED** (agreed 8/27/2026). Name, intent, location,
   department, signals and the transcript come from the call; email, street address, cart id,
   digital journey and estimated value stay as the prospect's own seeded screenpop. Blanking
   them would undersell the pre-call-intelligence pitch, and inventing them from a two-minute
   call would be worse. Everything derived here is traceable to something that was said.
   ============================================================================= */

type Conv = VoiceConversation;

/** The most recent call that actually ended in a transfer, or null. */
export function latestTransferredCall(convs: Conv[] | undefined): Conv | null {
  for (const c of convs ?? []) {
    const o = c.outcome;
    /* Both halves matter: `transferred` is the gate, `routedTo` is what the artifacts NAME.
       A transfer with no department would render a routing demo pointing nowhere. */
    if (o?.transferred && o.routedTo.trim() && c.transcript?.length) return c;
  }
  return null;
}

/** Words worth matching a signal against a turn — short ones match everything. */
function keyWords(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 5)
    .map((w) => w.toLowerCase());
}

/**
 * The colour band a signal is drawn in.
 *
 * ⚠️ Read off the signal's own NAME rather than assigned by position, so a call that fires a
 * different mix still colours consistently with the seeded artifact.
 */
function signalColor(name: string): string {
  const n = name.toLowerCase();
  if (/\(qa\)|greeting|close|quality/.test(n)) return "blue";
  if (/booked|scheduled|conversion|qualified/.test(n)) return "green";
  if (/intent|interest|product|competitor/.test(n)) return "purple";
  return "orange";
}

/**
 * Attach each signal to the turn that triggered it.
 *
 * ⚠️ **THE SAME TECHNIQUE `InsightsCallDetail` USES for "Found Phrases"** — signal name to its
 * significant words to the first turn containing one — rather than a second model call. It is
 * deterministic, so an SE rehearsing the same call twice sees the same artifact.
 *
 * ⚠️ A signal that matches no turn lands on the LAST turn rather than being dropped: the
 * routing demo prints a signal COUNT, and silently losing detections would make the count
 * disagree with the Analysis tab of the CI report built from the very same call.
 */
function signalsByTurn(signals: CISignal[], turns: { text: string }[]): { c: string; t: string }[][] {
  const out: { c: string; t: string }[][] = turns.map(() => []);
  if (!turns.length) return out;
  for (const s of signals) {
    const words = keyWords(s.name);
    let idx = turns.findIndex((t) => {
      const low = t.text.toLowerCase();
      return words.some((w) => low.includes(w));
    });
    if (idx < 0) idx = turns.length - 1;
    out[idx].push({ c: signalColor(s.name), t: s.name });
  }
  return out;
}

/**
 * Per-turn confidence for each queue, aligned to `queues[]`.
 *
 * ⚠️ **THIS IS THE ONE MODELLED THING HERE, and it is bounded by two real facts:** it starts
 * near even and it ENDS on the department the agent actually named. The artifact animates these
 * bars climbing as the call proceeds; no transcript carries a per-turn probability, and asking
 * a model to invent one would make the same call score differently on each replay. A monotonic
 * ramp toward the true winner is honest about what it is — a visualisation of the decision, not
 * a measurement of it.
 */
function confidenceRamp(turnCount: number, queueCount: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < turnCount; i++) {
    const p = turnCount > 1 ? i / (turnCount - 1) : 1;         // 0 at the open, 1 at the transfer
    const win = Math.round(40 + p * 52);                        // 40 -> 92
    const rest = queueCount > 1 ? Math.round((100 - win) / (queueCount - 1)) : 0;
    rows.push(Array.from({ length: queueCount }, (_, q) => (q === 0 ? win : rest)));
  }
  return rows;
}

/** The three queues with the department the agent named FIRST, since `queues[0]` is the winner. */
function queuesWithWinner(base: VoiceRoutingDemo["queues"], routedTo: string): VoiceRoutingDemo["queues"] {
  const norm = (x: string) => x.trim().toLowerCase();
  const hit = base.find((q) => norm(q.name) === norm(routedTo));
  /* ⚠️ MATCHED BY NAME, NOT ASSUMED TO BE PRESENT. The agent's department comes from the
     workflow's use-case branches, which an SE can rename with Ask AI — so it may not be one of
     the prospect's seeded queues at all. When it is, reorder; when it is not, it leads and the
     seeded ones fill the remaining slots. Either way `queues[0]` is what the agent said. */
  const winner = hit ?? { id: "routed_ai", name: routedTo.trim() };
  return [winner, ...base.filter((q) => q.id !== winner.id)].slice(0, Math.max(3, 1));
}

/** The Voice Routing Demo, rebuilt from a captured call. */
export function voiceAiRouting(profile: CustomerProfile, conv: Conv): VoiceRoutingDemo | null {
  const base = profile.reports.voiceRoutingDemo;
  const o = conv.outcome;
  if (!base || !o?.transferred || !o.routedTo.trim()) return null;

  const queues = queuesWithWinner(base.queues, o.routedTo);
  const turns = conv.transcript;
  const sigs = signalsByTurn(conv.signals ?? [], turns);
  const ramp = confidenceRamp(turns.length, queues.length);

  return {
    ...base,                                   // brand, icon, phone, attribution, visitor history, badge
    callerLocation: o.location.trim() || base.callerLocation,
    queues,
    convo: turns.map((t, i) => ({
      role: t.speaker === "agent" ? ("agent" as const) : ("caller" as const),
      text: t.text,
      sigs: sigs[i] ?? [],
      q: ramp[i] ?? [],
    })),
    routedSubtitle: `AI Agent qualified caller intent and routed to ${o.routedTo.trim()}`,
  };
}

/** "Cancel an existing reservation" -> "cancel an existing reservation", leaving acronyms be. */
function lowerFirst(t: string): string {
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/** The Voice Screenpop the receiving rep sees, rebuilt from the same call. */
export function voiceAiScreenpop(profile: CustomerProfile, conv: Conv): VoiceScreenpop | null {
  const base = profile.reports.voiceScreenpop;
  const o = conv.outcome;
  if (!base || !o?.transferred || !o.routedTo.trim()) return null;

  const name = o.callerName.trim() || base.callerName;
  const first = name.split(/\s+/)[0] || name;
  const where = o.location.trim();
  const intent = o.intent.trim() || base.intent;
  /* What the agent ACTUALLY collected, read off the signals and the outcome rather than
     asserted — the rep is told only what the caller really gave. */
  const collected = [
    o.callerName.trim() ? "name" : "",
    where ? "location" : "",
  ].filter(Boolean);

  return {
    ...base,                                   // email, address, cart, journey, value: the prospect's own
    callerName: name,
    intent,
    /* ⚠️⚠️ **THE "AI VOICE AGENT" PANEL COMES ENTIRELY FROM THE CALL, WHERE THE CRM FIELDS DO
       NOT — and the distinction is not pedantry.** Keeping the seeded `coverage` left a support
       caller who never gave a location reading "ZIP 89121 confirmed, Las Vegas serviceable" on
       a panel headed by the AI agent's name: the screen would be crediting the agent with a
       check it never ran, which is exactly the kind of thing a prospect who knows the product
       asks about. An address and an email are facts about a person that a CRM legitimately
       already holds; a verification is an event, and this call either did it or did not. */
    coverage: where ? `${where} confirmed by the AI agent` : `Service area not checked on this call`,
    switchIntent: `Qualified by the AI voice agent and routed to ${o.routedTo.trim()}`,
    tagBlue: `Routed to ${o.routedTo.trim()}`,
    greeting:
      /* Lower-cased and de-punctuated because the intent is a SENTENCE and this splices it
         mid-clause — "about Cancel an existing reservation." reads as two half-sentences. */
      `Hi ${first}, thanks for holding. I can see you just spoke with our AI assistant about ${lowerFirst(intent.replace(/\.\s*$/, ""))}` +
      `${collected.length ? `, and I already have your ${collected.join(" and ")}` : ""}. ` +
      `Let me pick up right where you left off.`,
  };
}
