import type { CustomerProfile } from "./schema";
import type { DemoPlan, PlanItem } from "../../engine/demoPlan";
import { surfaceById, surfaceKey } from "./demoSurfaces";
import { columnEdits } from "./columnEdits";
import { stripGeneratedDashes } from "./questionImport";

/* =============================================================================
   applyPlan.ts — run a confirmed plan against a freshly generated demo
   -----------------------------------------------------------------------------
   Asked for 10/9/2026, and the pain it answers was stated outright: *"They're having
   to use the Ask AI button on all the screens to change it."* So this is literally
   that, done once, from the plan the SE already confirmed.

   ⚠️⚠️ **IT RUNS IN THE BROWSER, THROUGH THE SAME `applyEdits` THE DRAWER USES, AND
   THAT IS THE WHOLE REASON IT IS SAFE.** Doing it server-side would mean a second
   implementation of the override merge, the `editGuard` refusals, the undo stack and
   the demo PATCH. Running it here inherits every one of them: a structural change or a
   type flip is dropped exactly as it would be from the drawer, each surface gets a real
   undo step, `readOnly` still refuses somebody else's demo, and the existing debounced
   PATCH in `AiAssistantContext` syncs the lot to the shared record with no new endpoint.

   ⚠️⚠️ **`registerBase`, NEVER `registerScope`.** The latter is last-write-wins and sets
   the ACTIVE scope, so registering 16 surfaces in a loop would leave the top bar's
   sparkle pointing at whichever screen happened to be last. `registerBase` exists for
   exactly this: make a key editable without making it active. `applyEdits` returns 0 for
   a key with no base, so skipping it would make every edit a silent no-op.

   ⚠️⚠️ **ONE SURFACE FAILING MUST NOT TAKE THE DEMO WITH IT.** The prospect is already
   generated and published by the time this runs; losing it because one assistant call
   timed out would be the worst trade in the feature. Every item is caught on its own and
   reported, and the walk continues.

   ⚠️⚠️ **PARALLEL NOW, 5 AT A TIME, BECAUSE THE BUDGET IS FIVE MINUTES (10/9/2026).**
   This first shipped sequential to stay clear of a rate limit. Measured, each item is a
   15 to 25 second Opus call, so five screen edits added ~100 seconds AFTER a ~3 minute
   generation and a customized demo could run past the five-minute goal. The surfaces
   are independent (one item per key, and `mutate` is a functional setState), and the
   generation pool already runs six Opus calls at once against the same key, so five
   here is well inside what that pool proves is fine. Ten items is two waves, not ten.
   ⚠️ **EACH ITEM IS CAPPED AT 90 SECONDS** (`ITEM_TIMEOUT_MS`). One hung call must not
   hold the whole demo past the budget; it is reported as failed and the demo opens.
   ============================================================================= */

export type ItemState = "waiting" | "running" | "done" | "skipped" | "failed";

export interface ItemProgress {
  surface: string;
  /** The surface's own label, so a caller does not have to look it up to render. */
  label: string;
  says: string;
  state: ItemState;
  /** Why it was skipped or how it failed, shown next to the row. */
  detail?: string;
}

export interface ApplyDeps {
  registerBase: (key: string, data: unknown) => void;
  applyEdits: (key: string, edits: { path: string; value: string }[]) => number;
  addTile: (key: string, tile: any) => void;
  effectiveData: (key: string) => unknown;
}

/* Mirrors the drawer: a generated tile is only ever drawn where GeneratedTiles renders
   it, so telling the model otherwise gets "add a tile" answered with a tile nobody sees. */
const canCreateTiles = (path: string) =>
  path.startsWith("/dashboards/") || path.startsWith("/reports/") || path.startsWith("/insights/");

async function askOne(
  customerName: string, title: string, data: unknown, question: string, path: string,
  signal?: AbortSignal,
): Promise<any> {
  const res = await fetch("/api/ai-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      customerName,
      dashboardTitle: title,
      dataContext: JSON.stringify(data),
      question,
      canCreateTiles: canCreateTiles(path),
      /* ⚠️ NOT STREAMED, DELIBERATELY, WHERE THE DRAWER ALWAYS IS. A drawer streams to
         move a progress bar for someone watching one answer; here the progress the SE
         watches is the LIST of surfaces, and each row is either done or not. One JSON
         body is less to go wrong on a path that is already looping. */
      stream: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "The assistant could not be reached.");
  return body?.result;
}

/** Land one assistant result on one surface. Returns how many edits actually applied. */
function land(key: string, path: string, r: any, deps: ApplyDeps): { applied: number; note?: string } {
  if (!r) return { applied: 0, note: "the assistant returned nothing" };

  if (r.kind === "create" && r.tile) {
    if (!canCreateTiles(path)) return { applied: 0, note: "this screen cannot draw a new tile" };
    deps.addTile(key, { id: crypto?.randomUUID?.() ?? String(Date.now()), ...r.tile });
    return { applied: 1 };
  }

  if (r.kind === "editColumn" && r.column && r.column.op !== "none") {
    /* THE APP splices, not the model — see `columnEdits`. Asked to emit whole cell lists
       the model rewrites untouched values, which is a demo shipping invented data. */
    const edits = columnEdits(deps.effectiveData(key), r.column, undefined);
    if (!edits) return { applied: 0, note: "this screen's table does not take column changes" };
    return { applied: deps.applyEdits(key, edits) };
  }

  if (r.kind === "editData" && Array.isArray(r.edits) && r.edits.length) {
    /* ⚠️ INSTRUCT THEN ENFORCE, the pairing used everywhere else here: the prompt asks
       for no dashes and the model mostly complies, and "mostly" is not demoable. Every
       STRING the assistant wrote is swept, because unlike the drawer this path has no
       human reading each edit before it lands. */
    const edits = r.edits.map((e: any) => {
      try {
        const v = JSON.parse(e.value);
        if (typeof v === "string") return { ...e, value: JSON.stringify(stripGeneratedDashes(v)) };
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          return { ...e, value: JSON.stringify(v.map((x) => stripGeneratedDashes(String(x)))) };
        }
      } catch { /* not JSON we can sweep; pass it through untouched */ }
      return e;
    });
    const applied = deps.applyEdits(key, edits);
    return applied
      ? { applied }
      : { applied: 0, note: "every edit was refused, usually a design or layout change" };
  }

  /* kind:"answer" is the model declining or explaining. Reported, never swallowed: an
     item that quietly does nothing is the failure this whole feature exists to stop. */
  return { applied: 0, note: r.answer ? String(r.answer).slice(0, 160) : "no change was made" };
}

const CONCURRENCY = 5;
const ITEM_TIMEOUT_MS = 90_000;

export interface ApplyResult { applied: number; items: ItemProgress[] }

/**
 * Walk a confirmed plan. `onProgress` fires on every state change so a caller can
 * render the list live.
 */
export async function applyPlan(
  plan: DemoPlan,
  profile: CustomerProfile,
  demoId: string,
  deps: ApplyDeps,
  onProgress?: (items: ItemProgress[]) => void,
  signal?: AbortSignal,
): Promise<ApplyResult> {
  const items: ItemProgress[] = plan.items.map((i: PlanItem) => ({
    surface: i.surface,
    label: surfaceById(i.surface)?.label ?? i.surface,
    says: i.says,
    state: "waiting",
  }));
  const report = () => { try { onProgress?.(items.map((i) => ({ ...i }))); } catch { /* never let a UI callback stop the walk */ } };
  report();

  let applied = 0;
  const runOne = async (n: number) => {
    const item = plan.items[n];
    const surface = surfaceById(item.surface);
    if (!surface || !surface.when(profile)) {
      items[n].state = "skipped";
      items[n].detail = "this prospect does not have that screen";
      report();
      return;
    }
    items[n].state = "running";
    report();
    /* Its own controller, so the 90 second cap cancels THIS call only, while the
       caller's signal still cancels everything. */
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctl.abort(), ITEM_TIMEOUT_MS);
    try {
      const base = surface.base(profile);
      const key = surfaceKey(demoId, surface.path);
      /* Seed BEFORE asking: `applyEdits` refuses a key with no base, and the answer
         arrives seconds later with nowhere to land. */
      deps.registerBase(key, base);
      const r = await askOne(profile.customerName, surface.label, base, item.instruction, surface.path, ctl.signal);
      const { applied: got, note } = land(key, surface.path, r, deps);
      applied += got;
      items[n].state = got ? "done" : "skipped";
      items[n].detail = got ? undefined : note;
    } catch (e: any) {
      items[n].state = "failed";
      items[n].detail = e?.name === "AbortError"
        ? (signal?.aborted ? "cancelled" : "took too long, skipped so the demo could open")
        : (e?.message || "the assistant failed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    report();
  };

  /* A shared cursor rather than fixed waves, so a slow item never holds a free slot. */
  let next = 0;
  const worker = async () => {
    while (next < plan.items.length && !signal?.aborted) await runOne(next++);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.items.length) }, worker));
  return { applied, items };
}
