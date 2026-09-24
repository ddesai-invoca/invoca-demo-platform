/* =============================================================================
   integrations.ts — is a context provider actually usable by THIS server?
   -----------------------------------------------------------------------------
   The Advanced Settings panel offers Gong / Slack / Drive as context sources for
   a generation. Whether each is available is a property of the SERVER's
   environment, not of the browser, so it is decided here and reported through
   /api/status as booleans.

   ⚠️⚠️ AN ASSISTANT'S CONNECTORS ARE NOT THIS SERVER'S CREDENTIALS, and that
   distinction is the whole reason this file exists. A Claude session can hold
   Gong, Slack and Drive connectors authenticated as the person chatting — none
   of which the deployed app can reach. The app needs its own credential per
   provider, and until it has one the honest answer is `false`.

   ⚠️ THREE DIFFERENT AUTH MODELS, deliberately not unified:
     • GONG is a SERVICE credential (access key + secret from Gong admin). One
       setup, and every SE's generation benefits — nobody consents to anything.
     • DRIVE is PER-USER OAuth. Strategy docs live in individual Drives, so the
       app must read as the SE, not as a service account. It reuses the Google
       client that already powers sign-in, the same way /auth/gmail does.
     • SLACK needs a workspace app with search scopes, which is an approval, not
       a variable — this project already has a declined request on record saying
       exactly that.
   docs/INTEGRATIONS.md carries what to obtain for each.
   ============================================================================= */

/** Gong: one service credential covering everyone. */
export const gongConfigured = (): boolean =>
  !!(process.env.GONG_ACCESS_KEY && process.env.GONG_SECRET);

/** Salesforce: a SERVICE credential (client-credentials on a Connected App), so
 *  one setup covers every SE — the same shape as Gong, and for the same reason:
 *  an account owner is not personal data living in somebody's own Drive.
 *  ⚠️ Re-exported from `salesforceApi` rather than re-tested here, or the flag
 *  `/api/status` publishes could say "connected" while the lookup disagrees. */
export { salesforceConfigured } from "./salesforceApi.ts";

/** Slack: a workspace app token. */
export const slackConfigured = (): boolean => !!process.env.SLACK_BOT_TOKEN;

/** Drive: per-user OAuth on the EXISTING Google client, so the client id and
 *  secret are already present when sign-in works — what is missing is the
 *  granted scope, which is why this needs its own flag rather than reusing the
 *  auth-gate boolean. */
export const driveConfigured = (): boolean =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_DRIVE_ENABLED === "1");
