# invoca-voice-agent

The LiveKit worker behind the live Voice-agent demo. Runs as its own process, and on Render
as its own **Background Worker** service — it is not part of the web app.

## Running it

```bash
cd agent
npm run dev     # LOCAL — use this one
npm start       # PRODUCTION / Render
```

⚠️ **USE `npm run dev` LOCALLY.** The framework picks its health port by mode: `start` binds a
FIXED **8081**, `dev` binds an ephemeral one. So a worker that is still running — or a job
child orphaned by an earlier `kill` of only the parent — makes the next `npm start` die with a
raw `EADDRINUSE` stack trace that says nothing about agents, and the orphan then throws `EPIPE`
when its parent disappears. `npm run dev` cannot collide, and it logs more while iterating.

If you do hit it, the leftovers are the parent plus one child per job:

```bash
lsof -nP -iTCP:8081 -sTCP:LISTEN     # who holds the port
pkill -f voiceAgent.js               # parent
pkill -f job_proc_lazy_main          # job children — killing the parent does NOT take these
```

## What it needs

`../.env` (both scripts read it) or real environment variables on Render:

| variable | why |
|---|---|
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | register the worker, and pay for STT + TTS through the gateway |
| `ANTHROPIC_API_KEY` | the brain — LiveKit's inference gateway has no Anthropic model, so Claude is reached directly |

**No provider keys of its own.** Speech in and speech out are brokered by LiveKit, so there is
deliberately no `DEEPGRAM_API_KEY` here.

Optional overrides: `VOICE_LLM_MODEL`, `VOICE_STT_MODEL`, `VOICE_TTS_MODEL`.

## What it does

Registers under the agent name `invoca-voice` and waits. Every call, `/api/livekit-token`
(in the web app) mints a token that dispatches this worker into a brand-new room and hands it
the finished system prompt as job metadata. The worker never builds a prompt — see the header
of `voiceAgent.js`.
