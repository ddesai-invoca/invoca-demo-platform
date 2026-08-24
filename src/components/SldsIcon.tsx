/* =============================================================================
   The real SLDS icons, extracted VERBATIM from a capture of Lightning (8/24/2026).
   -----------------------------------------------------------------------------
   Every path below was serialised out of the live DOM, per the standing use-the-real-icons
   rule. The first build of the Salesforce screen substituted Material ligatures and it was
   the first thing that read as wrong: SLDS glyphs are a different weight and shape, and
   Material has no equivalent for several of them (Guidance Center, the nav pencil).

   ⚠️ EVERY SLDS ICON IS `viewBox="0 0 520 520"` — a 520 grid, not 24. Dropping one of these
   paths into a 24-unit viewBox renders an invisible speck in the corner.
   ⚠️ THEY ARE FILLED, NOT STROKED, and take their colour from `fill` — so a parent's
   `color` does nothing unless the path uses `currentColor`. These are set to `currentColor`
   so a caller can tint them the way Lightning does.
   ============================================================================= */

/** Icon name -> the `<path d>` of the real SLDS glyph. */
const PATHS: Record<string, string> = {
  search: "M496 453L362 320a189 189 0 10-340-92 190 190 0 00298 135l133 133a14 14 0 0021 0l21-21a17 17 0 001-22M210 338a129 129 0 11130-130 129 129 0 01-130 130",
  /* The small solid triangle Lightning uses for a menu, distinct from `chevrondown`. */
  triangledown: "M83 140h354c10 0 17 13 9 22L273 374c-6 8-19 8-25 0L73 162c-7-9-1-22 10-22",
  add: "M300 290h165c8 0 15-7 15-15v-30c0-8-7-15-15-15H300c-6 0-10-4-10-10V55c0-8-7-15-15-15h-30c-8 0-15 7-15 15v165c0 6-4 10-10 10H55c-8 0-15 7-15 15v30c0 8 7 15 15 15h165c6 0 10 4 10 10v165c0 8 7 15 15 15h30c8 0 15-7 15-15V300c0-6 4-10 10-10",
  guidance: "M222 362a27 27 0 01-1 3 69 69 0 0024 78c16 13 20 18 18 30a76 76 0 01-11 27 449 449 0 01-232-74v-36l1-27h201zm277 0l1 28v37a450 450 0 01-203 72 100 100 0 005-20c6-37-18-55-32-66a28 28 0 01-11-33 82 82 0 019-17h231zM225 196l44 65-42 60h-87zm35-176a393 393 0 01235 302h-59l-88-130a20 20 0 00-33 0l-22 33-51-76a20 20 0 00-34 0L91 322H25A393 393 0 01260 20m72 220l55 82H277z",
  help: "M284 380h-50c-8 0-14-6-14-14v-15c0-42 27-80 67-94a80 80 0 00-24-155c-22-1-43 7-59 22a70.4 70.4 0 00-23 44c-1 6-7 11-15 11h-50c-9 0-16-7-15-16 4-38 21-72 48-99 32-30 73-46 117-45 83 3 151 71 154 154 3 70-40 133-105 157-9 4-15 11-15 20v15c0 9-8 15-16 15m16 105c0 8-7 15-15 15h-50c-8 0-15-7-15-15v-50c0-8 7-15 15-15h50c8 0 15 7 15 15z",
  setup: "M468 324l-37-31a195 195 0 000-68l37-31c12-10 16-28 8-42l-16-29a34 34 0 00-40-14l-45 17a173 173 0 00-58-34l-8-47c-3-16-17-25-33-25h-32c-16 0-30 9-33 25l-8 46c-22 7-41 19-59 34l-44-17-11-2c-12 0-23 6-29 16l-16 28c-8 14-5 32 8 42l37 31a195 195 0 000 68l-37 31a34 34 0 00-8 42l16 30a34 34 0 0040 14l45-17c18 16 38 27 58 34l8 48a33 33 0 0033 27h32c16 0 30-12 33-28l8-48c23-8 43-20 61-37l42 17 12 2c12 0 23-6 29-16l15-26c8-12 4-30-8-40m-207 47a110 110 0 01-109-110 109 109 0 11218 0 110 110 0 01-109 110m29-191h-46c-7 0-13 4-15 10l-28 72c-2 5 2 11 8 11h47l-17 60c-2 6 5 9 9 5l71-83c5-5 1-13-6-13h-35l31-49c3-5-1-12-7-12h-12z",
  notification: "M460 330h-5a35 35 0 01-35-35V180A160 160 0 00252 20c-86 4-152 78-152 165v111c0 19-16 34-35 34h-5c-22 0-40 19-40 41v15c0 7 7 14 15 14h450c8 0 15-7 15-15v-15a40 40 0 00-40-40M309 440h-98a10 10 0 00-10 12c5 28 30 48 59 48s54-21 59-48a10 10 0 00-10-12",
  chevrondown: "M476 178L271 385c-6 6-16 6-22 0L44 178c-6-6-6-16 0-22l22-22c6-6 16-6 22 0l161 163c6 6 16 6 22 0l161-162c6-6 16-6 22 0l22 22c5 6 5 15 0 21",
  pencil: "M95 334l89 89c4 4 10 4 14 0l222-223c4-4 4-10 0-14l-88-88a10 10 0 00-14 0L95 321c-4 4-4 10 0 13M361 57a10 10 0 000 14l88 88c4 4 10 4 14 0l25-25a38 38 0 000-55l-47-47a40 40 0 00-57 0zM21 482c-2 10 7 19 17 17l109-26c4-1 7-3 9-5l2-2c2-2 3-9-1-13l-90-90c-4-4-11-3-13-1l-2 2a20 20 0 00-5 9z",
  warning: "M514 425L285 55a28 28 0 00-50 0L6 425c-14 23 0 55 25 55h458c25 0 40-32 25-55m-254-25c-17 0-30-13-30-30s13-30 30-30 30 13 30 30-13 30-30 30m30-90c0 6-4 10-10 10h-40c-6 0-10-4-10-10V180c0-6 4-10 10-10h40c6 0 10 4 10 10z",
  settings: "M261 191c-39 0-70 31-70 70s31 70 70 70 70-31 70-70-31-70-70-70m210 133l-37-31a195 195 0 000-68l37-31c12-10 16-28 8-42l-16-28a34 34 0 00-40-14l-46 17a168 168 0 00-59-34l-8-47c-3-16-17-25-33-25h-32c-16 0-30 9-33 25l-8 46a180 180 0 00-60 34l-46-17-11-2c-12 0-23 6-29 16l-16 28c-8 14-5 32 8 42l37 31a195 195 0 000 68l-37 31a34 34 0 00-8 42l16 28a34 34 0 0040 14l46-17c18 16 38 27 59 34l8 48a33 33 0 0033 27h32c16 0 30-12 33-28l8-48a170 170 0 0062-37l43 17 12 2c12 0 23-6 29-16l15-26c9-11 5-29-7-39m-210 47c-61 0-110-49-110-110s49-110 110-110 110 49 110 110-49 110-110 110",
  newwindow: "M487 20H296c-8 0-16 5-16 13v30c0 8 7 17 16 17h79c9 0 14 10 7 16L212 266c-6 6-6 15 0 21l21 21c6 6 15 6 21 0l170-170c6-6 16-2 16 7v79c0 8 8 17 16 17h29c8 0 15-9 15-17V34c0-9-5-14-13-14M363 255l-34 35q-9 9-9 21v114c0 8-7 15-15 15H95c-8 0-15-7-15-15V215c0-8 7-15 15-15h115c8 0 16-3 21-9l34-34c6-6 2-17-7-17H60a40 40 0 00-40 40v280a40 40 0 0040 40h280a40 40 0 0040-40V262c0-9-11-13-17-7",
  todo: "M240 70l-17-17c-5-5-12-5-17 0L100 158l-43-42c-5-5-12-5-17 0l-17 17c-5 5-5 12 0 17l59 59c5 5 11 7 17 7s12-2 17-7L240 87c4-4 4-12 0-17m244 114H275c-9 0-16-7-16-16v-32c0-9 7-16 16-16h209c9 0 16 7 16 16v32c0 9-7 16-16 16m0 143H227c-9 0-16-7-16-16v-32c0-9 7-16 16-16h257c9 0 16 7 16 16v32c0 9-7 16-16 16m-354 0H98c-9 0-16-7-16-16v-32c0-9 7-16 16-16h32c9 0 16 7 16 16v32c1 9-7 16-16 16m0 143H98c-9 0-16-7-16-16v-32c0-9 7-16 16-16h32c9 0 16 7 16 16v32c1 9-7 16-16 16m354 0H227c-9 0-16-7-16-16v-32c0-9 7-16 16-16h257c9 0 16 7 16 16v32c0 9-7 16-16 16",
  chevronleft: "M342 477L134 272c-6-6-6-16 0-22L342 45c6-6 16-6 22 0l22 22c6 6 6 16 0 22L221 250c-6 6-6 16 0 22l163 161c6 6 6 16 0 22l-22 22c-5 5-14 5-20 0",
  chevronright: "M179 44l207 205c6 6 6 16 0 22L179 476c-6 6-16 6-22 0l-22-22c-6-6-6-16 0-22l163-161c6-6 6-16 0-22L136 88c-6-6-6-16 0-22l22-22c6-5 15-5 21 0",
  refresh: "M465 40h-30c-8 0-15 7-15 15v70c0 9-5 13-12 7l-10-10a210 210 0 10-12 309c7-6 7-16 1-22l-21-21c-5-5-14-6-20-1a152 152 0 01-172 14 152 152 0 0177-281 150 150 0 01118 58c3 8-4 12-13 12h-70c-8 0-15 7-15 15v31c0 8 6 14 14 14h183c7 0 13-6 13-13V55c-1-8-8-15-16-15",
  rows: "M465 140H55c-8 0-15-7-15-15V95c0-8 7-15 15-15h410c8 0 15 7 15 15v30c0 8-7 15-15 15m0 149H55c-8 0-15-7-15-15v-30c0-7 7-14 15-14h410c8 0 15 7 15 15v30c0 7-7 14-15 14m0 151H55c-8 0-15-7-15-15v-30c0-8 7-15 15-15h410c8 0 15 7 15 15v30c0 8-7 15-15 15",
  /* The page-header tile glyph — a 100-unit box, not 520. */
  "calendar-tile": "M76 42H24a2 2 0 00-2 2v30a6 6 0 006 6h44a6 6 0 006-6V44a2 2 0 00-2-2M40 70a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm0-14a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm14 14a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm0-14a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm14 14a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm0-14a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4c0-1.1.9-2 2-2h4a2 2 0 012 2zm4-30h-5v-2c0-2.2-1.8-4-4-4s-4 1.8-4 4v2H41v-2c0-2.2-1.8-4-4-4s-4 1.8-4 4v2h-5a6 6 0 00-6 6v2c0 1.1.9 2 2 2h52a2 2 0 002-2v-2a6 6 0 00-6-6",
  /* The view-picker calendar — a 52-unit box. */
  "calendar-sm": "M46.5 20h-41c-.8 0-1.5.7-1.5 1.5V46a4 4 0 004 4h36a4 4 0 004-4V21.5c0-.8-.7-1.5-1.5-1.5M19 42c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm0-10c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm10 10c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm0-10c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm10 10c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm0-10c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1zm5-25h-5V5a3 3 0 00-3-3 3 3 0 00-3 3v2H19V5a3 3 0 00-3-3 3 3 0 00-3 3v2H8a4 4 0 00-4 4v2.5c0 .8.7 1.5 1.5 1.5h41c.8 0 1.5-.7 1.5-1.5V11a4 4 0 00-4-4",
  /* ⚠️ THE SALESFORCE CLOUD, AUTHORED — neither capture carries the logo image (its `<img>`
     serialises as `class="icon noicon"` with no src). Drawn as the mark's real silhouette:
     three lobes over a flat base, which is what distinguishes it from a generic cloud.
     Replace it the moment a capture carries the asset. */
  cloud: "M196 96c19-20 45-32 74-32 39 0 73 22 91 54a112 112 0 0135-6c60 0 109 49 109 109s-49 109-109 109H150C93 330 47 284 47 227c0-40 23-75 56-92a94 94 0 01-1-11c0-52 42-94 94-94",
  /* ⚠️ ALSO AUTHORED, for the same reason: the profile avatar's `<img alt="User">` has no
     src in either capture. SLDS's default is a white head-and-shoulders on the user's
     colour, and the measured circle is #1B96FF at 32px. */
  user: "M260 270a105 105 0 10-105-105 105 105 0 00105 105m0 40c-79 0-190 40-190 120v30c0 11 9 20 20 20h340c11 0 20-9 20-20v-30c0-80-111-120-190-120",
  /* ⚠️ AUTHORED, like `cloud` and `user` above: the "Invoca Call Log" object's own glyph
     serialised as an EMPTY placeholder (`<rect fill-opacity="0"/>`), so the capture has the
     tile colour but no artwork. This is a plain SLDS-weight handset on the same 520 grid.
     Replace it if a capture ever carries the real one. */
  call: "M478 372l-71-71a30 30 0 00-42 0l-30 30a20 20 0 01-25 3 371 371 0 01-124-124 20 20 0 013-25l30-30a30 30 0 000-42l-71-71a30 30 0 00-42 0l-41 41c-20 20-24 51-11 78a707 707 0 00306 306c27 13 58 9 78-11l41-41a30 30 0 000-43",
};

/* ⚠️ NOT EVERY SLDS GLYPH IS ON THE 520 GRID. The calendar tile and the view-picker
   calendar come off smaller boxes (100 and 52), measured from their own path extents. An
   icon set that assumes one viewBox renders those two as a speck in the corner. */
const VIEWBOX: Record<string, string> = {
  "calendar-tile": "0 0 100 100",
  "calendar-sm": "0 0 52 52",
};

export type SldsIconName = keyof typeof PATHS | string;

/**
 * One SLDS glyph. `size` is the rendered box; the path is always drawn on the 520 grid.
 */
export function SldsIcon({ name, size = 16, className }: {
  name: SldsIconName; size?: number; className?: string;
}) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg className={className} width={size} height={size} viewBox={VIEWBOX[name] ?? "0 0 520 520"}
      aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
