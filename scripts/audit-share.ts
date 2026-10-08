/* =============================================================================
   audit-share — a shared demo shows ONE prospect their own demo, and nothing else
   -----------------------------------------------------------------------------
   This is the only feature in the repo reachable WITHOUT an Invoca session, so the
   checks here are about containment rather than appearance: which demo a token can
   reach, what a prospect's bundle carries, and which routes exist for them at all.
   ============================================================================= */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "audit-share-"));

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const code = (p: string) => fs.readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const S = await import("../engine/shareStore.ts");
const A = await import("../engine/shareApi.ts");
const D = await import("../engine/demoStore.ts");
const M = await import("../src/data/shareMode.ts");

for (const id of ["acme-health", "rival-corp", "replace-a", "replace-b", "live-link"]) {
  D.saveDemo({ id, prospect: id, industry: "x", createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), creator: { name: "SE", email: "se@invoca.com" },
    profile: { id, customerName: id } } as never);
}
const rec = S.createShare({ demoId: "acme-health", prospect: "Acme Health", createdBy: "se@invoca.com", days: 7, password: "Acme Health" });
const unlockRes = (await A.handleShareApi("POST", `/api/share/${rec.token}/unlock`, { password: "Acme Health" }, {}))!;
const ck = { [A.cookieNameFor(rec.token)]: unlockRes.setCookie!.value };

console.log("\nContainment\n");

/* ⚠️⚠️ **THE ONE LINE THAT KEEPS A SHARE FROM BEING A KEY TO THE LIBRARY.** The demo
   id is read from the SHARE RECORD; a body naming another demo must change nothing. */
(async () => {
  const r = (await A.handleShareApi("GET", `/api/share/${rec.token}/demo`, { demoId: "rival-corp" } as never, ck))!;
  return r.status === 200 && (r.body as { demo: { id: string } }).demo.id === "acme-health";
})().then((pass) => pass
  ? ok("the request body cannot point a token at another demo")
  : bad("a token could be redirected to a different demo"));

(await A.handleShareApi("GET", `/api/share/${rec.token}/demo`, undefined, {}))!.status === 401
  ? ok("the demo needs the unlock cookie")
  : bad("the demo is served without the password");

(await A.handleShareApi("GET", `/api/share/${rec.token}/demo`, undefined, { [A.cookieNameFor(rec.token)]: "forged" }))!.status === 401
  ? ok("a forged cookie is refused")
  : bad("a forged unlock cookie is accepted");

/* ⚠️ Another LIVE link's valid cookie must not open this one. */
(() => {
  const other = S.createShare({ demoId: "rival-corp", prospect: "Rival", createdBy: "se@invoca.com", days: 7, password: "Rival" });
  return A.handleShareApi("POST", `/api/share/${other.token}/unlock`, { password: "Rival" }, {}).then(async (u) =>
    (await A.handleShareApi("GET", `/api/share/${rec.token}/demo`, undefined, { [A.cookieNameFor(rec.token)]: u!.setCookie!.value }))!.status === 401);
})().then((pass) => pass
  ? ok("another link's cookie does not open this one")
  : bad("one share's cookie unlocks another"));

(await A.handleShareApi("GET", `/api/share/${rec.token}/demos`, undefined, ck))!.status === 404
  ? ok("there is no route that lists demos")
  : bad("a share route can enumerate demos");

S.getShare("../../etc/passwd") === null
  ? ok("a traversing token is refused by the store")
  : bad("a token can escape the shares directory");

/* ⚠️ An unknown token must look identical to a revoked one, or the route is an
   oracle for which links exist. */
(await A.handleShareApi("GET", `/api/share/${"A".repeat(43)}`, undefined, {}))!.status === 410
  ? ok("an unknown token answers like an expired one")
  : bad("an unknown token is distinguishable from a revoked one");

(() => { const sum = S.summarize(S.getShare(rec.token)!); return !("passwordHash" in sum) && !("passwordSalt" in sum); })()
  ? ok("the owner's summary never carries the hash or the salt")
  : bad("the password hash leaks to the owner view");

!fs.readFileSync(path.join(process.env.DATA_DIR!, "shares", `${rec.token}.json`), "utf8").includes('"Acme Health"\n')
  ? ok("the password is not stored in plaintext")
  : bad("the password is stored in plaintext");

console.log("\nOne link per demo\n");

/* ⚠️⚠️ **CREATING REPLACES — asked for after two links appeared for one demo.** Two
   secrets is two things to track and two to remember to turn off, and the SE cannot tell
   which one the prospect actually has. The old record is DELETED, not revoked, so the
   list stays clean and the replacement is unambiguous. */
(() => {
  /* ⚠️ ITS OWN DEMO IDS. The first version reused "acme-health", and because creating now
     DELETES the previous link it destroyed the record the Containment and Lifecycle
     sections were still using — the audit crashed in `shareActive(null)`. A check must not
     disturb the fixtures another check depends on. */
  const first = S.createShare({ demoId: "replace-a", prospect: "A", createdBy: "se@invoca.com", days: 30, password: "A" });
  const other = S.createShare({ demoId: "replace-b", prospect: "B", createdBy: "se@invoca.com", days: 30, password: "B" });
  const second = S.createShare({ demoId: "replace-a", prospect: "A", createdBy: "se@invoca.com", days: 30, password: "A" });
  const list = S.listShares("replace-a");
  list.length === 1 && list[0].token === second.token
    ? ok("a second link replaces the first rather than stacking")
    : bad(`creating left ${list.length} links for one demo`);
  S.getShare(first.token) === null
    ? ok("the replaced link's URL stops working immediately")
    : bad("the old link still resolves after being replaced");
  /* ⚠️ And it is scoped to the ONE demo: replacing Acme's must not touch anyone else's. */
  S.getShare(other.token) !== null
    ? ok("another demo's link is untouched by the replacement")
    : bad("creating a link for one demo deleted another demo's");
})();

/* ⚠️ The default duration reaches the stored record, not just the form. */
S.createShare({ demoId: "replace-b", prospect: "B", createdBy: "se@invoca.com", days: 0, password: "p" }).days === 30
  ? ok("a request with no usable duration stores the 30-day default")
  : bad("the stored default is not 30 days");

console.log("\nLifecycle\n");
S.revokeShare(rec.token);
(await A.handleShareApi("GET", `/api/share/${rec.token}/demo`, undefined, ck))!.status === 410
  ? ok("revoke kills a live session immediately")
  : bad("a revoked link still serves the demo");
(await A.handleShareApi("POST", `/api/share/${rec.token}/unlock`, { password: "Acme Health" }, {}))!.status === 410
  ? ok("a revoked link refuses a fresh unlock")
  : bad("a revoked link can be unlocked again");
S.extendShare(rec.token, 3);
S.shareActive(S.getShare(rec.token)!) && S.getShare(rec.token)!.days === 10
  ? ok("extend adds days and brings a revoked link back")
  : bad("extend does not restore a link");

/* ⚠️ The caps are the only thing standing between a leaked link and our Anthropic
   and LiveKit bills, because the agent runs LIVE for whoever holds it. */
A.__resetBudgets();
(() => { let n = 0; while (A.takeBudget("t1", "chat")) if (++n > 500) break; return n === A.CAPS.chat; })()
  ? ok(`chat is capped per link per day (${A.CAPS.chat})`)
  : bad("the per-link chat cap does not hold");
A.takeBudget("t2", "chat") === true
  ? ok("each link has its own budget")
  : bad("one link's spend exhausts another's");

console.log("\nWhat a prospect's app can reach\n");

/* ⚠️⚠️ **ENFORCED ON THE ROUTE, NOT THE NAV — the shape this repo has already paid
   for once, when gating a list row left a bookmarked URL rendering a dashboard. */
const blocked = ["/dashboards/marketing", "/call-review", "/signal", "/integrations", "/launch",
  "/salesforce", "/insights", "/reports/digital-insights", "/reports/conversation-intelligence"];
blocked.every((p) => !M.shareAllows(p))
  ? ok(`${blocked.length} out-of-scope routes are refused, including the two reports not asked for`)
  : bad(`a route outside the share is allowed: ${blocked.filter((p) => M.shareAllows(p)).join(", ")}`);

["/agent-studio", "/agent-studio/agent", "/agent-studio/agent/workflow/sms",
 "/agent-studio/agent/preview", "/reports", "/reports/sms-conversation-intelligence",
 "/reports/voice-conversation-intelligence"].every((p) => M.shareAllows(p))
  ? ok("Agent Studio and the two AI CI reports are reachable")
  : bad("a route the share is supposed to carry is refused");

/* ⚠️ The agent must go through the capped share twin, never the gated route. */
M.apiPath("/api/chat") === "/api/chat"
  ? ok("outside a share, the agent calls the normal route")
  : bad("apiPath rewrites outside share mode");

console.log("\nThe prospect's bundle and chrome\n");

/* ⚠️⚠️ **NO PROSPECT DATA IN THE BUNDLE.** Measured before this feature: 15 real
   companies shipped inside the public JS, hidden only by the Google gate — which a
   share link removes. */
!/import\.meta\.glob[^)]*generated/.test(code("src/data/profiles.ts"))
  ? ok("generated profiles are no longer bundled")
  : bad("the generated profiles are back in the bundle — a share link would expose them");

/* ⚠️ Scans the SHIPPED bundle when there is one. Skipped rather than failed with no
   build, because a fresh clone has no `dist/` and a check that fails for the wrong
   reason gets deleted as a nuisance. */
(() => {
  const dist = "dist/assets";
  const js = fs.existsSync(dist) ? fs.readdirSync(dist).filter((f) => f.startsWith("index-") && f.endsWith(".js")) : [];
  if (!js.length) { console.log("  skip  no build to scan (run npm run build to check the shipped bundle)"); return; }
  const b = fs.readFileSync(path.join(dist, js[0]), "utf8");
  const leaked = ["Orlando Health", "AutoNation", "Marriott", "Denver Health", "Moffitt"].filter((n) => b.includes(n));
  leaked.length === 0
    ? ok(`the shipped bundle names no prospect (${js[0]})`)
    : bad(`the shipped bundle still carries prospect data: ${leaked.join(", ")}`);
})();

/* ⚠️ A prospect never boots the real app at all — not hidden, not mounted. */
/isShareMode\(\)\s*\?\s*<ShareApp/.test(code("src/main.tsx"))
  ? ok("a share link boots ShareApp, never the full app")
  : bad("a shared link mounts the real app");
/ProfileProvider only=/.test(code("src/screens/ShareApp.tsx"))
  ? ok("the prospect's store holds exactly one profile")
  : bad("the prospect's app could hold more than their own demo");
/isShareMode\(\)/.test(code("src/components/TopBar.tsx")) && /net-select-static/.test(code("src/components/TopBar.tsx"))
  ? ok("the customer switcher is a static label for a prospect")
  : bad("a prospect gets the customer switcher");
/isShareMode\(\)/.test(code("src/components/Sidebar.tsx"))
  ? ok("the nav rail is scoped for a prospect")
  : bad("a prospect gets the full 14-item nav");

/* ⚠️ Ask AI is ABSENT, which is three separate surfaces: the shell's drawer, the
   top bar's pair, and the Preview Agent page's own pair (it renders outside the shell). */
/!isShareMode\(\) && <AiAssistantDrawer \/>/.test(code("src/layout/AppShell.tsx"))
  ? ok("the Ask AI drawer is not rendered in a share")
  : bad("the Ask AI drawer is in a prospect's DOM");
/!isShareMode\(\) && <TopBarAi \/>/.test(code("src/components/TopBar.tsx"))
  ? ok("the top bar's Ask AI pair is not rendered in a share")
  : bad("a prospect gets the top bar's Ask AI");
/!isShareMode\(\) && \(/.test(code("src/screens/SmsPreviewPage.tsx"))
  ? ok("the Preview Agent page's own Ask AI pair is not rendered in a share")
  : bad("a prospect gets Ask AI on the Preview Agent page");

/* ⚠️⚠️ **AND A PROSPECT'S OWN EDITS NEVER REACH THE SE'S DEMO.** The drawers stay
   usable (asked for), but the sync is blocked — otherwise whoever holds a link could
   rewrite the demo an SE is about to present. */
/if \(isShareMode\(\)\) return;/.test(code("src/data/AiAssistantContext.tsx"))
  ? ok("nothing a prospect does syncs back to the demo")
  : bad("a prospect's edits could overwrite the SE's demo");

/* ⚠️ And the SE's OWN edits must reach the prospect, which is what hydrating the
   demo's customizations does — without it the share shows the untuned base. */
/hydrateDemo\(demoId/.test(code("src/screens/ShareApp.tsx"))
  ? ok("the SE's saved customizations are applied to the shared view")
  : bad("the prospect would see the demo without the SE's edits");

/* ⚠️ `window.open` takes an ABSOLUTE path, so Preview Agent escapes the share
   without the basename — measured by walking the share as a prospect. */
/SHARE_BASENAME \+ \(extra/.test(code("src/screens/AgentWorkflow.tsx"))
  ? ok("Preview Agent opens inside the share, not the signed-in app")
  : bad("Preview Agent would open the full app for a prospect");

/* ── the SE's share dialog (10/6/2026, after four reports) ────────────────── */
(() => {
  const c = code("src/components/ShareDemoButton.tsx");
  /* ⚠️⚠️ **PORTALLED AND PICKER-SAFE — two halves of one reported bug.** The demo list
     is a scroll box, so an in-flow panel was CUT OFF; and the picker closes on a
     document mousedown whose target is not `[data-picker-safe]`, so the row unmounted
     before the click landed and "Create link" did nothing. */
  /* ⚠️ RE-AIMED 10/7/2026: the panel became a CENTRED MODAL, so both halves moved
     into `CenterModal` — it portals to <body> and its backdrop carries
     `data-picker-safe`. The invariants are unchanged and are asserted where they
     now live; the mechanism is not the invariant. `audit:app` pins the shell. */
  const shell = code("src/components/CenterModal.tsx");
  /from "\.\/CenterModal"/.test(c) && /createPortal\(/.test(shell) && /document\.body/.test(shell)
    ? ok("the share panel is portalled out of the demo list's scroll box")
    : bad("the share panel renders inside the scroll box and will be clipped");
  /data-picker-safe/.test(shell)
    ? ok("the panel is picker-safe, so pressing it does not close the demo list")
    : bad("pressing the share panel closes the picker and swallows the click");

  /* ⚠️⚠️ **AND NEVER `preventDefault` ON THE PANEL.** A React portal bubbles through the
     REACT tree, so a click inside still reaches the row and must be stopped — but
     `preventDefault` on an ancestor cancels the submit button's default action, which is
     what made "Create link" fire no request at all. This was my own bug, found by
     instrumenting fetch rather than by reading the diff. */
  !/onClick=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\}/.test(c)
    ? ok("the panel does not preventDefault, so the form can submit")
    : bad("the panel cancels its own submit — Create link will do nothing");

  /* ⚠️⚠️ RE-AIMED, AND THE INVARIANT GOT STRONGER RATHER THAN WEAKER. This used to
     require a ResizeObserver, because an ANCHORED panel that grew after being
     placed could end up past the bottom of the viewport — unreachable, since it is
     `position: fixed`. A centred modal has no anchor to fall off: it stays centred
     however much it grows, and clamps to the viewport. So the check is now that it
     CANNOT anchor, which forbids the whole class rather than patching it. */
  !/getBoundingClientRect|ResizeObserver|setRect\(/.test(c)
    ? ok("the panel is centred, so growing cannot push it off screen")
    : bad("a growing panel can end up off screen");
})();

/* ⚠️ The buttons are the LAUNCH green, asked for directly — the same token
   `.launch-btn` uses, so the two cannot drift. */
(() => {
  const css = fs.readFileSync("src/styles/app.css", "utf8");
  const rule = css.slice(css.indexOf(".shr-btn {"), css.indexOf(".shr-btn {") + 240);
  return /var\(--color-green-bar\)/.test(rule) && !/#2666f9/.test(rule);
})()
  ? ok("the share buttons use the launch green, not the platform blue")
  : bad("the share button is the wrong colour");

/* ⚠️ The launch form can create a link up front, and it must never fail the launch:
   an SE who waited three minutes cannot lose the demo because a link failed. */
(() => {
  const l = code("src/screens/Launch.tsx");
  /* ⚠️ RE-AIMED 10/7/2026: this pinned `shareOnLaunch && demo`, which went red when the
     request became admin-gated — the condition was never the invariant. What matters is
     that the POST is guarded AND wrapped, so a failed link cannot lose a three-minute
     generation; who may make one is asserted by the admin-gate section below. */
  return /shareOnLaunch/.test(l) && /if \(shareOnLaunch && [^)]*demo\)/.test(l) && /catch \{/.test(l);
})()
  ? ok("the launch form can share from the start, and a failed link cannot lose the demo")
  : bad("the shareable-on-launch option is missing or can fail the launch");

/* ⚠️⚠️ **ONE DEFINITION OF THE DEFAULT DURATION.** It is read by the launch checkbox,
   the dialog's pre-filled field, the server's fallback and the extend button — four
   literals is how the form offers 30 days while the server quietly stores 7. */
(() => {
  const files = ["src/screens/Launch.tsx", "src/components/ShareDemoButton.tsx",
    "engine/shareApi.ts", "engine/shareStore.ts"];
  /* ⚠️ Narrowed after a probe fault: a bare `useState(\d+)` also matched an unrelated
     `useState(0)` in Launch.tsx, so the check failed on correct code. Only
     day-carrying expressions count, plus the dialog's own day field by name. */
  const stray = files.filter((f) => /\bdays:\s*\d|\bdays \?\? \d|addDays:\s*\d/.test(code(f)));
  const allUse = files.every((f) => /DEFAULT_SHARE_DAYS/.test(code(f)));
  const fieldSeeded = /useState\(DEFAULT_SHARE_DAYS\)/.test(code("src/components/ShareDemoButton.tsx"));
  return stray.length === 0 && allUse && fieldSeeded;
})()
  ? ok("every caller reads one DEFAULT_SHARE_DAYS, with no stray literal")
  : bad("a hardcoded day count is back — the form and the server can disagree");

/* ⚠️ The constant lives in a DOM-FREE module, because the engine project compiles with
   no DOM lib and `shareMode.ts` reads `location` — importing that from engine/ failed
   the build with "Cannot find name 'location'", the same shape as the replicaPages
   import that cost 43 errors. */
!/\blocation\b/.test(code("src/data/shareDefaults.ts"))
  ? ok("the shared constant's module carries no DOM reference")
  : bad("shareDefaults touches the DOM — the engine build will fail on it");

/* ⚠️⚠️ **MY REPORTS LISTS ONLY WHAT THE SHARE CARRIES.** The routes were already
   refused, so an out-of-scope row was never a way IN — but it rendered a list of links
   that all answer "Not part of this demo", which reads as a broken product. Filtered on
   the row's DESTINATION rather than its name, so renaming a report cannot slip it back. */
(() => {
  const r = code("src/screens/MyReports.tsx");
  return /isShareMode\(\)/.test(r) && /shareAllows\(r\.to\)/.test(r);
})()
  ? ok("My Reports is filtered by destination on a shared demo")
  : bad("a prospect's Reports page lists reports their share cannot open");

/* ⚠️ Public routes must never echo an exception to a prospect's page. */
!/error: e\?\.message \|\| 'Share request failed\.'/.test(code("vite.config.ts"))
  ? ok("the share routes do not echo internal errors")
  : bad("an internal error message reaches a prospect's page");

/* ⚠️⚠️ **A CLASSNAME IS NOT STYLING.** The trigger shipped carrying `row-icon`, a class
   NO stylesheet defines, so the browser fell back to its default button chrome — `2px
   outset`, `#efefef`, square corners — next to two flat ghost buttons, and it was
   reported as standing out. `tsc` cannot see this and neither can a render test that
   only asks whether the button exists. Every class this component renders must resolve
   to a real rule; `material-icons` is the one global exception (fonts, not layout). */
(() => {
  const src = fs.readFileSync("src/components/ShareDemoButton.tsx", "utf8");
  const css = fs.readFileSync("src/styles/app.css", "utf8");
  const used = new Set<string>();
  for (const m of src.matchAll(/className=(?:"([^"]+)"|\{"([^"]+)")/g))
    (m[1] ?? m[2]).split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
  const orphans = [...used].filter((c) => c !== "material-icons" && !new RegExp(`\\.${c}[\\s,:.{\\[]`).test(css));
  if (orphans.length) bad(`ShareDemoButton renders class(es) with no CSS rule: ${orphans.join(", ")}`);
  else ok("every class the share button renders resolves to a real CSS rule");
})();

/* ⚠️ And it must read as its NEIGHBOURS do — a ghost button, not a boxed one. Pinned
   against `.prospect-delete`, the sibling it sits beside, rather than against literals. */
(() => {
  const css = fs.readFileSync("src/styles/app.css", "utf8");
  const rule = (sel: string) => {
    const i = css.indexOf(sel + " {");
    return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
  };
  const t = rule(".shr-trigger"), d = rule(".prospect-delete");
  const same = (prop: string) => {
    const g = (r: string) => (new RegExp(`${prop}:\\s*([^;]+)`).exec(r)?.[1] ?? "").trim();
    return !!g(t) && g(t) === g(d);
  };
  return !!t && same("width") && same("height") && same("border-radius")
    && /background:\s*transparent/.test(t) && /border:\s*none/.test(t);
})()
  ? ok("the share trigger is a ghost button with the delete button's own box")
  : bad("the share trigger does not match its sibling row controls");

console.log("\nAdmin gate (the feature is piloted with admins, 10/7/2026)\n");

/* ⚠️⚠️ **BOTH HALVES OR NEITHER.** Hiding the button is cosmetic — anyone signed in can
   POST to the route — and refusing the route alone leaves a control that only ever says
   no. So the server checks are functional (they call the real handler) and the client
   checks read the source, and a sabotage of either half must redden. */
const anySe = { email: "colleague@invoca.com", name: "A Colleague" };
const yes = () => true;

(await A.handleShareAdminApi("POST", "/api/demos/acme-health/shares",
  { prospect: "Acme Health" }, anySe, yes, false))!.status === 403
  ? ok("a non-admin cannot create a share link")
  : bad("a non-admin can create a share link");

(await A.handleShareAdminApi("GET", "/api/demos/acme-health/shares",
  undefined, anySe, yes, false))!.status === 403
  ? ok("a non-admin cannot list a demo's share links")
  : bad("a non-admin can list a demo's share links");

(await A.handleShareAdminApi("DELETE", `/api/shares/${rec.token}`,
  undefined, anySe, yes, false))!.status === 403
  ? ok("a non-admin cannot revoke a link")
  : bad("a non-admin can revoke a link");

(await A.handleShareAdminApi("PATCH", `/api/shares/${rec.token}`,
  { addDays: 7 }, anySe, yes, false))!.status === 403
  ? ok("a non-admin cannot extend a link")
  : bad("a non-admin can extend a link");

/* ⚠️ The gate must not refuse an ADMIN — a check that refuses everyone passes the four
   above while shipping a feature nobody can use. */
(await A.handleShareAdminApi("GET", "/api/demos/acme-health/shares",
  undefined, anySe, yes, true))!.status === 200
  ? ok("an admin still reaches the share routes")
  : bad("the gate refuses admins too");

/* ⚠️⚠️ **A LIVE PROSPECT LINK MUST SURVIVE THE PILOT.** The public handler takes no
   admin flag at all; if it ever grows one, every link already in a prospect's inbox
   dies the moment the gate is tightened. Asserted by USE, not by reading the signature. */
/* ⚠️ ITS OWN FIXTURE, because `createShare` deletes a demo's prior links (one link per
   demo): under a sabotage that lets a non-admin create, the attempts above would revoke
   `acme-health`'s link and this check would fire with the wrong reason. */
(await (async () => {
  const live = S.createShare({ demoId: "live-link", prospect: "Live", createdBy: "se@invoca.com", days: 7, password: "Live" });
  const u = (await A.handleShareApi("POST", `/api/share/${live.token}/unlock`, { password: "Live" }, {}))!;
  const r = (await A.handleShareApi("GET", `/api/share/${live.token}/demo`, undefined,
    { [A.cookieNameFor(live.token)]: u.setCookie!.value }))!;
  return r.status === 200 && A.handleShareApi.length < 5;
})())
  ? ok("a prospect's link still opens — the public side takes no admin flag")
  : bad("the admin gate reached the prospect-facing routes");

/* ⚠️ Both twins must PASS the flag. A twin that omits it type-errors today, but the
   argument is a boolean and a future refactor could default it to true. */
/handleShareAdminApi\([\s\S]{0,400}?isAdmin\(user\)\)/.test(code("server.ts"))
  ? ok("server.ts passes isAdmin into the share admin routes")
  : bad("server.ts does not pass the admin flag");

/demoApi\.isAdmin\(user\)/.test(code("vite.config.ts"))
  ? ok("the dev twin passes isAdmin into the share admin routes")
  : bad("the dev twin does not pass the admin flag");

/* The client half — hidden rather than disabled, so a non-admin is never offered a
   control whose request the server would then refuse. */
const L = code("src/screens/Launch.tsx");

/\{e\.inLibrary && admin && <ShareDemoButton/.test(L)
  ? ok("the share button renders for admins only")
  : bad("a non-admin is shown the share button");

/\{admin && <label className="launch-share">/.test(L)
  ? ok("the launch form's shareable checkbox is admin-only")
  : bad("a non-admin is shown the shareable checkbox");

/if \(shareOnLaunch && admin && demo\)/.test(L)
  ? ok("the launch-time share request is admin-gated")
  : bad("the launch-time share request is not admin-gated");


/* =============================================================================
   THE PASSWORD IS EMAILED, NOT PASSED ALONG (10/8/2026)
   -----------------------------------------------------------------------------
   Asked for: *"instead of us giving them the password, i want to setup it up so that
   they have to enter their email, and then a password is send to them from
   noreply@invoca.com, the password is the prospect's name with no spaces."*

   ⚠️⚠️ **WHAT THIS BUYS IS A RECORD OF WHO OPENED THE DEMO, NOT A SECOND FACTOR.** The
   password is the prospect's own name and the unlock page prints that name in its own
   heading, so anybody holding the link can derive it without asking. The 32-byte token
   in the URL is still the only real secret. These checks are written to that reading.
   ============================================================================= */
console.log("\nEmailed share password\n");
{
  const { sharePassword } = await import("../src/data/sharePassword.ts");
  const { sharePasswordEmail } = await import("../engine/mailer.ts");

  sharePassword("United Veterinary Care") === "UnitedVeterinaryCare"
    ? ok("the password is the prospect's name with the spaces taken out")
    : bad(`sharePassword is wrong: ${sharePassword("United Veterinary Care")}`);
  /* ⚠️ EVERY whitespace run, not just " " — a pasted name can carry a non-breaking
     space or a tab, and a password nobody can type is worse than a weak one. */
  sharePassword("Avi  &\tCo.") === "Avi&Co."
    ? ok("tabs and non-breaking spaces are stripped too, and punctuation is kept")
    : bad(`unusual whitespace survives: ${JSON.stringify(sharePassword("Avi  &\tCo."))}`);

  /* ⚠️ The emailed string and the stored hash must come from ONE function, or the
     password that arrives is not the one that opens the link. */
  const api = code("engine/shareApi.ts");
  (api.match(/sharePassword\(/g)?.length ?? 0) >= 2 && !/replace\(\/\\s/.test(api)
    ? ok("both the create route and the email derive the password from one function")
    : bad("the password is derived twice — the sent string and the stored hash can disagree");

  /* ⚠️⚠️ A CUSTOM PASSWORD CANNOT BE EMAILED. The store keeps a hash, so one somebody
     typed cannot be recovered — and sending the DERIVED one instead would be worse than
     sending nothing, because it would not open the link and nothing would say why. */
  /if \(!rec\.derivedPassword\)/.test(api) && /password set by your Invoca contact/.test(api)
    ? ok("a link with a custom password refuses to email one, and says why")
    : bad("a custom-password link would be emailed a password that does not work");
  /derivedPassword: !custom/.test(api)
    ? ok("only a derived password is flagged as emailable")
    : bad("the derived flag is not set from whether a password was supplied");

  /* ⚠️ The recipient is caller-chosen, so the shape check and the cap are the guards. */
  /\[\^\\s@\]\+@/.test(api) && /email\.length > 254/.test(api)
    ? ok("the address is shape-checked and length-bounded")
    : bad("any string is accepted as an email address");
  /takeBudget\(token, "email"\)/.test(api) && /CAPS = \{ chat: 120, voice: 10, email: 12 \}/.test(api)
    ? ok("requests are capped per link per day, so a leaked link is not a mail relay")
    : bad("the request route is uncapped — a share link could push unsolicited mail");
  /noteRequest\(token, email\)/.test(api)
    ? ok("every request is recorded on the share, so a burst is visible afterwards")
    : bad("nobody can see who asked for the password — the point of the change");
  /* ⚠️ RECORDED EVEN WHEN NOTHING IS SENT. Who asked is the fact worth keeping; whether
     the mail left is a separate question. */
  api.indexOf("noteRequest(token, email)") < api.indexOf("if (!rec.derivedPassword)")
    ? ok("the request is recorded before the send is attempted")
    : bad("a refused send loses the record of who asked");

  /* The mail itself. */
  const mail = sharePasswordEmail("buyer@acme.com", "United Veterinary Care",
    "UnitedVeterinaryCare", "https://x/share/tok", "noreply@invoca.com");
  mail.from === "noreply@invoca.com" && mail.to === "buyer@acme.com"
    ? ok("the mail carries the configured From") : bad("the From is not set on the mail");
  mail.text.includes("UnitedVeterinaryCare") && mail.text.includes("https://x/share/tok")
    && (mail.html ?? "").includes("UnitedVeterinaryCare")
    ? ok("both bodies carry the password and the link")
    : bad("the email is missing the password or the link");
  /* ⚠️ The prospect name is AI-written text going into HTML mail. */
  !(sharePasswordEmail("b@a.com", "<script>x</script>", "p", "u").html ?? "").includes("<script>")
    ? ok("the prospect name is escaped into the HTML body")
    : bad("the prospect name is injected into HTML mail unescaped");

  /* ⚠️ SET IT IN BOTH TRANSPORTS OR NEITHER — the rule mailer.ts already states for
     Reply-To and Cc; a From honoured by one route silently depends on which is live. */
  const mailer = code("engine/mailer.ts");
  /From: \$\{mail\.from \?/.test(mailer) && /from: `"\$\{FROM_NAME\}" <\$\{mail\.from \|\| USER\}>`/.test(mailer)
    ? ok("both transports honour the From")
    : bad("one transport ignores mail.from — it depends which happens to be configured");

  /* ⚠️ PUBLIC, like the rest of /api/share — a prospect has no Invoca session. */
  const srv = code("server.ts");
  srv.indexOf('app.post("/api/share/:token/request-password"') > 0
  && srv.indexOf('app.post("/api/share/:token/request-password"') < srv.indexOf("installAuth(app)")
    ? ok("the request route is public, registered before the auth gate")
    : bad("the request route is behind the gate, or missing — a prospect could never reach it");
  /\/api\/share\//.test(code("vite.config.ts"))
    ? ok("the dev twin serves it too") : bad("the route 404s in dev while production serves it");
  /baseUrl = ""/.test(api) && /shareBase\(req\)/.test(srv)
    ? ok("the emailed link is built from the request, not a constant")
    : bad("the link in the email would be wrong off production");

  /* The gate itself. */
  const gate = code("src/screens/ShareApp.tsx");
  /requestPassword/.test(gate) && /Email me the password/.test(gate)
    ? ok("the gate asks for an email first")
    : bad("the gate still asks for a password nobody was sent");
  /* ⚠️⚠️ **PRESENCE WAS NOT ENOUGH, AND THIS CHECK LET A REAL BUG THROUGH.** It matched the
     button's LABEL, which says nothing about whether clicking it does anything — the
     dead-control trap CLAUDE.md records repeatedly. It shipped broken: the step was derived
     from `sentTo` (`if (!sentTo)`) and the button advanced by setting it to `""`, which is
     FALSY, so the guard could not tell "advanced without an address" from "not advanced"
     and the link did nothing. One value was answering two questions. The checks below pin
     the fix rather than the label: the step is its OWN state, the render branches on IT,
     and the button sets it. */
  /I already have the password/.test(gate)
    ? ok("there is still a way through when the mail does not arrive")
    : bad("a spam filter or an unconfigured mailer leaves the prospect with no route");
  /useState<"email" \| "password">\("email"\)/.test(gate)
    ? ok("which step the gate is on is its own state")
    : bad("the step is derived from another value again — an empty one reads as 'not yet'");
  /if \(step === "email"\)/.test(gate) && !/if \(!sentTo\)/.test(gate)
    ? ok("the render branches on the step, not on whether an address was captured")
    : bad("the step guard reads a value that can legitimately be empty");
  /I already have the password[\s\S]{0,120}?setStep\("password"\)|setStep\("password"\);[\s\S]{0,160}?I already have the password/.test(gate)
    ? ok("the 'I already have the password' link actually advances the step")
    : bad("that link does not change the step — it is a dead control");
  /if \(!body\?\.sent\) setNote/.test(gate)
    ? ok("an unsent email says so rather than pointing at an empty inbox")
    : bad("the gate claims an email was sent whatever happened");
}


fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll share checks passed\n");
process.exit(fail ? 1 : 0);
