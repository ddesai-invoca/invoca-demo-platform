/* =============================================================================
   audit-alerts — the alert funnel's contract, exercised against a REAL channel
   -----------------------------------------------------------------------------
   Run with `npm run audit:alerts` (and by `npm run audit`).

   ⚠️⚠️ **THIS SUITE DELIVERS TO A LOCAL HTTP SERVER STOOD UP HERE, NOT TO SLACK AND
   NOT TO THE NETWORK.** The dedupe, the cooldown and the ceiling are only observable
   once a send actually SUCCEEDS — with no channel configured every call returns
   `sent: false` and every one of these checks would pass against a funnel that
   dedupes nothing. That is the tautological-check trap this repo records three times
   over, so the fake webhook is not convenience, it is the only way the assertions
   mean anything. Same reason `audit:advanced` mocks `fetch` rather than calling Gong,
   and `audit:replicas` learned not to depend on example.com being reachable.

   ⚠️ **`DATA_DIR` IS SET BEFORE `alerts.ts` IS IMPORTED**, because `demoStore`
   resolves it at module load — the trick `audit:events` already uses. Everything
   here writes to a throwaway directory and nothing touches the real store.
   ============================================================================= */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-audit-"));
process.env.DATA_DIR = TMP;
process.env.ALLOW_ALERTS = "1";
delete process.env.RENDER_GIT_COMMIT;
process.env.APP_ENV = "local";

let fail = 0;
const bad = (msg: string) => { console.log(`  FAIL  ${msg}`); fail++; };
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const check = (cond: unknown, msg: string) => (cond ? ok(msg) : bad(msg));

/* ---- a stand-in for the Slack webhook --------------------------------------- */
const posted: string[] = [];
let status = 200;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (status === 200) posted.push(body);
    res.writeHead(status).end(status === 200 ? "ok" : "nope");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as { port: number }).port;
process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;

const A = await import("../engine/alerts.ts");
const { alert, alertSummary, alertChannel, alertsConfigured, resetAlertsForTest,
  reloadAlertsForTest, alertStateFileForTest, alertStateForTest, setPersistThrottleForTest } = A;

const lastPost = () => (posted.length ? JSON.parse(posted[posted.length - 1]).text as string : "");
const fresh = () => { resetAlertsForTest(); posted.length = 0; status = 200; };

console.log("\nThe channel");
{
  check(alertChannel() === "slack", "a webhook URL selects Slack as the channel");
  check(alertsConfigured(), "a webhook alone counts as configured");
}

console.log("\nOne fault, one message");
{
  fresh();
  const r1 = await alert({ key: "probe-a", title: "Thing broke", detail: "the detail",
    context: { route: "/dashboards/marketing" } });
  check(r1.sent && posted.length === 1, "the first occurrence is delivered");
  check(/Thing broke/.test(lastPost()) && /the detail/.test(lastPost()),
    "the message carries the title and the detail");
  check(/route: \/dashboards\/marketing/.test(lastPost()),
    "and the context lines, so it is diagnosable without opening the logs");
  check(/\[local\]/.test(lastPost()),
    "a non-production alert says so in the subject");

  /* ⚠️ THE CHECK THIS WHOLE SUITE EXISTS FOR. */
  const r2 = await alert({ key: "probe-a", title: "Thing broke", detail: "again" });
  const r3 = await alert({ key: "probe-a", title: "Thing broke", detail: "and again" });
  check(!r2.sent && r2.reason === "cooldown" && !r3.sent && posted.length === 1,
    "repeats of the same signature are counted, not sent");
  check(r3.repeats === 2, "and the repeat count is tracked while it is quiet");

  const r4 = await alert({ key: "probe-b", title: "A different thing" });
  check(r4.sent && posted.length === 2, "a DIFFERENT signature still gets through");
}

console.log("\nA persistent fault escalates instead of going quiet");
{
  fresh();
  await alert({ key: "probe-c", title: "Recurring" });
  await alert({ key: "probe-c", title: "Recurring" });
  await alert({ key: "probe-c", title: "Recurring" });
  /* ⚠️ Expire the cooldown IN MEMORY rather than by rewriting the file and reloading.
     The file route conflates this with persistence, which the crash-loop block below
     tests on its own — and it was how the first version of this check managed to fail
     on correct code (the count had not been written yet, because nothing was notified). */
  alertStateForTest().keys["probe-c"].notifiedAt = new Date(Date.now() - 31 * 60_000).toISOString();
  const r = await alert({ key: "probe-c", title: "Recurring" });
  check(r.sent && posted.length === 2, "once the cooldown passes it reports again");
  check(/fired: 3 times since the last alert/.test(lastPost()),
    "and it names how many times it fired while quiet");
}

console.log("\nA crash loop cannot storm the channel");
{
  fresh();
  const r1 = await alert({ key: "boot-crash", title: "uncaughtException" });
  check(r1.sent, "the first boot's crash is reported");
  /* ⚠️ EXACTLY WHAT A RESTART DOES: the in-memory state is gone, the disk is not. */
  reloadAlertsForTest();
  const r2 = await alert({ key: "boot-crash", title: "uncaughtException" });
  reloadAlertsForTest();
  const r3 = await alert({ key: "boot-crash", title: "uncaughtException" });
  check(!r2.sent && !r3.sent && posted.length === 1,
    "a restart re-reads the cooldown from disk, so the next boots stay quiet");
}

console.log("\nQuiet occurrences still reach the disk, eventually");
{
  fresh();
  setPersistThrottleForTest(0);
  await alert({ key: "counted", title: "Counted" });
  await alert({ key: "counted", title: "Counted" });
  await alert({ key: "counted", title: "Counted" });
  reloadAlertsForTest();
  const onDisk = JSON.parse(fs.readFileSync(alertStateFileForTest(), "utf8"));
  check(onDisk.keys["counted"]?.since === 2,
    "counts survive a restart, so a long-lived quiet fault escalates honestly");
  setPersistThrottleForTest(60_000);
}

console.log("\nThe global ceiling");
{
  fresh();
  const results = [];
  for (let i = 0; i < 20; i++) results.push(await alert({ key: `storm-${i}`, title: `Storm ${i}` }));
  check(posted.length <= 13, `a 20-fault storm costs at most 13 messages (was ${posted.length})`);
  check(results.some((r) => (r.reason ?? "").startsWith("suppressed")),
    "the ones past the ceiling report themselves as suppressed");
  check(posted.some((p) => /rate limited/i.test(p)),
    "and the ceiling says so once, rather than going silently quiet");
  check(alertSummary().suppressed > 0, "the suppressed count is visible on the summary");
}

console.log('\n"record" level counts without interrupting anybody');
{
  fresh();
  const r = await alert({ key: "quiet-thing", title: "Worth knowing", level: "record" });
  check(!r.sent && r.reason === "record" && posted.length === 0, "a record-level alert sends nothing");
  check(alertSummary().distinct24h === 1 && alertSummary().total24h === 1,
    "but it is counted for /api/status");
}

console.log("\nWhat /api/status may see");
{
  fresh();
  await alert({ key: "leaky", title: "Demo save failed", detail: "prospect Aptive, demo id aptive",
    context: { prospect: "Aptive" } });
  const sum = JSON.stringify(alertSummary());
  /* ⚠️ THE PUBLIC ENDPOINT RULE: counts and signatures, never the detail. A message
     can quote a prospect or a URL; a signature cannot. */
  check(!/Aptive/.test(sum) && !/prospect/.test(sum),
    "the summary leaks no detail or context — /api/status is PUBLIC");
  check(/leaky/.test(sum), "but it does name the signature, so you can tell WHAT is failing");
  check(typeof alertSummary().total24h === "number", "and it carries counts");
}

console.log("\nIt fails safe");
{
  fresh();
  status = 500;
  const r = await alert({ key: "dead-hook", title: "Webhook is dead" });
  check(!r.sent && /no channel/.test(r.reason ?? ""),
    "a dead webhook falls through to email rather than throwing");
  status = 200;

  fresh();
  const nasty = await alert({ key: "x".repeat(500), title: "y".repeat(5000),
    detail: "z".repeat(50_000), context: { a: undefined, b: null, c: "" } as any });
  check(typeof nasty.sent === "boolean", "absurd input returns a result instead of throwing");
  check(lastPost().length < 4000, "and the message is capped rather than unbounded");

  fresh();
  process.env.ALLOW_ALERTS = "";
  const quiet = await alert({ key: "staging-quiet", title: "Should not send" });
  check(!quiet.sent && posted.length === 0 && /does not send/.test(quiet.reason ?? ""),
    "non-production sends nothing without ALLOW_ALERTS");
  process.env.ALLOW_ALERTS = "1";
}

/* ---- the WIRING: is the funnel actually connected to anything? --------------
   ⚠️⚠️ **A PERFECT FUNNEL NOBODY CALLS IS THE FAILURE MODE THIS SECTION EXISTS FOR.**
   Every check above passes against an `alerts.ts` that no error path ever reaches —
   which is precisely the silent no-op this repo has recorded six times. These read
   the real files. */
console.log("\nThe wiring");
{
  const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const srv = code("server.ts");
  const vite = code("vite.config.ts");

  check(/process\.on\("uncaughtException"/.test(srv) && /process\.on\("unhandledRejection"/.test(srv),
    "both process-level handlers are installed");
  /* ⚠️ THE ONE ALERT THAT MUST BE AWAITED. A floating promise dies with the process,
     so the most important notification the app can send is the one that would never
     leave — and the exit has to wait for it. */
  check(/await Promise\.race\(\[\s*alert\(/.test(srv),
    "the crash alert is awaited before the process exits");
  check(/setTimeout\(r, 3_000\)/.test(srv),
    "and it is capped, so a dead channel delays the exit rather than hanging it");

  /* ⚠️ EXPRESS DECIDES AN ERROR HANDLER BY ARITY — four arguments. A three-argument
     one registered in the same place is ordinary middleware and silently never runs. */
  const handler = srv.match(/app\.use\(\((err[^)]*)\)/);
  check(!!handler && handler[1].split(",").length === 4,
    "the Express error handler takes four arguments, so Express treats it as one");
  check(srv.indexOf('app.get("*"') < srv.indexOf("app.use((err"),
    "and it is registered after the catch-all, where it can actually see errors");

  check(/app\.post\("\/api\/client-error"/.test(srv),
    "server.ts serves POST /api/client-error");
  check(/'invoca-client-error-api'/.test(vite) && /clientErrorApi\(\)/.test(vite),
    "and the dev twin serves it too, so the hook is not silently a no-op locally");
  check(srv.indexOf('app.post("/api/client-error"') < srv.indexOf("installAuth(app)"),
    "it sits OUTSIDE the auth gate, so an expired session still reports");
  check(/key: `client:\$\{route\}:\$\{name\}`/.test(srv),
    "client signatures are namespaced, so a caller cannot forge a server-side one");

  check(/alerts: alertSummary\(\)/.test(srv) && /alerts: alertSummary\(\)/.test(vite),
    "both twins report the alert counts on /api/status");
  check(/alertOnCanary\(\)/.test(srv) && /needsAttention/.test(srv),
    "the nightly canary's own verdict raises an alert");
  check(/date === lastAttentionDate/.test(srv),
    "and at most once per ET day, because a daily signal must not page hourly");

  const boundary = code("src/components/DashboardBoundary.tsx");
  check(/componentDidCatch/.test(boundary) && /reportClientError/.test(boundary),
    "the error boundary reports instead of swallowing");
  check(/export function ScreenBoundary/.test(boundary),
    "and the standalone screens have a boundary of their own");
  check(/<ScreenBoundary>/.test(code("src/App.tsx")),
    "which is actually wrapped around the route tree");
  check(/installClientErrorReporting\(\)/.test(code("src/main.tsx")),
    "the global error hooks are installed at boot");
  const client = code("src/data/clientErrors.ts");
  check(/addEventListener\("error"/.test(client) && /addEventListener\("unhandledrejection"/.test(client),
    "and they cover BOTH channels — a rejected promise never reaches onerror");
  check(/keepalive: true/.test(client),
    "a report survives the navigation a crash often triggers");
  check(/if \(!\(e as ErrorEvent\)\.error && \(e\.target as Element\)\?\.tagName\) return;/.test(client),
    "a broken image is not reported as a platform failure");
  check(/where: "voice-agent-missing"/.test(code("src/data/liveKitVoice.ts")),
    "the voice watchdog reports when no agent ever joins");
}

/* ---- every failure path goes through the one helper -------------------------
   ⚠️⚠️ **THE POINT OF THIS SECTION IS THAT A ROUTE CANNOT LOG WITHOUT ALERTING.**
   Counting call sites would pass the day somebody adds a 14th handler that quietly
   goes back to a bare `console.error` — which is exactly the state this whole piece
   of work started from (18 log lines, 5 alerts). So it checks the REMAINDER instead:
   every surviving `console.error` in server.ts must be one of the few that legitimately
   is not a route. */
console.log("\nNo route can fail silently");
{
  const raw = fs.readFileSync(path.resolve("server.ts"), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  check(/function routeFailed\(/.test(src), "server.ts has one failure helper");
  /* It must do BOTH, or the helper is just a rename of the problem. */
  const body = src.slice(src.indexOf("function routeFailed("), src.indexOf("function routeFailed(") + 700);
  check(/console\.error\(/.test(body) && /void alert\(/.test(body),
    "and it logs AND alerts, so one cannot happen without the other");

  const ALLOWED = [
    /\$\{key\}/,          // the helper's own line
    /✗/,                   // the two crash handlers, which alert separately
    /🐤/,                   // canary scaffolding
    /⚠ skipped/,           // boot event-seeding, per roster file
  ];
  const strays = src.split("\n")
    .map((l, i) => [i + 1, l] as [number, string])
    .filter(([, l]) => /console\.error\(/.test(l))
    .filter(([, l]) => !ALLOWED.some((re) => re.test(l)));
  strays.length === 0
    ? ok(`no route handler logs without alerting (${src.split("\n").filter((l) => /routeFailed\(/.test(l)).length - 1} paths wired)`)
    : strays.forEach(([n, l]) => bad(`server.ts:${n} logs without alerting: ${l.trim().slice(0, 70)}`));

  /* ⚠️ THE LEVELS ARE THE DIFFERENCE BETWEEN A USEFUL CHANNEL AND A MUTED ONE. */
  check(/routeFailed\("chat", e, \{ level: isOverloaded\(e\) \? "record" : "page" \}\)/.test(src),
    "an overloaded AI is counted, not paged — it is expected and self-correcting");
  check(/routeFailed\("replicate", e, \{ level: "record"/.test(src)
     && /routeFailed\("replicate-capture", e, \{ level: "record"/.test(src),
    "a replicate failure is counted — it is usually the target site blocking us");
  check(/routeFailed\("generate-persist", writeErr/.test(src) && !/generate-persist[^)]*"record"/.test(src),
    "a delivered-but-unsaved profile DOES page — that is silent data loss");
  check(/routeFailed\("canary-tick"/.test(src),
    "a canary tick that throws reports immediately rather than waiting a day for stale");
}

server.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp dir */ }

console.log(fail ? `\n${fail} alert check(s) failed\n` : "\nAll alert checks passed\n");
process.exit(fail ? 1 : 0);
