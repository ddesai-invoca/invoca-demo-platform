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
     • PROJECT ADMINS can EDIT and DELETE anyone's demo (see ADMIN_EMAILS), so
       whoever runs the platform can fix a colleague's demo in place instead of
       leaving them a duplicate they then have to re-share.

   Routes (all under /api):
     GET    /api/me                    → the signed-in user
     GET    /api/demos                 → summaries (no heavy payload)
     POST   /api/demos                 → create (creator = caller)
     GET    /api/demos/:id             → full demo
     PATCH  /api/demos/:id             → update customizations (owner or admin)
     DELETE /api/demos/:id             → delete (owner or admin)
     POST   /api/demos/:id/duplicate   → copy as mine
   ============================================================================= */

import { type DemoRecord, deleteDemo, getDemo, listDemos, saveDemo, uniqueId } from "./demoStore.ts";

export interface DemoUser { email: string; name: string }

export interface ApiResult { status: number; body: unknown }

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });

const owns = (rec: DemoRecord, user: DemoUser) =>
  (rec.creator?.email ?? "").toLowerCase() === user.email.toLowerCase();

/* PROJECT ADMINS — write access to every demo, not just their own.

   The list is the built-in ADMINS below PLUS anything in the DEMO_ADMIN_EMAILS
   env var (comma separated). Additive, deliberately: replacing the built-in list
   means `DEMO_ADMIN_EMAILS=bill@invoca.com`, meant as "Bill too", silently
   strips the project admin of access to everyone's demos — the exact problem
   this feature exists to fix, reintroduced by a config typo. To remove a
   built-in admin, edit this constant.

   Read at module load, so changing the var needs a server restart (on Render, a
   restart — not a redeploy). Matching is case-insensitive and tolerates spaces.

   Admin is deliberately NOT ownership: an admin editing your demo does not
   become its creator (see the PATCH branch), so the library keeps showing whose
   demo it is and the owner keeps their own rights to it. */
const ADMINS = ["ddesai@invoca.com"];

const ADMIN_EMAILS = new Set(
  [...ADMINS, ...(process.env.DEMO_ADMIN_EMAILS ?? "").split(",")]
    .map((e) => e.trim().toLowerCase()).filter(Boolean),
);

export const isAdmin = (user: DemoUser) =>
  /* trim() on THIS side too: the config side was already trimmed, so an email
     arriving with surrounding whitespace missed a list it was actually in. */
  ADMIN_EMAILS.has((user.email ?? "").trim().toLowerCase());

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
): Promise<ApiResult | null> {
  const p = urlPath.split("?")[0].replace(/\/+$/, "");

  if (p === "/api/me" && method === "GET") return ok({ user, admin: isAdmin(user) });

  if (p === "/api/demos") {
    if (method === "GET") return ok({ demos: listDemos(), user, admin: isAdmin(user) });
    if (method === "POST") {
      const profile = body?.profile;
      if (!profile?.customerName) return err(400, "A generated profile is required.");
      return ok({ demo: createDemo(profile, user, body?.customizations) });
    }
    return err(405, "Method not allowed.");
  }

  const match = /^\/api\/demos\/([^/]+)(\/duplicate)?$/.exec(p);
  if (!match) return null; // not a demo route — let the caller fall through

  const [, id, isDuplicate] = match;
  const rec = getDemo(id);
  if (!rec) return err(404, "Demo not found.");

  if (isDuplicate) {
    if (method !== "POST") return err(405, "Method not allowed.");
    // Name it "<prospect> (copy)" — otherwise the library and the in-app customer
    // switcher show two identically-named entries and nobody can tell them apart.
    const copy = createDemo(rec.profile, user, structuredClone(rec.customizations), " (copy)");
    return ok({ demo: copy });
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
