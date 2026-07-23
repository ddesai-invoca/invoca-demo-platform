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
import type { Express, Request, Response, NextFunction } from "express";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "invoca.com").toLowerCase();
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
function verify(token?: string): { email: string; exp: number } | null {
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
      scope: "openid email profile",
      hd: ALLOWED_DOMAIN, // hint Google to the org's accounts
      state,
      prompt: "select_account",
      access_type: "online",
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

      // The id_token came straight from Google's TLS token endpoint, so we can
      // trust its claims without re-fetching Google's public keys.
      const claims: any = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
      const email = String(claims.email || "").toLowerCase();
      const domain = String(claims.hd || email.split("@")[1] || "").toLowerCase();
      if (claims.aud !== CLIENT_ID || !claims.email_verified || domain !== ALLOWED_DOMAIN) {
        return res.status(403).send(deniedPage(`Access is limited to <b>@${ALLOWED_DOMAIN}</b> accounts. You signed in as ${email || "an account outside that domain"}.`));
      }

      const session = sign({ email, exp: Date.now() + MAX_AGE_MS });
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

  app.get("/auth/logout", (req: Request, res: Response) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    res.redirect("/auth/login");
  });

  // Gate everything else: pages redirect to login, /api returns 401.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth/")) return next();
    if (verify(parseCookies(req.headers.cookie)[COOKIE])) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in required." });
    return res.redirect("/auth/login");
  });
}
