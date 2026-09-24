/* =============================================================================
   googleAuth.ts — "Sign in with Google, @invoca.com only" gate for server.ts
   -----------------------------------------------------------------------------
   Puts the whole app (UI + /api) behind Google sign-in, restricted to one email
   domain (default invoca.com). Standard OAuth 2.0 authorization-code flow, no
   extra dependencies (Node's built-in crypto + fetch). A signed HttpOnly cookie
   holds the session after login.

   Enabled only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set — otherwise
   the gate is OFF (so local `npm start` works without auth). Env vars:
     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (from Google Cloud Console)
     ALLOWED_EMAIL_DOMAIN                      (default "invoca.com")
     SESSION_SECRET                            (random string; signs the cookie)
     BASE_URL                                  (optional, e.g. https://app.onrender.com;
                                                otherwise derived from the request)
   The OAuth "Authorized redirect URI" in Google must be  <BASE_URL>/auth/callback .
   ============================================================================= */

import crypto from "node:crypto";
/* One admin list for the whole app: the same people who can triage feedback are the
   ones who may connect the sending account. A second list here would drift. */
import { isAdmin } from "./engine/demoApi.ts";
import { saveDriveToken } from "./engine/driveTokens.ts";
import { saveGmailToken } from "./engine/gmailTokens.ts";
import { orgEmailDomain } from "./engine/appEnv.ts";
import type { Express, Request, Response, NextFunction } from "express";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
/* ⚠️ ONE DEFINITION — `engine/appEnv.ts`. The follow-up-notice mailer reads the
   same value as a SEND GUARD, and a second copy here is how the gate and the
   guard come to disagree about who counts as staff. */
const ALLOWED_DOMAIN = orgEmailDomain();
const SESSION_SECRET = process.env.SESSION_SECRET || CLIENT_SECRET || "insecure-dev-secret";
const BASE_URL = process.env.BASE_URL || "";
const COOKIE = "invoca_demo_session";
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export const authEnabled = !!(CLIENT_ID && CLIENT_SECRET);

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const hmac = (body: string) => crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");

function sign(payload: object): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}
function verify(token?: string): { email: string; name?: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = hmac(body);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  (header || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const baseUrl = (req: Request) => BASE_URL || `${req.protocol}://${req.get("host")}`;
const secure = (req: Request) => (BASE_URL ? BASE_URL.startsWith("https") : req.secure);

function deniedPage(msg: string): string {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Access restricted</title><body style="font-family:system-ui,-apple-system,sans-serif;background:#0b0f1a;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:440px;padding:24px"><div style="font-size:40px">🔒</div><h2 style="color:#fff;margin:12px 0 8px">Access restricted</h2><p style="color:#9aa1ac;line-height:1.5">${msg}</p><a href="/auth/login" style="display:inline-block;margin-top:14px;color:#fff;background:#2666f9;padding:10px 20px;border-radius:8px;text-decoration:none">Try again</a></div></body>`;
}

/* Who is making this request? With the gate on, it's the signed-in Google
   account (the middleware below guarantees a valid session on every non-/auth
   route). With the gate off — local dev — everything is attributed to one
   local identity so the demo library still works without signing in. */
export interface SessionUser { email: string; name: string }
const DEV_USER: SessionUser = { email: "local@dev", name: "Local Dev" };

export function currentUser(req: { headers: { cookie?: string } }): SessionUser {
  const session = verify(parseCookies(req.headers.cookie)[COOKIE]);
  if (!session) return DEV_USER;
  return { email: session.email, name: session.name || session.email.split("@")[0] };
}

/* Shown once, to an admin, on their own screen. The token is a credential, so the
   page says so plainly, tells them where it goes, and offers the revoke link. It is
   never logged: a credential in a log file outlives every intention to remove it. */
function gmailTokenPage(account: string, refreshToken: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8"><title>Gmail connected</title>
<style>
 body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f8f4;color:#0a231e;margin:0;padding:48px 20px;line-height:1.6}
 .w{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e6e9e5;border-radius:14px;padding:28px 30px}
 h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
 p{margin:0 0 14px;color:#3d4d48}
 code{background:#f4f6f2;border:1px solid #e6e9e5;border-radius:5px;padding:2px 6px;font-size:13px}
 .tok{display:block;word-break:break-all;background:#0a231e;color:#9fe8d1;padding:14px 16px;border-radius:10px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 16px}
 .warn{background:#fff9e8;border:1px solid #e0b050;color:#7a5a10;border-radius:10px;padding:12px 15px;font-size:14px}
 ol{color:#3d4d48;padding-left:20px} li{margin:0 0 8px}
 a{color:#00a87f}
</style>
<div class="w">
  <h1>Gmail connected</h1>
  <p>Mail will send as <b>${esc(account)}</b>.</p>
  <p><b>This is the refresh token. It is shown once and never stored here.</b></p>
  <code class="tok">${esc(refreshToken)}</code>
  <div class="warn">Treat it like a password: anyone holding it can send mail as this account.
  Revoke it any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</div>
  <ol>
    <li>In Render, open the service, then <b>Environment</b>.</li>
    <li>Add <code>GMAIL_REFRESH_TOKEN</code> = the value above.</li>
    <li>Add <code>GMAIL_SENDER</code> = <code>${esc(account)}</code>.</li>
    <li><b>Restart the service</b>, then check
        <code>/api/status</code> shows <code>"emailConfigured": true</code>.</li>
  </ol>
  <p><a href="/">Back to the launch page</a></p>
</div>`;
}

export function installAuth(app: Express) {
  if (!authEnabled) return;
  app.set("trust proxy", 1); // Render & other proxies terminate TLS → correct req.protocol/req.secure

  app.get("/auth/login", (req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/auth/callback`,
      response_type: "code",
      /* ⚠️⚠️ **`gmail.send` IS IN THE SIGN-IN SCOPE ON PURPOSE (9/24/2026), AND
         THIS FILE PREVIOUSLY ARGUED THE OPPOSITE.** Asked for directly, about the
         "tell the account exec" notification: *"it should automatically just be
         sent as that user, they dont need to click anything"*. A separate Connect
         button is a click, and a feature that needs one is a feature most people
         never turn on — so the grant now rides the login they already perform.
         The consequence is stated rather than buried: the Google consent screen
         says "Send email on your behalf", it is all-or-nothing, and somebody who
         declines cannot use the platform at all.
         ⚠️ The only zero-click alternative is Workspace DOMAIN-WIDE DELEGATION,
         which lets this server send as anyone at Invoca with no consent from
         anybody — a far larger grant than each person allowing it for themselves,
         and it needs a super-admin. Rejected for the same reason it was rejected
         for Drive's READ scope. */
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
      hd: ALLOWED_DOMAIN, // hint Google to the org's accounts
      state,
      prompt: "select_account",
      /* ⚠️⚠️ **`offline` IS WHAT RETURNS A REFRESH TOKEN, AND `prompt=consent` IS
         DELIBERATELY *NOT* SET HERE** — unlike the two connect routes below. With
         it, Google re-shows the consent screen on EVERY sign-in, which turns a
         one-time grant into a permanent nag. Without it, Google returns a refresh
         token on the FIRST grant of a newly-requested scope (which adding
         gmail.send makes this) and nothing afterwards — so the callback stores it
         when present and keeps the stored copy when not. */
      access_type: "offline",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  /* ---- ONE-TIME GMAIL CONSENT ------------------------------------------------
     Invoca's Workspace blocks app passwords, so completion emails go through the
     Gmail API instead. That needs a REFRESH TOKEN for the sending account, which
     only exists if that account consents once with access_type=offline.

     Deliberately reuses the EXISTING /auth/callback redirect URI, distinguished by
     a state prefix, so nothing has to be registered in the Google Cloud Console
     beyond adding the gmail.send scope to the consent screen.

     Admin-gated: this mints a credential that can send mail as whoever runs it. */
  app.get("/auth/gmail", (req: Request, res: Response) => {
    const who = currentUser(req);
    if (!isAdmin(who)) {
      return res.status(403).send(deniedPage("Only an admin can connect the sending account."));
    }
    const state = "gmail:" + crypto.randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/auth/callback`,
      response_type: "code",
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
      hd: ALLOWED_DOMAIN,
      state,
      /* offline + consent is what actually returns a refresh token. Without
         prompt=consent Google reuses a prior grant and returns none, which is the
         classic "it worked but there is no refresh_token" dead end. */
      access_type: "offline",
      prompt: "consent",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  /* ---- PER-SE GOOGLE DRIVE CONSENT -------------------------------------------
     docs/INTEGRATIONS.md's Drive model: per-user OAuth on this same client, not
     one shared credential. So unlike /auth/gmail (admin-only, mints ONE token
     for the sending account), this is open to ANY signed-in SE, and the token
     that comes back is stored per-account (engine/driveTokens.ts) rather than
     displayed for someone to paste into Render. */
  app.get("/auth/drive", (req: Request, res: Response) => {
    const state = "drive:" + crypto.randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/auth/callback`,
      response_type: "code",
      scope: "openid email profile https://www.googleapis.com/auth/drive.readonly",
      hd: ALLOWED_DOMAIN,
      state,
      // Same reasoning as /auth/gmail: offline + consent is what actually
      // returns a refresh token, rather than reusing a prior grant silently.
      access_type: "offline",
      prompt: "consent",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  /* ---- PER-SE GMAIL SEND CONSENT ---------------------------------------------
     Asked for directly: the "tell the account exec" notification should come
     FROM the SE who marked the demo, and land in THEIR Sent folder, because they
     are the actual sender.

     ⚠️⚠️ **THE SAME SCOPE AS /auth/gmail AND THE OPPOSITE POLICY.** That route is
     ADMIN-ONLY and mints ONE credential for the shared sending account, shown
     once to be pasted into Render. This one is open to any signed-in SE, mints
     THEIRS, and stores it (engine/gmailTokens.ts) — the /auth/drive model applied
     to a send scope. Both legs reuse the existing /auth/callback redirect URI,
     distinguished by their state prefix, so nothing new is registered in the
     Google Cloud Console.
     ⚠️ **NOT FOLDED INTO THE SIGN-IN SCOPE, DELIBERATELY.** Adding gmail.send to
     the gate would show "this app wants to send email as you" to everyone who
     opens the platform, including the majority who only ever generate a demo.
     A send capability should be consented to where it is used. */
  app.get("/auth/gmail-connect", (req: Request, res: Response) => {
    const state = "gmailc:" + crypto.randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/auth/callback`,
      response_type: "code",
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
      hd: ALLOWED_DOMAIN,
      state,
      // offline + consent is what actually returns a refresh token, as above.
      access_type: "offline",
      prompt: "consent",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/callback", async (req: Request, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      if (!code || !state || state !== cookies.oauth_state) return res.status(403).send(deniedPage("Your sign-in link expired or didn't match. Please try again."));

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: `${baseUrl(req)}/auth/callback`, grant_type: "authorization_code" }),
      });
      const tok: any = await tokenRes.json();
      if (!tok?.id_token) return res.status(403).send(deniedPage("Google sign-in failed."));

      /* The Gmail consent leg: show the refresh token ONCE so it can be pasted
         into the host's environment, then stop. It is deliberately not written to
         disk — the environment is where every other credential in this app lives,
         and a token sitting in a data directory is a copy nobody remembers. */
      /* ⚠️⚠️ **CHECKED BEFORE THE `gmail:` BRANCH, AND THE ORDER IS LOAD-BEARING
         ONLY BECAUSE THE PREFIXES ARE DISTINCT** — `"gmailc:".startsWith("gmail:")`
         is FALSE (the colon differs), so the two cannot actually collide. It is
         tested first anyway, and named `gmailc:` rather than `gmail-connect:`
         only after checking that: a prefix pair where one IS a prefix of the
         other would send every per-SE consent down the admin path and display a
         colleague's send credential on screen. */
      if (state.startsWith("gmailc:")) {
        const claims2: any = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
        const acct = String(claims2.email || "").toLowerCase();
        res.setHeader("Set-Cookie", `oauth_state=; Path=/; Max-Age=0`);
        if (!tok.refresh_token) {
          return res.status(400).send(deniedPage(
            "Google didn't return a new grant for sending — that usually means it was already connected. " +
            "Disconnect it and try again to get a fresh one, or it may already be working: " +
            "<a href=\"/\">go back and check</a>."));
        }
        /* ⚠️ STORED, NEVER DISPLAYED. The admin leg below prints its token
           because a human pastes that one into Render; this is somebody's own
           send credential and there is nothing for anyone to copy. */
        saveGmailToken(acct, tok.refresh_token);
        return res.redirect("/?gmail=connected");
      }

      if (state.startsWith("gmail:")) {
        const claims2: any = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
        const acct = String(claims2.email || "").toLowerCase();
        res.setHeader("Set-Cookie", `oauth_state=; Path=/; Max-Age=0`);
        if (!tok.refresh_token) {
          return res.status(400).send(deniedPage(
            "Google did not return a refresh token. That usually means the grant already existed: " +
            "remove this app at <b>myaccount.google.com/permissions</b> and run <b>/auth/gmail</b> again."));
        }
        return res.send(gmailTokenPage(acct, tok.refresh_token));
      }

      /* The Drive consent leg: store the refresh token for THIS account and
         send them back to the app — no page to read, no value to copy, because
         nobody has to paste anything into Render for this one. */
      if (state.startsWith("drive:")) {
        const claims2: any = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
        const acct = String(claims2.email || "").toLowerCase();
        res.setHeader("Set-Cookie", `oauth_state=; Path=/; Max-Age=0`);
        if (!tok.refresh_token) {
          return res.status(400).send(deniedPage(
            "Google didn't return a new grant for Drive — that usually means it was already connected. " +
            "Disconnect it in Advanced settings and try again to get a fresh one, or it may already be working: " +
            "<a href=\"/\">go back and check</a>."));
        }
        saveDriveToken(acct, tok.refresh_token);
        return res.redirect("/?drive=connected");
      }

      // The id_token came straight from Google's TLS token endpoint, so we can
      // trust its claims without re-fetching Google's public keys.
      const claims: any = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
      const email = String(claims.email || "").toLowerCase();
      const domain = String(claims.hd || email.split("@")[1] || "").toLowerCase();
      if (claims.aud !== CLIENT_ID || !claims.email_verified || domain !== ALLOWED_DOMAIN) {
        return res.status(403).send(deniedPage(`Access is limited to <b>@${ALLOWED_DOMAIN}</b> accounts. You signed in as ${email || "an account outside that domain"}.`));
      }

      /* ⚠️⚠️ **THE SEND TOKEN IS CAPTURED HERE, ON AN ORDINARY SIGN-IN.** That is
         what makes "sent as the SE" automatic: by the time anyone marks a demo,
         their mailbox is already connected because they logged in.
         ⚠️ **ONLY WHEN PRESENT, AND IT NEVER CLEARS A STORED ONE.** Google returns
         a refresh token on the first grant of a scope and omits it on every later
         sign-in, so overwriting unconditionally would wipe a good token on the
         second login and leave sending permanently broken for that person. */
      if (tok.refresh_token) saveGmailToken(email, tok.refresh_token);

      const name = String(claims.name || claims.given_name || email.split("@")[0]);
      const session = sign({ email, name, exp: Date.now() + MAX_AGE_MS });
      res.setHeader("Set-Cookie", [
        `${COOKIE}=${session}; HttpOnly; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}; SameSite=Lax${secure(req) ? "; Secure" : ""}`,
        `oauth_state=; Path=/; Max-Age=0`,
      ]);
      res.redirect("/");
    } catch (e) {
      console.error("[auth] callback failed:", e);
      res.status(500).send(deniedPage("Something went wrong during sign-in."));
    }
  });

  app.get("/auth/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    res.redirect("/auth/login");
  });

  // Gate everything else: pages redirect to login, /api returns 401.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth/") || req.path === "/healthz") return next();
    if (verify(parseCookies(req.headers.cookie)[COOKIE])) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in required." });
    return res.redirect("/auth/login");
  });
}
