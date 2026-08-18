/* =============================================================================
   findTilePath — locate a tile's data by its heading.
   -----------------------------------------------------------------------------
   Rule 3: the sparkle ON a tile must only ever change THAT tile. That needs the
   tile's data path, and hand-threading one through every card on seven dashboards
   and five reports is both a large mechanical change and one that silently rots —
   a screen added later, or a list someone starts filtering, quietly goes back to
   letting the model guess (which is how "Calls by Region" got renamed instead of
   "Conversions by Product Category").

   So the path is DERIVED instead: walk the page's own data for the node whose
   heading equals the card's heading. One implementation, every screen covered,
   including ones that do not exist yet.

   AMBIGUITY IS RESOLVED BY REFUSING. If a heading matches two different nodes we
   return undefined and the caller falls back to the previous behaviour, rather than
   picking one and pinning edits to the wrong half of the page. An explicit `path`
   prop always wins over this, which is what the Marketing dashboard needs: its
   Product Category TABLE and its Product Category CHART share a heading but read
   `breakdowns[n]` and `productCategoryGraph` respectively, so a title lookup alone
   would anchor the chart to the table and drop every edit to it.

   Pure and dependency-free so it can be unit tested directly. */

/* The keys a card's visible heading can come from across these screens. `title`
   and `tableTitle` sit on the same breakdown object, which is why the first match
   on a node wins and the node is only recorded once. */
const TITLE_KEYS = ["title", "tableTitle", "chartTitle", "name", "label", "heading"];

export function findTilePath(data: unknown, title: string | undefined): string | undefined {
  const want = (title ?? "").trim().toLowerCase();
  if (!want) return undefined;
  const hits: string[] = [];

  const walk = (node: unknown, path: string) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const k of TITLE_KEYS) {
      const v = obj[k];
      if (typeof v === "string" && v.trim().toLowerCase() === want) {
        /* Record the NODE, not the key: the tile is the object that carries the
           heading, and edits to it are relative to that object. */
        if (path) hits.push(path);
        break;
      }
    }
    for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
  };

  walk(data, "");
  const uniq = [...new Set(hits)];
  return uniq.length === 1 ? uniq[0] : undefined;
}
