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

   Google Workspace SMTP wants an APP PASSWORD (a 16-character credential created
   in the Google account, requires 2-Step Verification). It is not the account
   password and it lives only in the server environment.

   ⚠️ UNCONFIGURED IS A SUPPORTED STATE, not an error. With no SMTP_USER /
   SMTP_APP_PASSWORD the app runs exactly as before and a would-be email is
   logged instead of sent. The feature works end to end without it; only the
   notification is silent. That is what lets this ship before the credential
   exists, and it is why `configured` is reported on /api/status.
   ============================================================================= */

import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || "";              // e.g. ddesai@invoca.com
const PASS = process.env.SMTP_APP_PASSWORD || "";      // Google app password
const FROM_NAME = process.env.SMTP_FROM_NAME || "Invoca Demo Generator";

/** True when a real send is possible. Surfaced by /api/status as a boolean. */
export const mailConfigured = (): boolean => !!(USER && PASS);

/** The address replies go to, for the UI to show honestly. Empty when unset. */
export const mailFrom = (): string => USER;

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
    await getTransport().sendMail({
      from: `"${FROM_NAME}" <${USER}>`,
      replyTo: USER,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    console.log(`[mail] sent to ${mail.to}: ${mail.subject}`);
    return { sent: true };
  } catch (e: any) {
    /* Logged, not thrown. The most common cause is an app password that was
       revoked or never created; the item is still saved either way. */
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
