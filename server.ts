/* =============================================================================
   server.ts — PRODUCTION server (serves the built app + the live /api backend)
   -----------------------------------------------------------------------------
   In dev, the /api/* endpoints live inside the Vite dev server (vite.config.ts,
   `configureServer`). Those DO NOT exist in a static `vite build` output — so a
   plain static host (SFTP-only shared hosting) can serve the UI but every live-AI
   feature dies. This file is the production equivalent: a small Node/Express
   server that serves `dist/` AND re-implements the same six endpoints, calling
   the SAME engine modules, with the API keys read from the server environment
   (never shipped to the browser).

   Run it on any host that can execute Node (a VPS, or a Node platform like
   Render/Railway/Fly). It is NOT usable on static-file-only hosting.

     npm run build       # produce dist/
     npm start           # node --env-file-if-exists=.env --import tsx server.ts

   The handlers here MIRROR vite.config.ts — keep the two in sync if you change
   request/response shapes. Same Node-cache caveat as dev: restart after editing
   engine/*.ts.
   ============================================================================= */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateProfile, slugify } from "./engine/core.ts";
import { chatReply } from "./engine/chat.ts";
import { analyzeSms } from "./engine/analyze.ts";
import { synthesize } from "./engine/tts.ts";
import { askAssistant } from "./engine/assistant.ts";
import { installAuth, authEnabled, currentUser } from "./googleAuth.ts";
import { handleDemoApi, isAdmin } from "./engine/demoApi.ts";
import { handleFeedbackApi } from "./engine/feedbackApi.ts";
import { mailConfigured } from "./engine/mailer.ts";
import { DATA_DIR, isPersistent } from "./engine/demoStore.ts";
import { deployStatus } from "./engine/status.ts";
import { runCanary, recordRun, toPublic as canaryPublic, BUDGET_SECONDS } from "./engine/canary.ts";
import { migrateDemoDashes } from "./engine/dashSweep.ts";
import { applyDemoPatches } from "./engine/demoPatches.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const OUT_DIR = path.join(ROOT, "src/data/generated");
const PORT = Number(process.env.PORT) || 3000;

const apiKey = process.env.ANTHROPIC_API_KEY;

// TTS provider resolution — mirrors vite.config.ts.
const deepgramKey = process.env.DEEPGRAM_API_KEY;
const deepgramModel = process.env.DEEPGRAM_MODEL;
const elevenKey = process.env.ELEVENLABS_API_KEY;
const elevenVoice = process.env.ELEVENLABS_VOICE_ID;
const elevenModel = process.env.ELEVENLABS_MODEL_ID;
const providerRaw = (process.env.TTS_PROVIDER || "").toLowerCase();
const ttsProvider: "deepgram" | "elevenlabs" =
  providerRaw === "elevenlabs" || providerRaw === "deepgram" ? (providerRaw as any) : deepgramKey ? "deepgram" : "elevenlabs";

const app = express();
/* Attachment uploads are RAW BYTES, so their parser is registered before the JSON
   one: express.json would otherwise reject a PNG as malformed JSON. Scoped to the
   upload path only, and capped, so nothing else changes. */
app.use("/api/feedback/:id/files", express.raw({ type: "*/*", limit: "12mb" }));
app.use(express.json({ limit: "2mb" }));

/* Health check for the host (Render etc.) — exempt from auth.
   503 once we are DRAINING, so the host stops routing new requests at us while the
   in-flight ones finish. See the shutdown handler at the bottom of this file. */
let draining = false;
app.get("/healthz", (_req, res) =>
  draining ? res.status(503).type("text").send("draining") : res.type("text").send("ok"));

/* PUBLIC DEPLOY STATUS — "did my push actually reach the live site?"

   Registered BEFORE installAuth so it answers without a session, exactly like
   /healthz. That is the point: the app is behind a Google gate, so there was no
   way to confirm from outside that a deploy landed. The payload deliberately
   carries no customer data and no secrets — see engine/status.ts. */
app.get("/api/status", (_req, res) => res.json(deployStatus({
  ttsProvider,
  ttsKey: ttsProvider === "deepgram" ? !!deepgramKey : !!elevenKey,
  anthropicKey: !!apiKey,
  googlePlacesKey: !!process.env.GOOGLE_PLACES_API_KEY,
  mapboxTokenInServerEnv: !!process.env.VITE_MAPBOX_TOKEN,
  authGate: authEnabled,
  emailConfigured: mailConfigured(),
})));

/* PUBLIC NIGHTLY CANARY RESULT — timings + audit for the last generation run.

   Registered BEFORE installAuth for the same reason /api/status is: the point is
   to be readable without a session. That is what lets the scheduled cloud agent
   react to a regression WITHOUT being handed any credential — the alternative
   would have been a shared secret pasted into a routine prompt.

   ⚠️ PUBLIC. engine/canary.ts::toPublic() decides what is safe to expose, and it
   deliberately omits the target company names and URLs. Do not add them here. */
app.get("/api/canary", (_req, res) => res.json(canaryPublic()));

installAuth(app);

/* Feedback and feature requests (/api/feedback*). Registered BEFORE the demo
   library only because both return null for a path they do not own; the order
   between them is arbitrary. Behind the auth gate, so `currentUser` is a real
   person and the completion email has somewhere honest to go. */
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/feedback")) return next();
  try {
    const user = currentUser(req);
    const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const result = await handleFeedbackApi(req.method, req.originalUrl, req.body, user, isAdmin(user), base);
    if (!result) return next();
    if (result.binary) {
      res.status(result.status).set(result.binary.headers).send(result.binary.buffer);
      return;
    }
    res.status(result.status).json(result.body);
  } catch (e: any) {
    console.error("[feedback] failed:", e);
    res.status(500).json({ error: e?.message || "Feedback request failed." });
  }
});

/* Shared demo library (/api/me, /api/demos*). Returns null for any other route,
   so the AI endpoints below still get their turn. Same handler as the dev server. */
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  try {
    const result = await handleDemoApi(req.method, req.path, req.body, currentUser(req));
    if (!result) return next();
    res.status(result.status).json(result.body);
  } catch (e: any) {
    console.error("[demos] failed:", e);
    res.status(500).json({ error: e?.message || "Demo library request failed." });
  }
});

const isOverloaded = (e: any) => e?.status === 529 || e?.status === 429 || /overload/i.test(String(e?.message || ""));

/* POST /api/generate → SSE stream of progress, then the finished profile. */
app.post("/api/generate", async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const { name, url } = req.body || {};
    if (!name || !url) { sse({ type: "error", error: "Both a prospect name and a website URL are required." }); return res.end(); }
    if (!apiKey) { sse({ type: "error", error: "ANTHROPIC_API_KEY is not set on the server." }); return res.end(); }
    const profile = await generateProfile(name, url, {
      apiKey,
      onProgress: (e: { phase: string; status: "start" | "done" }) => sse({ type: "progress", phase: e.phase, status: e.status }),
    });
    sse({ type: "done", profile });
    res.end();
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${slugify(name)}.json`), JSON.stringify(profile, null, 2));
    } catch (writeErr) {
      console.error("[generate] profile delivered but failed to persist to disk:", writeErr);
    }
  } catch (e: any) {
    console.error("[generate] failed:", e);
    sse({ type: "error", error: e?.message || "Generation failed." });
    res.end();
  }
});

/* POST /api/chat → the live SMS/Voice agent's next reply. */
app.post("/api/chat", async (req, res) => {
  try {
    const { brain, messages, voice } = req.body || {};
    if (!brain?.customerName) return res.status(400).json({ error: "brain.customerName is required." });
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
    const reply = await chatReply(brain, Array.isArray(messages) ? messages : [], apiKey, { voice: !!voice });
    res.json({ reply });
  } catch (e: any) {
    console.error("[chat] failed:", e);
    res.status(isOverloaded(e) ? 503 : 500).json({ error: isOverloaded(e) ? "The AI is briefly overloaded — one moment, please resend." : e?.message || "Chat failed." });
  }
});

/* POST /api/ai-assistant → the dashboard "Ask AI" answer / tile / edit. */
app.post("/api/ai-assistant", async (req, res) => {
  try {
    const input = req.body || {};
    if (!input?.customerName || !input?.question) return res.status(400).json({ error: "customerName and question are required." });
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
    const result = await askAssistant(input, apiKey);
    res.json({ result });
  } catch (e: any) {
    console.error("[ai-assistant] failed:", e);
    res.status(isOverloaded(e) ? 503 : 500).json({ error: isOverloaded(e) ? "The AI is briefly overloaded — one moment, please resend." : e?.message || "Assistant failed." });
  }
});

/* POST /api/analyze → fast signal extraction for a captured conversation. */
app.post("/api/analyze", async (req, res) => {
  try {
    const input = req.body || {};
    if (!input?.customerName || !Array.isArray(input?.transcript)) return res.status(400).json({ error: "customerName and transcript are required." });
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
    const signals = await analyzeSms(input, apiKey);
    res.json({ signals });
  } catch (e: any) {
    console.error("[analyze] failed:", e);
    res.status(500).json({ error: e?.message || "Analyze failed." });
  }
});

/* POST /api/tts → audio/mpeg from Deepgram or ElevenLabs (key server-side). */
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceId } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required." });
    let audio: Uint8Array;
    if (ttsProvider === "deepgram") {
      if (!deepgramKey) return res.status(501).json({ error: "DEEPGRAM_API_KEY is not set on the server." });
      audio = await synthesize({ text, provider: "deepgram", deepgram: { apiKey: deepgramKey, model: deepgramModel } });
    } else {
      if (!elevenKey) return res.status(501).json({ error: "ELEVENLABS_API_KEY is not set on the server." });
      audio = await synthesize({ text, provider: "elevenlabs", elevenlabs: { apiKey: elevenKey, voiceId: voiceId || elevenVoice, modelId: elevenModel } });
    }
    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(audio));
  } catch (e: any) {
    console.error("[tts] failed:", e);
    res.status(500).json({ error: e?.message || "TTS failed." });
  }
});

/* POST /api/delete-profile → remove a generated prospect's on-disk JSON. */
/* Mirrors the placeApi() plugin in vite.config.ts — keep the two in sync. */
app.get("/api/place", async (req, res) => {
  try {
    const { fetchPlace } = await import("./engine/places.ts");
    res.json({
      place: await fetchPlace(String(req.query.name ?? ""), String(req.query.city ?? "")),
    });
  } catch {
    res.json({ place: null });
  }
});

/* Mirrors the ogImageApi() plugin in vite.config.ts — keep the two in sync. */
app.get("/api/og-image", async (req, res) => {
  try {
    const { fetchOgImage } = await import("./engine/ogImage.ts");
    res.json({ url: await fetchOgImage(String(req.query.domain ?? "")) });
  } catch {
    res.json({ url: null });
  }
});

app.post("/api/delete-profile", (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id || !/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: "A valid profile id is required." });
    const file = path.join(OUT_DIR, `${id}.json`);
    if (!file.startsWith(OUT_DIR + path.sep)) return res.status(400).json({ error: "Invalid id." });
    if (fs.existsSync(file)) { fs.rmSync(file); return res.json({ ok: true, deleted: true }); }
    return res.json({ ok: true, deleted: false });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Delete failed." });
  }
});

// Static built app + SPA deep-link fallback (so /dashboards/marketing etc. work).
app.use(express.static(DIST));
app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

const server = app.listen(PORT, () => {
  console.log(`Invoca demo running on http://localhost:${PORT}`);
  console.log(authEnabled ? "🔒 Google sign-in gate is ON (restricted by email domain)." : "🔓 Auth gate OFF — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET to require sign-in.");
  console.log(`📁 Demo library: ${DATA_DIR}${isPersistent(DATA_DIR) ? "" : "  (⚠ not a persistent disk — demos are lost on redeploy)"}`);
  /* One-time content migration. PATCH is creator-only, so a user sweeping from
     their browser cannot fix a teammate's demo; the server can. Guarded by a
     marker file, so this is a no-op on every boot after the first. */
  migrateDemoDashes(DATA_DIR);
  /* Agreed one-off content patches (engine/migrations/*.json). Server-side for
     the same reason as the sweep: PATCH is creator-only, so a demo owned by
     someone else cannot be updated from the browser. Content only, never
     ownership. */
  applyDemoPatches(DATA_DIR);
  if (!apiKey) console.warn("⚠  ANTHROPIC_API_KEY not set — the AI features will return errors. Set it in the server environment (.env or host config).");
  scheduleCanary();
});

/* ---- graceful shutdown -----------------------------------------------------
   Render stops an instance by sending SIGTERM and waiting before SIGKILL. With no
   handler, the default SIGTERM behaviour kills the process immediately and every
   in-flight request dies with it — a generation stream, a PATCH being saved, an
   artifact being fetched — which is the sharp edge of a deploy for anyone actually
   using the site at that moment.

   ⚠️ THIS DOES NOT SHORTEN THE DEPLOY WINDOW and is not meant to. The window exists
   because a Render disk attaches to one instance at a time (see CLAUDE.md TODO 0);
   this only makes the START of the window clean instead of abrupt.

   `closeIdleConnections()` matters: `server.close()` alone waits for keep-alive
   sockets that are sitting idle between requests, so a browser with an open
   connection and nothing in flight would hold the drain open for the full timeout.
   Idle sockets are dropped at once; only real in-flight requests hold us. */
const DRAIN_TIMEOUT_MS = Number(process.env.DRAIN_TIMEOUT_MS ?? 10_000);

function shutdown(signal: string): void {
  if (draining) return;                       // SIGTERM then SIGINT must not double-run
  draining = true;
  console.log(`↩  ${signal} — draining (health check now 503, ${DRAIN_TIMEOUT_MS}ms budget).`);
  server.closeIdleConnections?.();
  server.close(() => {
    console.log("✓  in-flight requests finished — exiting cleanly.");
    process.exit(0);
  });
  /* A request that never ends (an open SSE generation stream) must not hold the
     process past the host's patience, or SIGKILL lands anyway and we gained nothing. */
  setTimeout(() => {
    console.warn("⚠  drain timed out — forcing exit.");
    process.exit(0);
  }, DRAIN_TIMEOUT_MS).unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ---- the nightly canary ----------------------------------------------------
   Runs one full generation at ~2am Eastern, times it, audits it, and throws the
   profile away (engine/canary.ts). It lives IN THE WEB PROCESS because this is
   the only place ANTHROPIC_API_KEY already exists — no extra Render service, no
   endpoint that bypasses the sign-in gate, and no secret handed to a cloud agent.

   Why a 10-minute tick rather than a cron expression: the target is 2am EASTERN,
   and Eastern is UTC-4 or UTC-5 depending on the season, so a fixed UTC cron
   would drift by an hour twice a year. Asking the clock what hour it is in
   America/New_York is DST-correct by construction. The ET DATE is the run key, so
   the "did I already run today" check can't fire twice within one 2am hour.

   ⚠️ Every failure path is swallowed. A canary that can take down the web service
   the whole team demos on is far worse than no canary. */
function scheduleCanary(): void {
  if ((process.env.CANARY ?? "").toLowerCase() === "off") {
    console.log("🐤 Nightly canary disabled (CANARY=off).");
    return;
  }
  if (!apiKey) {
    console.log("🐤 Nightly canary not armed — no ANTHROPIC_API_KEY.");
    return;
  }
  /* 5am Eastern. Override with CANARY_HOUR_ET. ⚠️ The two claude.ai routines that
     read /api/canary are scheduled to fire AFTER this (6:00 and 6:30 ET); moving
     this hour without moving them means they report on the PREVIOUS night's run
     and a real failure goes unnoticed for a day. */
  const HOUR = Number(process.env.CANARY_HOUR_ET ?? 5);
  const TICK_MS = 10 * 60 * 1000;
  let running = false;
  let lastRunDate = "";                     // ET calendar date of the last run

  const etParts = () => {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
  };

  const tick = async () => {
    try {
      const { date, hour } = etParts();
      if (running || hour !== HOUR || date === lastRunDate) return;
      running = true;
      lastRunDate = date;                    // claim the slot BEFORE the await
      console.log(`🐤 Canary starting (${date} ~${HOUR}:00 ET)…`);
      const run = await runCanary(apiKey);
      recordRun(run);
      const verdict = !run.ok ? `FAILED: ${run.error}`
        : run.overBudget ? `OVER BUDGET ${run.totalSeconds}s > ${BUDGET_SECONDS}s`
        : run.audit.failures.length ? `${run.audit.failures.length} audit failure(s) in ${run.totalSeconds}s`
        : `ok ${run.totalSeconds}s`;
      console.log(`🐤 Canary done — ${verdict} (slowest: ${run.slowestPhase})`);
    } catch (e) {
      console.error("🐤 Canary tick failed (ignored):", e);
    } finally {
      running = false;
    }
  };

  setInterval(tick, TICK_MS).unref?.();
  console.log(`🐤 Nightly canary armed for ~${HOUR}:00 America/New_York (budget ${BUDGET_SECONDS}s).`);
  /* Opt-in immediate run, for verifying the wiring without waiting for 2am. */
  if ((process.env.CANARY_ON_BOOT ?? "") === "1") {
    console.log("🐤 CANARY_ON_BOOT=1 — running once now.");
    (async () => {
      try {
        const run = await runCanary(apiKey);
        recordRun(run);
        console.log(`🐤 Boot canary: ok=${run.ok} total=${run.totalSeconds}s audit_failures=${run.audit.failures.length}`);
      } catch (e) { console.error("🐤 Boot canary failed (ignored):", e); }
    })();
  }
}
