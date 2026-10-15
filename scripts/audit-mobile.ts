/* =============================================================================
   audit-mobile.ts — the phone and tablet layer (10/15/2026)
   -----------------------------------------------------------------------------
   Asked for: every screen and feature optimized for mobile, "all of the existing
   stuff and anything that is created in the future as well". This is the
   "in the future" half. A static check cannot see a squeezed column, so the
   browser probes in scripts/mobile-probe.js do that; what this file can do is
   make a NEW screen impossible to ship without somebody deciding what it does
   on a phone, and keep the phone rules from ever leaking onto desktop.

     1. mobile.css is imported LAST, so it wins ties without raising specificity.
     2. Every rule in it sits inside a max-width (<= 1024px) or hover:none query,
        which is what keeps the measured desktop replicas pixel-identical.
     3. Every screen wrapper (`.xyz-page`) has mobile rules OR is recorded below
        as checked on a phone and fine as it is, with the reason.
     4. Every fixed-position panel wider than a phone is made full width.
     5. The deliberate exceptions (desktop-only consoles rendered at 1024px) stay.
   ============================================================================= */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");
const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const MOBILE = "src/styles/mobile.css";
const mobile = stripCss(read(MOBILE));
const SHEETS = ["src/styles/app.css", "src/styles/standalone.css", "src/styles/ts.css"];

/* ── 1. load order ─────────────────────────────────────────────────────────── */
console.log("\nLoad order\n");
{
  const main = code("src/main.tsx");
  const imports = [...main.matchAll(/import\s+['"](\.\/styles\/[^'"]+\.css)['"]/g)].map((m) => m[1]);
  imports.at(-1) === "./styles/mobile.css"
    ? ok(`mobile.css is the last of ${imports.length} stylesheets`)
    : bad(`mobile.css must be imported last; order is ${imports.join(", ")}`);
  /<meta name="viewport" content="width=device-width/.test(read("index.html"))
    ? ok("index.html declares a device-width viewport")
    : bad("index.html lost its device-width viewport — every phone would render the desktop page zoomed out");
}

/* ── 2. every rule is scoped ───────────────────────────────────────────────── */
console.log("\nEvery phone rule is scoped to small screens\n");
{
  /* Walk the top level by brace depth: anything at depth 0 that is not an
     @media block is a rule that reaches desktop. */
  const ALLOWED_TOP = new Set([".tb-burger, .nav-scrim"]);
  const top: string[] = [];
  const medias: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < mobile.length; i++) {
    const ch = mobile[i];
    if (ch === "{") {
      if (depth === 0) {
        const head = mobile.slice(start, i).trim();
        if (head.startsWith("@media")) medias.push(head);
        else top.push(head);
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  const stray = top.filter((h) => !ALLOWED_TOP.has(h));
  stray.length === 0
    ? ok(`no unscoped rules (the one allowed top-level rule hides the phone menu on desktop)`)
    : bad(`unscoped rule(s) would restyle desktop: ${stray.join(" | ")}`);
  const loose = medias.filter((m) => {
    if (/min-width/.test(m)) return true;
    const px = [...m.matchAll(/max-width:\s*(\d+)px/g)].map((x) => +x[1]);
    if (px.some((n) => n > 1024)) return true;
    return px.length === 0 && !/hover:\s*none/.test(m);
  });
  loose.length === 0
    ? ok(`${medias.length} media blocks, all max-width <= 1024px or hover:none`)
    : bad(`media block(s) that reach desktop: ${loose.join(" | ")}`);
}

/* ── 3. every screen is accounted for ──────────────────────────────────────── */
console.log("\nEvery screen has phone rules or a recorded reason it needs none\n");
/* Checked at 375x812 with scripts/mobile-probe.js (no sideways scroll, no
   text squeezed into a sliver) and found fine without rules of their own. */
const CHECKED_AS_IS: Record<string, string> = {
  fbb: "feedback board: single column already",
  fup: "follow-ups list: single column already",
  iat: "Add Tile picker: its auto-fill grid collapses to one column by itself",
  icp: "report column picker: probed clean at 375px",
  itg: "Integrations: Bootstrap-style breakpoints already go to one column",
  rn: "release notes: single column already",
  rp: "My Reports: table already scrolls inside its own box",
  ssl: "Semantic Signal library: grid breakpoints already go to one column",
  ts: "/ts-gallery is an internal bench, never shown to a prospect",
  wfd: "workflow Details tab: a single column of fields",
  artifact: "/reports/artifact/:id is unreachable — My Reports opens artifacts in a new tab",
};
{
  const wrappers = new Set<string>();
  for (const s of SHEETS) for (const m of read(s).matchAll(/^\.([a-z0-9]+)-page\b/gm)) wrappers.add(m[1]);
  const missing: string[] = [];
  for (const p of [...wrappers].sort()) {
    const covered = new RegExp(`\\.${p}-`).test(mobile);
    if (!covered && !CHECKED_AS_IS[p]) missing.push(`.${p}-page`);
  }
  missing.length === 0
    ? ok(`all ${wrappers.size} screen wrappers covered (${Object.keys(CHECKED_AS_IS).length} recorded as fine as they are)`)
    : bad(`no phone rules and no recorded reason for: ${missing.join(", ")} — open it at 375px with scripts/mobile-probe.js, then add rules to mobile.css or a line to CHECKED_AS_IS`);
  const stale = Object.keys(CHECKED_AS_IS).filter((p) => !wrappers.has(p));
  stale.length === 0 ? ok("no stale entries in CHECKED_AS_IS") : bad(`CHECKED_AS_IS names screens that no longer exist: ${stale.join(", ")}`);
}

/* ── 4. wide fixed panels go full width ────────────────────────────────────── */
console.log("\nDrawers and dialogs fit a phone\n");
{
  /* A fixed-position element with a desktop width (500/800px drawers, 900px
     modals) hangs off a 375px screen or leaves a sliver of page that looks
     tappable. It must be named in mobile.css. */
  const NOT_PANELS = new Set(["phone", "wf-tree", "wf-voice", "gs-pill", "gs-sitelinks", "gs-pack", "gs-pack-list", "sfh-search"]);
  const wide: string[] = [];
  for (const s of SHEETS) {
    const css = stripCss(read(s));
    /* ⚠️ The anchor is a LOOKBEHIND: written as `(^|\})` each match consumed the closing
       brace the NEXT rule needed, so every other rule was silently skipped and dropping
       `.idr-panel` from mobile.css went unnoticed. Caught by sabotaging this check. */
    for (const m of css.matchAll(/(?:^|(?<=\}))\s*\.([a-z0-9-]+)\s*\{([^{}]*)\}/g)) {
      const cls = m[1], body = m[2];
      if (NOT_PANELS.has(cls)) continue;
      const w = /(?<![-a-z])width:\s*([^;]+)/.exec(body);
      if (!w) continue;
      const px = [...w[1].matchAll(/(\d{3,4})px/g)].map((x) => +x[1]);
      if (!px.length || Math.max(...px) < 380) continue;
      if (!/position:\s*fixed/.test(body) && !/(paper|drawer|panel|modal|dialog)$/.test(cls)) continue;
      if (!new RegExp(`\\.${cls}\\b`).test(mobile)) wide.push(`.${cls}`);
    }
  }
  wide.length === 0
    ? ok("every wide fixed panel, drawer and modal is sized for a phone")
    : bad(`wide panel(s) with no phone rule: ${wide.join(", ")}`);
}

/* ── 5. the deliberate exceptions and the tour ─────────────────────────────── */
console.log("\nDesktop-only surfaces and the guided tour\n");
{
  const ads = read("public/google-ads.html");
  /<meta name="viewport" content="width=1024">/.test(ads) && !/user-scalable=0/.test(ads)
    ? ok("the Google Ads console renders at 1024px on a phone and can be pinch-zoomed")
    : bad("google-ads.html: a desktop-only console needs width=1024 and must not forbid zooming");
  /@media \(hover: none\)[^<]*\.aplos-hovercard/.test(ads)
    ? ok("its frozen hovercard is hidden on touch, so the page does not zoom out to 1500px")
    : bad("google-ads.html lost its touch-only style for the frozen hovercard");
  for (const f of ["src/artifacts/screenpop.ts", "src/artifacts/voiceRoutingDemo.ts"]) {
    /<meta name="viewport" content="width=1024">/.test(read(f))
      ? ok(`${f.split("/").pop()} (an agent desktop) renders at desktop width on a phone`)
      : bad(`${f}: a fixed multi-column agent desktop clips on a phone without width=1024`);
  }
  const tour = code("src/components/GuidedTour.tsx");
  /inline:\s*"nearest"/.test(tour) && /r\.left < 0 \|\| r\.right > window\.innerWidth/.test(tour)
    ? ok("the tour scrolls a target into view SIDEWAYS too (Agent Studio's chip row on a phone)")
    : bad("GuidedTour: a target off to the side in a scrolling row would be spotlit off screen");
  /closest\("\.sidebar"\)[\s\S]{0,80}classList\.add\("nav-open"\)/.test(tour)
    ? ok("a handoff to a menu item opens the phone menu so the item can be seen and tapped")
    : bad("GuidedTour: on a phone the menu is a closed drawer, so a handoff to it points at nothing");
  /useLayoutEffect\([\s\S]{0,400}r\.bottom <= window\.innerHeight - 8/.test(tour)
    ? ok("a tour card taller than its assumed height is pulled back on screen")
    : bad("GuidedTour: the card placement assumes 290px; at phone width it runs off the bottom");
}

console.log(fail ? `\n${fail} mobile check(s) failed\n` : "\nAll mobile checks passed\n");
process.exit(fail ? 1 : 0);
