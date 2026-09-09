# Environments: local, staging, production

Three environments, one codebase. `engine/appEnv.ts` is the single definition of which one a
process is, derived from Render's own `RENDER_SERVICE_NAME` so a new service is labelled
correctly without anyone having to remember a flag.

| | local | staging | production |
|---|---|---|---|
| how it is identified | no `RENDER_GIT_COMMIT` | service name matches `staging`/`sandbox`/`preview`/`dev`/`test`/`qa` | anything else on Render |
| `/api/status` `environment` | `local` | `staging` | `production` |
| STAGING badge on every screen | no | **yes** | no |
| nightly canary (a full generation) | off | **off** unless `CANARY=on` | on |
| feedback completion email | logged | **logged** unless `ALLOW_EMAIL=1` | sent |
| LiveKit agent it dispatches to | `invoca-voice` (the shared hosted worker) | **`invoca-voice-staging`** | `invoca-voice` |
| demo library | `./.data` | its own disk, or ephemeral | the Render disk |

## Standing up the staging service (one-time, on Render)

These are dashboard steps and need your account, so they are not something the assistant can
do for you.

1. **New Web Service** from the same GitHub repo.
   - **Name it `invoca-demo-platform-staging`.** The name is what makes it staging. Call it
     something without `staging`/`sandbox` in it and it will believe it is production: no
     badge, a nightly canary billing a full Opus generation, and real email to real people.
   - **Branch: `staging`** — create the remote ref with:

         git push origin HEAD:staging

     Do **not** `git checkout -b staging`. Under the promote flow below, `staging` is a
     DEPLOY POINTER, not a branch you develop on: you keep working on `main` locally and push
     it to whichever environment you want. Having a local `staging` checked out is how you end
     up committing to it by accident and then wondering why `main` is behind.
   - Build: `npm ci && npm run build`. Start: `npm start`. Same as production.
   **The fields Render autofills, and the four to correct** (reviewed against the real
   creation screen 9/8/2026):

   | field | Render's autofill | use instead | why |
   |---|---|---|---|
   | Build Command | `npm install; npm run build` | `npm ci && npm run build` | The `;` runs the build **even when install fails**, so you debug a build error whose real cause was the install. And `npm ci` installs exactly the lockfile, so staging and production get identical trees — `npm install` can resolve different versions, which defeats the point of a gate. |
   | Project / Environment | `My project / Production` | a new `Staging` environment, or blank | A staging service inside an environment named Production. Render attaches env groups per environment, so this is how production values reach staging later with nobody looking there. (`appEnv()` reads the service NAME, so the badge is unaffected either way.) |
   | Health Check Path | placeholder only | type `/healthz` | The SIGTERM drain returns 503 on `/healthz` so Render stops routing before the process exits. With no path set Render does a TCP check and that whole mechanism does nothing. |
   | Compute | whatever is preselected | match production | `tsc -b && vite build` is the step most likely to OOM on 512 MB. A staging service that cannot build what production builds proves nothing. |

   Leave alone: Language `Node`, Root Directory empty, Start Command `npm run start`, Region
   the same as production, Auto-Deploy `On Commit`, Pre-Deploy empty, Build Filters empty, and
   no disk (see the disk note below).

2. **Environment variables.** Copy production's, then change these:

   | variable | value on staging | why |
   |---|---|---|
   | `BASE_URL` | the staging URL | the Google sign-in callback is built from it |
   | `VITE_MAPBOX_TOKEN` | the same token | **build-time**. Without it maps render blank, and its presence in the server env does not prove the deployed bundle carries it |
   | `CANARY` | leave UNSET | staging is off by default; `off` also works |
   | `GMAIL_REFRESH_TOKEN`, `SMTP_*` | omit | belt and braces, since non-production already refuses to send |
   | `DATA_DIR` | leave unset | see the disk note below |

3. **Google OAuth.** In the Cloud Console, add the staging callback to the OAuth client's
   **Authorized redirect URIs**: `https://<staging-host>/auth/callback`. Without it sign-in
   fails with a redirect-uri mismatch and nothing else on the service works.
4. **The disk, and this is the one real decision.** A Render persistent disk attaches to
   **one instance at a time**, so staging cannot share production's. Either:
   - **no disk**, which is simplest. `storage.persistent` reports false and the demo library
     is wiped on every deploy. Fine for testing screens; you will be duplicating or
     regenerating a demo whenever you want something to test against.
   - **its own small disk**, so demos persist on staging, entirely separate from production's.
     Costs a little and is worth it if you test against one prospect repeatedly.

## Running staging WITHOUT the Google sign-in gate

⚠️⚠️ **WITH `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ABSENT THE GATE TURNS ITSELF OFF, AND
EVERY `/api/*` ROUTE IS OPEN TO ANYONE WITH THE URL.** The boot log says so
(`🔓 Auth gate OFF`), off-gate every caller is `Local Dev <local@dev>`, and the app works
completely — which is exactly why this is easy to leave in place without noticing.

⚠️ **THE EXPOSURE IS COST, NOT PROSPECT DATA.** With no disk the demo library starts empty, so
there is nothing of a customer's to leak. What IS reachable spends real money on our own keys:
`/api/generate`, `/api/chat`, `/api/analyze` and `/api/ai-assistant` on `ANTHROPIC_API_KEY`
(and Ask AI on a voice workflow now runs **Opus 5 with adaptive thinking**, the most expensive
call in the app), `/api/voice-preview` and `/api/livekit-token` on the LiveKit account, and
`/api/zip` on the Places key. `*.onrender.com` hostnames are guessable and are scanned.
Only `/healthz`, `/api/status` and `/api/canary` are public by design, and those are counts
and booleans.

Two ways to leave it open safely:

- **Omit `ANTHROPIC_API_KEY` as well.** ⚠️ **STAGING STILL RENDERS 14 PROSPECTS IN FULL** — the
  bundled `src/data/generated/*.json` are loaded by `import.meta.glob` at BUILD time, so every
  dashboard, report, Signal screen and Salesforce page works with no disk, no library and no
  API key. Only the AI features go dead (generation, the SMS/voice agents, Ask AI). For
  testing screens, layout and CSS that is a complete environment and costs nothing to leave
  open. Leave the LiveKit and Places keys off too and the surface is inert.
- **Add the two Google vars after all.** Same OAuth client as production; you add
  `https://<staging-host>/auth/callback` to its Authorized redirect URIs. Two minutes, and the
  gate is on.

Either is defensible. What is not defensible is the middle: open, with the AI keys set.

## Promoting a change

`main` is the source of truth in your working copy. `staging` and `main` on the remote are
just two pointers at commits, and pushing moves one of them:

    git push origin HEAD:staging      # deploy what you have to staging
    # click through it, then:
    git push origin main              # promote to production

⚠️ **`staging` can therefore be AHEAD of `main`, and that is the normal state** — it is
whatever you are currently testing. Nothing merges it back; `main` catches up when you push
it. To see the gap:

    git fetch origin
    git log --oneline origin/main..origin/staging

Run `npm run typecheck`, or the full `npm run audit`, before either push. A Render build
failure on `main` is a broken deploy on the URL the team demos from. Note that
`npx tsc --noEmit` checks **zero files** because the root tsconfig is a solution file, which
is exactly how a broken build reached production on 9/8/2026.

## Voice on staging

**Staging has no voice worker until you deploy one, and a call there will sit on the warming
notice.** That is deliberate, and it is the safe failure.

There is one LiveKit project, and LiveKit hands a job to any worker registered under the
requested agent name. If staging asked for `invoca-voice`, its test calls would be answered by
the **production** worker, and a staging worker deployed under that name could answer a **real
demo call** with untested code, mid-sentence. Neither would surface as an error anywhere.

To test a worker change on staging, deploy a second agent under the staging name:

    cd agent
    lk agent create                   # a SECOND agent, with its own id in livekit.toml
    lk agent update --secrets VOICE_AGENT_NAME=invoca-voice-staging
    lk agent deploy

Production is untouched: it keeps dispatching to `invoca-voice`. Local development also keeps
using `invoca-voice` on purpose, so a laptop can still exercise a real call against the shared
hosted worker without deploying anything.

## Failover (not built)

A staging service is **not** a failover target, because it cannot see production's demos: the
single-attach disk again. Making it one means moving the demo library off the disk into
Postgres or object storage behind `engine/demoStore.ts`, which is already a narrow
read/write/list interface. That migration is also what CLAUDE.md names as the real fix for
zero-downtime deploys, so it earns its keep twice. It needs a store provisioned, which is your
call to make.
