/* =============================================================================
   canary.ts — the nightly "is generation still fast and still correct?" check
   -----------------------------------------------------------------------------
   Runs one full generateProfile() against a fixed target, times every phase,
   audits the result, and THROWS THE PROFILE AWAY.

   WHY IT LIVES IN THE SERVER, not in a cloud agent or a cron container:
   generateProfile() needs ANTHROPIC_API_KEY, and the deployed web service is the
   one place that already has it. Putting the run here means no new endpoint that
   bypasses the Google gate, and no credential that has to be handed to anything
   else. The scheduled cloud agent that reacts to a regression only ever reads the
   PUBLIC result below, so it needs no secret at all.

   ⚠️ THE PROFILE IS NEVER PERSISTED. Not to the demo library, not to
   src/data/generated. Only the small result record is written. That is
   deliberate: "generate then delete" leaves junk behind whenever the run dies
   between the two steps, and this cannot. It also means the canary can never put
   a fake prospect in front of the team.

   ⚠️ FIXED TARGETS, deliberately not random. Research time swings with site size
   (measured: 60s on one prospect, 85s on another), which is far larger than any
   regression worth catching. A rotating set of three stable sites, each compared
   against ITS OWN history, keeps the signal readable. Rotating rather than one
   single site so the pipeline is never tuned to exactly one page shape.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { generateProfile } from "./core.ts";
import { DATA_DIR } from "./demoStore.ts";

/* The budget the user set: a generation must stay under five minutes. */
export const BUDGET_SECONDS = 300;

/* Three stable, public, differently-sized sites. Names are NOT published by the
   public endpoint — see toPublic() — so nobody can mistake a canary target for
   an Invoca sales prospect. */
const TARGETS = [
  { name: "Roto-Rooter Plumbing & Water Cleanup", url: "https://www.rotorooter.com/" },
  { name: "Goosehead Insurance", url: "https://www.goosehead.com/" },
  { name: "Mattress Firm", url: "https://www.mattressfirm.com/" },
];

export interface CanaryPhase { phase: string; seconds: number }
export interface CanaryRun {
  startedAt: string;
  targetIndex: number;          // which of TARGETS ran, so runs are comparable
  ok: boolean;
  error: string | null;
  totalSeconds: number | null;
  overBudget: boolean;
  budgetSeconds: number;
  phases: CanaryPhase[];        // longest first
  slowestPhase: string | null;
  prefixSeconds: number | null; // serial research+terms time = total - longest phase
  audit: { checks: number; failures: string[] };
  commit: string | null;
}

const RESULT_FILE = path.join(DATA_DIR, "canary.json");
const KEEP_RUNS = 30;

/* ---- the audit ------------------------------------------------------------
   generateProfile() already Zod-validates, so shape is guaranteed. What Zod does
   NOT police is the handful of fields other screens quietly depend on, plus
   whether the dashboard's numbers actually add up. Those are the regressions that
   ship silently, so they are what the canary checks. */
export function auditProfile(p: any): { checks: number; failures: string[] } {
  const fail: string[] = [];
  let checks = 0;
  const check = (label: string, ok: boolean) => { checks++; if (!ok) fail.push(label); };
  const num = (s: unknown) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;

  const md = p?.reports?.marketingDashboard;
  const bds: any[] = md?.breakdowns ?? [];
  const byTitle = (re: RegExp) => bds.find((b) => re.test(b.title ?? ""));

  /* Fields another screen reads and would silently fall back on. */
  check("Google Ads keyword source (a Search Term breakdown row)",
    !!byTitle(/search term/i)?.rows?.[0]);
  check("Google Ads ad-group source (a Product Category breakdown row)",
    !!byTitle(/product category/i)?.rows?.[0]);
  check("bookingTerm present (drives the Ads conversion label)", !!p?.bookingTerm);
  check("Preview Agent has questions to edit",
    Array.isArray(p?.reports?.agentConfig?.smsPlaybook?.qualifyingQuestions)
    && p.reports.agentConfig.smsPlaybook.qualifyingQuestions.length > 0);
  check("sponsored-link target (brandDomain)", !!p?.brandDomain);
  /* The "Qa pairs" card on AI Recommendations opens a modal of these. agentConfig
     .aiRecommendations is OPTIONAL, so a generation that omits it passes Zod
     silently and the card renders looking normal but does nothing when clicked —
     found on a real demo mid-session. The screen now falls back to derived pairs so
     it is never dead, but a generation that skipped them is still a regression worth
     knowing about at 5am rather than in front of a prospect. */
  check("AI Recommendations has engine-generated Q&A pairs",
    ((p?.reports?.agentConfig?.aiRecommendations ?? []) as any[])
      .some((r) => (r?.qaPairs ?? []).length > 0));

  /* Canonical breakdown order — the dashboard's donut sequence and the Google
     Ads re-skin both depend on it (see assembleDashboard in core.ts). */
  const ORDER = [/^calls by source/i, /^calls by medium/i, /^calls by campaign/i,
    /^calls by search term/i, /product category/i, /region/i];
  check("breakdowns in canonical order", ORDER.every((re, i) => bds[i] && re.test(bds[i].title)));

  /* The arithmetic a prospect would actually add up. */
  const kpiCalls = num(md?.kpiGroups?.[0]?.tiles?.find((t: any) => /call count/i.test(t.label))?.value);
  for (const b of bds) {
    const calls = b.rows.reduce((s: number, r: any) => s + num(r.metrics[0]), 0);
    const complete = /source|medium|product category|region/i.test(b.title);
    if (complete) {
      check(`${b.title} sums to the call total`, Math.abs(calls - kpiCalls) <= kpiCalls * 0.005);
    } else {
      check(`${b.title} (top 5) sums to less than the total`, calls < kpiCalls);
    }
  }

  /* THE "VOLUME IS NOT VALUE" STORY, checked rather than merely asked for.

     Every Call Outcome Summary is supposed to open on the highest-volume row with the
     WORST conversion rate and close on the smallest with the BEST, because that
     contrast is the SE's line: "your biggest channel is not your best channel."
     Audited on disk, four older profiles had it exactly INVERTED on all six
     breakdowns and two recent ones missed it on one each — a prompt-only rule that
     was quietly not holding, and invisible until someone told that story on a call.

     The conversion column is index 2 on every breakdown shape (col 1 is Quote
     Discussed, or "<booking> Set (Industry)" on Product Category — reading col 1 by
     mistake is how a first pass at this check mis-scored Product Category). */
  for (const b of bds) {
    const rows: { calls: number; conv: number }[] = (b.rows ?? []).map((r: any) => ({
      calls: num(r.metrics?.[0]), conv: num(r.metrics?.[2]),
    }));
    if (rows.length < 3) continue;
    const biggest = rows.reduce((a, r) => (r.calls > a.calls ? r : a));
    const smallest = rows.reduce((a, r) => (r.calls < a.calls ? r : a));
    const lo = Math.min(...rows.map((r) => r.conv));
    const hi = Math.max(...rows.map((r) => r.conv));
    check(`${b.title}: biggest row has the WORST conversion rate`, biggest.conv === lo);
    check(`${b.title}: smallest row has the BEST conversion rate`, smallest.conv === hi);
  }

  /* Prose dashes. A lone "—" is a legitimate empty-cell placeholder; a dash with
     real text around it is the AI-tell the sweep exists to remove. */
  let prose = 0;
  (function walk(v: unknown) {
    if (typeof v === "string") { if (/[—–]/.test(v) && !/^[\s—–\-/|:.]*$/.test(v)) prose++; return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
  })(p);
  check(`no dash-joined prose (found ${prose})`, prose === 0);

  return { checks, failures: fail };
}

/* ---- the run -------------------------------------------------------------- */
export async function runCanary(apiKey: string): Promise<CanaryRun> {
  /* Rotate by day-of-year so each target is measured against its own history
     rather than against a different site's. */
  const started = new Date();
  const dayOfYear = Math.floor((started.getTime() - Date.UTC(started.getUTCFullYear(), 0, 0)) / 86400000);
  const targetIndex = dayOfYear % TARGETS.length;
  const target = TARGETS[targetIndex];

  const t0 = Date.now();
  const phases: CanaryPhase[] = [];
  const open = new Map<string, number>();

  const run: CanaryRun = {
    startedAt: started.toISOString(),
    targetIndex,
    ok: false,
    error: null,
    totalSeconds: null,
    overBudget: false,
    budgetSeconds: BUDGET_SECONDS,
    phases: [],
    slowestPhase: null,
    prefixSeconds: null,
    audit: { checks: 0, failures: [] },
    commit: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || null,
  };

  try {
    const profile = await generateProfile(target.name, target.url, {
      apiKey,
      onProgress: (e: { phase: string; status: "start" | "done" }) => {
        if (e.status === "start") open.set(e.phase, Date.now());
        else {
          const s = open.get(e.phase);
          if (s) phases.push({ phase: e.phase, seconds: +((Date.now() - s) / 1000).toFixed(1) });
        }
      },
    });
    run.totalSeconds = +((Date.now() - t0) / 1000).toFixed(1);
    run.ok = true;
    run.audit = auditProfile(profile);
    // profile goes out of scope here and is never written anywhere. That is the point.
  } catch (e: any) {
    run.error = e?.message ?? String(e);
    run.totalSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  }

  /* The SERIAL PREFIX, measured rather than inferred. research() and
     generateTerms() run before the pool, so they are pure serial time — now ~40%
     of the wall clock and the first thing to look at when the total creeps up.
     An earlier version derived this as (total - longest phase), which is only
     correct while a POOL phase is the longest; the moment research becomes the
     longest phase (a big multi-page site) that formula silently reports nonsense.
     Both are captured by name, so sum them. */
  const prefixOf = (name: string) => phases.find((p) => p.phase === name)?.seconds ?? 0;
  const prefix = prefixOf("research") + prefixOf("terms");
  if (prefix > 0) run.prefixSeconds = +prefix.toFixed(1);

  /* Sorted longest-first for reading, but the slowest POOL phase is what bounds
     the pool — research is serial and belongs to the prefix, not the pool. */
  phases.sort((a, b) => b.seconds - a.seconds);
  run.phases = phases;
  run.slowestPhase = phases.find((p) => p.phase !== "research" && p.phase !== "terms")?.phase ?? null;
  run.overBudget = run.totalSeconds !== null && run.totalSeconds > BUDGET_SECONDS;
  return run;
}

/* ---- the record ----------------------------------------------------------- */
export function recordRun(run: CanaryRun): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const prev = readRuns();
    fs.writeFileSync(RESULT_FILE, JSON.stringify([run, ...prev].slice(0, KEEP_RUNS), null, 2));
  } catch (e) {
    console.error("[canary] could not persist the result:", e);
  }
}

export function readRuns(): CanaryRun[] {
  try {
    const raw = fs.readFileSync(RESULT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/* PUBLIC payload. Registered ahead of the auth gate so the scheduled agent (and
   you, from a phone) can read it without a session — which is the whole reason
   this needs no shared secret.

   ⚠️ It is PUBLIC, so adding a field publishes it. Target NAMES and URLS are
   deliberately omitted: they are real companies, and a public endpoint implying
   they are Invoca prospects is exactly the leak /api/status was careful about.
   `targetIndex` is enough to compare like with like. Timings, phase names and
   audit labels carry no customer data. */
/* A run older than this means the canary has STOPPED running, which is itself a
   problem worth waking up to. 26h gives the nightly run six hours of slack. */
const MAX_AGE_HOURS = 26;

export function toPublic() {
  const runs = readRuns();
  const latest = runs[0] ?? null;

  /* ⚠️ SILENCE IS NOT SUCCESS. The first version computed needsAttention as
     `!!latest && (…)`, so with no runs on record it reported FALSE — a clean bill
     of health for a canary that had never run at all. A monitor whose "nothing
     wrong" and "not working" look identical is worse than no monitor, because it
     actively reassures you. Missing and stale are now failures in their own right. */
  const ageHours = latest ? (Date.now() - Date.parse(latest.startedAt)) / 3_600_000 : null;
  const missing = !latest;
  const stale = ageHours !== null && Number.isFinite(ageHours) && ageHours > MAX_AGE_HOURS;

  const reason =
    missing ? "no canary run on record — it has never run, or the result store was reset"
    : stale ? `last run was ${Math.round(ageHours!)}h ago (over ${MAX_AGE_HOURS}h) — the canary has stopped running`
    : !latest!.ok ? `the generation failed: ${latest!.error ?? "unknown error"}`
    : latest!.overBudget ? `took ${latest!.totalSeconds}s, over the ${BUDGET_SECONDS}s budget`
    : latest!.audit.failures.length ? `${latest!.audit.failures.length} audit failure(s) — it ran but produced wrong data`
    : null;

  return {
    ok: true,
    budgetSeconds: BUDGET_SECONDS,
    /* Explicit, so a reader never has to infer "it didn't run" from a null. */
    missing,
    stale,
    ageHours: ageHours === null ? null : +ageHours.toFixed(1),
    reason,
    latest: latest && {
      startedAt: latest.startedAt,
      targetIndex: latest.targetIndex,
      ok: latest.ok,
      error: latest.error,
      totalSeconds: latest.totalSeconds,
      overBudget: latest.overBudget,
      slowestPhase: latest.slowestPhase,
      prefixSeconds: latest.prefixSeconds,
      phases: latest.phases,
      audit: latest.audit,
      commit: latest.commit,
    },
    /* Trend for the SAME target, so a regression is visible rather than inferred. */
    history: runs
      .filter((r) => latest && r.targetIndex === latest.targetIndex)
      .slice(0, 10)
      .map((r) => ({ startedAt: r.startedAt, totalSeconds: r.totalSeconds, ok: r.ok, commit: r.commit })),
    needsAttention: reason !== null,
  };
}
