import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant, type GeneratedTile } from "../data/AiAssistantContext";
import { DashTileAi } from "./DashTileMenu";
import { LineChart } from "./LineChart";
import { StackedBarChart } from "./StackedBarChart";
import { DonutChart } from "./DonutChart";
import type { MultiSeriesChart } from "../data/schema";

/* useDashboardData — each dashboard calls this with its BASE data slice. It
   registers the dashboard as the assistant's scope and returns the EFFECTIVE
   data (base + any AI edits overlaid). Call it unconditionally at the top of the
   component (before the null-guard), like any hook. */
export interface PageDataOptions {
  /* Dot-path to a list of questions whose tools this page exposes, which turns on
     the drawer's paste / import / rewrite controls. Opt-in: omitted everywhere
     else, so no other screen changes. See AiAssistantContext's Scope. */
  questionPath?: string;
}
export function useDashboardData<T>(base: T, opts?: PageDataOptions): T {
  const { pathname } = useLocation();
  const { profileId, profile } = useProfile();
  const { registerScope, effectiveData } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  const questionPath = opts?.questionPath;
  useEffect(() => {
    if (base == null) return;
    registerScope({ key, customerName: profile.customerName, baseTitle: (base as any)?.title ?? "", baseData: base, questionPath });
  }, [key, base, profile.customerName, registerScope, questionPath]);
  const eff = effectiveData(key);
  return (eff ?? base) as T;
}

/* usePageData is the SAME hook under an honest name. Nothing in it is
   dashboard-specific — the scope key comes from the route — so every platform
   screen registers its slice this way and gets the Ask AI drawer plus its own
   undo stack. `useDashboardData` stays exported so the six dashboards that
   already call it are untouched. */
export const usePageData = useDashboardData;

/* usePageDataWithLabels — for screens that carry a few headings as LITERALS.

   A literal heading is invisible to the assistant: it will accept "rename this to
   X", write the edit into the data, and the screen will not budge, because the
   heading was never read from the data in the first place. That is a silent
   no-op, which is the worst kind.

   So the labels are folded INTO the object registered as the page's scope. The
   assistant then sees them as editable data at `labels.<key>`, an edit is stored
   under this page's key like any other, and undo covers it — all with no schema
   change and no engine phase, so every prospect already on disk gets it.

   The final spread is deliberate: an override saved BEFORE a new label key
   existed (or before this existed at all) would not carry it, so defaults fill
   the gaps rather than rendering `undefined`.

   `labels` must be a module-level constant so its identity is stable. */
export function usePageDataWithLabels<T extends object, L extends Record<string, string>>(
  base: T, labels: L,
): T & { labels: L } {
  const merged = useMemo(() => ({ ...base, labels }), [base, labels]);
  const eff = usePageData(merged) as T & { labels?: Partial<L> };
  return { ...eff, labels: { ...labels, ...(eff.labels ?? {}) } };
}

/* A short text preview of a generated tile so the assistant can ground edits. */
function previewOf(t: GeneratedTile): string {
  if (t.tileType === "kpi") return t.kpis.map((k) => `${k.label}: ${k.value}`).join(", ");
  if (t.tileType === "pie") return t.slices.map((s) => `${s.label}: ${s.value}`).join(", ");
  return `${t.xLabels.join(", ")} — ${t.series.map((s) => `${s.name}[${s.values.join(",")}]`).join("; ")}`;
}

/* Renders one AI-generated tile as a standard dash-card (KPI / line / bar / pie)
   with its own AI sparkle (scoped to THIS tile) + a remove (×) control. */
function TileCard({ tile, onRemove }: { tile: GeneratedTile; onRemove: () => void }) {
  const asChart: MultiSeriesChart = {
    yLabel: tile.note || tile.series[0]?.name || "",
    xLabels: tile.xLabels,
    series: tile.series.length ? tile.series : [{ name: tile.title, values: [] }],
  };
  const pieTotal = tile.slices.reduce((s, d) => s + (d.value || 0), 0);

  return (
    <section className="dash-card gen-card" data-genid={tile.id}>
      <div className="dash-card-head">
        <span className="dash-card-title">
          {tile.title}
          <span className="gen-badge" title="AI-generated tile"><span className="material-icons">auto_awesome</span>AI</span>
        </span>
        <span className="gen-actions">
          <DashTileAi focus={{ scope: "tile", tileKind: "generated", id: tile.id, label: tile.title, preview: previewOf(tile) }} />
          <span className="material-icons gen-remove" title="Remove tile" onClick={onRemove}>close</span>
        </span>
      </div>

      {tile.tileType === "kpi" && (
        <div className="kpi-row" style={{ gridTemplateColumns: `repeat(${Math.max(1, tile.kpis.length)}, 1fr)` }}>
          {tile.kpis.map((k, i) => (
            <div className="kpi-tile" key={i}>
              <div className="kpi-label" title={k.label}>{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
        </div>
      )}
      {tile.tileType === "line" && <div className="chart-wrap"><LineChart chart={asChart} height={240} /></div>}
      {tile.tileType === "bar" && <div className="chart-wrap"><StackedBarChart chart={asChart} height={240} /></div>}
      {tile.tileType === "pie" && <div className="donut-wrap"><DonutChart segments={tile.slices} total={pieTotal} /></div>}
      {tile.note && tile.tileType !== "kpi" && <div className="gen-note">{tile.note}</div>}
    </section>
  );
}

/* Drop <DashAssistant /> at the bottom of each dashboard to render its AI tiles.
   Scope registration + edit overlay come from useDashboardData() at the top. */
export function DashAssistant() {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { tilesFor, removeTile, hiddenFor } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  const tiles = tilesFor(key);
  const hidden = hiddenFor(key);
  if (!tiles.length && !hidden.length) return null;
  return (
    <>
      <HiddenTileStyles hidden={hidden} />
      {tiles.length > 0 && (
        <div className="gen-tiles">
          {tiles.map((t) => <TileCard key={t.id} tile={t} onRemove={() => removeTile(key, t.id)} />)}
        </div>
      )}
    </>
  );
}

/* HIDING A BUILT-IN TILE.

   Every card head already carries `data-tile` with the tile's data path (the id rule
   3 gives it), so a card is removed from view with one generated rule per hidden
   tile rather than a wrapper component threaded through ~77 cards on 12 screens.

   This is app-authored CSS keyed off app state, NOT the assistant writing CSS: the
   model only ever returns a tile id to hide, and rule 1 still holds — no data value
   reaches a class name, a colour or a font.

   `display: none` (rather than unmounting) is deliberate: the tile's DATA is
   untouched, so Undo and "put it back" are free, and a grid re-flows around a
   display:none child instead of leaving a hole. */
function HiddenTileStyles({ hidden }: { hidden: string[] }) {
  if (!hidden.length) return null;
  const css = hidden
    /* Escaped because a path is interpolated into a selector: a quote or backslash in
       an id would otherwise end the attribute selector early and the rule would
       either do nothing or match more than intended. */
    .map((t) => `.dash-card:has(> .dash-card-head[data-tile="${t.replace(/["\\]/g, "\\$&")}"]) { display: none; }`)
    .join("\n");
  return <style>{css}</style>;
}
