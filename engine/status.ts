/* =============================================================================
   status.ts — what the live deploy currently is
   -----------------------------------------------------------------------------
   Answers one question from OUTSIDE the Google sign-in gate: did the code I
   pushed actually reach the running site? The app is gated, so before this there
   was no way to confirm a deploy without signing in, and every push was a guess.

   Served at GET /api/status by BOTH server.ts (prod) and the Vite dev plugin,
   from this one function so the two can't drift — same reason demoApi.ts is
   transport-agnostic.

   ⚠️ THIS ENDPOINT IS PUBLIC (registered ahead of the auth gate, like /healthz).
   Anything added here is published to anyone who guesses the URL, so it carries:
     • NO customer data — a COUNT of demos, never names, ids or emails
     • NO secrets — integrations are booleans ("is a key configured"), not values
   Build metadata and counts only. Anything that names a customer belongs behind
   the gate.
   ============================================================================= */

import { DATA_DIR, isPersistent, listDemos } from "./demoStore.ts";
import { appEnv } from "./appEnv.ts";

/* Process start, so `uptimeSeconds` and this agree even if the module is loaded
   lazily (the dev server imports it on first request). */
const BOOTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/* EVERY key presence is passed IN, never read from process.env here.

   The first version reached into process.env for the Places and Mapbox keys, and
   reported both as false on the dev server even though .env had them: Vite does
   not put .env into process.env, it exposes it via loadEnv(). A status endpoint
   that under-reports configuration is worse than none, because it sends you
   hunting for a key that was already set. Each caller now supplies these from
   whatever source it actually has. */
export interface StatusInput {
  /** Resolved by the caller, since prod and dev pick the provider the same way. */
  /* Can the DEPLOYED app mint a LiveKit token? A boolean, never the key.
     ⚠️ Without this there was no way to tell from outside the gate whether the live site
     could start a streaming voice call at all — and when it cannot it silently falls back
     to the old 4.5-6s pipeline, which looks like the demo simply being slow. */
  livekitConfigured: boolean;
  anthropicKey: boolean;
  googlePlacesKey: boolean;
  mapboxTokenInServerEnv: boolean;
  authGate: boolean;
  emailConfigured: boolean;
  /* Advanced-settings context sources — see the integrations block below. */
  gongConfigured: boolean;
  slackConfigured: boolean;
  driveConfigured: boolean;
  salesforceConfigured: boolean;
  /* Is Replicate rendering pages in a real browser, or serving the fast copy? A boolean, so
     it stays safe on this PUBLIC endpoint — it names no token and no URL. */
  renderConfigured: boolean;
  /**
   * The alert funnel's own summary (`engine/alerts.ts::alertSummary`).
   *
   * ⚠️⚠️ **PASSED IN, LIKE EVERY OTHER FIELD, AND FOR THE REASON AT THE TOP OF THIS
   * FILE.** `status.ts` reads nothing from `process.env` itself — the first version did
   * and reported two real keys as absent on the dev server, because Vite exposes `.env`
   * through `loadEnv()` rather than `process.env`. Importing `alerts.ts` here would also
   * drag the whole mailer and demo-store graph into a module that exists to be cheap.
   * ⚠️ **COUNTS AND SIGNATURES ONLY.** `alertSummary()` is built for this endpoint and
   * deliberately carries no message text and no context — a detail line can quote a
   * prospect or a URL, and this route is PUBLIC. `audit:alerts` asserts that.
   */
  alerts: unknown;
}

export function deployStatus(input: StatusInput) {
  /* A COUNT, not a list. Wrapped so a broken or unmounted disk reports as an
     error field rather than 500-ing the one endpoint used to diagnose it. */
  let demos: number | null = null;
  let storageError: string | null = null;
  try { demos = listDemos().length; } catch (e) { storageError = (e as Error).message; }

  return {
    ok: true,
    /* Render supplies these free. Null locally, which is itself a useful signal:
       it tells you you are looking at a dev server, not the deploy. */
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    commitShort: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || null,
    branch: process.env.RENDER_GIT_BRANCH ?? null,
    /* ⚠️ WHICH ENVIRONMENT THIS IS — a LABEL, so it is safe on a public endpoint by the same
       rule as `service` and `branch`: it names no prospect, no demo and no key value. It is
       what lets you confirm from outside the gate that a push reached STAGING rather than
       production, which is the whole point of having two. */
    environment: appEnv(),
    /* Whether the nightly full generation is armed here. Two claude.ai routines read
       /api/canary, so knowing which service actually produces that result matters. */
    canaryArmed: (process.env.CANARY ?? "").toLowerCase() === "on" || appEnv() === "production",
    service: process.env.RENDER_SERVICE_NAME ?? null,
    bootedAt: BOOTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    demos,
    storage: { persistent: isPersistent(DATA_DIR), error: storageError },
    /**
     * ⚠️ WHAT HAS BEEN GOING WRONG, AS COUNTS — the half of monitoring that is
     * readable from outside the gate. `needsAttention` on `/api/canary` already
     * answers "did last night's generation break"; this answers "is anything
     * failing right now", without a session and without naming anybody.
     */
    alerts: input.alerts,
    integrations: {
      anthropicKey: input.anthropicKey,
      /* Whether feedback completion emails can send. A BOOLEAN, never the address:
         this endpoint is public, so it reports that a thing is configured, never
         what it is configured to. Lets you confirm SMTP landed after a Render
         restart without signing in or mailing a colleague to find out. */
      emailConfigured: input.emailConfigured,
      googlePlacesKey: input.googlePlacesKey,
      /* The frontend needs the Mapbox token at BUILD time, so its presence in the
         SERVER env does not prove the deployed bundle carries it. Named for what
         it actually measures rather than for what you wish it meant. */
      mapboxTokenInServerEnv: input.mapboxTokenInServerEnv,
      livekitConfigured: input.livekitConfigured,
      /* THE ADVANCED-SETTINGS CONTEXT SOURCES. Booleans, like every other key
         here — "a credential exists", never the credential. The launch form's
         Advanced panel reads these to decide whether to offer a provider or show
         what it still needs, so it can never claim one is available when the
         server cannot actually call it. All three are false until the
         credentials land; see docs/INTEGRATIONS.md. */
      gongConfigured: input.gongConfigured,
      renderConfigured: input.renderConfigured,
      slackConfigured: input.slackConfigured,
      driveConfigured: input.driveConfigured,
      salesforceConfigured: input.salesforceConfigured,
      authGate: input.authGate,
    },
  };
}
