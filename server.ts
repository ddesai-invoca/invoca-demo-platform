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
import { installAuth, authEnabled } from "./googleAuth.ts";

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
app.use(express.json({ limit: "2mb" }));

// Health check for the host (Render etc.) — exempt from auth, always 200.
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// Google sign-in gate (@invoca.com only) — must run before the API + static
// routes. No-op unless GOOGLE_CLIENT_ID/SECRET are set (so local runs stay open).
installAuth(app);

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

app.listen(PORT, () => {
  console.log(`Invoca demo running on http://localhost:${PORT}`);
  console.log(authEnabled ? "🔒 Google sign-in gate is ON (restricted by email domain)." : "🔓 Auth gate OFF — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET to require sign-in.");
  if (!apiKey) console.warn("⚠  ANTHROPIC_API_KEY not set — the AI features will return errors. Set it in the server environment (.env or host config).");
});
