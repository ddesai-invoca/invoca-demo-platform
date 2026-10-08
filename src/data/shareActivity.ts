import { SHARE_TOKEN, isShareMode } from "./shareMode";

/* =============================================================================
   shareActivity.ts — tell the server a prospect had a conversation
   -----------------------------------------------------------------------------
   Asked for 10/8/2026, alongside the Activity tab: track *"everytime a prospect
   finishes an SMS demo or finishes a voice agent demo"*.

   ⚠️⚠️ **FIRED LIBERALLY, COUNTED ONCE.** The SMS capture upserts its conversation after
   EVERY turn (progressive by design, so nothing is lost when the tab closes), so there is
   no single "finished" moment to hook. Rather than invent one — a close handler a prospect
   can always sidestep — this reports the conversation's own id every time it is captured
   and the SERVER dedupes. A conversation therefore counts exactly once however many times
   this fires, and a genuinely new one counts again.

   ⚠️ **SHARE MODE ONLY.** `SHARE_TOKEN` is null in the signed-in app, so this is a no-op
   there: an SE rehearsing their own demo is not activity anybody is tracking.
   ============================================================================= */

/** ⚠️ Never awaited and never thrown from — it is a side effect of a conversation the
 *  prospect is in the middle of, and must not be able to interrupt one. */
export function reportShareActivity(kind: "sms" | "voice", id?: string): void {
  if (!isShareMode() || !SHARE_TOKEN) return;
  try {
    void fetch(`/api/share/${SHARE_TOKEN}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...(id ? { id } : {}) }),
      /* The voice one fires as a call ends, which is often followed by a navigation. */
      keepalive: true,
    }).catch(() => {});
  } catch { /* a blocked fetch must not take the demo down */ }
}
