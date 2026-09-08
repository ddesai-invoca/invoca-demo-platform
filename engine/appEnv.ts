/* =============================================================================
   appEnv.ts — which environment is this process, and what is it allowed to do
   -----------------------------------------------------------------------------
   Added 9/8/2026 for the sandbox/staging service. ONE definition, several readers: the public
   status payload, the nightly canary, the mailer, the LiveKit agent name and the top-bar
   badge. Several copies of "am I production?" is how one of them ends up disagreeing, and the
   symptom would be a staging service doing something only production should.

   ⚠️⚠️ **IT IS DERIVED FROM THE SERVICE NAME, NOT FROM A FLAG SOMEBODY HAS TO REMEMBER.**
   Render sets `RENDER_SERVICE_NAME` for free. Keying off an `APP_ENV` var alone means a
   staging service that was created without it looks EXACTLY like production — no badge, a
   nightly canary burning a full generation, and real email going to real people. Deriving it
   from the name makes the safe answer the automatic one: call the service
   `invoca-demo-platform-staging` and it is staging by construction.
   ⚠️ `APP_ENV` still overrides, for a local prod-like run or a service named something else.
   ============================================================================= */

export type AppEnv = "production" | "staging" | "local";

/** Anything that reads as a non-production deployment. */
const NON_PROD = /(staging|sandbox|preview|dev|test|qa)/i;

export function appEnv(): AppEnv {
  const explicit = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (explicit === "production" || explicit === "staging" || explicit === "local") return explicit;

  const service = process.env.RENDER_SERVICE_NAME ?? "";
  /* ⚠️ `RENDER_GIT_COMMIT` is how the rest of this codebase already tells a real deploy from a
     dev server (see /api/status), so the same signal decides "local" here. */
  if (!process.env.RENDER_GIT_COMMIT) return "local";
  return NON_PROD.test(service) ? "staging" : "production";
}

export const isProduction = (): boolean => appEnv() === "production";

/**
 * The LiveKit agent name this environment dispatches to.
 *
 * ⚠️⚠️ **THIS IS THE ONE THAT WOULD HAVE CONTAMINATED PRODUCTION SILENTLY.** LiveKit hands a
 * job to any worker registered under the requested name **within the project**, and there is
 * one LiveKit project. With both services asking for `invoca-voice`:
 *   - a staging test call is answered by the PRODUCTION worker, so staging can never exercise
 *     a worker change and its test calls spend production capacity;
 *   - and the moment a staging worker is deployed under that name, it joins the same pool and
 *     can answer a REAL demo call with untested code, mid-sentence.
 * Neither shows up as an error anywhere. So the name carries the environment.
 *
 * ⚠️ **THE WORKER READS THE SAME VARIABLE** (`agent/voiceAgent.js`), because the token
 * dispatches BY NAME and a mismatch means no agent ever joins and the caller hears silence —
 * the invariant that file already carries in capitals. `audit:voice` checks both ends.
 * ⚠️ **CONSEQUENCE, STATED: staging has no voice worker until one is deployed under its own
 * name**, so a voice call there shows the warming notice rather than connecting. That is the
 * safe failure and it is deliberate; deploy a second agent when a worker change needs testing.
 */
export function voiceAgentName(): string {
  const explicit = process.env.VOICE_AGENT_NAME?.trim();
  if (explicit) return explicit;
  /* ⚠️⚠️ **LOCAL KEEPS THE PRODUCTION NAME, AND THAT IS NOT AN OVERSIGHT — measured, because
     the first version broke local voice entirely.** There is ONE hosted worker on LiveKit
     Cloud and local development is deliberately pointed at it: user memory records "hosted
     worker, always on; prompt ships via git push, only voiceAgent.js needs `lk agent
     deploy`", which is exactly why a laptop can exercise a real call without deploying
     anything. Giving `local` its own name means no worker ever answers and every local call
     sits on the warming notice — a silent regression in the daily loop.
     The hazard this function exists for is a DEPLOYED second service competing in the same
     worker pool, so only `staging` is renamed. */
  return appEnv() === "staging" ? "invoca-voice-staging" : "invoca-voice";
}
