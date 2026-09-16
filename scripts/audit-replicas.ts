/* =============================================================================
   npm run audit:replicas — every captured page is inert, and its field map is real
   -----------------------------------------------------------------------------
   The risk here is not that a replica looks wrong; it is that it WORKS. These are copies of
   real companies' lead forms — AutoNation's is a **Salesforce Web-to-Lead** form and Aptive's
   posts to Aptive's own lead API — so a capture that kept its `action`, a script, or an
   inline handler could file a REAL lead at the prospect's own company the first time an SE
   demoed it. That is the check this file exists for, and it runs over the FILES ON DISK
   rather than over the code that is supposed to have cleaned them.

   The second risk is a field map that names inputs the captured form does not have: the
   submit would then quietly produce a lead with no name, which reads as the feature being
   broken. Every mapped field is asserted to exist in the HTML.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import { replicaBySlug, replicaSlugs, readReplicaForm } from "../src/data/replicaPages.ts";

let bad = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { bad++; console.log(`  FAIL  ${m}`); };

let skipped = 0;
const slugs = replicaSlugs();
console.log(`\nReplica pages — ${slugs.length} captured\n`);

if (!slugs.length) no("no replicas are registered at all");

for (const domain of slugs) {
  const page = replicaBySlug(domain)!;
  const file = path.join("public/replicas", page.file);
  /* ⚠⚠ **AN ABSENT CAPTURE IS SKIPPED, NOT FAILED — and that is not a loosened check.**
     `public/replicas/*.html` is git-ignored ON PURPOSE (see .gitignore: a frozen capture is
     megabytes, git never forgets a blob, and `npm run capture:prune` deletes them after 10
     days). So a fresh clone, CI and production legitimately have NONE, and failing there would
     make `npm run audit` red for everyone but whoever last captured a page — which is how a
     check gets deleted as a nuisance. Everything below still runs, and still FAILS, for every
     capture that IS on this machine; the inertness rules are unchanged. */
  if (!fs.existsSync(file)) { console.log(`  skip  ${domain}: no local capture (git-ignored — run \`npm run capture\`)`); skipped++; continue; }
  const html = fs.readFileSync(file, "utf8");

  /* ---- 1. inert: nothing that can execute or post ------------------------- */
  const el = (tag: string) => (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
  /* ⚠️ COUNTED AS TAGS, but `<script` inside an HTML COMMENT is not a script — Aptive's page
     carries three commented-out ones (`<!--MARKETO <script …>-->`) and a naive count reports a
     clean capture as dirty. Comments are stripped first, the same fix `audit:place` needed. */
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const liveEl = (tag: string) => (live.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;

  liveEl("script") === 0
    ? ok(`${domain}: no scripts (${el("script") - liveEl("script")} commented-out ones ignored)`)
    : no(`${domain}: ${liveEl("script")} live <script> survived`);
  liveEl("iframe") === 0 ? ok(`${domain}: no iframes`) : no(`${domain}: ${liveEl("iframe")} iframe(s) survived`);
  const actions = (live.match(/<form[^>]*\saction\s*=/gi) || []).length;
  actions === 0
    ? ok(`${domain}: no form can post anywhere`)
    : no(`${domain}: ${actions} form(s) still carry an action — THIS WOULD FILE A REAL LEAD`);
  const handlers = (live.match(/\son(?:click|submit|load|change|input|focus|blur|error)\s*=/gi) || []).length;
  handlers === 0 ? ok(`${domain}: no inline handlers`) : no(`${domain}: ${handlers} inline handler(s) survived`);
  (live.match(/\sformaction\s*=/gi) || []).length === 0
    ? ok(`${domain}: no formaction override`)
    : no(`${domain}: a formaction survived`);

  /* ---- 2. it is actually a page, with the form we claim ------------------- */
  const forms = liveEl("form");
  forms > 0 ? ok(`${domain}: ${forms} form(s) present`) : no(`${domain}: no form at all — the capture missed it`);
  /^<!doctype html>/i.test(html) ? ok(`${domain}: serialised as a document`) : no(`${domain}: no doctype`);
  /<base\s+href=/i.test(html)
    ? ok(`${domain}: <base href> present, so its assets still resolve`)
    : no(`${domain}: no <base href> — images and fonts would 404`);
  /* ⚠️⚠️ **THE INVARIANT IS "IT RENDERS STYLED", NOT "THE CSS WAS INLINED" — and asserting the
     mechanism instead of the outcome failed a capture that was perfectly fine.** There are two
     legitimate ways to keep a replica styled and this repo uses both: the browser console tool
     inlines the sheets it can READ into a `<style data-replica-css>` block, while `npm run
     capture` leaves `<link rel=stylesheet>` in place and lets `<base href>` resolve them
     cross-origin (CORS governs reading a sheet, never applying one). The second is why
     `avi-co.html` is 172KB against Aptive's 1.7MB. Either satisfies the thing we actually care
     about; neither being present does not. */
  const inlinedCss = /<style[^>]*data-replica-css/i.test(html);
  const linkedCss = (html.match(/<link[^>]*rel=["']?stylesheet/gi) || []).length;
  inlinedCss || (linkedCss > 0 && /<base\s+href=/i.test(html))
    ? ok(`${domain}: will render styled (${inlinedCss ? "inlined CSS" : `${linkedCss} stylesheet link(s) resolved by <base href>`})`)
    : no(`${domain}: no CSS at all, inlined or linked — the page would render unstyled`);

  /* ⚠️⚠️ **THE MARKERS ARE WHAT MAKE A CAPTURE READABLE WITHOUT GUESSING, and the site this was
     built for has fields with NO `name` at all** — only Klaviyo ids like
     `first_name_01JATZXB7E742ATZXVTCGPV77W`, regenerated on every render. A capture without
     markers still works (the runtime derives the map), so this reports rather than fails for
     the two older browser-console captures; what it DOES fail is a marked capture whose markers
     are incoherent, because that would produce a lead with a missing name and no error. */
  const leads = [...html.matchAll(/data-lead="([a-zA-Z]+)"/g)].map((m) => m[1]);
  if (!leads.length) {
    ok(`${domain}: no data-lead markers (older capture — the runtime derives the map)`);
  } else {
    const dupes = leads.filter((k, i) => leads.indexOf(k) !== i && k !== "company");
    dupes.length === 0
      ? ok(`${domain}: ${leads.length} field(s) marked, one control per meaning`)
      : no(`${domain}: two controls claim the same meaning (${[...new Set(dupes)].join(", ")})`);
    leads.some((k) => /^(firstName|lastName|fullName)$/.test(k))
      ? ok(`${domain}: a name field is marked, so a submit can make a lead`)
      : no(`${domain}: nothing marked as a name — a submit would produce a nameless lead`);
    (html.match(/data-lead-form="1"/g) || []).length === 1
      ? ok(`${domain}: exactly one form is marked as the lead form`)
      : no(`${domain}: the lead form is marked ${(html.match(/data-lead-form="1"/g) || []).length} times`);
    /* ⚠️ EVERY MARKED CONTROL MUST BE READABLE. `collectValues` keys on `name || id`, so a
       marked field with neither is marked and still unreadable — the capture injects a `name`
       for exactly this case, and this is what proves it did. */
    const unreadable = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*data-lead="[^"]*"[^>]*>/gi)]
      .filter((m) => !/\sname\s*=/i.test(m[0]) && !/\sid\s*=/i.test(m[0])).length;
    unreadable === 0
      ? ok(`${domain}: every marked field has a name or id to read it by`)
      : no(`${domain}: ${unreadable} marked field(s) have neither name nor id`);
  }

  /* ---- 3. an OVERRIDE, if one is set, must name fields the capture has ----
     The normal path derives the map from the live form (`deriveFieldMap`), which cannot be
     checked from Node — there is no layout here, and visibility is one of its signals. That
     path is verified in the browser instead. */
  if (page.fields) {
    const has = (n: string) => new RegExp(`name=["']${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(html);
    const mapped = [...page.fields.name, page.fields.phone, page.fields.email, page.fields.zip,
      page.fields.message, ...Object.keys(page.fields.extra ?? {})].filter(Boolean) as string[];
    const missing = mapped.filter((n) => !has(n));
    missing.length === 0
      ? ok(`${domain}: all ${mapped.length} OVERRIDDEN fields exist in the capture`)
      : no(`${domain}: overridden field(s) absent from the form: ${missing.join(", ")}`);
  } else {
    ok(`${domain}: field map is derived from the live form (no hand-written override)`);
  }

  /* ---- 4. the reader turns a filled form into a lead and refuses an empty one */
  const fields = page.fields ?? { name: ["first_name", "firstName"], phone: "phone" };
  const sample: Record<string, string> = {};
  fields.name.forEach((n, i) => { sample[n] = i === 0 ? "Dana" : "Whitfield"; });
  if (fields.phone) sample[fields.phone] = "6025550147";
  readReplicaForm(fields, sample).ok
    ? ok(`${domain}: a filled form yields a lead`)
    : no(`${domain}: a filled form did not produce a usable lead`);
  readReplicaForm(fields, {}).ok === false
    ? ok(`${domain}: an empty form is refused rather than making a blank lead`)
    : no(`${domain}: an empty form produced a lead`);
}

/* ---- 5. the wiring layer re-strips, and the capture tool strips at source -- */
const screen = fs.readFileSync("src/screens/ReplicaPage.tsx", "utf8");
/removeAttribute\("action"\)/.test(screen)
  ? ok("the serving layer re-strips form actions (second line of defence)")
  : no("the serving layer no longer re-strips form actions");
/preventDefault\(\)/.test(screen) ? ok("submit is prevented") : no("submit is not prevented");
/* ⚠️ `about:blank` IS "complete". Binding against it reported "no fillable form" over a page
   with five marked fields, until the real load corrected it — see the block comment there. */
/doc0\.URL !== "about:blank"/.test(screen)
  ? ok("the frame is not bound against the blank document it starts with")
  : no("binding on readyState alone makes the banner report no form before the page loads");
/removeAttribute\("disabled"\)/.test(screen)
  ? ok("a control the removed JS would have enabled is re-enabled")
  : no("disabled controls are not re-enabled — the submit button would never fire");
/* ⚠️⚠️ **THE OVERLAY THAT COVERS THE REPLICA MUST BE CLOSEABLE.** `aviandco.com` opens with a
   Klaviyo modal at `z-index: 90000` and a cookie banner, both faithful to the live site and both
   inert once its JavaScript is gone — so the appointment form behind them was unreachable.
   ⚠️ ASSERTED AS SOURCE, NOT BEHAVIOUR: there is no DOM in this process and this repo does not
   take a jsdom dependency for one audit. The behaviour itself is verified in the browser. */
/DISMISSISH/.test(screen) && /isDismiss/.test(screen)
  ? ok("overlay: a dismiss control is recognised separately from a submit")
  : no("overlay: nothing wires the close button, so a popup would trap the SE on the page");
/style\.display = "none"/.test(screen)
  ? ok("overlay: clicking close actually hides something")
  : no("overlay: the dismiss handler does not hide the overlay");
/* ⚠️ EACH LABEL ON ITS OWN — a joined `aria-label` + text is double the length and rejected the
   one control that mattered. See the block comment in ReplicaPage. */
/labels\.some\(\(t\) => t\.length > 0 && t\.length <= 24/.test(screen)
  ? ok("overlay: each label is length-checked on its own, so a duplicated one still matches")
  : no("overlay: the dismiss length guard is joined again, which rejects \"Close dialog\"");
/INPUT\|TEXTAREA\|SELECT\|LABEL\|OPTION/.test(screen)
  ? ok("overlay: form controls are never treated as dismiss controls")
  : no("overlay: a checkbox could be treated as a dismiss control");

const tool = fs.readFileSync("scripts/capture-replica.js", "utf8");
/\["action", "method", "target", "onsubmit"\]/.test(tool)
  ? ok("the capture tool neutralises at source")
  : no("the capture tool no longer neutralises forms");

/* ---- 6. the render service, and the fallback that protects uptime ---------
   ⚠️⚠️ **THE POINT OF THESE IS THE FALLBACK, NOT THE RENDER.** Accuracy is a preference;
   staying up is the requirement. An accurate path that takes the platform down with it, or
   that makes every SE wait 20 seconds when it is dead, is worse than the fast copy.

   ⚠️ **AGAINST A MOCKED `fetch`, NEVER THE REAL NETWORK** — the same rule `audit:advanced`
   follows for Gong. The first version used `https://example.com/`, which is not reachable from
   this environment, and reported three failures that were entirely the probe's fault. An audit
   that depends on someone else's site is flaky by construction. */
{
  const before = process.env.BROWSERLESS_TOKEN;
  const realFetch = globalThis.fetch;
  const svc = await import("../engine/renderService.ts");
  const rep = await import("../engine/replicate.ts");

  /* ⚠️ OVER 500 BYTES ON PURPOSE. `renderViaService` treats a tiny body as a bot-blocked stub
     and falls back — correct behaviour, and a fixture under that threshold makes the
     happy-path check fail for a reason that has nothing to do with the code. */
  const PAGE = `<!doctype html><html><head><title>T</title><link rel="stylesheet" href="/a.css"></head>`
    + `<body><form><input name="first_name"><input name="phone"></form>`
    + `<p>${"x".repeat(600)}</p></body></html>`;
  /* The target answers a normal page; the render service always rejects the token. */
  const mock = (rendererStatus: number) => (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("browserless")) {
      return new Response("", { status: rendererStatus, headers: { "content-type": "text/plain" } });
    }
    return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof globalThis.fetch;

  const fresh = () => `https://site.test/p${Math.random().toString(36).slice(2)}`;

  try {
    /* unconfigured is a supported state, and it must SAY so rather than look like a bad replica */
    delete process.env.BROWSERLESS_TOKEN;
    svc.resetRenderBreaker();
    globalThis.fetch = mock(401);
    svc.renderConfigured() === false
      ? ok("render: unconfigured reports unconfigured")
      : no("render: reports configured with no token");
    const un = await rep.fetchReplica(fresh());
    un.via === "fetch" && Boolean(un.fallbackReason)
      ? ok("render: with no token it serves the fast copy AND names the reason")
      : no("render: the fast copy did not explain itself");

    /* a rejected token must degrade, never throw, and must trip the breaker */
    process.env.BROWSERLESS_TOKEN = "not-a-real-token";
    svc.resetRenderBreaker();
    svc.renderConfigured() === true ? ok("render: a token turns it on") : no("render: token ignored");
    let fellBack = 0;
    for (let i = 0; i < 3; i++) {
      const r = await rep.fetchReplica(fresh());
      if (r.via === "fetch" && /token|render/i.test(r.fallbackReason || "")) fellBack++;
    }
    fellBack === 3
      ? ok("render: a rejected token degrades to the fast copy every time, never an error page")
      : no(`render: only ${fellBack} of 3 bad-token requests fell back cleanly`);
    svc.renderBreakerState().open
      ? ok("render: the breaker trips after repeated failures")
      : no("render: the breaker never trips, so a dead service costs every SE the full timeout");
    const tripped = await rep.fetchReplica(fresh());
    /cooldown/i.test(tripped.fallbackReason || "")
      ? ok("render: while tripped it skips the service instead of waiting for a timeout")
      : no("render: a tripped breaker still called the service");
    svc.resetRenderBreaker();
    svc.renderBreakerState().open === false
      ? ok("render: the breaker can recover")
      : no("render: the breaker never recovers");

    /* and when the service ANSWERS, the accurate path is actually taken */
    svc.resetRenderBreaker();
    globalThis.fetch = (async (input: unknown) => {
      const url = String((input as { url?: string })?.url ?? input);
      if (url.includes("browserless")) return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("<html><body>fast</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof globalThis.fetch;
    const rendered = await rep.fetchReplica(fresh());
    rendered.via === "render" && !rendered.fallbackReason
      ? ok("render: when the service answers, the accurate copy is what is served")
      : no("render: a working service was not used");
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.BROWSERLESS_TOKEN;
    else process.env.BROWSERLESS_TOKEN = before;
  }
}

/* ---- 6b. the bot wall, and the form that is not there yet -----------------
   ⚠️⚠️ **THE BUG THESE EXIST FOR: A BOT CHALLENGE IS A 200 AND WAS SERVED AS THE REPLICA.**
   Measured on `https://www.aviandco.com/schedule-an-appointment` — `/content` returned a valid
   24,462-byte document titled "Just a moment…", which cleared the 500-byte stub guard, got
   sanitized and cached, and the banner said "rendered in a browser" over a Cloudflare
   interstitial. The second half of the same test: the real page's appointment form is a Klaviyo
   widget mounted by a third-party script after our settle, so an unblocked render with no wait
   still had nothing to fill in.

   ⚠️ SAME RULE AS ABOVE — MOCKED `fetch`, NEVER THE REAL NETWORK. */
{
  const before = process.env.BROWSERLESS_TOKEN;
  const realFetch = globalThis.fetch;
  const svc = await import("../engine/renderService.ts");
  const rep = await import("../engine/replicate.ts");

  /* The wording is the fixture: this is what Cloudflare actually served us. */
  const WALL = `<!doctype html><html><head><title>Just a moment...</title></head><body>`
    + `<p>Performing security verification</p><p>This website uses a security service to protect`
    + ` against malicious bots.</p><p>${"x".repeat(600)}</p></body></html>`;
  const LEAD = `<!doctype html><html><head><title>Book</title></head><body>`
    + `<form><input placeholder="First Name"><input type="tel" name="phone"></form>`
    + `<p>${"x".repeat(600)}</p></body></html>`;
  /* A real page with no lead field — a homepage, the case that must NOT pay for two renders. */
  const NOFORM = `<!doctype html><html><head><title>Home</title></head><body>`
    + `<form id="search_mini_form"><input name="q" placeholder="Search"></form>`
    + `<p>${"x".repeat(600)}</p></body></html>`;

  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { "content-type": "text/html" } });
  const unblockJson = (body: string) =>
    new Response(JSON.stringify({ content: body, solved: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });

  /** Counts which endpoints were asked, so "it did not waste a render" is checkable. */
  let calls: { content: number; unblock: number; site: number };
  const wire = (content: () => Response, unblock: () => Response, site: () => Response) => {
    calls = { content: 0, unblock: 0, site: 0 };
    globalThis.fetch = (async (input: unknown) => {
      const url = String((input as { url?: string })?.url ?? input);
      if (url.includes("/unblock")) { calls.unblock++; return unblock(); }
      if (url.includes("browserless")) { calls.content++; return content(); }
      calls.site++; return site();
    }) as unknown as typeof globalThis.fetch;
  };
  const fresh = () => `https://site.test/p${Math.random().toString(36).slice(2)}`;

  try {
    process.env.BROWSERLESS_TOKEN = "t";

    /* the predicates themselves, on the real wording and on a page that must not false-positive */
    svc.looksBotWalled(WALL) && !svc.looksBotWalled(LEAD)
      ? ok("wall: the Cloudflare interstitial is recognised and a real page is not")
      : no("wall: the bot-challenge test is wrong in one direction or the other");
    svc.lacksLeadField(NOFORM) && !svc.lacksLeadField(LEAD)
      ? ok("wall: a lead field is detected, and a search box is not mistaken for one")
      : no("wall: the lead-field test is wrong in one direction or the other");

    /* a walled fast render escalates, and the unblocked page is what gets served */
    svc.resetRenderBreaker();
    wire(() => html(WALL), () => unblockJson(LEAD), () => html(NOFORM));
    const esc = await rep.fetchReplica(fresh());
    esc.via === "unblock" && calls.unblock === 1
      ? ok("wall: a bot challenge escalates to the stealth renderer")
      : no(`wall: a bot challenge was not escalated (via=${esc.via}, unblock calls=${calls.unblock})`);
    /* ⚠️ THE WHOLE POINT — the challenge page must never reach the SE. */
    !/just a moment/i.test(esc.html)
      ? ok("wall: the challenge page is never what gets served")
      : no("wall: a Cloudflare interstitial was served as the replica");

    /* a page that already has a form must not pay for a second render */
    svc.resetRenderBreaker();
    wire(() => html(LEAD), () => unblockJson(LEAD), () => html(NOFORM));
    const fastPath = await rep.fetchReplica(fresh());
    fastPath.via === "render" && calls.unblock === 0
      ? ok("wall: a page that rendered fine never touches the stealth renderer")
      : no(`wall: a good render still escalated (via=${fastPath.via}, unblock calls=${calls.unblock})`);

    /* ⚠️ A FORMLESS PAGE LOOKS FOR A FORM ONCE AND THEN KEEPS WHAT IT HAD. Browserless answers a
       `waitForSelector` that never matches with HTTP 408 and an EMPTY body — measured — so this
       is the difference between a homepage replica and a blank screen. */
    svc.resetRenderBreaker();
    wire(() => html(NOFORM), () => new Response("", { status: 408 }), () => html(NOFORM));
    const formless = await rep.fetchReplica(fresh());
    formless.via === "render" && calls.unblock === 1 && !/^$/.test(formless.html)
      ? ok("wall: a formless page keeps its render when no lead field ever appears")
      : no(`wall: a formless page lost its replica (via=${formless.via}, unblock=${calls.unblock})`);
    /* ⚠️ AND A MISSED SELECTOR IS NOT A SICK SERVICE. If it counted, replicating three
       homepages would disable the accurate path for five minutes. */
    svc.renderBreakerState().failures === 0
      ? ok("wall: a missed selector does not count against the circuit breaker")
      : no("wall: replicating formless pages would trip the breaker");

    /* when even the stealth renderer is turned away, say so — and never serve the wall */
    svc.resetRenderBreaker();
    wire(() => html(WALL), () => unblockJson(WALL), () => html(LEAD));
    const stillWalled = await rep.fetchReplica(fresh());
    stillWalled.via === "fetch" && /bot challenge/i.test(stillWalled.fallbackReason || "")
      ? ok("wall: an unbeatable challenge degrades to the fast copy and names itself")
      : no(`wall: an unbeatable challenge was handled wrong (via=${stillWalled.via})`);

    /* ⚠️ THE 403 MUST NOT BURY THE RENDERER'S REASON. A site that walls off the renderer walls
       off the plain fetch too, so the error used to blame only the fetch. */
    svc.resetRenderBreaker();
    wire(() => html(WALL), () => new Response("", { status: 500 }), () => html("no", 403));
    let msg = "";
    try { await rep.fetchReplica(fresh()); } catch (e) { msg = (e as Error).message; }
    /403/.test(msg) && /render/i.test(msg)
      ? ok("wall: a total failure reports the site AND the renderer, not just one")
      : no(`wall: the error dropped half the story — "${msg}"`);

    /* ⚠️⚠️ ONE RENDER PER URL. The normal flow probes twice for the same URL (the button, then
       the page), and before this the second probe started its own render and the renderer
       rejected the overlap — which is how a working feature reported "refuses automated
       fetches". */
    svc.resetRenderBreaker();
    wire(() => html(LEAD), () => unblockJson(LEAD), () => html(NOFORM));
    const url = fresh();
    const [p1, p2] = await Promise.all([rep.fetchReplica(url), rep.fetchReplica(url)]);
    calls.content === 1 && p1.via === "render" && p2.via === "render"
      ? ok("wall: two overlapping probes for one URL share a single render")
      : no(`wall: overlapping probes rendered ${calls.content} times`);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.BROWSERLESS_TOKEN;
    else process.env.BROWSERLESS_TOKEN = before;
  }
}

/* ---- 6c. one classifier, two front ends ----------------------------------
   ⚠️⚠️ **THE BROWSER AND THE CAPTURE SCRIPT MUST AGREE, AND A SECOND COPY OF THE RULES WOULD
   NOT.** `classifySignals` is shared: the browser feeds it a live element, `markLeadFields`
   feeds it attributes scraped from markup. If they ever disagreed the capture would stamp one
   meaning into the file and the runtime would read another — producing a lead with the wrong
   field in it and no error anywhere. */
{
  const { markLeadFields } = await import("../engine/replicaCapture.ts");
  /* ⚠️ FROM `leadFields.ts`, the DOM-free module both front ends share — importing it through
     `replicaPages.ts` would work but would hide the boundary this check is about. */
  const { classifySignals } = await import("../src/data/leadFields.ts");

  /* Deliberately awkward, and every oddity is one this repo actually hit: fields with no
     `name` (Klaviyo), a search box that must not win, a login that must not win, and a
     Salesforce-style opaque name that only its <label> explains. */
  const page = `<!doctype html><html><head></head><body>
    <form id="search"><input name="q" placeholder="Search"></form>
    <form id="login"><input type="email" name="username"><input type="password" name="password"></form>
    <form id="lead">
      <input id="fn_01ABC" placeholder="First Name">
      <input id="ln_01ABC" placeholder="Last Name">
      <input type="tel" name="phone-number" placeholder="Phone">
      <input type="email" name="email" placeholder="Email">
      <label for="op_01ABC">Comments</label><textarea id="op_01ABC"></textarea>
      <input placeholder="Zip Code">
    </form></body></html>`;

  const m = markLeadFields(page);
  /* ⚠️ THE LEAD FORM, NOT THE SEARCH BOX OR THE LOGIN — form index 2 of 3. */
  m.formIndex === 2
    ? ok("capture: the lead form wins over a search box and a login")
    : no(`capture: picked form #${m.formIndex} instead of the lead form`);
  m.map.name.join(",") === "fn_01ABC,ln_01ABC"
    ? ok("capture: nameless fields are read by id, first and last in order")
    : no(`capture: name came out as ${JSON.stringify(m.map.name)}`);
  m.map.phone === "phone-number" && m.map.email === "email"
    ? ok("capture: phone and email are identified")
    : no("capture: phone or email was missed");
  /* The name is meaningless; the label is the only signal. */
  m.map.message === "op_01ABC"
    ? ok("capture: an opaque field is classified by its <label>")
    : no(`capture: the labelled textarea was missed (got ${m.map.message})`);
  /* ⚠️ A FIELD WITH NO name AND NO id STILL HAS TO BE READABLE — the injected name is the fix. */
  m.map.zip === "replica_zip" && /name="replica_zip"/.test(m.html)
    ? ok("capture: a field with neither name nor id gets one injected")
    : no(`capture: the nameless zip is unreadable (got ${m.map.zip})`);
  /data-lead-form="1"/.test(m.html) && (m.html.match(/data-lead="/g) || []).length === 6
    ? ok("capture: the form and all six fields are stamped into the HTML")
    : no(`capture: stamped ${(m.html.match(/data-lead="/g) || []).length} fields`);

  /* the shared rules, asserted directly on the signals the two front ends both produce */
  const agree = [
    [{ tag: "INPUT", type: "text", name: "", id: "fn_1", autocomplete: "", label: "First Name" }, "firstName"],
    [{ tag: "INPUT", type: "text", name: "00NRl000001soAX", id: "", autocomplete: "", label: "Comments" }, "message"],
    [{ tag: "INPUT", type: "text", name: "q", id: "", autocomplete: "", label: "Search" }, null],
    [{ tag: "INPUT", type: "text", name: "", id: "", autocomplete: "postal-code", label: "" }, "zip"],
    /* ⚠️⚠️ **A SPLIT NAME FIELD'S SUB-LABEL, MEASURED ON keywhitman.com/lasik/schedule-online/
       (WPForms).** The input carries TWO `<label for>` elements sharing one id — a hidden
       group legend "Name *" and a hidden per-field sub-label "First" — so a naive read of the
       first label alone (or a join that then requires an EXACT "first"/"last" match) sees only
       "Name *" and classifies nothing. The real signal is the bracket-style name attribute,
       `wpforms[fields][0][first]`. */
    [{ tag: "INPUT", type: "text", name: "wpforms[fields][0][first]", id: "wpforms-371-field_0", autocomplete: "", label: "Name * First" }, "firstName"],
    [{ tag: "INPUT", type: "text", name: "wpforms[fields][0][last]", id: "wpforms-371-field_0-last", autocomplete: "", label: "Last" }, "lastName"],
    /* ⚠️⚠️ **THE FALSE POSITIVE THE FIRST FIX PRODUCED.** Anchoring the bracket regex only at
       the START matched "last_visit" as a last-name field — it starts with "last" followed by
       a delimiter, which is exactly what an unanchored-at-the-end pattern was looking for.
       "first"/"last" must be the FINAL token, not merely the first one. */
    [{ tag: "INPUT", type: "text", name: "last_visit", id: "", autocomplete: "", label: "When did you last visit?" }, null],
    [{ tag: "SELECT", type: "", name: "how_heard", id: "", autocomplete: "", label: "How did you first hear about us?" }, null],
  ] as const;
  agree.every(([sig, want]) => classifySignals(sig) === want)
    ? ok("capture: the shared rules classify each signal set the same way for both front ends")
    : no("capture: the shared classifier disagrees with its own fixtures");

  /* ⚠️⚠️ **A DARKENING BACKDROP CAN BE A SIBLING OF THE DISMISSED OVERLAY, NOT ITS ANCESTOR —
     and the ancestor walk alone cannot find a sibling.** Measured on
     valetliving.com/contact/support/ (OneTrust): `.onetrust-pc-dark-filter` is a SEPARATE
     child of `#onetrust-consent-sdk`, sitting BESIDE `#onetrust-banner-sdk` rather than
     wrapping it — full viewport, `position: fixed`, high z-index, `rgba(0,0,0,.5)`. Clicking
     "Accept All Cookies" hid the banner (the ancestor walk's only find) and left the dark
     filter in place: it goes from an obvious white box to a faint grey wash once the banner
     is gone, so it barely reads as still there, and it keeps swallowing every click and
     keystroke meant for the form beneath it — reported directly as "even after closing it I
     can't write in the form".
     ⚠️ Asserted as source, not behaviour: there is no DOM in this process (this repo does not
     take a jsdom dependency for one audit) and the real fix was verified live in the browser —
     "Devon" typed via a real click and real keystrokes, into a form that would not accept
     input before this. */
  const framePage = fs.readFileSync("src/screens/ReplicaPage.tsx", "utf8");
  /r\.width >= vw \* 0\.9 && r\.height >= vh \* 0\.9/.test(framePage) && /position !== "fixed" && st\.position !== "absolute"/.test(framePage)
    ? ok("overlay: a second sweep takes down any other near-full-viewport overlay left behind")
    : no("overlay: only the clicked control's ancestor is hidden — a sibling backdrop like OneTrust's dark filter survives and keeps blocking the form");
  /n === overlay \|\| n\.style\.display === "none"/.test(framePage)
    ? ok("overlay: the sweep skips what it already hid, so it never double-processes the same node")
    : no("overlay: the sweep re-walks the element it just hid");

  /* ⚠️⚠️ **THE ENGINE MUST NOT REACH INTO THE DOM MODULE.** `engine/` compiles with no DOM lib,
     so an import of `replicaPages.ts` from there breaks `npm run typecheck` — sixteen errors,
     none of which `tsc --noEmit` on the app config reports. Asserted as source because the
     failure it prevents is a build failure, not a runtime one. */
  const capSrc = fs.readFileSync("engine/replicaCapture.ts", "utf8");
  /from "\.\.\/src\/data\/leadFields\.ts"/.test(capSrc) && !/replicaPages\.ts"/.test(capSrc)
    ? ok("capture: the engine imports the DOM-free rules, not the DOM module")
    : no("capture: engine/replicaCapture.ts imports the DOM module — npm run typecheck will fail");

/* ---- the PRODUCTION ENTRY POINT is type-checked, and stays that way ----------
   ⚠️⚠️ **`server.ts` WAS EXCLUDED FROM EVERY TYPE CHECK UNTIL 9/16/2026.**
   `tsconfig.node.json` listed only `["vite.config.ts", "engine"]`, and `npm run build`
   is `tsc -b` plus a client-only vite build — so nothing read the file that runs in
   production. Measured when it was turned on: **44 errors, 43 of them DOM types** pulled
   in by one dynamic `import("./src/data/replicaPages.ts")`, a module full of
   `HTMLInputElement` and `Document`.

   What the gap actually cost, both real and both in this repo's own history: a required
   field added to `StatusInput` went unnoticed at the call site in `server.ts`, and a
   duplicated brace introduced while splitting a commit passed `tsc -b` and surfaced only
   when somebody booted the server. Both are caught now — verified by reintroducing each.

   These checks exist because the fix is TWO halves that must stay together: the include,
   and the server not importing a browser-only module. Undo either and the other is
   worthless. */
console.log("\nThe production entry point is type-checked");
{
  const tscfg = fs.readFileSync("tsconfig.node.json", "utf8");
  /^\s*"include":.*"server\.ts"/m.test(tscfg)
    ? ok("tsconfig.node.json includes server.ts")
    : no("server.ts is excluded from the type check again — it is the file that runs in production");
  /^\s*"include":.*"googleAuth\.ts"/m.test(tscfg)
    ? ok("and googleAuth.ts, which it imports")
    : no("googleAuth.ts is excluded from the type check");

  const srv = fs.readFileSync("server.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  !/replicaPages\.ts/.test(srv)
    ? ok("server.ts imports the DOM-free registry, not the browser-side module")
    : no("server.ts imports src/data/replicaPages.ts again — that is what excluded it from the type check");

  const reg = fs.readFileSync("src/data/replicaRegistry.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  !/HTMLElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLIFrameElement|\bDocument\b|\bwindow\b/.test(reg)
    ? ok("and that registry stays DOM-free, so it can never re-break the node project")
    : no("src/data/replicaRegistry.ts now references the DOM — the node project has no DOM lib");

  /* The re-export is what keeps every existing importer (the screen, this audit) working. */
  const pages = fs.readFileSync("src/data/replicaPages.ts", "utf8");
  /export \{ replicaFor, replicaExpired, replicaBySlug, replicaSlugs \} from "\.\/replicaRegistry\.ts"/.test(pages)
    ? ok("replicaPages.ts still re-exports them, so no caller had to change")
    : no("replicaPages.ts no longer re-exports the registry — existing importers will break");
}

  /* ⚠️ A PAGE WITH NO LEAD FORM RETURNS ZERO RATHER THAN MARKING THE SEARCH BOX — the capture
     script refuses to write such a file, and this is the signal it refuses on. */
  const none = markLeadFields(`<!doctype html><html><body><form><input name="q" placeholder="Search"></form></body></html>`);
  none.score === 0 && none.marked === 0
    ? ok("capture: a page with no lead form scores zero instead of marking a search box")
    : no(`capture: a formless page scored ${none.score}`);
}

/* ---- 6d. frozen captures, and the 10-day deal that pays for them ----------
   ⚠️⚠️ **A FROZEN CAPTURE IS SELF-CONTAINED AND EXPIRES; THE TWO ARE ONE TRADE.** Embedding a
   page's CSS, fonts and images costs megabytes (aviandco: 17.8MB against 172KB linked), which
   is only acceptable because it is collected after `TTL_DAYS`. These checks exist because the
   dangerous half is expiry: if it did not degrade to the live render, the feature would simply
   stop working on day 10 with no clue why. */
{
  const { replicaFor, replicaBySlug, replicaExpired, replicaSlugs: slugsOf } = await import("../src/data/replicaPages.ts");
  const { TTL_DAYS, captureAgeDays } = await import("../src/data/leadFields.ts");

  const frozen = slugsOf().map((sl) => replicaBySlug(sl)!).filter((p) => p.frozen);
  const linked = slugsOf().map((sl) => replicaBySlug(sl)!).filter((p) => !p.frozen);

  captureAgeDays("2026-09-05", new Date("2026-09-15T00:00:00Z")) === 10 && captureAgeDays("nonsense") === 0
    ? ok("ttl: capture age is counted in whole days, and junk dates do not expire everything")
    : no("ttl: the age calculation is wrong");

  /* ⚠️ THE BOUNDARY, BOTH SIDES OF IT. Off-by-one here is the difference between a capture that
     lives 9 days and one that never expires. */
  if (frozen.length) {
    const p = frozen[0];
    const at = (n: number) => new Date(Date.parse(`${p.capturedAt}T00:00:00Z`) + n * 86_400_000);
    const host = p.domain;
    replicaFor(host, at(TTL_DAYS - 1)) && !replicaFor(host, at(TTL_DAYS))
      ? ok(`ttl: a frozen capture is served on day ${TTL_DAYS - 1} and gone on day ${TTL_DAYS}`)
      : no("ttl: the expiry boundary is wrong, so a frozen capture lives too long or too short");
    /* ⚠️ AND IT MUST STILL OPEN BY SLUG — there is no URL to fall back to rendering there. */
    replicaBySlug(p.slug) && replicaExpired(p, at(TTL_DAYS + 5))
      ? ok("ttl: an expired capture still opens by slug, but is reported expired to prune")
      : no("ttl: by-slug opening or the expiry report is wrong");
  } else {
    ok("ttl: no frozen captures registered (nothing to expire)");
  }

  /* ⚠️ A LINKED CAPTURE MUST NEVER EXPIRE. Aptive and AutoNation are small and, crucially,
     AutoNation's live path 403s — expiring it would take the feature away with no fallback. */
  linked.every((p) => !replicaExpired(p, new Date("2099-01-01")) && replicaFor(p.domain, new Date("2099-01-01")))
    ? ok(`ttl: ${linked.length} linked capture(s) never expire, so their prospects keep working`)
    : no("ttl: a linked capture expires — its prospect would lose the feature with no fallback");

  /* ⚠️ THE FREEZER'S HARD-WON SETTINGS, asserted as source because each one cost a failed run:
     stealth on (else Cloudflare), blockAds off (else the Klaviyo form disappears), the session
     inside the plan's 2-minute ceiling, and CDP instead of Buffer. */
  const fz = fs.readFileSync("engine/freezePage.ts", "utf8");
  /stealth=true/.test(fz) && !/blockAds/.test(fz.replace(/\/\*[\s\S]*?\*\//g, ""))
    ? ok("freeze: stealth is on and ad-blocking is off (it deleted the form we came for)")
    : no("freeze: stealth/blockAds settings regressed — the capture will be a bot wall or formless");
  /FREEZE_SESSION_MS = 1[01]\d_000/.test(fz)
    ? ok("freeze: the session fits inside the plan's 2-minute ceiling")
    : no("freeze: the session timeout is outside the plan limit and will 400");
  /Network\.getResponseBody/.test(fz) && !/response\.buffer\(\)|res\.buffer\(\)/.test(fz.replace(/\/\*[\s\S]*?\*\//g, ""))
    ? ok("freeze: bodies come from CDP, not Buffer (which does not exist in that sandbox)")
    : no("freeze: it is back to response.buffer(), which harvests nothing");
  /usedSet\.has\(abs\)/.test(fz)
    ? ok("freeze: the in-page fallback only chases assets the page really requested")
    : no("freeze: the fallback will fetch every unused theme ref and time the run out");
  /* ⚠️ THE VIEWPORT IS PART OF THE CAPTURE. A theme that rebuilds its nav from JS at a
     breakpoint bakes whatever layout was live when we serialised — the first frozen capture
     kept Magento's 320px mobile nav. */
  /* ⚠️ A SCRIPT'S VIEWPORT ADAPTATION ON BODY, FROZEN, PUTS THE FORM OFF-SCREEN. greenix wrote
     'width: 4000px; zoom: 1' during the settle and the capture laid out 4000px wide. */
  /removeProperty\(prop\)/.test(fz) && /"zoom", "text-size-adjust"/.test(fz)
    ? ok("freeze: a script's inline width/zoom on html and body is stripped before serialising")
    : no("freeze: an inline body width can be baked in, laying the capture out at the wrong size");
  /setViewport\(\{ width: 1440, height: 900 \}\)/.test(fz)
    ? ok("freeze: a desktop viewport is pinned, so the capture is not the mobile layout")
    : no("freeze: no viewport is set — a responsive theme will freeze its mobile DOM");
  /const replacement = uri \|\| abs/.test(fz)
    ? ok("freeze: a ref it cannot embed is absolutised, so it still points where it did")
    : no("freeze: un-embedded relative refs will 404 once their sheet is spliced inline");
}

/* ---- 7. stylesheets survive, which is what broke the Ridgeline header ------ */
{
  const { sanitizeReplica } = await import("../engine/replicate.ts");
  const src = `<html><head><link rel="stylesheet" href="/a.css"><link rel="preload" href="/b.js"></head><body><form action="https://real/x"><input name="q"></form></body></html>`;
  const out = sanitizeReplica(src, "https://site.test/page").html;
  /<link[^>]*rel="stylesheet"/i.test(out)
    ? ok("sanitize: keeps <link rel=stylesheet> (cross-origin CSS still applies)")
    : no("sanitize: stripped the stylesheet link — this is what made the header lay out wrong");
  !/rel="preload"/i.test(out) ? ok("sanitize: drops preloads for scripts it removed") : no("sanitize: kept a preload");
  !/<form[^>]*\saction=/i.test(out) ? ok("sanitize: strips the form action") : no("sanitize: LEFT A FORM ACTION");
  /<base\s+href="https:\/\/site\.test\/page"/.test(out) ? ok("sanitize: adds <base href>") : no("sanitize: no base href");
}
const cap = fs.readFileSync("scripts/capture-replica.js", "utf8");
!/link\[rel="stylesheet"\]'?\s*\+?\s*$|stylesheet"\],link\[rel="preload/m.test(cap.replace(/\n/g, ""))
  ? ok("capture tool: no longer strips stylesheet links")
  : no("capture tool: still strips <link rel=stylesheet>");

/* ---- 8. Replicate SAVES the link; it does not navigate to the replica -------
   Asked for directly: *"once its done, just show complete, but dont go to it, auto save the
   page, so when the user click book online it goes to the replicated page."* Two halves, and
   the store's own validation is the half that can silently undo it — a `/replica?url=…`
   path has no host, so the needs-a-dot rule would refuse it and the SE would see an error
   where a receipt should be. */
{
  const { normalizeUrl } = await import("../src/data/bookingOverride.ts");
  const p = normalizeUrl("/replica?url=https%3A%2F%2Fsite.test%2Fbook");
  p.url === "/replica?url=https%3A%2F%2Fsite.test%2Fbook" && !p.error
    ? ok("override: a same-origin /replica path is stored verbatim (query untouched)")
    : no(`override: the replica path was refused or rewritten — ${JSON.stringify(p)}`);
  /* ⚠️ A protocol-relative URL is somebody else's origin wearing a path's clothes. */
  normalizeUrl("//evil.test/book").url !== "//evil.test/book"
    ? ok("override: //host/path is NOT treated as a same-origin path")
    : no("override: a protocol-relative URL slipped through the path branch");
  !normalizeUrl("javascript:alert(1)").url && !normalizeUrl("javascript://x/a").url
    ? ok("override: javascript: is still refused in both shapes")
    : no("override: a javascript: URL is now storable");
  normalizeUrl("rotorooter").url === null
    ? ok("override: a hostname with no dot is still a typo, not a host")
    : no("override: the needs-a-dot rule stopped firing");

  /* ⚠⚠ **AND IT HAS TO OUTLIVE THE BROWSER IT WAS SAVED IN** — asked for directly: *"it
     should always stay and save even when the users closes it and opens it the next day."*
     localStorage already did the next-day half; what it could not do is travel, so the value
     rides the override layer that is PATCHed onto the demo record and re-hydrated by anyone
     who opens it. These check the wiring that makes that true, because every part of it is
     silent when it breaks: a key outside the `<demoId>::` prefix is simply never synced. */
  const bo = fs.readFileSync("src/data/bookingOverride.ts", "utf8");
  const { bookingScopeKey, BOOKING_SCOPE_PATH } = await import("../src/data/bookingOverride.ts");
  bookingScopeKey("aptive") === `aptive::${BOOKING_SCOPE_PATH}`
    ? ok("override: the store key is `<profileId>::<path>`, the prefix the demo sync slices on")
    : no(`override: the scope key would never sync — ${bookingScopeKey("aptive")}`);
  /^\/[a-z-]+$/.test(BOOKING_SCOPE_PATH)
    ? ok("override: it is keyed by a bare pathname, which is what the server stores")
    : no(`override: ${BOOKING_SCOPE_PATH} is not a bare pathname`);
  /* ⚠️ RE-AIMED, NOT LOOSENED: the base gained the after-submit field, so both are seeded "".
     The invariant is unchanged — every field this hook writes must exist in the base, or the
     first write is an undefined -> string flip. */
  /registerBase\(key, \{ \[BOOKING_FIELD\]: "", \[THANKS_FIELD\]: "" \}\)/.test(bo)
    ? ok('override: the base is seeded "" so the first save is not an undefined -> string flip')
    : no("override: no base is registered — applyEdits refuses a key with no base");
  !/registerScope\(/.test(bo)
    ? ok("override: it registers a BASE, not a scope (a scope is last-write-wins)")
    : no("override: it calls registerScope, which would repoint the page's sparkle");
  /applyEdits\(key, \[\{ path: BOOKING_FIELD[\s\S]{0,80}\) > 0\) \{/.test(bo)
    ? ok("override: a save tries the durable demo layer FIRST")
    : no("override: the durable write is gone or is no longer what decides the fallback");
  /writeLocal\(profileId, null\);\s*\/\/ one source of truth/.test(bo)
    ? ok("override: a successful shared save clears the local copy (no two disagreeing sources)")
    : no("override: the local copy survives a shared save and can go stale");
  /return \{ url: local \?\? shared, set, thankYou, setThankYou, clear \};/.test(bo)
    ? ok("override: local wins over shared — which is only set when the shared write was refused")
    : no("override: the precedence changed; a viewer's own link can be ignored");
  /* Reset now clears BOTH fields plus the local copy — same invariant, three parts. */
  /path: BOOKING_FIELD, value: JSON\.stringify\(""\)[\s\S]{0,120}writeLocal\(profileId, null\);/.test(bo)
    ? ok("override: Reset clears BOTH copies, so the default cannot come back on the next render")
    : no("override: Reset leaves one copy behind");

  const gs = fs.readFileSync("src/screens/GoogleSearch.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /* ⚠️ RE-AIMED, NOT LOOSENED: the path is built into `replica` and then both saved and shown
     in the box, so pinning the old single-expression `onSet(\`/replica…\`)` would fail on
     correct code. The invariant is the two halves — built from the target, handed to onSet. */
  /const replica = `\/replica\?url=\$\{encodeURIComponent\(target\)\}`;/.test(gs)
  && /onSet\(replica\)/.test(gs)
    ? ok("replicate: a successful capture points Book online at the replica")
    : no("replicate: the success path no longer saves the replica as the booking link");
  !/navigate\(`\/replica/.test(gs)
    ? ok("replicate: it no longer navigates the SE off the search screen")
    : no("replicate: it still navigates to the replica instead of saving it");
  /setDone\(true\)/.test(gs) && /done \? "Complete"/.test(gs)
    ? ok('replicate: the button reports "Complete" rather than closing the panel')
    : no("replicate: there is no Complete state");
  /setValue\(e\.target\.value\); setErr\(""\); setDone\(false\)/.test(gs)
    ? ok("replicate: typing a new URL clears the receipt, so it cannot describe the old one")
    : no("replicate: Complete survives the URL being edited");
  /* ⚠⚠ **REPORTED AS "it still takes me to the real website".** The link WAS re-pointed — and
     then **Save** stored whatever sat in the input, which was still the original site URL, so
     the replica was silently clobbered. That click only became reachable once the panel stopped
     navigating away, so nothing before this could have caught it. */
  /setValue\(replica\);\s*setDone\(true\)/.test(gs)
    ? ok("replicate: the box becomes the replica, so a following Save cannot clobber it")
    : no("replicate: the input still holds the site URL — Save would overwrite the replica");
}

/* ---- 9. a captured embed has to SHOW its own submit button ------------------
   Reported directly: *"you need to also make sure that the submission button is also always
   replicated, for example i dont see one for greenix."* It WAS replicated and wired — it was
   29px below the edge of a HubSpot frame frozen at the height its stripped host script last
   set. These pin the fix and the two things that make it safe. */
{
  const rp = fs.readFileSync("src/data/replicaPages.ts", "utf8");
  const pg = fs.readFileSync("src/screens/ReplicaPage.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /export function fitEmbeddedFrames/.test(rp)
    ? ok("embeds: a captured form frame is grown to its own content height")
    : no("embeds: nothing resizes a frozen form frame — its submit button stays clipped");
  /if \(need > f\.clientHeight \+ 1\)/.test(rp)
    ? ok("embeds: it only ever GROWS (shrinking would clip a deliberately tall embed)")
    : no("embeds: it can shrink a frame, which can hide content that was visible");
  /!inner\?\.body \|\| !inner\.querySelector\("form"\)/.test(rp)
    ? ok("embeds: FORM frames only — a chat or ad iframe is left alone")
    : no("embeds: it stretches every iframe, which pushes the real page apart");
  /fitEmbeddedFrames\(doc\);/.test(pg) && /setTimeout\(\(\) => fitEmbeddedFrames\(doc\), \d+\)/.test(pg)
    ? ok("embeds: fitted on bind AND again once fonts/images have settled")
    : no("embeds: it is fitted once, so a late reflow can re-clip the button");
  /clearTimeout\(refit\)/.test(pg)
    ? ok("embeds: the refit timer is cleared on unmount")
    : no("embeds: the refit timer outlives the screen");

  /* ⚠️ A web-form lead must not list under an LSA trigger — the Agent Studio column would
     contradict the page the SE just submitted. */
  const qw = fs.readFileSync("src/data/quoteWorkflow.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /triggeredBy: q\.source === "web"/.test(qw)
    ? ok("workflow: the Triggered By line names the real source (web form vs LSA)")
    : no("workflow: a website-form lead still lists as a Google Local Services ad");
}

if (skipped) console.log(`\n  ${skipped} capture(s) not on this machine — the wiring checks above still ran.`);
/* ---- 10. a registry entry whose capture is absent must FAIL CLOSED ----------
   Reported from production: Replicate said Complete and Book online opened a BLANK page. The
   registry ships in the JS bundle while `public/replicas/*.html` is git-ignored, so on a deploy
   the client asserted a static hit, framed `/replicas/aptive.html`, and `express.static` missed
   — and the SPA catch-all returned `index.html` INTO THE IFRAME, i.e. the app rendering itself
   with no route. Nothing errored anywhere, and the capture Browserless had just made sat unused
   in the dynamic store. Three independent guards now, because any one of them alone leaves a
   silent blank frame. */
{
  const srv = fs.readFileSync("server.ts", "utf8");
  const vite = fs.readFileSync("vite.config.ts", "utf8");
  const page = fs.readFileSync("src/screens/ReplicaPage.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  (srv.match(/st && staticReady\(st\.file\)/g) || []).length === 2
    ? ok("lookup: server.ts only claims a static hit when the capture is on disk (both branches)")
    : no("lookup: server.ts still trusts the registry without checking the file");
  (vite.match(/st && staticReady\(st\.file\)/g) || []).length === 2
    ? ok("lookup: the dev twin applies the same rule (both branches)")
    : no("lookup: vite.config.ts still trusts the registry blindly — the twins have drifted");
  /app\.get\("\/replicas\/\*"[\s\S]{0,120}status\(404\)/.test(srv)
    ? ok("serve: a missing capture 404s instead of falling through to the SPA shell")
    : no("serve: /replicas/* still falls through to index.html — a blank iframe, not an error");
  /* ⚠️ The ORDER matters as much as the route: after the catch-all it can never run. */
  srv.indexOf('app.get("/replicas/*"') < srv.indexOf('app.get("*"')
    ? ok("serve: the 404 guard is registered BEFORE the SPA catch-all")
    : no("serve: the guard sits after the catch-all, so it never runs");
  !/replicaFor|replicaBySlug/.test(page)
    ? ok("page: the browser no longer decides from the bundled registry — it asks the server")
    : no("page: ReplicaPage short-circuits on the registry again, which the client cannot verify");
}

/* ---- 11. what the page says after a submit ---------------------------------
   Asked directly: *"are you able to also replicate what happens when someone click submit…
   sometimes it goes to a different page, or sometimes it just says thank you."* Two answers,
   and the SECOND check is the one that keeps the first honest: a site whose confirmation is
   delivered by JavaScript must produce NOTHING rather than an invented "Thanks!". */
{
  const rp = fs.readFileSync("src/data/replicaPages.ts", "utf8");
  const pg = fs.readFileSync("src/screens/ReplicaPage.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const gs = fs.readFileSync("src/screens/GoogleSearch.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bo = fs.readFileSync("src/data/bookingOverride.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const eg = fs.readFileSync("src/data/editGuard.ts", "utf8");

  /* ⚠️ The three guards that stop a reveal firing on something that is not a confirmation:
     it must be hidden, carry real words, and hold no form fields. */
  /if \(!isHidden\(el\)\) continue;/.test(rp)
    ? ok("confirm: only a HIDDEN block counts (an already-visible one is page furniture)")
    : no("confirm: it would reveal something the page was already showing");
  /trim\(\)\.length < 12\) continue;/.test(rp)
    ? ok("confirm: a styled-but-empty shell is refused (HubSpot leaves one)")
    : no("confirm: an empty box can be revealed, which reads as the page breaking");
  /el\.querySelector\("input, textarea, select"\)\) continue;/.test(rp)
    ? ok("confirm: a node still holding form fields is not a confirmation")
    : no("confirm: it can reveal the form it was meant to replace");
  /if \(!best \|\| el\.contains\(best\)\) best = el;/.test(rp)
    ? ok("confirm: the OUTERMOST match wins, so the body copy is not lost")
    : no("confirm: it keeps an inner node — the heading without 'what happens next'");
  /return false;\s*$/m.test(rp.slice(rp.indexOf("export function revealConfirmation")))
    ? ok("confirm: it reports failure so the caller can fall back rather than guess")
    : no("confirm: revealConfirmation cannot signal that the page has none");

  /if \(!created\) return;/.test(pg)
    ? ok("confirm: a refused submit shows no thank-you (never claim success)")
    : no("confirm: it can thank someone while telling them the submit failed");
  /if \(thanksRef\.current\) \{ frame\.src = thanksRef\.current; return; \}/.test(pg)
    ? ok("after-submit: the SE's own page wins over a block we merely recognised")
    : no("after-submit: the explicit instruction does not take precedence");
  /const thanksRef = useRef\(""\)/.test(pg)
    ? ok("after-submit: read through a ref, so resolving it does not re-wire every form")
    : no("after-submit: a closure read would be empty exactly when it matters");

  /onSetThankYou/.test(gs) && /gs-lnk-after/.test(gs)
    ? ok("after-submit: the Book online menu carries the field, not a second surface")
    : no("after-submit: there is no way to set it");
  /\/\^thankYouUrl\$\/i/.test(eg)
    ? ok("after-submit: the guard allows the first write on a demo that predates the field")
    : no("after-submit: the first save is an undefined -> string flip and will be refused");
  (bo.match(/THANKS_FIELD, value: JSON\.stringify\(""\)/g) || []).length === 1
    ? ok("after-submit: Reset clears it too, so no page outlives the link it belonged to")
    : no("after-submit: Reset leaves a stale after-submit page behind");
}

console.log(bad ? `\n${bad} replica check(s) FAILED\n` : "\nAll replica checks passed\n");
process.exit(bad ? 1 : 0);
