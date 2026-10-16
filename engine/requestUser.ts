/* =============================================================================
   requestUser — WHO was using the platform when something failed (10/15/2026)
   -----------------------------------------------------------------------------
   Asked for directly, against a "Client error on /launch" alert: *"start capturing
   the user: what email is logged in while they're trying to do something and
   getting the error."*

   ⚠️⚠️ ASYNC-LOCAL, SO NO CALL SITE HAS TO REMEMBER IT. server.ts runs every request
   inside `runWithUser`, and `alert()` reads `requestUser()` when it is called — so
   all 20 `routeFailed` sites, the Express error handler and anything added later
   carry the user with no argument threaded through them. A parameter on each call
   would be one more thing a new handler forgets, and the symptom would be an alert
   with nobody on it, which is the report this file exists to fix.

   Deliberately dependency-free: `alerts.ts` imports it, and almost everything
   imports `alerts.ts`, so pulling anything else in here is how an import cycle
   starts.
   ============================================================================= */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ user: string }>();

/** Run `fn` (and everything it awaits) as `user`. */
export function runWithUser<T>(user: string, fn: () => T): T {
  return store.run({ user }, fn);
}

/** The user of the request this code is running inside, if any. */
export function requestUser(): string | undefined {
  return store.getStore()?.user;
}
