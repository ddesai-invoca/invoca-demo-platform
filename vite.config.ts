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
          const signals = await analyzeSms(input, apiKey)
          send(200, { signals })
        } catch (e: any) {
          console.error('[analyze] failed:', e)
          send(500, { error: e?.message || 'Analyze failed.' })
        }
      })
    },
  }
}

/* Dev-only endpoint: POST /api/tts { text, voiceId? } → MP3 audio (audio/mpeg)
   from the configured provider (Deepgram Aura or ElevenLabs; key server-side).
   Powers the premium human voice on the live Voice-agent call. Returns a JSON
   error (with a clear message) when the key is missing/errors, so VoiceCall.tsx
   falls back to the browser voice. */
interface TtsSettings {
  provider: 'deepgram' | 'elevenlabs'
  deepgramKey?: string; deepgramModel?: string
  elevenKey?: string; elevenVoice?: string; elevenModel?: string
}
function ttsApi(cfg: TtsSettings): Plugin {
  return {
    name: 'invoca-tts-api',
    configureServer(server) {
      server.middlewares.use('/api/tts', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const sendErr = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const { text, voiceId: reqVoice } = JSON.parse(raw || '{}')
          if (!text || !String(text).trim()) return sendErr(400, { error: 'text is required.' })

          const { synthesize } = await import(
            pathToFileURL(path.resolve(process.cwd(), 'engine/tts.ts')).href
          )
          let audio: Uint8Array
          if (cfg.provider === 'deepgram') {
            if (!cfg.deepgramKey) return sendErr(501, { error: 'DEEPGRAM_API_KEY is not set. Add it to .env to enable the Deepgram voice.' })
            audio = await synthesize({ text, provider: 'deepgram', deepgram: { apiKey: cfg.deepgramKey, model: cfg.deepgramModel } })
          } else {
            if (!cfg.elevenKey) return sendErr(501, { error: 'ELEVENLABS_API_KEY is not set. Add it to .env to enable the premium voice.' })
            audio = await synthesize({ text, provider: 'elevenlabs', elevenlabs: { apiKey: cfg.elevenKey, voiceId: reqVoice || cfg.elevenVoice, modelId: cfg.elevenModel } })
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'audio/mpeg')
          res.setHeader('Cache-Control', 'no-store')
          res.end(Buffer.from(audio))
        } catch (e: any) {
          console.error('[tts] failed:', e)
          sendErr(500, { error: e?.message || 'TTS failed.' })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  const deepgramKey = env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY
  const deepgramModel = env.DEEPGRAM_MODEL || process.env.DEEPGRAM_MODEL
  const elevenKey = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY
  const elevenVoice = env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID
  const elevenModel = env.ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID
  // Provider: explicit TTS_PROVIDER wins; otherwise auto — Deepgram if its key is
  // set, else ElevenLabs.
  const providerRaw = (env.TTS_PROVIDER || process.env.TTS_PROVIDER || '').toLowerCase()
  const provider: TtsSettings['provider'] =
    providerRaw === 'elevenlabs' || providerRaw === 'deepgram'
      ? providerRaw
      : (deepgramKey ? 'deepgram' : 'elevenlabs')
  return {
    plugins: [
      react(),
      generateApi(apiKey),
      deleteProfileApi(),
      chatApi(apiKey),
      assistantApi(apiKey),
      analyzeApi(apiKey),
      ttsApi({ provider, deepgramKey, deepgramModel, elevenKey, elevenVoice, elevenModel }),
    ],
  }
})
