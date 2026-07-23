import { useEffect } from "react";
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
export function useDashboardData<T>(base: T): T {
  const { pathname } = useLocation();
  const { profileId, profile } = useProfile();
  const { registerScope, effectiveData } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  useEffect(() => {
    if (base == null) return;
    registerScope({ key, customerName: profile.customerName, baseTitle: (base as any)?.title ?? "", baseData: base });
  }, [key, base, profile.customerName, registerScope]);
  const eff = effectiveData(key);
  return (eff ?? base) as T;
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
  const { tilesFor, removeTile } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  const tiles = tilesFor(key);
  if (!tiles.length) return null;
  return (
    <div className="gen-tiles">
      {tiles.map((t) => <TileCard key={t.id} tile={t} onRemove={() => removeTile(key, t.id)} />)}
    </div>
  );
}
