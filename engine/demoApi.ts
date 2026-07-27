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

   Routes (all under /api):
     GET    /api/me                    → the signed-in user
     GET    /api/demos                 → summaries (no heavy payload)
     POST   /api/demos                 → create (creator = caller)
     GET    /api/demos/:id             → full demo
     PATCH  /api/demos/:id             → update customizations (owner only)
     DELETE /api/demos/:id             → delete (owner only)
     POST   /api/demos/:id/duplicate   → copy as mine
   ============================================================================= */

import { type DemoRecord, deleteDemo, getDemo, listDemos, saveDemo, uniqueId } from "./demoStore.ts";

export interface DemoUser { email: string; name: string }

export interface ApiResult { status: number; body: unknown }

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });

const owns = (rec: DemoRecord, user: DemoUser) =>
  (rec.creator?.email ?? "").toLowerCase() === user.email.toLowerCase();

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
export function createDemo(profile: any, user: DemoUser, customizations?: DemoRecord["customizations"]): DemoRecord {
  const meta = describe(profile);
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
    profile: { ...(profile as object), id },
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

  if (p === "/api/me" && method === "GET") return ok({ user });

  if (p === "/api/demos") {
    if (method === "GET") return ok({ demos: listDemos(), user });
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
    const copy = createDemo(rec.profile, user, structuredClone(rec.customizations));
    return ok({ demo: copy });
  }

  if (method === "GET") return ok({ demo: rec, canEdit: owns(rec, user) });

  if (method === "PATCH") {
    if (!owns(rec, user)) return err(403, `This demo belongs to ${rec.creator?.name || rec.creator?.email}. Duplicate it to make your own editable copy.`);
    const next: DemoRecord = {
      ...rec,
      customizations: body?.customizations ?? rec.customizations,
      profile: body?.profile ?? rec.profile,
      updatedAt: new Date().toISOString(),
    };
    return ok({ demo: saveDemo(next) });
  }

  if (method === "DELETE") {
    if (!owns(rec, user)) return err(403, "You can only delete demos you created.");
    return ok({ ok: deleteDemo(id) });
  }

  return err(405, "Method not allowed.");
}
