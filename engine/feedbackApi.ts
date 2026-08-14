/* =============================================================================
   feedbackApi.ts — the feedback / feature-request routes
   -----------------------------------------------------------------------------
     POST   /api/feedback        submit an item (any signed-in user)
     GET    /api/feedback        list: YOUR items, or everything if you are admin
     PATCH  /api/feedback/:id    change status or note (ADMIN ONLY)
     DELETE /api/feedback/:id    remove (ADMIN ONLY)

   Shaped exactly like demoApi so server.ts and the Vite dev server can mount it
   the same way: returns null for a path it does not own, so the caller falls
   through to the next handler.

   VISIBILITY: a submitter sees only their own items; an admin sees all. Enforced
   HERE, on the server, because a client-side filter is a suggestion. The list is
   filtered before it is serialised, so another person's text never reaches a
   browser that should not have it.
   ============================================================================= */

import {
  listFeedback, getFeedback, saveFeedback, deleteFeedback, newFeedbackId,
  STATUSES, TERMINAL, type FeedbackRecord, type FeedbackStatus, type FeedbackUser,
} from "./feedbackStore.ts";
import { sendMail, completionEmail, mailConfigured } from "./mailer.ts";

export interface ApiResult { status: number; body: unknown }
const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });

const MAX_TITLE = 140;
const MAX_BODY = 4000;

export async function handleFeedbackApi(
  method: string,
  urlPath: string,
  body: any,
  user: FeedbackUser,
  isAdmin: boolean,
  baseUrl: string,
): Promise<ApiResult | null> {
  const p = urlPath.split("?")[0].replace(/\/+$/, "");
  if (!p.startsWith("/api/feedback")) return null;   // not ours

  const mine = (r: FeedbackRecord) =>
    (r.submitter?.email || "").toLowerCase() === (user.email || "").toLowerCase();

  if (p === "/api/feedback") {
    if (method === "GET") {
      const all = listFeedback();
      return ok({
        items: isAdmin ? all : all.filter(mine),
        admin: isAdmin,
        statuses: STATUSES,
        /* So the form can tell the truth about what happens on completion rather
           than promising an email that cannot be sent. */
        emailEnabled: mailConfigured(),
      });
    }
    if (method === "POST") {
      const kind = body?.kind === "feature" ? "feature" : "feedback";
      const title = String(body?.title ?? "").trim();
      const text = String(body?.body ?? "").trim();
      if (!title) return err(400, "A short title is required.");
      if (!text) return err(400, "Please describe it a little.");
      if (title.length > MAX_TITLE) return err(400, `Keep the title under ${MAX_TITLE} characters.`);
      if (text.length > MAX_BODY) return err(400, `Keep the description under ${MAX_BODY} characters.`);

      const now = new Date().toISOString();
      const rec: FeedbackRecord = {
        id: newFeedbackId(),
        kind,
        title,
        body: text,
        page: String(body?.page ?? "").slice(0, 200) || undefined,
        /* The submitter comes from the SESSION, never from the request body: it is
           what makes the completion email go to a real person who actually sent
           this, and it cannot be spoofed by a crafted POST. */
        submitter: { email: user.email, name: user.name },
        status: STATUSES[0],
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, status: STATUSES[0], by: { email: user.email, name: user.name } }],
      };
      return ok({ item: saveFeedback(rec) });
    }
    return err(405, "Method not allowed.");
  }

  const m = /^\/api\/feedback\/([^/]+)$/.exec(p);
  if (!m) return err(404, "Not found.");
  const rec = getFeedback(m[1]);
  if (!rec) return err(404, "Not found.");

  if (method === "GET") {
    if (!isAdmin && !mine(rec)) return err(403, "Not yours.");
    return ok({ item: rec });
  }

  /* Triage is an admin action. A submitter marking their own request Complete
     would both skew the board and mail themselves. */
  if (method === "PATCH") {
    if (!isAdmin) return err(403, "Only an admin can change status.");
    const next = String(body?.status ?? "") as FeedbackStatus;
    if (next && !STATUSES.includes(next)) return err(400, "Unknown status.");
    const now = new Date().toISOString();

    if (typeof body?.note === "string") rec.note = body.note.slice(0, MAX_BODY);
    let mailed: { sent: boolean; reason?: string } | null = null;

    if (next && next !== rec.status) {
      rec.status = next;
      rec.history.push({ at: now, status: next, by: { email: user.email, name: user.name } });

      /* THE NOTIFICATION, sent once. `notifiedAt` is the guard: without it, any
         later save while the item sits in a terminal status would mail the person
         again, and "your request is done" arriving three times is worse than it
         never arriving. */
      if (TERMINAL.includes(next) && !rec.notifiedAt) {
        mailed = await sendMail(completionEmail({
          to: rec.submitter.email,
          name: rec.submitter.name,
          kind: rec.kind,
          title: rec.title,
          note: rec.note,
          boardUrl: `${baseUrl.replace(/\/+$/, "")}/feedback`,
        }));
        /* Stamped only on a real send, so an item completed while email is
           unconfigured still notifies later if someone re-completes it. */
        if (mailed.sent) rec.notifiedAt = now;
      }
    }
    rec.updatedAt = now;
    saveFeedback(rec);
    return ok({ item: rec, mailed });
  }

  if (method === "DELETE") {
    if (!isAdmin) return err(403, "Only an admin can delete.");
    return ok({ deleted: deleteFeedback(rec.id) });
  }

  return err(405, "Method not allowed.");
}
