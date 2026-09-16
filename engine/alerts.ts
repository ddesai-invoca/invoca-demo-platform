/* =============================================================================
   alerts.ts — ONE funnel for "something is wrong", and the rate limiting that
   makes it readable
   -----------------------------------------------------------------------------
   Built 9/16/2026. Asked for directly: *"I want to get notified when anything goes
   wrong with the platform, the small things like a feature is not working to bigger
   things like voice agent is not working or the whole platform is down."*

   MEASURED BEFORE BUILDING, because the gap was not where it looked: there are 21
   `console.error` sites across the server and **console was the only destination**.
   Render keeps the logs, but somebody has to go and look, so every one of those was
   a failure nobody would hear about. The canary already models this correctly for
   generation (`needsAttention`, with *missing* and *stale* counted as failures) and
   `engine/mailer.ts` already sends mail reliably — what was missing was the thing in
   between: somewhere for a failure to GO.

   ⚠️⚠️ **THE RATE LIMITING IS THE FEATURE, NOT A NICETY.** An error in a hot path
   fires on every request, and a channel that delivers five hundred copies of one
   fault is a channel you mute — after which the platform is less monitored than it
   was with nothing, because now you believe it is covered. Three layers stop that:
     1. **dedupe by SIGNATURE** — the caller passes a stable `key`, and repeats
        inside `COOLDOWN_MS` are counted rather than sent;
     2. a re-send after the cooldown carries "N more since", so a persistent fault
        escalates instead of going quiet;
     3. a **global ceiling** per window, past which one summary is sent and the rest
        are counted. A storm can cost you at most `MAX_PER_WINDOW` messages.

   ⚠️⚠️ **THE COOLDOWN STATE IS PERSISTED, AND THAT IS WHAT SURVIVES A CRASH LOOP.**
   `uncaughtException` notifies and then exits; the host restarts the process; with
   in-memory state only, the same fault would notify again on every boot, which is
   precisely the storm the dedupe exists to prevent, arriving by a different door.
   `DATA_DIR/alerts.json` holds the last-notified stamps (the same disk the demo
   library and the canary already use). Written only when a notification is actually
   sent, so an un-notified hot-path error costs no disk at all.

   ⚠️ **IT NEVER THROWS, AND IT IS NEVER AWAITED BY ANYTHING THAT MATTERS.** Same
   rule `sendMail` already follows: a notification failing must not fail the thing it
   was reporting on, or an error handler becomes a second error. Every path returns a
   result instead of raising, and callers use `void alert(...)` unless they are about
   to exit.

   ⚠️ **NON-PRODUCTION LOGS INSTEAD OF SENDING**, like the mailer — a staging service
   stood up by copying production's environment must not page anybody. `ALLOW_ALERTS=1`
   forces a real send for a one-off test.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./demoStore.ts";
import { appEnv, isProduction } from "./appEnv.ts";
import { adminEmails } from "./admins.ts";
import { sendMail, mailConfigured } from "./mailer.ts";

/** How long one signature stays quiet after being reported. */
const COOLDOWN_MS = 30 * 60_000;
/** The global ceiling, and the window it applies over. */
const MAX_PER_WINDOW = 12;
const WINDOW_MS = 60 * 60_000;
/** Distinct signatures kept in memory and on disk. Bounded, oldest evicted first. */
const MAX_KEYS = 200;
/**
 * How often an occurrence that is NOT being notified may touch the disk.
 *
 * ⚠️⚠️ **THE AUDIT FOUND THE COUNT BEING LOST ACROSS A RESTART.** The first version
 * persisted only when a notification was sent, so a fault that fired two hundred
 * times quietly and then hit a process restart came back reporting "1" — the
 * escalation ("fired N times since the last alert") is most valuable for exactly
 * that long-lived fault, and it was the case that lost it.
 * ⚠️ **AND WRITING ON EVERY OCCURRENCE IS THE THING THIS FILE WAS DESIGNED NOT TO
 * DO**: an error in a hot path would then fsync per request. A throttle keeps both —
 * counts survive a restart to within a minute, and a storm costs one write a minute.
 * Consequence, stated: occurrences inside one throttle window can be lost to a
 * restart. That is a count being slightly low, never a missed notification, because
 * `notifiedAt` is written the moment a notification goes out.
 */
let persistThrottleMs = 60_000;
let lastPersist = 0;

const STATE_FILE = path.join(DATA_DIR, "alerts.json");

/**
 * "page" reaches you now. "record" is counted and shows up on `/api/status`, and is
 * for things worth knowing in aggregate but not worth interrupting anybody over — a
 * single client-side render error, say, where the shape of the week matters and one
 * instance does not.
 */
export type AlertLevel = "page" | "record";

export interface AlertInput {
  /** The SIGNATURE, not the message: stable across occurrences of the same fault.
   *  "chat-500", "client-error:/dashboards/marketing:TypeError", "voice-worker-missing". */
  key: string;
  title: string;
  detail?: string;
  level?: AlertLevel;
  /** Anything that helps diagnose: the route, the prospect, the commit. Rendered as
   *  `key: value` lines. Keep it small — this ends up in a Slack message. */
  context?: Record<string, string | number | boolean | null | undefined>;
}

export interface AlertResult {
  /** Did a notification actually leave the process? */
  sent: boolean;
  /** Why not, when it did not: "suppressed", "cooldown", "record", "staging", "no channel". */
  reason?: string;
  /**
   * How many times this signature has fired since the last notification went out,
   * **including this occurrence**.
   *
   * ⚠️ ONE DEFINITION, AND THE AUDIT CAUGHT IT BEING TWO. The first version returned
   * `since - 1` so that a first report read 0, which made the count off by one on
   * every other path: the second occurrence of a quiet fault also read 0, i.e.
   * indistinguishable from "this has never happened before". Counting occurrences
   * and letting `render()` decide when to print is the version that cannot disagree
   * with itself.
   */
  repeats: number;
}

interface KeyState {
  first: string;
  last: string;
  /** Occurrences since the last notification went out. */
  since: number;
  /** Total occurrences, ever (within the retained window). */
  total: number;
  notifiedAt: string | null;
}

interface AlertState {
  keys: Record<string, KeyState>;
  /** Timestamps of notifications sent, for the global ceiling. */
  sends: string[];
  /** How many notifications the ceiling has swallowed since it last said so. */
  suppressed: number;
  suppressNotedAt: string | null;
}

let state: AlertState | null = null;

function blank(): AlertState {
  return { keys: {}, sends: [], suppressed: 0, suppressNotedAt: null };
}

/** ⚠️ A CORRUPT OR ABSENT FILE MUST NOT TAKE THE ALERTER DOWN — it is the one thing
 *  that has to work when other things are broken. Same fail-open reasoning as
 *  `agentWorkflows.read()`: a bad store degrades to "no history", never to a throw. */
function load(): AlertState {
  if (state) return state;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as AlertState;
    state = parsed && typeof parsed === "object" && parsed.keys
      ? { keys: parsed.keys, sends: parsed.sends ?? [], suppressed: parsed.suppressed ?? 0,
          suppressNotedAt: parsed.suppressNotedAt ?? null }
      : blank();
  } catch {
    state = blank();
  }
  return state!;
}

/** Write only if the throttle has elapsed. For occurrences nobody is being told about. */
function maybePersist(): void {
  if (Date.now() - lastPersist < persistThrottleMs) return;
  persist();
}

function persist(): void {
  lastPersist = Date.now();
  const s = load();
  /* Bounded: keep the most recently seen signatures only, so a long-lived process
     cannot grow this file without limit. */
  const entries = Object.entries(s.keys)
    .sort((a, b) => Date.parse(b[1].last) - Date.parse(a[1].last))
    .slice(0, MAX_KEYS);
  const out: AlertState = {
    keys: Object.fromEntries(entries),
    sends: s.sends.slice(-MAX_PER_WINDOW * 4),
    suppressed: s.suppressed,
    suppressNotedAt: s.suppressNotedAt,
  };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
  } catch (e: any) {
    console.error("[alert] could not persist state:", e?.message || e);
  }
}

/* ---- the channels ------------------------------------------------------------
   ⚠️⚠️ **SLACK IS A WEBHOOK URL AND NOTHING MORE, WHICH IS THE WHOLE POINT.** Slack
   delivery was asked for, and `docs/INTEGRATIONS.md` records a CLOSED request for
   exactly that — *"Slack notification when my demo finishes generating"*, rejected
   because *"it needs a Slack app and workspace approval"*. That request was for an
   app with `search:read`; posting to one channel is a far smaller ask, and there are
   three ways to produce the URL: an incoming-webhook app (a small approval), Slack's
   own email-to-channel address (NO approval, and it arrives through the mailer path
   below), or a Workflow Builder webhook (no app). This code cannot tell them apart,
   so an approval stalling does not block anything.
   ⚠️ **EMAIL IS THE FALLBACK, NOT A SECOND CHANNEL.** Two channels firing for one
   fault is two things to mute. Slack when the webhook is set, email otherwise. */
const slackUrl = (): string => (process.env.SLACK_WEBHOOK_URL ?? "").trim();

export const alertsConfigured = (): boolean => !!slackUrl() || mailConfigured();

/** Which channel a real send would use right now. Reported by `/api/status`. */
export const alertChannel = (): "slack" | "email" | "none" =>
  slackUrl() ? "slack" : mailConfigured() ? "email" : "none";

async function postSlack(text: string): Promise<void> {
  const res = await fetch(slackUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    /* `text` only: a webhook created any of the three ways accepts it, where Block
       Kit is not guaranteed on a Workflow Builder trigger. Readability comes from
       the message itself rather than from blocks we cannot rely on. */
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`slack ${res.status} ${(await res.text()).slice(0, 120)}`);
}

/* ---- the message ------------------------------------------------------------- */

/** ⚠️ EVERY FIELD IS CAPPED, INCLUDING THE TITLE — found by the audit, which fed it a
 *  5,000-character title and got a 5,000-character Slack message. The detail and the
 *  context values were capped from the start and the title was not, which is the one
 *  an exception message lands in most often. */
const TITLE_MAX = 200;

function render(a: AlertInput, occurrences: number): { subject: string; body: string } {
  const env = appEnv();
  const commit = (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7);
  const lines: string[] = [];
  if (a.detail) lines.push(a.detail.slice(0, 1200));
  const ctx: Record<string, unknown> = { ...(a.context ?? {}) };
  if (commit) ctx.commit = commit;
  ctx.environment = env;
  /* ⚠️ ONLY WHEN IT IS ACTUALLY A REPEAT. `occurrences` counts this one too, so a first
     report is 1 and printing "fired 1 times" on it would be noise. */
  if (occurrences > 1) ctx["fired"] = `${occurrences} times since the last alert`;
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null || v === "") continue;
    lines.push(`${k}: ${String(v).slice(0, 300)}`);
  }
  /* The environment leads the subject so a staging page is obvious at a glance —
     `ALLOW_ALERTS=1` on staging is a real thing somebody will do while testing. */
  const tag = env === "production" ? "" : `[${env}] `;
  return { subject: `${tag}${a.title.slice(0, TITLE_MAX)}`, body: lines.join("\n") };
}

/* ---- the funnel -------------------------------------------------------------- */

/**
 * Report that something is wrong. Never throws.
 *
 * ⚠️ Pass a STABLE `key`. `key: err.message` looks right and defeats the dedupe the
 * moment a message interpolates an id or a timestamp, which is most of them.
 */
export async function alert(input: AlertInput): Promise<AlertResult> {
  try {
    return await run(input);
  } catch (e: any) {
    /* The alerter itself failing is the one error that cannot be alerted on. */
    console.error(`[alert] funnel failed for "${input.key}":`, e?.message || e);
    return { sent: false, reason: "funnel failed", repeats: 0 };
  }
}

async function run(input: AlertInput): Promise<AlertResult> {
  const s = load();
  const now = new Date();
  const iso = now.toISOString();
  const level: AlertLevel = input.level ?? "page";

  const prev = s.keys[input.key];
  const k: KeyState = prev
    ? { ...prev, last: iso, since: prev.since + 1, total: prev.total + 1 }
    : { first: iso, last: iso, since: 1, total: 1, notifiedAt: null };
  s.keys[input.key] = k;

  /* Always logged, whatever happens next, so Render's own log keeps the full record
     even for occurrences the channel never sees. */
  console.error(`[alert] ${input.key.slice(0, 120)}: ${input.title.slice(0, 200)}`
    + (input.detail ? ` — ${input.detail.slice(0, 200)}` : ""));

  if (level === "record") { maybePersist(); return { sent: false, reason: "record", repeats: k.since }; }

  const quietUntil = k.notifiedAt ? Date.parse(k.notifiedAt) + COOLDOWN_MS : 0;
  if (now.getTime() < quietUntil) { maybePersist(); return { sent: false, reason: "cooldown", repeats: k.since }; }

  /* The global ceiling. Counted, and said out loud once per window rather than
     silently — a monitor that quietly stops reporting is the failure the canary's
     own "silence is not success" note is about. */
  s.sends = s.sends.filter((t) => now.getTime() - Date.parse(t) < WINDOW_MS);
  if (s.sends.length >= MAX_PER_WINDOW) {
    s.suppressed += 1;
    const noted = s.suppressNotedAt ? Date.parse(s.suppressNotedAt) : 0;
    if (now.getTime() - noted > WINDOW_MS) {
      s.suppressNotedAt = iso;
      const r = await deliver({
        subject: `${appEnv() === "production" ? "" : `[${appEnv()}] `}Alerts are being rate limited`,
        body: `More than ${MAX_PER_WINDOW} alerts in the last hour, so further ones are being counted instead of sent.\n`
          + `Most recent: ${input.title}\nSee /api/status for the running counts.`,
      });
      persist();
      return { sent: r.sent, reason: "suppressed (ceiling noted)", repeats: k.since };
    }
    persist();
    return { sent: false, reason: "suppressed", repeats: k.since };
  }

  const occurrences = k.since;
  const { subject, body } = render(input, occurrences);
  const r = await deliver({ subject, body });
  if (r.sent) {
    k.notifiedAt = iso;
    k.since = 0;
    s.sends.push(iso);
  }
  persist();
  return { sent: r.sent, reason: r.reason, repeats: occurrences };
}

async function deliver(msg: { subject: string; body: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!isProduction() && process.env.ALLOW_ALERTS !== "1") {
    console.log(`[alert] ${appEnv()}: not sending — "${msg.subject}"`);
    return { sent: false, reason: `${appEnv()} does not send alerts` };
  }
  const url = slackUrl();
  if (url) {
    try {
      await postSlack(`*${msg.subject}*\n${msg.body}`);
      console.log(`[alert] posted to Slack: ${msg.subject}`);
      return { sent: true };
    } catch (e: any) {
      /* ⚠️ A DEAD WEBHOOK FALLS BACK TO EMAIL RATHER THAN LOSING THE ALERT. A revoked
         webhook is exactly the kind of quiet breakage that would otherwise take the
         whole alerting channel with it, and nothing would say so. */
      console.error("[alert] Slack post failed, falling back to email:", e?.message || e);
    }
  }
  const to = adminEmails();
  if (!to.length || !mailConfigured()) {
    return { sent: false, reason: "no channel configured" };
  }
  const results = await Promise.all(to.map((addr) =>
    sendMail({ to: addr, subject: msg.subject, text: msg.body })));
  const sent = results.some((x) => x.sent);
  return { sent, reason: sent ? undefined : results[0]?.reason };
}

/* ---- what `/api/status` reports ---------------------------------------------
   ⚠️ COUNTS AND KEYS ONLY, NEVER THE DETAIL. That endpoint is PUBLIC, and the
   standing rule is counts and booleans — no prospect names, no demo ids, no key
   values. A signature like "chat-500" is safe; the error text that produced it is
   not, because a message can quote a prospect or a URL. */
export function alertSummary() {
  const s = load();
  const now = Date.now();
  const keys = Object.values(s.keys);
  const recent = Object.entries(s.keys)
    .filter(([, k]) => now - Date.parse(k.last) < 24 * 3_600_000)
    .sort((a, b) => Date.parse(b[1].last) - Date.parse(a[1].last));
  return {
    channel: alertChannel(),
    /* Distinct signatures seen in the last 24h, and how many times in total. */
    distinct24h: recent.length,
    total24h: recent.reduce((n, [, k]) => n + k.total, 0),
    /* The signatures themselves, newest first, capped — enough to say WHAT is
       failing without saying anything about whom it failed for. */
    topKeys: recent.slice(0, 8).map(([key, k]) => ({ key, count: k.total, last: k.last })),
    suppressed: s.suppressed,
    everSeen: keys.length,
  };
}

/** Test seam: drop all state, on disk and in memory. `audit:alerts` only. */
export function resetAlertsForTest(): void {
  state = blank();
  try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* nothing to remove */ }
}

/**
 * Test seam: forget the in-memory copy and re-read the file on the next call —
 * i.e. exactly what a RESTARTED PROCESS does. `audit:alerts` only.
 *
 * ⚠️ This is how the crash-loop property is actually tested rather than argued:
 * notify, reload, notify the same signature again, and the cooldown must still
 * hold. In-memory-only state passes every other check in that suite and fails
 * this one, which is the whole reason the file exists.
 */
export function reloadAlertsForTest(): void {
  state = null;
}

/** Test seam: the path the state lives at, so a suite can inspect it. */
export const alertStateFileForTest = (): string => STATE_FILE;

/** Test seam: the LIVE state, so a suite can expire a cooldown without sleeping
 *  30 minutes and without conflating that with the persistence path. */
export const alertStateForTest = () => load();

/** Test seam: make every occurrence persist, so the throttled write is testable. */
export const setPersistThrottleForTest = (ms: number): void => { persistThrottleMs = ms; lastPersist = 0; };
