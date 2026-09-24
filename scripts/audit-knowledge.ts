/* =============================================================================
   npm run audit:knowledge — the Knowledge Sources rows go somewhere real
   -----------------------------------------------------------------------------
   Two risks, and neither is "it looks wrong":
     1. A WEB LINK that 404s. Nothing in the data carries a URL (measured: 453
        rows across 91 profiles, all labels), so the temptation is to slugify
        "Find Your Home" into a path. That lands on the prospect's own website,
        mid-demo, as a 404. These checks pin that a label resolves to the site
        ROOT and never to a guess.
     2. A PLAYBOOK that invents sales copy. It must be a rendering of the
        prospect's OWN agent config and nothing else — so every profile's
        document is checked for its own data, for HTML escaping (that text is
        AI-written and goes into markup), and for not naming another prospect.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { knowledgeHref, looksLikeUrl, siteRoot } from "../src/data/knowledgeLinks.ts";
import { renderSalesPlaybook, playbookFileName } from "../src/artifacts/salesPlaybook.ts";
import { extractAnchors, matchLabel } from "../engine/siteLinks.ts";

let bad = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { bad++; console.log(`  FAIL  ${m}`); };

console.log("\nlooksLikeUrl — an address, or a page title?\n");
const CASES: [string, boolean][] = [
  ["https://www.aptivepestcontrol.com", true],
  ["www.shadyblinds.com/services/", true],
  ["aptivepestcontrol.com", true],
  /* ⚠️ THE ADVERSARIAL ONES, taken verbatim from real profiles. A naive "has a
     dot or a slash" test calls all four of these URLs. */
  ["Plans & Build-a-Plan", false],
  ["Continuing Life, Communities", false],
  ["Shop New & Used Cars", false],
  ["Homepage", false],
  ["Why LGI Homes", false],
];
for (const [n, want] of CASES) {
  looksLikeUrl(n) === want ? ok(`looksLikeUrl("${n}") = ${want}`) : no(`looksLikeUrl("${n}") should be ${want}`);
}

/* ---- over every profile on disk ---------------------------------------------- */
const files = [
  ...fs.readdirSync("src/data/generated").filter((f) => f.endsWith(".json")).map((f) => path.join("src/data/generated", f)),
  ...(fs.existsSync("engine/event-seeds") ? fs.readdirSync("engine/event-seeds").filter((f) => f.endsWith(".json")).map((f) => path.join("engine/event-seeds", f)) : []),
];
console.log(`\nAcross ${files.length} profiles\n`);

const names: string[] = [];
const profiles: any[] = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    const p = d.profile ?? d;
    if (p?.customerName) { profiles.push(p); names.push(p.customerName); }
  } catch { /* a malformed file is another audit's problem */ }
}

let rows = 0, guessed = 0, dead = 0, emptyDoc = 0, unescaped = 0, leaked = 0, noOwnData = 0;
for (const p of profiles) {
  const root = siteRoot(p);
  if (!/^https?:\/\/[^/\s]+$/.test(root)) no(`${p.customerName}: site root is not a bare origin (${root})`);

  for (const s of p.reports?.agentConfig?.knowledgeSources ?? []) {
    if (s.type !== "Web Link") continue;
    rows++;
    const href = knowledgeHref(p, s);
    if (!/^https?:\/\//.test(href)) dead++;
    /* ⚠️ THE CENTRAL CHECK: a LABEL must resolve to the root, never to a path
       derived from its words. Anything with a path segment beyond "/" that the
       row did not itself supply is a guess. */
    if (!looksLikeUrl(s.name) && href !== root) guessed++;
  }

  const doc = renderSalesPlaybook(p);
  if (doc.length < 800) emptyDoc++;
  /* ⚠️ COMPARED AGAINST THE ESCAPED NAME — the first version used the raw one and
     failed five profiles whose names contain "&" ("AT&T", "Krueger & Richard",
     "Crescent Hotels & Resorts"). The document was correct; the probe was
     asserting that escaping had NOT happened. */
  const escName = p.customerName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!doc.includes(escName)) noOwnData++;
  /* Raw "<" surviving into the body means something was interpolated unescaped. */
  const body = doc.slice(doc.indexOf("<article"));
  if (/<(script|iframe)\b/i.test(body)) unescaped++;
  /* ⚠️⚠️ **NO CROSS-PROSPECT LEAKAGE — AND THE FIRST VERSION OF THIS CHECK WAS
     MEASURING THE WRONG THING.** It flagged any document mentioning another
     prospect's name, which failed four profiles for being CORRECT: Crescent
     Hotels manages Marriott-branded properties, Optimum *is* CSC Holdings'
     brand, and Vyve resells DIRECTV — all named in those prospects' own
     generated agent configs. The renderer had leaked nothing.
     The invariant that actually matters is that the document contains only what
     THIS profile holds, so a foreign name is a failure only when it is absent
     from this profile's own config. */
  const own = JSON.stringify(p.reports?.agentConfig ?? {});
  for (const other of names) {
    if (other !== p.customerName && other.length > 6 && body.includes(other) && !own.includes(other)) { leaked++; break; }
  }
}

rows > 100 ? ok(`${rows} web-link rows resolved`) : no(`only ${rows} web-link rows found — the scan is probably broken`);
dead === 0 ? ok("every web link is an absolute http(s) URL") : no(`${dead} rows do not resolve to a URL`);
guessed === 0 ? ok("a LABEL always lands on the site root — no path is ever guessed") : no(`${guessed} labels were turned into guessed paths`);
emptyDoc === 0 ? ok("every profile renders a non-empty playbook") : no(`${emptyDoc} playbooks are empty`);
noOwnData === 0 ? ok("every playbook names its own prospect") : no(`${noOwnData} playbooks do not name their prospect`);
unescaped === 0 ? ok("no script/iframe survives into the document body") : no(`${unescaped} playbooks contain executable markup`);
leaked === 0 ? ok("no playbook names another prospect") : no(`${leaked} playbooks leak another prospect's name`);

/* ---- escaping and omission, exercised directly -------------------------------- */
console.log("\nThe document itself\n");
{
  const p: any = JSON.parse(JSON.stringify(profiles[0]));
  p.customerName = 'Acme <script>alert(1)</script>';
  p.reports.agentConfig.smsPlaybook.offer = '<img src=x onerror=alert(1)>';
  const out = renderSalesPlaybook(p);
  !/<script>alert/.test(out) && !/<img src=x/.test(out)
    ? ok("hostile text in the config is escaped, not rendered")
    : no("the playbook renders unescaped input");
  playbookFileName(p).endsWith(".pdf")
    ? ok("the filename matches the row in the table")
    : no("the document's name does not match the table row");
}
{
  const p: any = JSON.parse(JSON.stringify(profiles[0]));
  p.reports.agentConfig.smsPlaybook.offer = "";
  p.reports.agentConfig.brandConversationRules = [];
  const out = renderSalesPlaybook(p);
  /* ⚠️ AN EMPTY SECTION IS OMITTED, NOT PADDED. A prospect with no promotion
     genuinely runs none, and a "Current offer" heading with nothing under it
     reads as a broken document. */
  !out.includes("Current offer") && !out.includes("Brand conversation rules")
    ? ok("sections with no data are omitted entirely")
    : no("an empty section is still rendered");
}
{
  const p: any = JSON.parse(JSON.stringify(profiles[0]));
  delete p.reports.agentConfig.smsPlaybook;
  delete p.reports.agentConfig.aiRecommendations;
  const out = renderSalesPlaybook(p);
  out.length > 400 && out.includes(p.customerName)
    ? ok("a profile with almost no agent config still renders a valid document")
    : no("a sparse profile breaks the playbook");
}

/* ---- the screen ---------------------------------------------------------------- */
const src = fs.readFileSync("src/screens/KnowledgeSources.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
/target="_blank"/.test(src) && /rel="noopener noreferrer"/.test(src)
  ? ok("web links open in a new tab, with noopener")
  : no("a web link must not replace the demo in the current tab");
/knowledgeHref\(profile, s\)/.test(src) ? ok("the screen uses the shared resolver") : no("the screen resolves links itself");
/* ⚠️ SCOPED TO THE NAME CELL. The first version counted every `href="#"` in the
   file and caught the Refresh column's "Off (manual only)", which is inert
   product chrome from the capture and nothing to do with this feature. */
{
  const cell = src.slice(src.indexOf('className="ks-name"'), src.indexOf("</td>", src.indexOf('className="ks-name"')));
  (cell.match(/href="#"/g) ?? []).length === 1
    ? ok("in the Name cell only the Document keeps href=# (it opens a Blob, not a URL)")
    : no("a Name-cell link is still dead, or the Document stopped using the Blob path");
}
/revokeObjectURL/.test(src) ? ok("the Blob URL is revoked") : no("the generated document leaks a Blob URL");

/* ---- reading the site's own navigation ---------------------------------------- */
console.log("\nsiteLinks — a real published page, or nothing\n");

const HTML = `
  <nav>
    <a href="/pest-control/">Pest Control Services</a>
    <a href=/build-a-plan/>Plans &amp; Build-a-Plan</a>
    <a href="/locations/"><span>Our</span> Locations</a>
    <a href="/">Home</a>
    <a href="#top">Skip</a>
    <a href="mailto:x@y.com">Email us</a>
    <a href="tel:5551234">Call</a>
    <a href="https://facebook.com/aptive">Facebook</a>
    <a href="/pest-control/">Pest Control Services</a>
    <a href="/careers/">Careers</a>
  </nav>`;
const anchors = extractAnchors(HTML, "https://aptivepestcontrol.com/");

anchors.length === 4
  ? ok("off-site, mailto, tel, #fragment, the root and duplicates are all dropped")
  : no(`expected 4 usable anchors, got ${anchors.length}: ${anchors.map((a) => a.href).join(", ")}`);
/* ⚠️ UNQUOTED ATTRIBUTES ARE REAL — SingleFile and plenty of live sites emit
   `href=/about`, the trap this repo already records twice. */
anchors.some((a) => a.href.endsWith("/build-a-plan/"))
  ? ok("an unquoted href is still extracted")
  : no("unquoted href attributes are being missed");
anchors.some((a) => a.text === "Our Locations")
  ? ok("nested markup inside the anchor is flattened to its text")
  : no("anchor text is not being cleaned");

matchLabel("Pest Control Services", anchors) === "https://aptivepestcontrol.com/pest-control/"
  ? ok("an exact nav-text match wins") : no("exact text should match");
matchLabel("Plans & Build-a-Plan", anchors) === "https://aptivepestcontrol.com/build-a-plan/"
  ? ok("a label matches on shared significant words") : no("token matching failed");
matchLabel("Our Locations", anchors) === "https://aptivepestcontrol.com/locations/"
  ? ok("a single significant word matches when it is the whole label") : no("'Our Locations' should resolve");

/* ⚠️⚠️ THE CHECK THAT MATTERS MOST: NO WEAK MATCH. A label sharing only one
   generic word with an unrelated page must return null and fall back to the
   homepage — sending an SE to the wrong page is worse than sending them to the
   front door, and it is the reason this does not slugify labels. */
/* ⚠️⚠️ **THE FIXTURE SHARES EXACTLY ONE TOKEN, AND THE FIRST VERSION DID NOT —
   so it could not fail.** It used "Financing Options", which shares NOTHING with
   any anchor, so the check passed whether the threshold was 2 or 1 and the
   sabotage that lowers it went undetected. This one overlaps on "pest" alone:
   with the threshold it is correctly null, without it it wrongly resolves to
   the pest-control page. Verified by lowering `need` and watching it redden. */
matchLabel("Pest Stories", anchors) === null
  ? ok("one shared word is not a match — a near-miss falls back to the homepage")
  : no(`"Pest Stories" wrongly matched ${matchLabel("Pest Stories", anchors)}`);
matchLabel("Financing Options", anchors) === null
  ? ok("a label sharing nothing resolves to nothing")
  : no(`"Financing Options" wrongly matched ${matchLabel("Financing Options", anchors)}`);
matchLabel("Homepage", anchors) === null
  ? ok("'Homepage' resolves to nothing — the fallback IS the homepage")
  : no("Homepage should not match a sub-page");
matchLabel("Services", [{ href: "https://x.com/careers/", text: "Careers and Services Team" }]) !== null
  ? ok("a one-word label may match its one word") : no("a single-token label should still resolve");
matchLabel("Care Services", [{ href: "https://x.com/careers/", text: "Careers" }]) === null
  ? ok("'Care Services' does not match 'Careers' on a stem")
  : no("a partial word must not count as a hit");

console.log("\nWiring\n");
const srvSrc = fs.readFileSync("server.ts", "utf8");
const devSrc = fs.readFileSync("vite.config.ts", "utf8");
/api\/site-links/.test(srvSrc) ? ok("server.ts serves /api/site-links") : no("server.ts is missing the endpoint");
/api\/site-links/.test(devSrc) ? ok("the dev twin serves /api/site-links") : no("the dev twin is missing it");
/links: \{\}/.test(srvSrc)
  ? ok("a failure answers {} so the screen keeps its homepage fallback")
  : no("a failed resolve must not 500 the screen");
/\/api\/site-links/.test(src) && /resolved\[s\.name\] \?\? knowledgeHref/.test(src)
  ? ok("the screen asks once and falls back per row")
  : no("the screen does not use the resolved links with a fallback");

console.log(bad ? `\n${bad} FAILED\n` : "\nAll knowledge-source checks passed\n");
process.exit(bad ? 1 : 0);
