/* =============================================================================
   sharedConversations — the SMS and voice conversations prospects have on a shared demo
   (10/21/2026).

   Asked for: link each conversation in the event sheet's Activity tab back to that exact
   conversation in the AI SMS / AI Voice Conversation Intelligence report. Before this the
   conversation lived ONLY in the prospect's own browser (localStorage), so the server knew a
   conversation happened (activityStore) but never what was in it, and a link would have opened
   nothing. The shared page now posts each conversation here as it changes.

   ⚠️ KEPT FOREVER, on the user's instruction: "always keep the conversation, we, as admins,
   should still be able to access the shared demo even if it expires." Nothing here is deleted
   when a link expires or is revoked; the share records and these are separate stores.

   One JSON file per conversation: DATA_DIR/shared-conversations/<demoId>/<kind>-<id>.json.
   Bounded on the way in, because the body comes from a public route.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, isValidId } from "./demoStore.ts";

const DIR = path.join(DATA_DIR, "shared-conversations");

export type SharedKind = "sms" | "voice";

export interface SharedConversation {
  id: string;
  kind: SharedKind;
  demoId: string;
  prospect: string;
  /** Who unlocked the link, as the unlock cookie records it ("" when no address was given). */
  email: string;
  createdAt: string;
  updatedAt: string;
  /** The SmsConversation / VoiceConversation object as the report renders it. */
  conversation: Record<string, unknown>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_BYTES = 400_000;

function dirFor(demoId: string): string | null {
  return isValidId(demoId) ? path.join(DIR, demoId) : null;
}
function fileFor(demoId: string, kind: SharedKind, id: string): string | null {
  const d = dirFor(demoId);
  return d && SAFE_ID.test(id) ? path.join(d, `${kind}-${id}.json`) : null;
}

/** Create or update one conversation. Returns false for anything it will not store. */
export function saveSharedConversation(input: {
  demoId: string; prospect: string; email: string; kind: SharedKind; conversation: unknown;
}): boolean {
  const c = input.conversation as Record<string, unknown> | null;
  const id = typeof c?.id === "string" ? c.id : "";
  const file = fileFor(input.demoId, input.kind, id);
  if (!file || !c || !Array.isArray(c.transcript)) return false;
  const json = JSON.stringify(c);
  if (json.length > MAX_BYTES) return false;
  const now = new Date().toISOString();
  let createdAt = now;
  try { createdAt = (JSON.parse(fs.readFileSync(file, "utf8")) as SharedConversation).createdAt || now; } catch { /* new */ }
  const rec: SharedConversation = {
    id, kind: input.kind, demoId: input.demoId, prospect: input.prospect,
    email: (input.email || "").trim(), createdAt, updatedAt: now, conversation: c,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec));
  fs.renameSync(tmp, file);
  return true;
}

/** A demo's shared conversations, newest first, optionally of one kind. */
export function listSharedConversations(demoId: string, kind?: SharedKind): SharedConversation[] {
  const d = dirFor(demoId);
  if (!d || !fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => f.endsWith(".json") && (!kind || f.startsWith(`${kind}-`)))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as SharedConversation; } catch { return null; } })
    .filter((r): r is SharedConversation => !!r?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Where a conversation opens in the app: the right report, the right demo, that conversation. */
export function conversationLink(base: string, demoId: string, kind: SharedKind, id: string): string {
  const report = kind === "voice" ? "voice-conversation-intelligence" : "sms-conversation-intelligence";
  return `${base.replace(/\/$/, "")}/reports/${report}?demo=${encodeURIComponent(demoId)}&conv=${encodeURIComponent(id)}`;
}
