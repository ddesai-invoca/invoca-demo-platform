import { useAiAssistant, type AssistantFocus } from "../data/AiAssistantContext";

/* Tile-head trailing actions. The AI sparkle (auto_awesome) is revealed on tile
   hover and must appear on EVERY tile — KPI cards, tables, charts, and generated
   tiles. Clicking it opens the "Ask AI" drawer FOCUSED on that tile: ask about
   it, or change its data / numbers / trend / title. Charts show a cadence
   dropdown instead of a kebab, so DashTileToggle pairs the sparkle with the
   dropdown; DashTileMenu pairs it with the kebab. */

function cleanTitle(el: Element | null): string | undefined {
  if (!el) return undefined;
  // The title span may contain a badge ("AI"); take just the first text node.
  const first = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
  return (first?.textContent ?? el.textContent ?? "").trim() || undefined;
}

/* The hover-revealed AI sparkle. Pass an explicit `focus` (generated tiles), or
   omit it to derive the focus from the enclosing built-in tile's DOM. */
export function DashTileAi({ focus }: { focus?: AssistantFocus }) {
  const { openDrawer } = useAiAssistant();
  const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (focus) return openDrawer(focus);
    const card = (e.currentTarget as HTMLElement).closest(".dash-card");
    const label = cleanTitle(card?.querySelector(".dash-card-title") ?? null);
    const preview = card ? (card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220) : undefined;
    openDrawer({ scope: "tile", tileKind: "builtin", label, preview });
  };
  return <span className="material-icons dash-ai-tile" title="Ask AI" onClick={onClick}>auto_awesome</span>;
}

/* Sparkle + kebab — KPI cards, tables, any non-chart tile. */
export function DashTileMenu() {
  return (
    <span className="dash-tile-actions">
      <DashTileAi />
      <span className="material-icons dash-more">more_vert</span>
    </span>
  );
}

/* Sparkle + cadence dropdown — chart/graph tiles (Daily / Weekly / …). */
export function DashTileToggle({ label = "Daily" }: { label?: string }) {
  return (
    <span className="dash-tile-actions">
      <DashTileAi />
      <span className="chart-toggle">{label} <span className="material-icons">expand_more</span></span>
    </span>
  );
}
