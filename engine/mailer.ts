/* =============================================================================
   mailer.ts — the one place this app sends email
   -----------------------------------------------------------------------------
   Sends FROM the maintainer's own @invoca.com address, TO the address the person
   signed in with. That was a deliberate choice over a transactional provider:

     • No new vendor, no DNS records, no waiting on IT to verify a domain.
     • It genuinely comes from a person, so a reply lands in a real inbox and the
       thread continues where the feedback started.
     • The recipient address is never typed by anyone. It comes from the Google
       session, so it cannot be mistyped and there is no address field to abuse.

   TWO WAYS TO SEND, tried in this order:

     1. GMAIL API (preferred). Reuses the Google OAuth client this app already has
        for sign-in, plus a one-time consent that mints a refresh token. This is
        the route that works when a Workspace blocks app passwords, which Invoca's
        does: /auth/gmail walks you through it once.
     2. SMTP with an APP PASSWORD. Simpler, and dead on arrival if the Workspace
        disables app passwords ("The setting you are looking for is not available
        for your account"). Kept because it is two env vars on a tenant that
        allows them.

   ⚠️ UNCONFIGURED IS A SUPPORTED STATE, not an error. With no SMTP_USER /
   SMTP_APP_PASSWORD the app runs exactly as before and a would-be email is
   logged instead of sent. The feature works end to end without it; only the
   notification is silent. That is what lets this ship before the credential
   exists, and it is why /api/status reports `integrations.emailConfigured` — a
   BOOLEAN, never the address, since that endpoint is public.
   ============================================================================= */

import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || "";              // e.g. ddesai@invoca.com
const PASS = process.env.SMTP_APP_PASSWORD || "";      // Google app password
const FROM_NAME = process.env.SMTP_FROM_NAME || "Invoca Demo Generator";

/* Gmail API route. GMAIL_SENDER is the address it sends AS; the refresh token was
   minted by that account consenting at /auth/gmail. The OAuth client is the same
   one sign-in uses, so there is no second app to register. */
const GMAIL_REFRESH = process.env.GMAIL_REFRESH_TOKEN || "";
const GMAIL_SENDER = process.env.GMAIL_SENDER || USER;
const OAUTH_ID = process.env.GOOGLE_CLIENT_ID || "";
const OAUTH_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const gmailReady = (): boolean => !!(GMAIL_REFRESH && GMAIL_SENDER && OAUTH_ID && OAUTH_SECRET);
const smtpReady = (): boolean => !!(USER && PASS);

/** True when a real send is possible either way. /api/status reports this. */
export const mailConfigured = (): boolean => gmailReady() || smtpReady();

/** Which route is live, for diagnostics. Never includes a credential. */
export const mailMode = (): "gmail" | "smtp" | "off" =>
  gmailReady() ? "gmail" : smtpReady() ? "smtp" : "off";

/** The address replies go to, for the UI to show honestly. Empty when unset. */
export const mailFrom = (): string => (gmailReady() ? GMAIL_SENDER : USER);

/* A refresh token is long-lived, an access token is not. Exchanged per send and
   cached until just before it expires: a nightly-ish send does not need a
   background refresher, and a stale token is the failure this avoids. */
let accessToken = "";
let accessExpiry = 0;
async function gmailAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiry) return accessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OAUTH_ID, client_secret: OAUTH_SECRET,
      refresh_token: GMAIL_REFRESH, grant_type: "refresh_token",
    }),
  });
  const tok: any = await res.json();
  if (!tok?.access_token) throw new Error(tok?.error_description || tok?.error || "Could not refresh the Gmail token.");
  accessToken = tok.access_token;
  accessExpiry = Date.now() + Math.max(0, (Number(tok.expires_in) || 3600) - 60) * 1000;
  return accessToken;
}

/* RFC 2822 on the wire, base64url for the API. Subjects are RFC 2047 encoded
   because a non-ASCII character in a raw header is not legal and silently mangles
   the subject line in some clients. */
function rawMessage(from: string, mail: Mail): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const subject = /^[\x20-\x7E]*$/.test(mail.subject)
    ? mail.subject
    : `=?UTF-8?B?${b64(mail.subject)}?=`;
  const boundary = "b" + Math.random().toString(36).slice(2);
  const headers = [
    `From: ${from}`, `To: ${mail.to}`, `Reply-To: ${GMAIL_SENDER || from}`,
    `Subject: ${subject}`, "MIME-Version: 1.0",
  ];
  const body = mail.html
    ? [
        `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
        `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "", mail.text, "",
        `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", mail.html, "",
        `--${boundary}--`,
      ]
    : ["Content-Type: text/plain; charset=UTF-8", "", mail.text];
  return Buffer.from([...headers, ...body].join("\r\n"), "utf8").toString("base64url");
}

async function sendViaGmail(mail: Mail): Promise<void> {
  const token = await gmailAccessToken();
  const from = `"${FROM_NAME}" <${GMAIL_SENDER}>`;
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: rawMessage(from, mail) }),
  });
  if (!res.ok) {
    const detail: any = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Gmail API returned ${res.status}`);
  }
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,     // 465 implicit TLS; 587 upgrades via STARTTLS
      auth: { user: USER, pass: PASS },
    });
  }
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send one message. NEVER throws: a notification failing must not fail the
 * status change that triggered it, or an admin's click reports an error while the
 * item is already updated on disk. Returns what happened so the caller can say so.
 */
export async function sendMail(mail: Mail): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) {
    console.log(`[mail] not configured, would have sent to ${mail.to}: ${mail.subject}`);
    return { sent: false, reason: "not configured" };
  }
  try {
    if (gmailReady()) await sendViaGmail(mail);
    else await getTransport().sendMail({
      from: `"${FROM_NAME}" <${USER}>`,
      replyTo: USER,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    console.log(`[mail] sent via ${mailMode()} to ${mail.to}: ${mail.subject}`);
    return { sent: true };
  } catch (e: any) {
    /* Logged, not thrown. Most likely causes: a revoked app password, or a Gmail
       refresh token that was withdrawn in the Google account's security settings.
       The item is still saved either way. */
    console.error(`[mail] failed to ${mail.to}:`, e?.message || e);
    return { sent: false, reason: e?.message || "send failed" };
  }
}

/* ---- the one message this app sends ---------------------------------------- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Your request is done" — sent when an item first reaches a terminal status. */
export function completionEmail(opts: {
  to: string; name: string; kind: string; title: string; note?: string; boardUrl: string;
}): Mail {
  const first = (opts.name || "").split(/\s+/)[0] || "there";
  const what = opts.kind === "feature" ? "feature request" : "feedback";
  const lines = [
    `Hi ${first},`,
    ``,
    `The ${what} you sent about the Invoca Demo Generator is done:`,
    ``,
    `  "${opts.title}"`,
    ...(opts.note ? [``, opts.note] : []),
    ``,
    `It is live now, so you should see it the next time you open the tool.`,
    ``,
    `You can see everything you have sent here: ${opts.boardUrl}`,
    ``,
    `Thanks for taking the time to send it, it is genuinely useful.`,
  ];
  const html =
    `<div style="font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#0a231e">` +
    `<p>Hi ${esc(first)},</p>` +
    `<p>The ${esc(what)} you sent about the Invoca Demo Generator is done:</p>` +
    `<blockquote style="margin:16px 0;padding:12px 16px;background:#f8faf1;border-left:3px solid #00b388;border-radius:0 8px 8px 0">` +
    `<strong>${esc(opts.title)}</strong>${opts.note ? `<br><span style="color:#3d4d48">${esc(opts.note)}</span>` : ""}` +
    `</blockquote>` +
    `<p>It is live now, so you should see it the next time you open the tool.</p>` +
    `<p><a href="${esc(opts.boardUrl)}" style="color:#00a87f">See everything you have sent</a></p>` +
    `<p style="color:#626464">Thanks for taking the time to send it, it is genuinely useful.</p>` +
    `</div>`;
  return { to: opts.to, subject: `Done: ${opts.title}`, text: lines.join("\n"), html };
}
