import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/* Dev-only endpoint: POST /api/generate { name, url } runs the same generation
   pipeline as `npm run generate`, writes src/data/generated/<slug>.json, and
   returns the validated profile. This powers the in-app Launch screen. */
function generateApi(apiKey: string | undefined): Plugin {
  const OUT_DIR = path.resolve(process.cwd(), 'src/data/generated')
  return {
    name: 'invoca-generate-api',
    configureServer(server) {
      // Don't let writing a generated file trigger a full page reload mid-demo.
      server.watcher.options = { ...server.watcher.options }
      server.watcher.unwatch(OUT_DIR)

      server.middlewares.use('/api/generate', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        // Stream progress as Server-Sent Events so the Launch screen can show each
        // build phase (start/done) + an overall % while the ~4-min generation runs.
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')  // don't let any proxy buffer the stream
        const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const { name, url } = JSON.parse(raw || '{}')
          if (!name || !url) { sse({ type: 'error', error: 'Both a prospect name and a website URL are required.' }); return res.end() }
          if (!apiKey) { sse({ type: 'error', error: 'ANTHROPIC_API_KEY is not set. Add it to .env or export it before `npm run dev`.' }); return res.end() }

          const { generateProfile, slugify } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/core.ts')).href
          )
          const profile = await generateProfile(name, url, {
            apiKey,
            onProgress: (e: { phase: string; status: 'start' | 'done' }) => sse({ type: 'progress', phase: e.phase, status: e.status }),
          })

          // Send the finished profile to the client FIRST — a disk-write failure must
          // never discard a valid profile the user just waited minutes for (the client
          // adds it to its registry + localStorage regardless of the on-disk cache).
          sse({ type: 'done', profile })
          res.end()
          try {
            fs.mkdirSync(OUT_DIR, { recursive: true })
            fs.writeFileSync(path.join(OUT_DIR, `${slugify(name)}.json`), JSON.stringify(profile, null, 2))
          } catch (writeErr) {
            console.error('[generate] profile delivered but failed to persist to disk:', writeErr)
          }
        } catch (e: any) {
          console.error('[generate] failed:', e)
          sse({ type: 'error', error: e?.message || 'Generation failed.' })
          res.end()
        }
      })
    },
  }
}

/* Dev-only endpoint: POST /api/delete-profile { id } removes a generated
   prospect's src/data/generated/<id>.json so it doesn't reappear on the next
   dev-server start. Seeds have no file (nothing to delete). */
function deleteProfileApi(): Plugin {
  const OUT_DIR = path.resolve(process.cwd(), 'src/data/generated')
  return {
    name: 'invoca-delete-profile-api',
    configureServer(server) {
      server.middlewares.use('/api/delete-profile', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const { id } = JSON.parse(raw || '{}')
          if (!id || !/^[a-z0-9-]+$/.test(id)) return send(400, { error: 'A valid profile id is required.' })
          const file = path.join(OUT_DIR, `${id}.json`)
          if (!file.startsWith(OUT_DIR + path.sep)) return send(400, { error: 'Invalid id.' })  // no traversal
          if (fs.existsSync(file)) { fs.rmSync(file); return send(200, { ok: true, deleted: true }) }
          return send(200, { ok: true, deleted: false })  // seed or already gone
        } catch (e: any) {
          send(500, { error: e?.message || 'Delete failed.' })
        }
      })
    },
  }
}

/* Dev-only endpoint: POST /api/chat { brain, messages, voice? } returns the
   agent's next reply (fast Haiku model). Powers the iPhone "Preview Agent" SMS
   chat and, with voice:true, the live Voice-agent phone call. */
function chatApi(apiKey: string | undefined): Plugin {
  return {
    name: 'invoca-chat-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const { brain, messages, voice } = JSON.parse(raw || '{}')
          if (!brain?.customerName) return send(400, { error: 'brain.customerName is required.' })
          if (!apiKey) return send(500, { error: 'ANTHROPIC_API_KEY is not set. Add it to .env or export it before `npm run dev`.' })

          const { chatReply } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/chat.ts')).href
          )
          const reply = await chatReply(brain, Array.isArray(messages) ? messages : [], apiKey, { voice: !!voice })
          send(200, { reply })
        } catch (e: any) {
          console.error('[chat] failed:', e)
          // "Overloaded" (529) / rate-limit (429) are transient — return a clean,
          // friendly message (never the raw SDK JSON) and a 503 so the client retries.
          const overloaded = e?.status === 529 || e?.status === 429 || /overload/i.test(String(e?.message || ''))
          send(overloaded ? 503 : 500, { error: overloaded ? 'The AI is briefly overloaded — one moment, please resend.' : (e?.message || 'Chat failed.') })
        }
      })
    },
  }
}

/* Dev mount for the shared demo library (/api/me, /api/demos*). Uses the SAME
   handler as the production server (engine/demoApi.ts) so the two can't drift.
   Locally there's no sign-in, so everything is attributed to the "Local Dev"
   identity that googleAuth.currentUser() falls back to. */
/* Resolves a prospect's og:image for the ChatGPT flyout hero. Lazy + cached in
   engine/ogImage.ts, so it adds NOTHING to profile-generation time. Mirrored in
   server.ts — keep the two in sync. */
/* Real business photo/rating for the ChatGPT flyout. Lazy + cached in
   engine/places.ts, so it adds nothing to generation time. Mirrored in
   server.ts — keep the two in sync. Key stays server-side. */
function placeApi(): Plugin {
  return {
    name: 'invoca-place-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!(req.url || '').startsWith('/api/place')) return next()
        res.setHeader('content-type', 'application/json')
        try {
          const q = new URL(req.url!, 'http://x').searchParams
          const { fetchPlace } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/places.ts')).href)
          const env = loadEnv('development', process.cwd(), '')
          const info = await fetchPlace(q.get('name') || '', q.get('city') || undefined,
            env.GOOGLE_PLACES_API_KEY)
          res.end(JSON.stringify({ place: info }))
        } catch {
          res.end(JSON.stringify({ place: null }))
        }
      })
    },
  }
}

function ogImageApi(): Plugin {
  return {
    name: 'invoca-og-image-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!(req.url || '').startsWith('/api/og-image')) return next()
        try {
          const domain = new URL(req.url!, 'http://x').searchParams.get('domain') || ''
          const { fetchOgImage } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/ogImage.ts')).href)
          const url = await fetchOgImage(domain)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ url }))
        } catch {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ url: null }))
        }
      })
    },
  }
}

/* GET /api/status — the same public deploy-status payload the prod server serves,
   from the same module, so the two can't drift. Locally the RENDER_* fields come
   back null, which is exactly how you tell a dev server from the real deploy. */
function statusApi(): Plugin {
  return {
    name: 'invoca-status-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/api/status') return next()
        try {
          const { deployStatus } = await import(pathToFileURL(path.resolve(process.cwd(), 'engine/status.ts')).href)
          const { authEnabled } = await import(pathToFileURL(path.resolve(process.cwd(), 'googleAuth.ts')).href)
          const env = loadEnv('development', process.cwd(), '')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(deployStatus({
            livekitConfigured: !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
            anthropicKey: !!env.ANTHROPIC_API_KEY,
            googlePlacesKey: !!env.GOOGLE_PLACES_API_KEY,
            mapboxTokenInServerEnv: !!env.VITE_MAPBOX_TOKEN,
            emailConfigured: !!(env.SMTP_USER && env.SMTP_APP_PASSWORD),
            authGate: authEnabled,
          })))
        } catch (e: any) {
          console.error('[status] failed:', e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: e?.message || 'status failed' }))
        }
      })
    },
  }
}

/* Dev-side twin of the production feedback mount, so the board and the form work
   against `npm run dev` exactly as they do live. Email is unconfigured locally
   unless SMTP_* is in .env, in which case a would-be send is logged. */
function feedbackApi(): Plugin {
  return {
    name: 'invoca-feedback-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/feedback')) return next()
        try {
          /* Uploads are binary: collect Buffers and concat, never string-concat,
             which would corrupt every byte above 0x7F. */
          const chunks: Buffer[] = []
          if (req.method !== 'GET' && req.method !== 'DELETE') for await (const c of req) chunks.push(Buffer.from(c))
          const rawBuf = Buffer.concat(chunks)
          const isUpload = /\/api\/feedback\/[^/]+\/files/.test(url)
          const [{ handleFeedbackApi }, { currentUser }, { isAdmin }] = await Promise.all([
            import(pathToFileURL(path.resolve(process.cwd(), 'engine/feedbackApi.ts')).href),
            import(pathToFileURL(path.resolve(process.cwd(), 'googleAuth.ts')).href),
            import(pathToFileURL(path.resolve(process.cwd(), 'engine/demoApi.ts')).href),
          ])
          const user = currentUser(req)
          const base = process.env.BASE_URL || 'http://localhost:5173'
          const parsed = isUpload ? rawBuf : (rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : undefined)
          const result = await handleFeedbackApi(req.method || 'GET', url, parsed, user, isAdmin(user), base)
          if (!result) return next()
          if (result.binary) {
            res.statusCode = result.status
            for (const [k, v] of Object.entries(result.binary.headers)) res.setHeader(k, v as string)
            res.end(result.binary.buffer)
            return
          }
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.body))
        } catch (e: any) {
          console.error('[feedback] failed:', e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e?.message || 'Feedback request failed.' }))
        }
      })
    },
  }
}

function demoLibraryApi(): Plugin {
  return {
    name: 'invoca-demo-library-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/me') && !url.startsWith('/api/demos')) return next()
        try {
          let raw = ''
          if (req.method !== 'GET' && req.method !== 'DELETE') for await (const chunk of req) raw += chunk
          const [{ handleDemoApi }, { currentUser }] = await Promise.all([
            import(pathToFileURL(path.resolve(process.cwd(), 'engine/demoApi.ts')).href),
            import(pathToFileURL(path.resolve(process.cwd(), 'googleAuth.ts')).href),
          ])
          const result = await handleDemoApi(req.method || 'GET', url, raw ? JSON.parse(raw) : undefined, currentUser(req))
          if (!result) return next()
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.body))
        } catch (e: any) {
          console.error('[demos] failed:', e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e?.message || 'Demo library request failed.' }))
        }
      })
    },
  }
}

/* Dev-only endpoint: POST /api/ai-assistant { customerName, dashboardTitle,
   dataContext, question, history } → the "Ask AI" dashboard assistant's reply:
   either a text answer about the data, or a generated tile spec (kpi/line/bar/
   pie). Fast Haiku model; key stays server-side. */
function assistantApi(apiKey: string | undefined): Plugin {
  return {
    name: 'invoca-assistant-api',
    configureServer(server) {
      server.middlewares.use('/api/ai-assistant', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const input = JSON.parse(raw || '{}')
          if (!input?.customerName || !input?.question) return send(400, { error: 'customerName and question are required.' })
          if (!apiKey) return send(500, { error: 'ANTHROPIC_API_KEY is not set. Add it to .env or export it before `npm run dev`.' })

          const { askAssistant } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/assistant.ts')).href
          )
          const result = await askAssistant(input, apiKey)
          send(200, { result })
        } catch (e: any) {
          console.error('[ai-assistant] failed:', e)
          const overloaded = e?.status === 529 || e?.status === 429 || /overload/i.test(String(e?.message || ''))
          send(overloaded ? 503 : 500, { error: overloaded ? 'The AI is briefly overloaded — one moment, please resend.' : (e?.message || 'Assistant failed.') })
        }
      })
    },
  }
}

/* Dev-only endpoint: POST /api/analyze { customerName, bookingTerm, customerNoun,
   transcript } → extracted SMS signals (fast Haiku). Powers the live-captured
   conversation's Analysis tab in the AI SMS Conversation Intelligence report. */
function analyzeApi(apiKey: string | undefined): Plugin {
  return {
    name: 'invoca-analyze-api',
    configureServer(server) {
      server.middlewares.use('/api/analyze', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const input = JSON.parse(raw || '{}')
          if (!input?.customerName || !Array.isArray(input?.transcript)) return send(400, { error: 'customerName and transcript are required.' })
          if (!apiKey) return send(500, { error: 'ANTHROPIC_API_KEY is not set.' })

          const { analyzeSms } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/analyze.ts')).href
          )
          const { signals, outcome } = await analyzeSms(input, apiKey)
          /* `outcome` is voice-only and absent for SMS; the client ignores what it does not use. */
          send(200, { signals, outcome })
        } catch (e: any) {
          console.error('[analyze] failed:', e)
          send(500, { error: e?.message || 'Analyze failed.' })
        }
      })
    },
  }
}

/* Dev endpoint: POST /api/livekit-token { brain, profileId, greeting?, voice? } →
   { url, token, room } for the LiveKit voice call. The API SECRET never leaves the
   server; the browser only ever gets a 10-minute join token. Answers 501 when
   LiveKit is not configured, so the client can fall back to the old pipeline
   instead of failing mid-demo. */
function livekitApi(env: Record<string, string>): Plugin {
  return {
    name: 'invoca-livekit-api',
    configureServer(server) {
      server.middlewares.use('/api/livekit-token', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const mod = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/livekitToken.ts')).href
          )
          const cfg = mod.livekitEnv(env)
          if (!cfg) return send(501, { error: 'LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to .env.' })

          /* ⚠️ CONFIG BEFORE BODY — see the note in server.ts. The readiness probe sends an
             empty body, so validating `brain` first makes an unconfigured server answer 400,
             which the client reads as "LiveKit is available" and the fallback never engages. */
          const { brain, profileId, greeting, voice } = JSON.parse(raw || '{}')
          if (!brain) return send(400, { error: 'brain is required.' })
          send(200, await mod.mintVoiceToken({ brain, profileId: profileId || 'demo', greeting, voice }, cfg))
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}

/* Dev endpoint: POST /api/voice-preview { voice, text } → audio/wav, synthesized through
   LiveKit Inference on LiveKit credentials. Twin of the handler in server.ts.

   ⚠️ This REPLACED /api/tts, which called api.deepgram.com / api.elevenlabs.io directly with
   those vendors' own keys. Everything voice now goes through LiveKit; see engine/voicePreview.ts. */
function voicePreviewApi(cfg: { url?: string; apiKey?: string; apiSecret?: string }): Plugin {
  return {
    name: 'invoca-voice-preview-api',
    configureServer(server) {
      server.middlewares.use('/api/voice-preview', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const sendErr = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          if (!cfg.apiKey || !cfg.apiSecret) return sendErr(501, { error: 'LiveKit is not configured. Add LIVEKIT_API_KEY and LIVEKIT_API_SECRET to .env.' })
          let raw = ''
          for await (const chunk of req) raw += chunk
          const { voice, text } = JSON.parse(raw || '{}')
          const mod = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/voicePreview.ts')).href
          )
          const wav = await mod.synthesizePreview(
            { voice: String(voice ?? ''), text: String(text ?? '') },
            { url: cfg.url, apiKey: cfg.apiKey, apiSecret: cfg.apiSecret },
          )
          res.statusCode = 200
          res.setHeader('Content-Type', 'audio/wav')
          res.setHeader('Cache-Control', 'no-store')
          res.end(Buffer.from(wav))
        } catch (e: any) {
          console.error('[voice-preview] failed:', e)
          sendErr(400, { error: e?.message || 'Preview failed.' })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /* PUT .env ON process.env FOR THE DEV SERVER.

     loadEnv() returns an object; it does NOT populate process.env. The API plugins
     below are handed the values they need explicitly, but the ENGINE modules they
     dynamically import read process.env directly (DEMO_ADMIN_EMAILS in demoApi,
     SMTP_* in mailer, DATA_DIR in demoStore). Under `npm run dev` those were always
     empty, so an admin-only feature was invisible locally and a completion email
     would never have sent no matter what .env said — both failing silently, which is
     the worst way for configuration to be wrong.

     A real shell variable still wins, so `FOO=1 npm run dev` overrides .env. */
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = v
  }
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  return {
    plugins: [
      react(),
      generateApi(apiKey),
      deleteProfileApi(),
      placeApi(),
      ogImageApi(),
      demoLibraryApi(),
    feedbackApi(),
      statusApi(),
      chatApi(apiKey),
      assistantApi(apiKey),
      analyzeApi(apiKey),
      voicePreviewApi({ url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET }),
      livekitApi(env),
    ],
  }
})
