# Deploying the Invoca demo platform

**Read this first.** This app is **not** a static website. The live AI features
(SMS/Voice Preview Agent, the "Ask AI" dashboard drawer + tile generation, signal
analysis, prospect generation) run on a **Node.js server** that holds your API
keys. That server (`server.ts`) must be **running** on the host — you cannot make
these features work by only SFTP-copying files to a static web host, and the keys
must never be put in the browser bundle.

So the host must be able to **run Node.js** (a VPS with SSH, or a Node platform).

---

## What runs where

- **Browser (built with `npm run build` → `dist/`)** — the UI. Safe to serve as
  static files. On its own it can browse pre-generated prospects/dashboards/reports
  but **all `/api/*` calls fail**.
- **`server.ts` (Node)** — serves `dist/` **and** the `/api/*` endpoints
  (`/api/chat`, `/api/tts`, `/api/analyze`, `/api/ai-assistant`, `/api/generate`,
  `/api/delete-profile`), reading keys from the environment. This is what makes
  "everything work the same as local".

---

## Required environment variables (server-side only — never in the client)

| Var | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | **Required.** All AI: chat, Ask AI, analyze, generation |
| `ELEVENLABS_API_KEY` | Premium Voice-agent TTS (ElevenLabs) |
| `DEEPGRAM_API_KEY` | Premium Voice-agent TTS (Deepgram) — alternative to ElevenLabs |
| `TTS_PROVIDER` | Optional: `deepgram` or `elevenlabs` (auto-detected otherwise) |
| `PORT` | Optional: port to listen on (default `3000`; Render sets this automatically) |
| `GOOGLE_CLIENT_ID` | Enables the "Sign in with Google" gate (from Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | Paired with the client id — gate is ON only when both are set |
| `ALLOWED_EMAIL_DOMAIN` | Who may sign in — default `invoca.com` |
| `SESSION_SECRET` | Random string that signs the login cookie (generate one) |
| `BASE_URL` | The public URL, e.g. `https://invoca-demo.onrender.com` (used to build the OAuth redirect) |

Set these in the host's environment (a control-panel "Environment Variables"
screen, or a `.env` file next to `server.ts` — `npm start` loads `.env` if present).
Without a key, the app loads but AI calls return a clear error.

---

## ⭐ Recommended: Render + "Sign in with Google" (@invoca.com only)

This gives your team a single HTTPS URL, gated so only Invoca Google accounts can
get in. ~15 minutes.

### 1. Put the code on GitHub (Render deploys from a repo)
The project isn't a git repo yet. From the project folder:
```bash
git init && git add -A && git commit -m "Invoca demo platform"
# create an EMPTY repo on github.com (private), then:
git remote add origin git@github.com:YOURORG/invoca-demo.git
git branch -M main && git push -u origin main
```
`.env`, `node_modules/`, and `dist/` are already git-ignored — your keys are NOT
committed. (Alternatively, Render can deploy without GitHub via its CLI — ask and
I'll give those steps.)

### 2. Create the Render web service
1. https://render.com → **New → Web Service** → connect the GitHub repo.
2. **Runtime:** Node. **Build command:** `npm install && npm run build`.
   **Start command:** `npm start`. **Instance type:** Starter ($7/mo — avoid the
   free tier, it sleeps and cold-starts mid-demo).
3. Deploy once so Render assigns a URL like `https://invoca-demo.onrender.com`.

### 3. Create the Google OAuth client (the sign-in)
1. https://console.cloud.google.com → create/select a project.
   - **Best:** if you can create the project inside Invoca's Google Workspace org,
     set the OAuth consent screen **User type = Internal** — then ONLY invoca.com
     accounts can sign in, automatically, with no warning screen.
   - Otherwise **External** is fine; the app's own domain check still enforces
     invoca.com (users may see an "unverified app" notice — harmless for internal use).
   - Scopes needed: just `email`, `profile`, `openid` (non-sensitive, no Google review).
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID → Web
   application.**
   - **Authorized redirect URI:** `https://invoca-demo.onrender.com/auth/callback`
     (your Render URL + `/auth/callback`).
   - Copy the **Client ID** and **Client secret**.

### 4. Add environment variables in Render (Settings → Environment)
```
ANTHROPIC_API_KEY      = sk-ant-...
ELEVENLABS_API_KEY     = ...            (optional, for premium voice)
DEEPGRAM_API_KEY       = ...            (optional alternative)
GOOGLE_CLIENT_ID       = ....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET   = ...
ALLOWED_EMAIL_DOMAIN   = invoca.com
SESSION_SECRET         = <random string, e.g. `openssl rand -hex 32`>
BASE_URL               = https://invoca-demo.onrender.com
```
Save → Render redeploys. Visit the URL: you'll hit Google sign-in, and only
@invoca.com accounts get through. Share the URL with the team.

### 5. (Optional) custom domain
In Render → Settings → Custom Domains add e.g. `demo.itelecomservices.com`, then add
the CNAME it shows in your DreamHost DNS panel. Update `BASE_URL` **and** the Google
redirect URI to the custom domain.

> Railway works the same way (New Project → Deploy from GitHub → set the same start
> command + env vars). Pick whichever you prefer.

---

## Option A — a Node host (VPS with SSH, or a Node platform)  ← full functionality

1. Get the project onto the host (git clone, or SFTP the folder — **excluding**
   `node_modules/` and `dist/`, which are rebuilt on the host).
2. On the host:
   ```bash
   npm install
   npm run build          # → dist/
   # set env vars (ANTHROPIC_API_KEY at minimum), then:
   npm start              # serves dist/ + /api on $PORT (default 3000)
   ```
3. Keep it running with a process manager so it survives reboots/crashes:
   ```bash
   npm install -g pm2
   pm2 start "npm start" --name invoca-demo
   pm2 save && pm2 startup
   ```
4. Put it behind the web server / TLS. Example nginx reverse proxy:
   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_buffering off;            # required: /api/generate streams (SSE)
     proxy_read_timeout 600s;        # generation can take ~2–3 min
   }
   ```
   (On a managed Node platform like Render/Railway/Fly, skip nginx: set the build
   command to `npm install && npm run build`, the start command to `npm start`, add
   the env vars, and the platform provides the URL + TLS.)

### Shared hosting with a "Setup Node.js App" (cPanel/Passenger)
If your SFTP host is cPanel and has **Setup Node.js App**: create a Node app
pointing at the uploaded folder, set the startup file to `server.ts` (or a small
`server.js` shim), add the env vars in that panel, run `npm install` + `npm run
build` from its terminal, and start it. This is the only way SFTP-style shared
hosting can run the backend — plain file upload alone cannot.

---

## Option B — static-only host (SFTP file upload, no Node)  ← UI only, AI disabled

Only if a live backend is impossible on the host:
```bash
npm run build
# SFTP the CONTENTS of dist/ into the web root (or a subfolder)
```
- Configure SPA deep-link fallback or refreshing `/dashboards/...` 404s:
  - **Apache** (`.htaccess` in the web root):
    ```apache
    <IfModule mod_rewrite.c>
      RewriteEngine On
      RewriteBase /
      RewriteCond %{REQUEST_FILENAME} !-f
      RewriteCond %{REQUEST_FILENAME} !-d
      RewriteRule . /index.html [L]
    </IfModule>
    ```
  - **nginx**: `location / { try_files $uri /index.html; }`
  - If you can't configure rewrites, switch the app to `HashRouter` (URLs become
    `/#/dashboards/...`) — ask and I'll change it.
- **Subfolder hosting** (e.g. `example.com/invoca/`): set `base: '/invoca/'` in
  `vite.config.ts` before `npm run build`.
- ⚠️ With this option the AI features **do not work** — there is no server for
  `/api/*` and no safe place for the keys.

---

## Best option for "everything works" with only FileZilla

If all you have is SFTP to shared hosting that can't run Node, the reliable path is
to host the **full app (`server.ts`)** on a small Node platform (Render/Railway/Fly
have free/cheap tiers), then point your domain/subdomain at it via DNS. You get the
exact local behavior with server-side keys; SFTP isn't involved in the deploy.
