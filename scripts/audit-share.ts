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



/* =============================================================================
   THE ACTIVITY TAB (10/8/2026)
   -----------------------------------------------------------------------------
   Asked for: track every time a prospect opens a shared demo, finishes an SMS demo
   or finishes a voice demo, with several people on one prospect shown as sublines
   under a single main row rather than as repeated rows.
   ============================================================================= */
console.log("\nActivity tracking\n");
{
  const { recordActivity, listActivity, totals, ANONYMOUS } =
    await import("../engine/activityStore.ts");
  const { activityLines } = await import("../engine/sheetActivity.ts");
  const { ACTIVITY_COLUMNS, ACTIVITY_TAB } = await import("../engine/sheetsApi.ts");

  recordActivity("acme-co", "Acme Co", "Buyer@Acme.com", "opened");
  recordActivity("acme-co", "Acme Co", "buyer@acme.com", "opened");
  /* ⚠️⚠️ THE DEDUPE IS THE WHOLE REASON THE NUMBERS MEAN ANYTHING. The SMS capture
     upserts after EVERY turn, so one conversation reports itself a dozen times; without
     this the column would be a message count wearing a conversation's name. */
  for (let i = 0; i < 9; i++) recordActivity("acme-co", "Acme Co", "buyer@acme.com", "sms", "conv-1");
  recordActivity("acme-co", "Acme Co", "buyer@acme.com", "sms", "conv-2");
  recordActivity("acme-co", "Acme Co", "cto@acme.com", "voice", "call-9");
  recordActivity("acme-co", "Acme Co", "cto@acme.com", "voice", "call-9");
  recordActivity("acme-co", "Acme Co", "", "opened");

  const rec = listActivity().find((r) => r.demoId === "acme-co")!;
  const buyer = rec.users.find((u) => u.email === "buyer@acme.com");
  buyer?.sms === 2
    ? ok("nine reports of one SMS conversation count once; a second counts again")
    : bad(`the SMS dedupe is wrong (sms=${buyer?.sms}, expected 2)`);
  rec.users.find((u) => u.email === "cto@acme.com")?.voice === 1
    ? ok("a re-captured voice call is not double counted")
    : bad("the voice dedupe is wrong");
  buyer?.opened === 2
    ? ok("an event with no id still counts every time — opens are not conversations")
    : bad(`opens are being deduped (opened=${buyer?.opened}, expected 2)`);
  /* ⚠️ ONE PERSON IS ONE SUBLINE however they typed their address. */
  rec.users.length === 3 && !!rec.users.find((u) => u.email === ANONYMOUS)
    ? ok("case differences are one person, and a missing address is its own line")
    : bad(`users did not collapse by case: ${rec.users.map((u) => u.email).join(", ")}`);

  const t = totals(rec);
  t.opened === 3 && t.sms === 2 && t.voice === 1
    ? ok("the main row totals its people")
    : bad(`totals are wrong: ${JSON.stringify(t)}`);

  /* ⚠️⚠️ THE SHAPE THAT WAS ASKED FOR: one main row, then its people. */
  const lines = activityLines([rec]);
  lines[0]?.main && lines.slice(1).every((l) => !l.main) && lines.length === 4
    ? ok("one main row per prospect with a subline per person, not a row each")
    : bad(`the grouping is wrong: ${lines.map((l) => (l.main ? "MAIN" : "sub")).join(",")}`);
  lines[0].label === "Acme Co" && lines[0].opened === 3
    ? ok("the main row is the prospect and carries the totals")
    : bad("the main row is not the prospect");

  /* ⚠️ Most recent first — the sheet answers "who has been in this lately". */
  recordActivity("zz-later", "Zeta Later", "a@z.com", "opened");
  const two = activityLines(listActivity().filter((r) => ["acme-co", "zz-later"].includes(r.demoId)));
  two[0]?.label === "Zeta Later"
    ? ok("the most recently active prospect is at the top")
    : bad("the Activity tab is not ordered by recency");

  ACTIVITY_TAB === "Activity" && ACTIVITY_COLUMNS[0] === "Prospect / Person"
    ? ok("the tab is called Activity and leads with the prospect/person column")
    : bad("the Activity tab name or columns drifted");

  /* ── the wiring ────────────────────────────────────────────────────────── */
  const api = code("engine/shareApi.ts");
  /recordActivity\(rec\.demoId, rec\.prospect, who, "opened"\)/.test(api)
    ? ok("unlocking a shared demo records an open")
    : bad("opening a shared demo records nothing");
  /* ⚠️ The address has to survive a reload, which is why it rides the session cookie. */
  /unlockedAs/.test(api) && /base64url/.test(api)
    ? ok("who opened it is carried in the unlock cookie, so activity stays attributable")
    : bad("the email is not carried — every later event would be anonymous");
  /* ⚠️ APPENDING TO THE COOKIE MUST NOT LOOSEN THE UNLOCK: the proof half is compared
     on its own. */
  /const \{ proof \} = splitCookie/.test(api) && /timingSafeEqual/.test(api)
    ? ok("the unlock still compares only the signed half of the cookie")
    : bad("the cookie change weakened the unlock comparison");
  /leaf === "\/activity"/.test(api) && /kind must be sms or voice/.test(api)
    ? ok("there is one public endpoint for a conversation, and it validates the kind")
    : bad("the activity endpoint is missing or unvalidated");
  /if \(!unlocked\(cookies, token\)\) return \{ status: 401[\s\S]{0,200}?leaf === "\/activity"|leaf === "\/activity"[\s\S]{0,300}?if \(!unlocked\(cookies, token\)\)/.test(api)
    ? ok("it needs the unlock, so a bare link cannot post activity")
    : bad("anybody holding the URL could write activity without unlocking");

  /* ⚠️ The client fires liberally BECAUSE the server dedupes — both halves or neither. */
  const client = code("src/data/shareActivity.ts");
  /isShareMode\(\)/.test(client) && /keepalive: true/.test(client)
    ? ok("the reporter is share-mode only and survives the navigation after a call ends")
    : bad("the reporter runs in the signed-in app, or dies with the page");
  /reportShareActivity\("sms"/.test(code("src/data/SmsCaptureContext.tsx"))
  && /reportShareActivity\("voice"/.test(code("src/data/VoiceCaptureContext.tsx"))
    ? ok("both capture paths report, with the conversation's own id")
    : bad("a conversation type is never reported");

  /* ⚠️ The sheet write must never be able to break the thing that triggered it. */
  const sync = code("engine/sheetActivity.ts");
  /catch \(e: unknown\)[\s\S]{0,200}?return \{ written: false/.test(sync)
    ? ok("a failed Activity write is swallowed — the event is already on disk")
    : bad("a spreadsheet problem could break a prospect unlocking a demo");
  /getDemo\(r\.demoId\)\?\.event === demo\?\.event/.test(sync)
    ? ok("the tab is scoped to the event, so two events cannot overwrite each other")
    : bad("every event would write every prospect into the same Activity tab");

  /* ⚠️ Rewritten whole, and CLEARED first — a shorter rebuild must not leave the old tail. */
  const sheets = code("engine/sheetsApi.ts");
  /:clear/.test(sheets) && /was > values\.length/.test(sheets)
    ? ok("a shorter rebuild clears the rows it no longer writes")
    : bad("stale rows survive under a rebuilt Activity tab");
  /themeNotes/.test(code("engine/sheetHook.ts")) && /frozenRowCount/.test(sheets)
    ? ok("both tabs get the house style, not a default white grid")
    : bad("the sheets are unstyled");
  /try \{ await themeNotes\(target\); \} catch/.test(code("engine/sheetHook.ts"))
    ? ok("a styling failure cannot lose a row that already landed")
    : bad("the theme call can fail a mark");

  /* ==========================================================================
     THE THEME, DRIVEN AGAINST A MOCKED GOOGLE.

     ⚠️⚠️ **THIS SECTION EXISTS BECAUSE THE SOURCE-READING CHECKS ABOVE ALL PASSED ON A
     SHEET THAT WAS COMPLETELY UNSTYLED.** The palette was right, the font constant was
     right, every field validated against Google's own discovery document — and the first
     real sheet came out as a plain white grid, because the request never reached Google
     in a usable state. Reading the file could not have found that; calling the function
     and reading what it would SEND can. Never the real API: an audit that depends on
     somebody else's service cannot run on a machine with no credential, which is the rule
     `audit:advanced` already follows for Gong.
     ========================================================================== */
  /**
   * ⚠️⚠️ **A MOCK THAT ALWAYS SAYS YES CANNOT CATCH A MALFORMED REQUEST, and that is
   * exactly how the whole theme shipped as a no-op twice.** The first version of this
   * section captured the payload and asserted things about its SHAPE while the stub
   * returned 200 to anything — so `{ r, g, b }` sailed through here and Google rejected
   * every colour in it: `Unknown name "r" ... Cannot find field`. The real API refuses an
   * unknown field outright rather than ignoring it, so one abbreviated key 400s the entire
   * batch and the sheet comes out blank. This validator refuses the same things Google
   * refuses, and the mock runs it on every call.
   */
  function colourFaults(node: unknown, path = "requests"): string[] {
    const bad: string[] = [];
    const ALLOWED = new Set(["red", "green", "blue", "alpha"]);
    const walk = (n: any, at: string) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${at}[${i}]`));
      for (const [k, v] of Object.entries(n)) {
        if (/color$/i.test(k) && v && typeof v === "object" && !Array.isArray(v)) {
          for (const key of Object.keys(v)) {
            if (!ALLOWED.has(key)) bad.push(`${at}.${k}.${key}`);
          }
        }
        walk(v, `${at}.${k}`);
      }
    };
    walk(node, path);
    return bad;
  }
  /* Proved to bite before it is trusted — the tautological-check trap, which this file
     has already recorded four times and which let the colour bug through once. */
  colourFaults({ requests: [{ repeatCell: { cell: { userEnteredFormat: { backgroundColor: { r: 1, g: 1, b: 1 } } } } }] }).length === 3
    ? ok("the colour validator rejects r/g/b — it can actually fail")
    : bad("the colour validator does not catch the shape that shipped broken");
  colourFaults({ requests: [{ repeatCell: { cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } } } }] }).length === 0
    ? ok("the colour validator accepts Google's own field names")
    : bad("the colour validator rejects a correct payload");

  {
    const { saveSheetsToken } = await import("../engine/sheetsTokens.ts");
    const sheetsApi = await import("../engine/sheetsApi.ts");
    saveSheetsToken("owner@invoca.com", "refresh-token-for-the-audit");
    const target = { email: "owner@invoca.com", spreadsheetId: "SHEET_ID_0123456789" };

    const sent: any[] = [];
    const realFetch = globalThis.fetch;
    /* ⚠️ **"Demo Notes" DELIBERATELY CARRIES NO `sheetId`.** That is not a lazy fixture —
       it is exactly what Google returns for the FIRST sheet in a spreadsheet, because
       protobuf-to-JSON omits zero-valued integers, and reproducing it is the whole point
       of this test. */
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
      if (u.includes("oauth2.googleapis.com")) return json({ access_token: "tok", expires_in: 3600 });
      if (u.includes("?fields=sheets.properties")) {
        return json({ sheets: [
          { properties: { title: "Demo Notes" } },
          { properties: { title: "Activity", sheetId: 1870 } },
        ] });
      }
      if (u.includes(":batchUpdate")) {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        const faults = colourFaults(payload);
        if (faults.length) {
          return new Response(JSON.stringify({ error: { message: `Invalid JSON payload received. Unknown name at '${faults[0]}': Cannot find field.` } }), { status: 400 });
        }
        sent.push(payload); return json({});
      }
      if (u.includes("/values/")) {
        if (u.includes("Activity!A2:A")) {
          return json({ values: [["Riverbend Sandler Pools"], ["    \u21b3  someone@example.com"]] });
        }
        return json({ values: [["h"], ["r1"], ["r2"]] });
      }
      return json({});
    }) as typeof fetch;

    try {
      sent.length = 0;
      /* ⚠️ CAUGHT AND REPORTED, NOT LEFT TO THROW. The mock refuses a malformed payload the
         way Google does, so a regression REJECTS here — and an unhandled rejection would
         kill the whole suite with a stack trace instead of naming the fault, which is the
         crash-not-FAIL trap this repo has already paid for once. */
      let refused: string | null = null;
      await sheetsApi.themeNotes(target).catch((e: Error) => { refused = e?.message ?? "rejected"; });
      refused === null
        ? ok("Google accepts the theme payload as built")
        : bad(`Google would reject the theme payload: ${refused}`);
      const flat = JSON.stringify(sent);

      /* ⚠️⚠️ THE REGRESSION THAT SHIPPED: `Number(undefined)` is NaN, `JSON.stringify`
         turns NaN into `null`, and Google 400s the whole batch — so every style request
         for the first tab of every sheet was lost, silently. */
      !/"sheetId":null/.test(flat) && !/NaN/.test(flat)
        ? ok("the first tab's sheetId 0 survives — no NaN reaches Google")
        : bad("sheetId came out null/NaN: the first tab of every sheet goes unstyled");
      /"sheetId":0/.test(flat)
        ? ok("an absent sheetId is read as 0, which is what it means")
        : bad("the first tab's id is not being resolved to 0");

      const reqs = sent.flatMap((b: any) => b.requests ?? []);
      colourFaults({ requests: reqs }).length === 0
        ? ok("every colour in a real payload uses red/green/blue, as Google names them")
        : bad(`colour fields Google will reject: ${colourFaults({ requests: reqs }).join(", ")}`);
      reqs.some((r: any) => r.updateSheetProperties?.properties?.tabColor)
        ? ok("the tab itself is coloured, so a themed sheet is obvious at a glance")
        : bad("nothing marks the tab as themed");
      reqs.some((r: any) => r.updateSheetProperties?.properties?.gridProperties?.hideGridlines === true)
        ? ok("the default grid is off — our own hairlines do the ruling")
        : bad("the sheet still reads as a default spreadsheet grid");

      /* ⚠️ Bounded to the rows that hold something. An unbounded body range rules all
         1,000 rows of an empty grid, which is most of what made it look unfinished. */
      const body = reqs.find((r: any) => r.repeatCell?.cell?.userEnteredFormat?.borders?.bottom);
      body?.repeatCell?.range?.endRowIndex === 3
        ? ok("the hairlines stop at the last row that holds something")
        : bad("the body formatting runs past the data and rules the empty grid");

    } finally {
      globalThis.fetch = realFetch;
    }

    /* The Activity emphasis, driven the same way. */
    const sent2: any[] = [];
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (u.includes("oauth2.googleapis.com")) return json({ access_token: "tok", expires_in: 3600 });
      if (u.includes("?fields=sheets.properties")) {
        return json({ sheets: [{ properties: { title: "Demo Notes" } }, { properties: { title: "Activity", sheetId: 1870 } }] });
      }
      if (u.includes(":batchUpdate")) {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        const faults = colourFaults(payload);
        if (faults.length) {
          return new Response(JSON.stringify({ error: { message: `Invalid JSON payload received. Unknown name at '${faults[0]}': Cannot find field.` } }), { status: 400 });
        }
        sent2.push(payload); return json({});
      }
      if (u.includes("Activity!A2:A")) {
        return json({ values: [["Riverbend Sandler Pools"], [`${sheetsApi.INDENT}someone@example.com`]] });
      }
      if (u.includes("/values/")) return json({ values: [["h"], ["r1"], ["r2"]] });
      return json({});
    }) as typeof fetch;
    try {
      let refused2: string | null = null;
      await sheetsApi.writeActivity(target, [
        { main: true, label: "Riverbend Sandler Pools", opened: 1, sms: 1, voice: 0, firstAt: "a", lastAt: "b" },
        { main: false, label: "someone@example.com", opened: 1, sms: 1, voice: 0, firstAt: "a", lastAt: "b" },
      ]).catch((e: Error) => { refused2 = e?.message ?? "rejected"; });
      refused2 === null
        ? ok("Google accepts the Activity payload as built")
        : bad(`Google would reject the Activity payload: ${refused2}`);
      const reqs2 = sent2.flatMap((b: any) => b.requests ?? []);
      /* ⚠️⚠️ THE SUBLINE IS RECOVERED FROM THE INDENT, which is the one definition the
         writer also uses. A prospect row gets the wash and the thick green edge; a person
         must NOT, or the whole tab reads as headings. */
      const accents = reqs2.filter((r: any) =>
        r.repeatCell?.cell?.userEnteredFormat?.borders?.left?.style === "SOLID_THICK");
      accents.length === 1 && accents[0].repeatCell.range.startRowIndex === 1
        ? ok("exactly the prospect row carries the thick green edge, not its people")
        : bad(`the prospect accent landed on ${accents.length} row(s) — the indent test is wrong`);
      reqs2.some((r: any) => r.repeatCell?.cell?.userEnteredFormat?.numberFormat?.pattern === "0")
        ? ok("the counts are formatted as integers, so two columns cannot disagree")
        : bad("a count could render as 1 in one column and 1.0 in the next");
    } finally {
      globalThis.fetch = realFetch2;
    }
  }

  /* ⚠️⚠️ A MISSING TAB MUST THROW, NOT RETURN QUIETLY. The silent return is precisely what
     made a sheet that could not be styled look exactly like one that had been, and it is
     the shape every caller's catch now depends on having something to catch. */
  {
    const sheetsApi = await import("../engine/sheetsApi.ts");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (u.includes("oauth2.googleapis.com")) return json({ access_token: "tok", expires_in: 3600 });
      if (u.includes("?fields=sheets.properties")) return json({ sheets: [{ properties: { title: "Something Else", sheetId: 9 } }] });
      return json({});
    }) as typeof fetch;
    let threw = false;
    try {
      await sheetsApi.themeNotes({ email: "owner@invoca.com", spreadsheetId: "SHEET_ID_0123456789" });
    } catch { threw = true; } finally { globalThis.fetch = realFetch; }
    threw
      ? ok("styling a tab that is not there throws, so a caller can report it")
      : bad("a missing tab is styled silently — the failure that shipped");
  }

  /* ==========================================================================
     THE GUIDED TOUR — first open on a shared demo.
     ========================================================================== */
  {
    const { tourStepsFor, autoOpeners } = await import("../src/data/tourSteps.ts");
    const { readFileSync } = await import("node:fs");
    const prof = JSON.parse(readFileSync("src/data/generated/aptive.json", "utf8"));
    const steps = tourStepsFor(prof);

    steps.length >= 12
      ? ok(`the tour is ${steps.length} steps, enough to carry agent studio, both agents and the reports`)
      : bad("the tour is too thin to show the product");

    /* ⚠️ The order the request settled on: agents first, reports LAST, so the conversation
       they just had is the data they are shown. */
    const ids = steps.map((s) => s.id);
    const iVoice = ids.indexOf("voice-tree"), iSms = ids.indexOf("sms-tree"), iRep = ids.indexOf("reports");
    iVoice > 0 && iSms > iVoice && iRep > iSms
      ? ok("agent studio, then voice, then SMS, then the reports")
      : bad("the tour order does not match what was asked for");

    /* ⚠️⚠️ EVERY STEP SELLS. The request says it twice, and a step that only names a
       control has told a prospect nothing. */
    const noValue = steps.filter((s) => !s.value || s.value.length < 25).map((s) => s.id);
    noValue.length === 0
      ? ok("every step states the value, not just the feature")
      : bad(`steps with no value line: ${noValue.join(", ")}`);

    /* ⚠️ Re-skinned, like everything else on this platform. */
    const blob = JSON.stringify(steps);
    blob.includes(prof.customerName) && blob.toLowerCase().includes(String(prof.bookingTerm).toLowerCase())
      ? ok("the copy carries the prospect's own name and booking term")
      : bad("the tour reads as a template");
    !/\b(Shady Blinds|Marriott|AutoNation|Orlando Health)\b/.test(blob)
      ? ok("no other prospect's vocabulary leaks into the tour")
      : bad("the tour names a different company");

    /* ⚠️ The scripted opener is a REAL conversation, so it must be ordinary language a
       person would type, not a tidy brief that proves nothing. */
    const op = autoOpeners(prof);
    op.length >= 2 && op.every((l) => l.length > 10 && l.length < 140)
      ? ok("the scripted opener is two short, human lines")
      : bad("the scripted conversation is the wrong shape");

    const tour = code("src/components/GuidedTour.tsx");
    /* ⚠️⚠️ THE HANG THAT SHIPPED IN TESTING: the budget was checked AFTER the
       scroll-into-view branch, so a target taller than the viewport scrolled forever and
       the card never appeared. */
    /* ⚠️ `indexOf` RETURNS -1 WHEN THE LINE IS GONE, AND `-1 < anything` IS TRUE — so the
       first version of this passed when the budget check was DELETED, which is the exact
       regression it exists to catch. Both indexes have to be real. */
    const iBudget = tour.indexOf("const over = Date.now() - started > budget");
    const iScroll = tour.indexOf("scrollIntoView");
    iBudget >= 0 && iScroll >= 0 && iBudget < iScroll
      ? ok("the wait budget is checked before any scrolling, so a tall target cannot hang it")
      : bad("a target taller than the viewport would spin forever and never show the card");
    /const fits = r\.height <= window\.innerHeight/.test(tour)
      ? ok("it only scrolls when scrolling could actually help")
      : bad("an oversized target is scrolled at forever");
    /if \(over\) \{ setBox\(null\); setReady\(true\); return; \}/.test(tour)
      ? ok("a target that never appears degrades to a centred card rather than stopping the tour")
      : bad("a missing selector would hang a prospect's first look at the product");
    /clickedStep\.current !== i/.test(tour)
      ? ok("a step's click is idempotent, so StrictMode cannot fire it twice")
      : bad("a re-run would click twice and spend the armed autoplay flag");

    /* ⚠️ The phone's scripted loop must survive its own state updates. */
    const phone = code("src/screens/PhonePreview.tsx");
    /mounted\.current = true;\s*return \(\) => \{ mounted\.current = false; \};/.test(phone)
      ? ok("the script's liveness is reset on remount, not left false by StrictMode")
      : bad("the scripted conversation would never start");
    !/let alive = true;[\s\S]{0,400}?return \(\) => \{ alive = false; \};[\s\S]{0,120}?\}, \[autoSend/.test(phone)
      ? ok("the loop is not torn down by the effect that started it")
      : bad("sending the first line would kill the loop before the second");
    /async function sendText\(/.test(phone) && /await sendText\(text\)/.test(phone)
      ? ok("the script and a human take the same send path")
      : bad("the tour has its own sender, free to drift from the real one");

    /* ⚠️ Consumed at click time: reading it during render spends it on StrictMode's first pass. */
    /onClick=\{\(\) => setPhone\(\{ script: takeAutoplay\(\)/.test(code("src/screens/AgentWorkflow.tsx"))
      ? ok("the autoplay flag is consumed in the click handler, never during render")
      : bad("a double render would swallow the script");

    /* ⚠️ Mounted by ShareApp, so the signed-in app never constructs it. */
    const appSrc = code("src/screens/ShareApp.tsx");
    /<ShareTour \/>/.test(appSrc) && /<BrowserRouter/.test(appSrc)
      ? ok("the tour is mounted inside the router, so its route steps work")
      : bad("the tour cannot navigate");
    !/GuidedTour/.test(code("src/App.tsx"))
      ? ok("the signed-in app never mounts the tour")
      : bad("an SE would get the prospect tour");
    /hasSeenTour\(\)/.test(appSrc) && /tour-replay/.test(appSrc)
      ? ok("first open only, and always replayable afterwards")
      : bad("the tour either nags or cannot be shown again");
  }

  /* ==========================================================================
     A SHARED DEMO IS READ-ONLY — asked for 10/8/2026, reversing an earlier call.
     ========================================================================== */
  {
    const app = code("src/screens/ShareApp.tsx");
    /* ⚠️⚠️ THE STRUCTURAL LOCK. `readOnly` is the one flag `applyEdits`, `mutate` and
       `undo` all check, so hydrating false covers every editable surface a prospect can
       reach — including ones added later, which a per-screen lock would silently miss. */
    /hydrateDemo\(demoId, \(customizations \?\? \{\}\) as never, false,/.test(app)
      ? ok("a shared demo hydrates read-only, so no write path exists at all")
      : bad("a prospect can still write to the override store");

    const wf = code("src/screens/AgentWorkflow.tsx");
    /onApply=\{!shared &&/.test(wf)
      ? ok("a shared demo is never handed a writer for the workflow drawers")
      : bad("a prospect's keystroke could reach applyEdits");
    /locked=\{shared\}/.test(wf)
      ? ok("the drawer is told it is locked, so it can say why")
      : bad("a prospect sees inert fields with no explanation");

    const dr = code("src/components/WorkflowNodeDrawer.tsx");
    /const live = !locked && !!\(edits && onApply\);/.test(dr)
      ? ok("locked outranks everything — a stray onApply cannot unlock a prospect's drawer")
      : bad("locking depends on the caller remembering to withhold onApply");
    /* ⚠️ Apply on a drawer that cannot write is a dead control, and the real product shows
       no footer at all on a configured node. */
    /\{locked \|\| d\.kind === "trigger" \?/.test(dr)
      ? ok("a locked drawer offers Close, not a dead Apply")
      : bad("a prospect can press Apply and nothing happens");
    (dr.match(/\{!locked && \(\s*<button className="wnd-add"/g) ?? []).length === 2
      ? ok("both Add buttons are absent when locked, not present and inert")
      : bad("an Add that adds nothing is still rendered to a prospect");
    /Read-only in this shared preview/.test(dr)
      ? ok("the locked drawer says why, and says the fields are editable in their own workspace")
      : bad("greyed fields with no explanation read as broken");

    /* ⚠️ The grey is scoped, so the SE's own read-only drawers keep the white they were
       signed off with — one screen's change stays on that screen. */
    const css = code("src/styles/app.css");
    /\.wnd-root--locked \.wnd-input/.test(css) && !/^\.wnd-input[^,{]*\{[^}]*#f5f6fa/m.test(css)
      ? ok("the locked grey is scoped and does not restyle the SE's drawers")
      : bad("locking a shared drawer changed the SE's own");

    /* ⚠️ "Belongs to someone else" is wrong for a prospect — they would read it as having
       opened the wrong thing. */
    /shared\s*\?\s*"Read-only in this shared preview/.test(code("src/screens/AgentWorkflowDetails.tsx"))
      ? ok("the Details tab tells a prospect the right reason it is read-only")
      : bad("a prospect is told the demo belongs to someone else");
  }

  /* ==========================================================================
     COALESCING — the guarantee that one SMS demo is one sheet write, not ten.
     ========================================================================== */
  {
    const { saveDemo } = await import("../engine/demoStore.ts");
    const { setEventSpreadsheet } = await import("../engine/eventSettings.ts");
    const { saveSheetsToken } = await import("../engine/sheetsTokens.ts");
    const { recordActivity } = await import("../engine/activityStore.ts");
    const act = await import("../engine/sheetActivity.ts");

    saveSheetsToken("owner@invoca.com", "refresh-token-for-the-audit");
    setEventSpreadsheet("chicago-2026", "SHEET_ID_0123456789", "owner@invoca.com", "T", "owner@invoca.com");
    saveDemo({
      id: "coalesce-demo", prospect: "Coalesce Co", event: "chicago-2026",
      creator: "owner@invoca.com", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), profile: { id: "coalesce-demo" },
    } as any);
    recordActivity("coalesce-demo", "Coalesce Co", "buyer@example.com", "opened");

    let writes = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (u.includes("oauth2.googleapis.com")) return json({ access_token: "tok", expires_in: 3600 });
      if (u.includes("?fields=sheets.properties")) {
        return json({ sheets: [{ properties: { title: "Demo Notes" } }, { properties: { title: "Activity", sheetId: 1870 } }] });
      }
      if (u.includes(":batchUpdate")) {
        const faults = colourFaults(JSON.parse(String(init?.body ?? "{}")));
        if (faults.length) return new Response(JSON.stringify({ error: { message: `Unknown name at '${faults[0]}'` } }), { status: 400 });
        return json({});
      }
      if (String(init?.method ?? "GET") !== "GET") writes += 1;
      if (u.includes("Activity!A2:A")) return json({ values: [["Coalesce Co"]] });
      if (u.includes("/values/")) return json({ values: [["h"], ["r"]] });
      return json({});
    }) as typeof fetch;

    try {
      /* Ten reports, as one progressive SMS capture produces.
         ⚠️⚠️ **THE TIMERS ARE LET RUN RATHER THAN FLUSHED, AND THE FIRST VERSION OF THIS
         CHECK WAS WEAKER FOR FLUSHING THEM.** A flush drained the pending MAP, which holds
         one entry per demo whether or not the window coalesced — so removing the guard
         left ten live timers, the flush saw one, and the check passed on code that writes
         ten times. Waiting out the real window measures the real behaviour. */
      for (let i = 0; i < 10; i += 1) act.queueActivitySync("coalesce-demo");
      await new Promise((r) => setTimeout(r, act.COALESCE_MS + 900));
      writes === 1
        ? ok("ten rapid activity reports collapse into one tab rewrite")
        : bad(`a burst produced ${writes} value writes — the window is not coalescing`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  /* ⚠️⚠️ A RESET-ON-EVERY-CALL DEBOUNCE STARVES: a steady stream of events would never
     sync at all. The window must OPEN on the first call and not move. */
  const sa = code("engine/sheetActivity.ts");
  /if \(pending\.has\(demoId\)\) return;/.test(sa) && !/clearTimeout[\s\S]{0,120}?pending\.set/.test(sa)
    ? ok("the coalescing window is fixed, so a busy demo cannot starve the sync")
    : bad("the window resets on every event — a steady stream would never write");
  /if \(inFlight\.has\(demoId\)\) \{ dirty\.add\(demoId\); return; \}/.test(sa)
    ? ok("a sync in flight is re-queued rather than raced")
    : bad("two rewrites of the same tab could overlap");
  /timer\.unref\?\.\(\)/.test(sa)
    ? ok("a pending sync cannot hold the SIGTERM drain open")
    : bad("a deploy could wait on a cosmetic sheet write");
  !/void syncActivitySheet\(/.test(code("engine/shareApi.ts")) && /queueActivitySync\(rec\.demoId\)/.test(code("engine/shareApi.ts"))
    ? ok("every activity report goes through the coalescer")
    : bad("an activity report still rewrites the tab directly");

  /* ⚠️ A sheet is styled the moment it is connected, not whenever somebody first marks. */
  const dapi = code("engine/demoApi.ts");
  /await prepareSheet\(\{ email: user\.email, spreadsheetId: id \}\)/.test(dapi)
    ? ok("connecting a sheet seeds and styles it straight away")
    : bad("a freshly connected sheet stays a default grid until the first mark");
  /catch \(e\) \{ styled = false; await reportStyleFailure\(TAB_NAME, e\); \}/.test(dapi)
    ? ok("a formatting problem cannot fail a connect that otherwise worked")
    : bad("a styling error would be thrown back at a successful connect");
  /await ensureSheet\(t\);\s*await themeNotes\(t\);/.test(sheets)
    ? ok("prepareSheet reuses ensureSheet — one definition of claiming the tab")
    : bad("connect-time seeding could disagree with the upsert about which tab to use");
  /body\?\.styled === false/.test(code("src/components/EventSheetButton.tsx"))
    ? ok("a connected-but-unstyled sheet says so instead of closing quietly")
    : bad("a failed connect-time style would be invisible");

  /* ⚠️ Both swallow sites must REPORT. A cosmetic failure that says nothing is how a
     broken theme shipped and stayed broken until somebody opened the file. */
  /reportStyleFailure\(TAB_NAME, e\)/.test(code("engine/sheetHook.ts"))
    ? ok("a Demo Notes styling failure is reported, not swallowed in silence")
    : bad("a styling failure on Demo Notes goes nowhere");
  /reportStyleFailure\(ACTIVITY_TAB, e\)/.test(code("engine/sheetActivity.ts"))
    ? ok("an Activity write failure is reported, not swallowed in silence")
    : bad("a failed Activity write goes nowhere");
  /level: "record"/.test(sheets)
    ? ok("a cosmetic failure is recorded, not paged at 2am")
    : bad("styling failures would page");

  /* ⚠️ The foreground path: fixes an already-written sheet AND surfaces the real error. */
  /\/\^\\\/api\\\/events\\\/\(\[\^\/\]\+\)\\\/restyle\$\//.test(code("engine/demoApi.ts"))
    ? ok("there is a restyle route")
    : bad("no way to re-apply the theme to a sheet that was written while it was broken");
  /Restyling a sheet is limited to project admins/.test(code("engine/demoApi.ts"))
    ? ok("restyle is admin-only, like connecting")
    : bad("any signed-in user could restyle");
  /email: cfg\.sheetOwner/.test(code("engine/demoApi.ts"))
    ? ok("restyle uses the connector's grant — the one every mark writes with")
    : bad("restyle would prove a credential the sheet does not use");

  /* ⚠️⚠️ THE PALETTE IS THE PRODUCT'S, AND IT IS CHECKED AGAINST THE FILES THAT OWN IT
     rather than against a list copied in here — a copied list is a second definition of
     the house style, free to drift from the artifacts it is supposed to match. Every
     colour the sheet paints must also appear in the sales playbook, which is this repo's
     own signed-off "Invoca white + green" document. */
  const playbook = code("src/artifacts/salesPlaybook.ts").toLowerCase();
  const hexes = [...sheets.matchAll(/rgb\(0x([0-9a-f]{6})\)/gi)]
    .map((m) => `#${m[1]}`.toLowerCase())
    .filter((h) => h !== "#ffffff");
  hexes.length >= 6
    ? ok(`the sheet names ${hexes.length} colours as hex, so they can be checked`)
    : bad("the sheet palette could not be read — the check is not measuring anything");
  const stray = hexes.filter((h) => !playbook.includes(h));
  stray.length === 0
    ? ok("every sheet colour is one the sales playbook already ships")
    : bad(`off-palette colour(s) in the sheet: ${stray.join(", ")}`);

  /* ⚠️ The brand green is a GROUND. Text that wants to read as green takes #00624d, or a
     count column comes out on-brand and unreadable at 10pt on white. */
  /backgroundColor: BRAND/.test(sheets) && !/foregroundColor: BRAND/.test(sheets)
    ? ok("#00b388 grounds the header band and is never used as small text")
    : bad("the brand green is painted as text, where it sits near 2.3:1 on white");
  /foregroundColor: GREEN_INK/.test(sheets)
    ? ok("green text takes the deeper #00624d")
    : bad("nothing uses the readable green ink");

  /* ⚠️ Lato is the platform's face; Inter is nobody's font here. */
  /const FONT = "Lato"/.test(sheets) && !/fontFamily: "/.test(sheets)
    ? ok("both tabs are set in Lato, from one constant")
    : bad("the sheet is set in a font this product does not use");

  /* ⚠️⚠️ A subline must RESTATE the hairline rather than omitting it: `borders` is in the
     field mask, so `{}` clears the bottom rule the base format just set.
     ⚠️ **THE FIRST VERSION OF THIS COULD NOT FAIL — the tautological-check trap again.**
     It searched the whole file for `: { bottom: { style: "SOLID", color: RULE } }`, which
     the BASE body format also contains, so the sabotage that empties the subline branch
     passed. Slice the ternary and read its else-branch. */
  const borders = sheets.slice(sheets.indexOf("borders: main"));
  const elseBranch = borders.slice(0, borders.indexOf("} },")).split("\n")
    .find((ln) => ln.trim().startsWith(": ")) ?? "";
  elseBranch.includes("bottom:")
    ? ok("a subline keeps its hairline instead of clearing it")
    : bad("quiet rows lose the rule under them");
}


fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll share checks passed\n");
process.exit(fail ? 1 : 0);
