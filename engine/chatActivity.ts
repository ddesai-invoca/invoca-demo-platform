/* =============================================================================
   chatActivity — is anybody chatting with an SMS agent right now? (10/20/2026)

   Asked for so a push can be checked first: "confirm before pushing anything to
   production … if any SMS agents are being used." Voice is answered by LiveKit
   (`lk room list`); SMS chats were invisible, because the server kept no record of them.

   ⚠️ TIMESTAMPS AND HASHES ONLY. This feeds the PUBLIC /api/status, so it holds no
   prospect name, no message text and no demo id: each reply is noted as a time plus a
   short hash that groups turns of one conversation (prospect + the customer's first message), which
   is what lets it count conversations rather than messages. Nothing is written to disk;
   a restart empties it, which is fine for a question about the last few minutes.

   ⚠️ RECORDED INSIDE `chatReply`, not in the routes: three routes call it (the app, a
   shared demo's scoped route, and the dev twin), and a counter in each route is how one of
   them ends up uncounted.
   ============================================================================= */

import { createHash } from "node:crypto";

const WINDOW_MS = 10 * 60_000;
const events: { at: number; convo: string }[] = [];

type Msg = { role?: string; content?: unknown };

/** Notes one SMS agent reply. Voice and Show Reasoning turns are not conversations. */
export function noteSmsReply(customerName: string, messages: Msg[], now = Date.now()): void {
  /* The customer's FIRST message identifies a conversation: it never changes as the chat
     grows. (The first two messages did, when the agent's opener is generated rather than
     scripted, and one chat counted as two.) A greeting-only turn groups under the prospect. */
  const first = messages.find((m) => m.role === "user");
  const convo = createHash("sha256").update(`${customerName}\n${String(first?.content ?? "")}`).digest("hex").slice(0, 12);
  events.push({ at: now, convo });
  const cutoff = now - WINDOW_MS;
  while (events.length && events[0].at < cutoff) events.shift();
}

/** Counts only, for /api/status. */
export function chatActivity(now = Date.now()) {
  const recent = events.filter((e) => e.at >= now - WINDOW_MS);
  const last = recent.length ? recent[recent.length - 1].at : null;
  return {
    smsRepliesLast10Min: recent.length,
    smsConversationsLast10Min: new Set(recent.map((e) => e.convo)).size,
    lastSmsReplySecondsAgo: last === null ? null : Math.round((now - last) / 1000),
  };
}

/** Test seam: the audit starts from an empty log. */
export function resetChatActivity(): void { events.length = 0; }
