/* =============================================================================
   tileId — the stable id for a built-in tile.
   -----------------------------------------------------------------------------
   The same value rule 3 already uses to pin edits: a tile's data path. Reusing it
   as the hide/show id means "remove the lead form tile" needs no second identity
   scheme, and an id can never drift out of step with the thing it points at.

   A card whose data is a GROUP of sibling fields joins them with "|", so the id is
   still one string and still unique to that card. */
export function tileId(path: string | string[] | undefined): string | undefined {
  if (!path) return undefined;
  return Array.isArray(path) ? path.join("|") : path;
}
