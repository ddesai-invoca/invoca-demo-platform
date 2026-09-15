import { ParticipantKind, RoomEvent } from "@livekit/rtc-node";

/* =============================================================================
   roomLifecycle.js — ending a voice job when the caller is gone
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THIS LIVES IN ITS OWN FILE SO THE AUDIT CAN RUN IT, NOT GREP IT.**
   `voiceAgent.js` calls `cli.runApp()` at module load, so importing it would start a
   worker — which is why `audit:voice` reads that file as TEXT and matches patterns in
   it. This file has no side effects, so `audit:voice` BUILDS a fake room and drives the
   real timer instead. That distinction has already cost this repo twice: CLAUDE.md
   records a grep passing against `if (false && CHROME_KEYS.has(path))`, and another
   matching a comment rather than the code it was written for. Same reason
   `workflowChrome.ts` and `workflowRows.ts` were split out of their screens.
   ============================================================================= */

/**
 * How long a room may sit with no caller in it before the job ends itself.
 *
 * ⚠️ It exists to survive a RECONNECT, not to be polite. A caller whose wifi blips, or whose
 * browser remounts the call component, disconnects and comes back under the same identity a
 * moment later; tearing the room down on the first disconnect event would kill a call that was
 * about to resume. 10s covers that comfortably (the browser client's own reuse window is 250ms)
 * and still ends a genuinely abandoned room fast enough that it cannot hold a concurrency slot
 * for the rest of the day.
 */
export const EMPTY_ROOM_GRACE_MS = 10_000;

/**
 * End the job once the last CALLER leaves, whatever reason they left for.
 *
 * ⚠️⚠️ **THIS IS THE ZOMBIE-SESSION FIX (9/15/2026), AND IT CLOSES A GAP THE SDK'S OWN OPTION
 * DELIBERATELY LEAVES OPEN.** `RoomInputOptions.closeOnDisconnect` already defaults to true, so
 * a clean hangup closes the session — but read its implementation and it only fires for three
 * disconnect reasons (`CLIENT_INITIATED`, `ROOM_DELETED`, `USER_REJECTED`). A laptop that sleeps,
 * a killed tab or a dropped network produces none of those, so the session stayed open, the agent
 * sat in the room retrying STT against somebody who was never coming back, and the room kept
 * billing. Measured live: rooms held 2 participants / 1 publisher for hours, and clicking End
 * Call still left the agent behind.
 *
 * ⚠️⚠️ **AND IT COST FAR MORE THAN MONEY, WHICH IS WHY IT IS WORTH THIS MUCH COMMENT.** LiveKit
 * caps CONCURRENT inference connections per plan, so each zombie permanently held one. On the
 * Build plan that cap was **2** — one zombie halved voice capacity and two killed it outright,
 * and the symptom was a silent dead call with `APIConnectionError` in the worker log, which reads
 * as a network fault rather than as a leak. It cost a long diagnosis. Do not simplify this away.
 *
 * ⚠️ **IT ARMS ONLY ON A DISCONNECT EVENT, NEVER ON AN EMPTY ROOM, and that is the whole guard
 * against the obvious bug here.** The agent can join before the caller does, so a room is
 * legitimately empty of callers for a moment at startup; a naive "is the room empty?" check at
 * session start would shut the job down before the demo began.
 *
 * ⚠️ **AGENTS DO NOT COUNT AS CALLERS.** `remoteParticipants` excludes this worker itself, but a
 * second agent (a future SIP leg, an egress recorder) would appear there and would otherwise keep
 * the room alive forever. `ParticipantKind.AGENT` is read from the SDK rather than inferred from
 * the `caller-` identity prefix our own token happens to mint.
 *
 * @param ctx      the JobContext — needs `room`, `shutdown()` and `addShutdownCallback()`
 * @param session  the AgentSession — closing it is what releases the inference connections
 * @param graceMs  overridable so the audit can drive the real timer without waiting 10s
 */
export function endWhenRoomEmpties(ctx, session, graceMs = EMPTY_ROOM_GRACE_MS) {
  let timer = null;

  const callersLeft = () =>
    [...ctx.room.remoteParticipants.values()].filter((p) => p.kind !== ParticipantKind.AGENT).length;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
    if (callersLeft() > 0) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      /* ⚠️ They came back inside the grace window: the call is live again, leave it alone.
         **THIS AND THE `ParticipantConnected` HANDLER BELOW ARE MUTUAL BACKSTOPS, ON PURPOSE.**
         Either one alone keeps a reconnecting caller's call — which is worth knowing before
         "simplifying" one away, because `audit:voice` only reddens when BOTH are gone (verified:
         removing either alone leaves the suite green, removing both fails the reconnect check).
         Keep the pair: this one is what makes the decision correct, and that one releases the
         pending timer promptly instead of leaving it to fire and no-op. */
      if (callersLeft() > 0) return;
      console.log(`[voice-agent] no caller left in ${ctx.room?.name ?? "?"}; ending the session`);
      /* ⚠️ CLOSING THE SESSION IS WHAT RELEASES THE INFERENCE CONNECTIONS, and it is also what
         triggers `deleteRoomOnClose` in voiceAgent.js — so the room goes with it and nothing
         lingers. The catch is not defensive padding: a session already closing (the caller hung
         up mid-error) rejects here, and an unhandled rejection inside a timer takes the worker
         down, which would turn a leak into an outage. */
      void (async () => {
        try {
          await session.close();
        } catch { /* already closing */ }
        ctx.shutdown("caller left");
      })();
    }, graceMs);
  });

  /* A reconnecting caller cancels a pending teardown. */
  ctx.room.on(RoomEvent.ParticipantConnected, cancel);

  /* ⚠️ Or the timer outlives the job it belongs to and fires against a torn-down room. */
  ctx.addShutdownCallback(async () => {
    cancel();
  });
}
