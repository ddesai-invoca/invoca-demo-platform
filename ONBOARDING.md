# Invoca Demo Platform — team sandbox setup

Welcome. This gets the demo platform running on your laptop so you can build and
change demos.

We all work in **one shared sandbox**:
<https://github.com/ddesai-invoca/invoca-demo-platform-testing>

It's a full copy of the production platform, so you can break things without
consequence. Don't work in `invoca-demo-platform` — that one is live and
auto-deploys to the real site.

Dhruv will send you the API keys you need (step 3) and runs the shared Render
deployment, so there's nothing to set up beyond your own machine.

---

## 1. Install Node 22

The app needs Node 22 or newer. Check what you have:

```bash
node -v
```

If it prints `v22.` or higher, skip to step 2. Otherwise **let Claude Code do
it** — open Claude Code and paste:

> Check whether I have Node 22 or newer. If not, install it — use Homebrew if I
> have it, otherwise install nvm and use that. Then confirm `node -v` and
> `npm -v` both work.

It'll pick the right approach for your machine and ask before installing
anything. If you'd rather do it yourself:

```bash
brew install node@22          # macOS with Homebrew
```

or grab the LTS installer from [nodejs.org](https://nodejs.org).

---

## 2. Get it running

In Claude Code, paste this:

> Clone https://github.com/ddesai-invoca/invoca-demo-platform-testing into my
> code folder, run npm install, and then stop — I need to add a .env before
> starting the server.

Or in a terminal:

```bash
git clone https://github.com/ddesai-invoca/invoca-demo-platform-testing.git
cd invoca-demo-platform-testing
npm install
```

You only clone once. After that it lives on your laptop and you pull and push
to keep in sync with everyone else.

---

## 3. Add your keys

Dhruv will send you the values. Create the file:

```bash
cp .env.example .env
```

Open `.env` and paste in what he sent. The only one that's strictly required is
`ANTHROPIC_API_KEY` — everything else is optional and the app degrades
gracefully without it (voice says "not configured", the map uses plain tiles).

**Never commit `.env`.** It's already in `.gitignore` — leave it that way. If
you're ever unsure whether something is safe to commit, ask Claude Code before
you push.

One thing to know: **Anthropic credits are shared across the whole account.**
Generating a prospect burns a meaningful chunk of tokens — browsing existing
demos costs nothing. If generation suddenly fails with "credit balance is too
low", that's the shared balance, not your key. Tell Dhruv rather than swapping
in a different key.

---

## 4. Start it

```bash
npm run dev
```

Open <http://localhost:5173>. That serves the app *and* its backend API — it's
not a static site, so don't open the HTML file directly.

There's no login locally. The Google sign-in only applies to the deployed site.

---

## 5. Making changes

Make your change, check it works at localhost:5173, then in Claude Code type:

```
/ship
```

That's the whole workflow. It's a command that lives in the repo, so it's the
same for everyone and you don't have to remember any of it. Claude Code will:

1. show you what changed, and flag anything you didn't expect
2. pull the latest and put you on a branch (never straight to `main` — we share
   this sandbox, and `main` deploys to the shared site)
3. stage your files **by name**, checking nothing secret is going with them
4. run `npm run audit` — the type check plus the full audit suite
5. write a real commit message
6. push and open a pull request, and hand you the URL

**If the audit fails, let it fix the cause.** The command tells it not to weaken
or delete a check to get to green, and that's the rule worth holding onto — those
checks encode a lot of hard-won rules about how this codebase fits together, and
they catch far more than a type error would.

You can talk to it normally throughout. "Why is that file staged?", "I don't want
the audit fix, explain it first", "put this on a different branch" — it's a
conversation, not a script.

**Two things worth doing yourself:**

**Ask before you change.** Files like `src/data/workflowDrawers.ts` carry long
comments explaining *why* things are the way they are, including bugs that were
fixed and shouldn't come back. "Explain this screen before I change it" costs
thirty seconds and saves reintroducing something.

**Read the diff before you approve the push.** `/ship` does the mechanics
reliably; it can still misjudge what you meant. You're the one who knows whether
the change is right.

---

## 6. Voice agent

The sandbox has **its own LiveKit voice agent**, already deployed and already
wired up. `agent/livekit.toml` in this repo points at it, so a deploy from here
goes to the sandbox worker and cannot touch the live one.

The two are kept apart by name: production dispatches to `invoca-voice`, the
sandbox to `invoca-voice-staging`. A call started here can only ever be answered
by the sandbox worker, and vice versa — the server works out which name to use
from the environment, so there's nothing for you to set.

**Most changes need no deploy at all.** The worker builds no prompt — the server
mints one per call and hands it over — so **prompt, workflow-tree and Ask AI
changes take effect on the very next call.** Just push and make a call.

The one exception is `agent/voiceAgent.js` itself — the speech and model wiring —
which needs the worker redeployed. **You almost certainly won't touch it, and you
can't deploy it anyway** (that needs access to Invoca's LiveKit account). If you
think your change needs it, talk to Dhruv.

One thing to expect: **the first call after a quiet spell is slow.** The worker
scales to zero when idle, so a cold start takes 10–20 seconds and you may see
the "agent didn't join in time" notice. Try once more — if it happens twice in a
row, something is actually wrong and worth flagging.

---

## 7. When something breaks

| Symptom | What's going on |
| --- | --- |
| `ANTHROPIC_API_KEY is not set` | No `.env`, or you copied `.env.example` without filling it in. |
| `credit balance is too low` | The shared Anthropic account is out of credits. Tell Dhruv — a different key won't help. |
| Generation fails partway | It's resumable. Re-run the same command; finished prospects are skipped. |
| Voice call shows the warming notice | Usually a cold start — try once more. If it keeps happening, the sandbox worker may not be running. |
| Port 5173 already in use | Another dev server is running. Kill it, or let Vite pick the next port. |
| `npm run audit` fails on something you didn't touch | Pull latest first — someone may have pushed a fix. If it persists, flag it. |

Anything else: ask Claude Code first — it can see the whole codebase and the
error. If it's environmental or access-related, ask Dhruv.
