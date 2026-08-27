# Deploying the voice agent worker to LiveKit Cloud

**Why this matters:** production already has `LIVEKIT_*` set, so the live site uses the LiveKit
engine and dispatches an agent named `invoca-voice`. Until a HOSTED worker exists, the only
worker registered to the project is whatever is running on a laptop — so closing it takes voice
down for every SE, and the fallback engine is no longer reachable because the server correctly
reports LiveKit as available.

## Once, on your machine

```bash
brew install livekit-cli          # or: curl -sSL https://get.livekit.io/cli | bash
lk cloud auth                     # opens a browser; pick the invoca-custom-project-tk9impi1 project
```

## Create the agent

```bash
cd agent
printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" > secrets.env   # git-ignored
lk agent create --secrets-file=secrets.env
rm secrets.env
```

`create` uploads the build context, builds the image, and writes the assigned deployment `id`
into `livekit.toml` — commit that change.

⚠️ **Only `ANTHROPIC_API_KEY` goes in the secrets file.** LiveKit injects `LIVEKIT_URL`,
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` itself, and the CLI deliberately skips them.
STT and TTS come from LiveKit's inference gateway, so no Deepgram key is needed either.

## Afterwards

```bash
lk agent deploy            # ship a code change
lk agent status            # is it up
lk agent logs              # what it is doing
lk agent secrets           # list (names only)
lk agent update-secrets --secrets-file=new.env   # rotate; add --overwrite to replace all
```

## How to know it worked

The agent name is what a token dispatches by, so this is the thing to confirm:

1. `lk agent status` shows the deployment running.
2. On the live site, open a voice workflow and click **Start Call**. The agent should speak
   within a couple of seconds.
3. If it stays silent for 10s the call screen says *"No voice agent joined this call"* — that
   message means the room was created and nothing answered, i.e. the worker is not registered
   under `invoca-voice`.

Then stop the laptop worker and confirm calls still work — that is the actual proof the hosted
one is serving, since both register to the same project and either can answer.

## The contract the CLI cannot check

`WorkerOptions({ agentName })` in `voiceAgent.js` must equal `AGENT_NAME` in
`engine/livekitToken.ts`. A mismatch means no agent ever joins and there is no error anywhere.
`npm run audit:voice` checks it, along with the image requirements LiveKit imposes (non-root,
`start` not `dev`, glibc base, no baked-in credentials).
