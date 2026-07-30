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
  ttsProvider: "deepgram" | "elevenlabs";
  ttsKey: boolean;
  anthropicKey: boolean;
  googlePlacesKey: boolean;
  mapboxTokenInServerEnv: boolean;
  authGate: boolean;
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
    service: process.env.RENDER_SERVICE_NAME ?? null,
    bootedAt: BOOTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    demos,
    storage: { persistent: isPersistent(DATA_DIR), error: storageError },
    integrations: {
      anthropicKey: input.anthropicKey,
      googlePlacesKey: input.googlePlacesKey,
      /* The frontend needs the Mapbox token at BUILD time, so its presence in the
         SERVER env does not prove the deployed bundle carries it. Named for what
         it actually measures rather than for what you wish it meant. */
      mapboxTokenInServerEnv: input.mapboxTokenInServerEnv,
      ttsProvider: input.ttsProvider,
      ttsKey: input.ttsKey,
      authGate: input.authGate,
    },
  };
}
