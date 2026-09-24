/* =============================================================================
   demoApi.ts — request handling for the shared demo library
   -----------------------------------------------------------------------------
   Transport-agnostic on purpose: both the Vite dev server (vite.config.ts) and
   the production server (server.ts) mount the SAME handler, so the two can't
   drift. Each caller supplies the signed-in user; this module owns the rules.

   Ownership model:
     • Anyone signed in can LIST and VIEW every demo (shared team library).
     • Only the creator can EDIT or DELETE their own demo.
     • Anyone can DUPLICATE someone else's demo — the copy is theirs to edit.
     • PROJECT ADMINS can EDIT and DELETE anyone's demo (the list is in `admins.ts`), so
       whoever runs the platform can fix a colleague's demo in place instead of
       leaving them a duplicate they then have to re-share.

   Routes (all under /api):
     GET    /api/me                    → the signed-in user
     POST   /api/admin-notice/ack      → dismiss the one-time "you're now an admin" popup
     GET    /api/demos                 → summaries (no heavy payload)
     POST   /api/demos                 → create (creator = caller)
     GET    /api/demos/:id             → full demo
     PATCH  /api/demos/:id             → update customizations (owner or admin)
     DELETE /api/demos/:id             → delete (owner or admin)
     POST   /api/demos/:id/duplicate   → copy as mine
     POST   /api/demos/:id/mark        → mark it Demoed / Follow-up / Lead (+ notify the AE)
     GET    /api/demos/:id/rep         → who owns this prospect's Salesforce account
     GET    /api/marks                 → my follow-up list (?all=1 for an admin)
   ============================================================================= */

import { type DemoRecord, deleteDemo, getDemo, listDemos, saveDemo, uniqueId } from "./demoStore.ts";
import { isAdminEmail } from "./admins.ts";
import { pendingAdminNotice, ackAdminNotice } from "./adminNotices.ts";
import { isMarkStatus, listMarks, markDemo, marksFor, unmarkDemo } from "./demoMarks.ts";
import { lookupRep, salesforceConfigured, type RepCandidate } from "./salesforceApi.ts";
import { markNoticeEmail, sendMail } from "./mailer.ts";
import { orgEmailDomain } from "./appEnv.ts";

export interface DemoUser { email: string; name: string }

export interface ApiResult { status: number; body: unknown }

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });

const owns = (rec: DemoRecord, user: DemoUser) =>
  (rec.creator?.email ?? "").toLowerCase() === user.email.toLowerCase();

/* PROJECT ADMINS — write access to every demo, not just their own.

   ⚠️ **THE LIST ITSELF MOVED TO `engine/admins.ts` (9/16/2026)**, so the alert funnel can
   read it without a `demoApi -> alerts -> demoApi` cycle. Everything about it is unchanged
   and documented there: built-in constant PLUS an additive `DEMO_ADMIN_EMAILS`, read at
   module load, case-insensitive. `adminEmails` is re-exported here so existing callers
   (`feedbackApi`, `audit:app`) keep importing it from where they always did — one list,
   two spellings of the same import.

   Admin is deliberately NOT ownership: an admin editing your demo does not
   become its creator (see the PATCH branch), so the library keeps showing whose
   demo it is and the owner keeps their own rights to it. */
export { adminEmails } from "./admins.ts";

export const isAdmin = (user: DemoUser) => isAdminEmail(user.email);

/* The single write rule. Both PATCH and DELETE go through this so they can never
   drift apart. */
const canWrite = (rec: DemoRecord, user: DemoUser) => owns(rec, user) || isAdmin(user);

/* Pull the library-facing fields out of a CustomerProfile. */
function describe(profile: any) {
  return {
    prospect: String(profile?.customerName ?? "Untitled").slice(0, 200),
    websiteUrl: String(profile?.websiteUrl ?? ""),
    industry: String(profile?.industry ?? ""),
  };
}

const emptyCustomizations = () => ({ overrides: {}, tiles: {} });

/** Build a new demo owned by `user` from a generated profile. */
export function createDemo(
  profile: any,
  user: DemoUser,
  customizations?: DemoRecord["customizations"],
  nameSuffix = "",
): DemoRecord {
  const meta = describe(profile);
  if (nameSuffix) meta.prospect = `${meta.prospect}${nameSuffix}`;
  const id = uniqueId(meta.prospect);
  const now = new Date().toISOString();
  // The frontend keys everything off profile.id — keep it equal to the demo id
  // so a duplicate never collides with its source.
  const rec: DemoRecord = {
    id,
    ...meta,
    creator: user,
    createdAt: now,
    updatedAt: now,
    profile: { ...(profile as object), id, customerName: meta.prospect },
    customizations: customizations ?? emptyCustomizations(),
  };
  return saveDemo(rec);
}

export async function handleDemoApi(
  method: string,
  urlPath: string,
  body: any,
  user: DemoUser,
  /* Only used to build the "open the demo" link in the AE notification. Optional
     so a caller that never marks anything needs no change; both twins pass it,
     deriving it exactly as they already do for the feedback board's mail. */
  baseUrl = "",
): Promise<ApiResult | null> {
  const p = urlPath.split("?")[0].replace(/\/+$/, "");

  if (p === "/api/me" && method === "GET")
    return ok({ user, admin: isAdmin(user), adminNotice: pendingAdminNotice(user.email) });

  /* ⚠️ ONE-TIME "you're now an admin" popup — see adminNotices.ts. Its own route
     rather than folding the ack into a PATCH somewhere, because dismissing it is
     not an edit to any demo; it belongs to the SIGNED-IN USER, not a record. */
  if (p === "/api/admin-notice/ack" && method === "POST") {
    ackAdminNotice(user.email);
    return ok({ ok: true });
  }

  if (p === "/api/demos") {
    if (method === "GET")
      return ok({ demos: listDemos(), user, admin: isAdmin(user), adminNotice: pendingAdminNotice(user.email) });
    if (method === "POST") {
      const profile = body?.profile;
      if (!profile?.customerName) return err(400, "A generated profile is required.");
      return ok({ demo: createDemo(profile, user, body?.customizations) });
    }
    return err(405, "Method not allowed.");
  }

  /* ⚠️⚠️ THE FOLLOW-UP LIST, AND `?all=1` IS THE VISIBILITY BOUNDARY. Own marks by
     default; everyone's only for an admin, and a non-admin asking for them is
     REFUSED rather than quietly handed their own — a filter that silently narrows
     is how somebody concludes the feature is broken. The narrowing happens in
     `listMarks` before anything is serialised, so a colleague's note never reaches
     a browser that should not have it (the rule `feedbackApi` already follows). */
  if (p === "/api/marks") {
    if (method !== "GET") return err(405, "Method not allowed.");
    const wantsAll = /(^|[?&])all=1(&|$)/.test(urlPath.split("?")[1] ?? "");
    if (wantsAll && !isAdmin(user)) return err(403, "Only an admin can see everyone's marks.");
    const entries = listMarks(wantsAll ? undefined : user.email);
    /* Joined with the demo's own name here rather than in the browser: the list
       is the point of the feature, and a row reading "dallas-sci-hispana" is not
       a follow-up list. A mark whose demo has since been deleted is dropped. */
    const byId = new Map(listDemos().map((d) => [d.id, d]));
    const marks = entries.flatMap((m) => {
      const d = byId.get(m.demoId);
      return d ? [{ ...m, prospect: d.prospect, industry: d.industry, event: d.event }] : [];
    });
    return ok({ marks, admin: isAdmin(user), scope: wantsAll ? "all" : "mine" });
  }

  const match = /^\/api\/demos\/([^/]+)(\/duplicate|\/mark|\/rep)?$/.exec(p);
  if (!match) return null; // not a demo route — let the caller fall through

  const [, id, sub] = match;
  const isDuplicate = sub === "/duplicate";
  const rec = getDemo(id);
  if (!rec) return err(404, "Demo not found.");

  if (isDuplicate) {
    if (method !== "POST") return err(405, "Method not allowed.");
    // Name it "<prospect> (copy)" — otherwise the library and the in-app customer
    // switcher show two identically-named entries and nobody can tell them apart.
    const copy = createDemo(rec.profile, user, structuredClone(rec.customizations), " (copy)");
    return ok({ demo: copy });
  }

  /* ⚠️⚠️ MARKING IS DELIBERATELY NOT GATED ON `canWrite`, WHICH IS THE WHOLE
     POINT. The Dallas roster is 76 demos owned by ONE account and presented by
     several SEs — requiring ownership would mean the person who actually gave
     the demo is the one who cannot record it. A mark is a fact about the SIGNED-IN
     USER, not an edit to the record, and it is stored outside the record so it
     changes nothing its owner is responsible for. */
  /* Who owns this prospect's Salesforce account. Read-only and safe to call
     before anything is marked, which is what lets the panel NAME the person
     before an SE commits to telling them. */
  if (sub === "/rep") {
    if (method !== "GET") return err(405, "Method not allowed.");
    return ok(await lookupRep(rec.websiteUrl));
  }

  if (sub === "/mark") {
    if (method === "POST") {
      const status = body?.status;
      if (!isMarkStatus(status)) return err(400, "Status must be demoed, follow-up or lead.");
      const mark = markDemo(id, user, status, body?.note);
      if (!mark) return err(400, "Invalid demo id.");
      const notified = body?.notify ? await notifyRep(rec, user, mark, body?.accountId, baseUrl) : undefined;
      return ok({ mark, ...(notified ? { notified } : {}) });
    }
    if (method === "DELETE") return ok({ removed: unmarkDemo(id, user.email) });
    if (method === "GET") {
      const all = marksFor(id);
      /* Same boundary as the list: your own unless you are an admin. */
      return ok({ marks: isAdmin(user) ? all : all.filter((m) => m.email.toLowerCase() === user.email.toLowerCase()) });
    }
    return err(405, "Method not allowed.");
  }

  if (method === "GET") return ok({ demo: rec, canEdit: canWrite(rec, user) });

  if (method === "PATCH") {
    if (!canWrite(rec, user)) return err(403, `This demo belongs to ${rec.creator?.name || rec.creator?.email}. Duplicate it to make your own editable copy.`);
    const next: DemoRecord = {
      ...rec,
      customizations: body?.customizations ?? rec.customizations,
      profile: body?.profile ?? rec.profile,
      updatedAt: new Date().toISOString(),
      /* CREATOR IS NEVER REASSIGNED. An admin editing someone else's demo would
         otherwise quietly take it over, and the owner would lose it from "mine".
         Instead the write is ATTRIBUTED: updatedBy records who last touched it,
         so an owner can see that an admin changed their demo rather than being
         left wondering. */
      updatedBy: user,
    };
    return ok({ demo: saveDemo(next) });
  }

  if (method === "DELETE") {
    if (!canWrite(rec, user)) return err(403, "You can only delete demos you created.");
    return ok({ ok: deleteDemo(id) });
  }

  return err(405, "Method not allowed.");
}

/* =============================================================================
   Telling the account executive
   -----------------------------------------------------------------------------
   ⚠️⚠️ **OPT-IN PER MARK, NEVER AUTOMATIC — the SE's own call when this was
   designed.** An SE marks ~25 demos in an afternoon at a conference; firing a
   mail on every one of those turns a signal into a burst somebody sets a filter
   for, and one mistaken click would tell a colleague something about an account
   that is not theirs. So `notify` has to be asked for, per demo.

   ⚠️⚠️ **THE ADDRESS IS RESOLVED HERE AND NEVER ACCEPTED FROM THE BROWSER.**
   This app sends from the maintainer's own Gmail; taking a `to` off the request
   body would make any signed-in SE able to send mail as them to anywhere. The
   client may only say WHICH candidate (`accountId`), and even that is checked
   against the set this server just resolved for this demo's own domain.

   ⚠️ **AND THE RECIPIENT MUST BE INSIDE THE ORG'S OWN EMAIL DOMAIN.** A CRM
   Account can legitimately be owned by an integration user or carry a partner's
   address; the sign-in gate has always narrowed to staff, and so does this. One
   definition of the domain (`engine/appEnv.ts`), read by both.
   ============================================================================= */

export interface NotifyResult {
  sent: boolean;
  /** Which mailbox it actually left from — the SE's own when they have
   *  connected one, the platform's otherwise. The UI says which, because
   *  "sent" alone would hide the fallback. */
  sentAs?: string;
  /** The rep we told, when we told one — so the UI names them rather than
   *  claiming a vague success. */
  to?: string;
  name?: string;
  /** Why not, in words an SE can act on. Never a stack trace. */
  reason?: string;
  /** More than one owner matched; the UI asks which. */
  candidates?: RepCandidate[];
}

async function notifyRep(
  rec: DemoRecord,
  user: DemoUser,
  mark: { status: string; note?: string; at: string },
  accountId: unknown,
  baseUrl: string,
): Promise<NotifyResult> {
  if (!salesforceConfigured()) return { sent: false, reason: "Salesforce isn't connected on this server." };

  const found = await lookupRep(rec.websiteUrl);
  let rep = found.rep;
  if (!rep && found.candidates.length && typeof accountId === "string") {
    /* ⚠️ PICKED FROM THE SET THIS SERVER JUST RESOLVED, not trusted as an id to
       look up. A client naming an arbitrary account would otherwise choose the
       recipient, which is the thing the paragraph above exists to prevent. */
    rep = found.candidates.find((c) => c.accountId === accountId) ?? null;
    if (!rep) return { sent: false, reason: "That account is no longer one of the matches.", candidates: found.candidates };
  }
  if (!rep) {
    return {
      sent: false,
      reason: found.reason ?? `No Salesforce account matches ${found.domain}.`,
      ...(found.candidates.length ? { candidates: found.candidates } : {}),
    };
  }

  const domain = orgEmailDomain();
  if (!rep.ownerEmail.endsWith(`@${domain}`)) {
    return { sent: false, reason: `${rep.ownerName} isn't an @${domain} address, so nothing was sent.`, name: rep.ownerName };
  }

  const LABEL: Record<string, string> = { demoed: "Demoed", "follow-up": "Follow-up", lead: "Lead" };
  const r = await sendMail(markNoticeEmail({
    to: rep.ownerEmail,
    repName: rep.ownerName,
    prospect: rec.prospect,
    status: LABEL[mark.status] ?? mark.status,
    note: mark.note,
    seName: user.name,
    seEmail: user.email,
    when: new Date(mark.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    demoUrl: `${baseUrl.replace(/\/+$/, "")}/launch`,
  /* ⚠️ SENT AS THE SE WHO MARKED IT, when they have connected their mailbox —
     they are the actual sender, so the AE sees their address and the message
     lands in their own Sent folder. Falls back to the platform mailbox rather
     than refusing; `sentAs` in the result reports which happened. */
  }), user.email);
  /* ⚠️ `sendMail` NEVER THROWS and reports why — an unconfigured mailer or a
     non-production service is a supported state, and the MARK is already saved
     either way. Reporting "sent" when it was only logged is the lie this
     carries `reason` to avoid. */
  return {
    sent: r.sent,
    to: rep.ownerEmail,
    name: rep.ownerName,
    ...(r.sentAs ? { sentAs: r.sentAs } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
  };
}
