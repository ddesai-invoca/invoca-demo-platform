/* =============================================================================
   freezePage — a real browser loads the page, and we keep the bytes it actually fetched
   -----------------------------------------------------------------------------
   Asked for: *"i just a self contained just in that moment in time, it doesnt matter what they
   do in the future if they change it in the future."*

   ⚠️⚠️ **THIS REPLACED A REGEX INLINER THAT DID NOT WORK, and the failure is worth recording.**
   Rewriting asset URLs from HTML text in Node meant reimplementing the browser's URL
   resolution, and it lost: 97 seconds, a 24MB file, **0 of 9 images inlined**, and **318 assets
   "could not be fetched"** because a Magento theme serves versioned static paths
   (`/static/version…/`) that a `../images/x.svg` resolved against the wrong base never finds.
   Guessing what a page's CSS means is a losing game.

   ⚠️⚠️ **SO THE BROWSER RESOLVES EVERY URL AND WE HARVEST WHAT IT ACTUALLY LOADED.**
   `page.on("response")` hands us the real bytes of every stylesheet, image and font the page
   requested — correct URLs, correct versions, correct cookies, no CORS involved because this is
   the protocol level, not `fetch` inside the page. Then the swap happens on the LIVE DOM, so
   `img.currentSrc` and `new URL(ref, sheet.href)` do the resolving instead of a regex.

   ⚠️⚠️ **AND IT ONLY EMBEDS WHAT THE PAGE USED, WHICH IS ALSO THE SIZE FIX.** A theme's CSS
   references icon sprites and font weights the page never renders; the browser never requests
   them, so they are never harvested and never embedded. That is the difference between a
   faithful capture and a dump of the whole theme.

   ⚠️ **SCRIPTS ARE NOT REMOVED HERE.** The result still goes through `sanitizeReplica`, which
   owns every safety guarantee (no scripts, no form actions, no handlers). One place, so the
   two capture routes cannot end up with different safety properties.
   ============================================================================= */

const ENDPOINT_DEFAULT = "https://production-sfo.browserless.io/content";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/* ⚠️⚠️ **120,000ms IS A HARD CEILING ON THIS PLAN, not a preference.** Asking for 180s came
   back `HTTP 400: The 'timeout' value must be a whole number of milliseconds between 1 and
   120,000 (your plan's maximum session time, 2 minutes)`. So the whole freeze — navigate, wait
   for the form, settle, scroll the page, read every response body, swap the DOM — has to fit
   inside two minutes. The in-browser waits below are sized against that budget, and the client
   abort sits ABOVE the session limit so a real overrun returns Browserless's own explanation
   rather than our generic timeout. */
const FREEZE_SESSION_MS = 115_000;
const FREEZE_TIMEOUT_MS = 150_000;

export class FreezeUnavailable extends Error {}

/** A same-origin child document that carries fillable fields — see the frame note in the FN. */
export interface ReplicaFrame { id: string; html: string; fillable: number }

export interface FreezeReport {
  sheets: { inlined: number; failed: number };
  images: { inlined: number; failed: number };
  cssRefs: { inlined: number; missing: number };
  /** @import statements spliced in as text — see the freezer's note on the font leak. */
  imports: number;
  embeddedBytes: number;
  harvested: number;
  /** URLs the page really fetched that were still linked after the in-browser swap. */
  leaks: number;
  /** How many of those the Node top-up managed to embed. */
  toppedUp: number;
  skipped: { url: string; why: string }[];
  ms: number;
}

/* ---------------------------------------------------------------------------
   The function body that runs ON BROWSERLESS. Kept as a string because it is
   Puppeteer code executed over there, not here.
   --------------------------------------------------------------------------- */
const FN = String.raw`
export default async function ({ page }) {
  const TARGET = "__URL__";
  const LEAD = "__LEAD__";
  const MAX_ASSET = __MAX_ASSET__;
  const MAX_TOTAL = __MAX_TOTAL__;

  /* ---- harvest via CDP, NOT page.on("response") --------------------------
     ⚠️⚠️ **THERE IS NO 'Buffer' IN THIS SANDBOX — MEASURED.** Puppeteer's own
     'response.buffer()' threw "Buffer is not defined" for all 217 responses on the first
     attempt, so 0 assets were harvested while the run otherwise looked fine. CDP's
     'Network.getResponseBody' hands back base64 directly and needs no Node globals. */
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");

  const meta = new Map();     // requestId -> { url, mime, type }
  const store = new Map();    // url -> { b64, mime, bytes }
  let total = 0;
  const skipped = [];
  const WANTED = ["Stylesheet", "Image", "Font"];
  const pending = [];

  client.on("Network.responseReceived", (e) => {
    meta.set(e.requestId, { url: e.response.url, mime: e.response.mimeType || "application/octet-stream", type: e.type });
  });
  client.on("Network.loadingFinished", (e) => {
    const m = meta.get(e.requestId);
    if (!m || !WANTED.includes(m.type)) return;
    if (store.has(m.url)) return;
    /* ⚠️ THE BODY MUST BE ASKED FOR NOW, before the browser evicts it — so the promise is
       collected and awaited later rather than fired and forgotten. */
    pending.push(
      client.send("Network.getResponseBody", { requestId: e.requestId })
        .then((r) => {
          const b64 = r.base64Encoded ? r.body : btoa(unescape(encodeURIComponent(r.body)));
          const bytes = Math.floor(b64.length * 0.75);
          if (bytes > MAX_ASSET) { skipped.push({ url: m.url, why: "over the per-asset cap" }); return; }
          if (total + bytes > MAX_TOTAL) { skipped.push({ url: m.url, why: "total budget spent" }); return; }
          total += bytes;
          store.set(m.url, { b64: b64, mime: m.mime, bytes: bytes });
        })
        .catch(() => { })
    );
  });

  /* ⚠️⚠️ **A DESKTOP VIEWPORT, SET BEFORE NAVIGATION — AND OMITTING IT FROZE THE MOBILE PAGE.**
     Measured: the first frozen capture rendered Magento's MOBILE navigation (the nav measured
     320px wide and 811px tall, the desktop logo row gone) because this theme rebuilds its nav
     DOM from JavaScript at its breakpoint, and whatever layout is in the DOM when we serialise
     is the layout the capture keeps forever. The live render path already learned this and
     pins 1440x900; matching it means a capture and a live render look the same.
     ⚠️ NOT TALLER THAN 900. A tall viewport was tried on the live path to drag more lazy images
     into range and it made a vh-sized hero 2400px tall with two carousel slides overlapping -
     the exact "formatting of the header is off" complaint. The scroll pass below is how
     below-the-fold images get requested instead. */
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
  /* The same wait the live render path uses: a lead-shaped field, else just settle. */
  try { await page.waitForSelector(LEAD, { timeout: 25000 }); } catch (e) { }
  await new Promise((r) => setTimeout(r, 5000));
  /* ⚠️ SCROLL, BECAUSE A LAZY IMAGE BELOW THE FOLD IS NEVER REQUESTED — and an unrequested
     asset cannot be harvested. Back to the top after, so the capture is the page as it opens. */
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1500));
  });
  await new Promise((r) => setTimeout(r, 2000));

  /* ⚠️⚠️ **A VIEWPORT ADAPTATION SOME SCRIPT WROTE ONTO BODY MUST NOT BE FROZEN - IT PUT THE
     FORM OFF-SCREEN.** Traced on greenixpc.com by snapshotting body at four points: null at
     goto, then 'width: 4000px; text-size-adjust: none; zoom: 1;' after the settle, and it
     survives scrolling back to the top. The live page at the same 1440 viewport has no inline
     body style at all and its form sits at x=784; with the 4000px body baked in, the capture
     laid out 4000px wide and the form panel sat at x=2064, off-screen at any sensible width.
     These particular properties describe how a script decided to adapt to ITS window, never
     the page's content, so they are stripped from html and body before serialising. Anything
     the page's own stylesheet sets is untouched. */
  await page.evaluate(() => {
    const junk = ["width", "min-width", "max-width", "zoom", "text-size-adjust", "-webkit-text-size-adjust", "transform"];
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const prop of junk) el.style.removeProperty(prop);
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    }
  });
  await Promise.all(pending);

  /* ---- hand the harvested bytes to the page, on demand -------------------- */
  await page.exposeFunction("__asset", (url) => {
    const hit = store.get(url);
    return hit ? "data:" + hit.mime + ";base64," + hit.b64 : null;
  });

  /* ---- swap on the live DOM, where the browser does the resolving --------- */
  const report = await page.evaluate(async (MAXA) => {
    const out = { sheets: 0, sheetsFailed: 0, images: 0, imagesFailed: 0, cssRefs: 0, cssMissing: 0, imports: 0 };

    /* ⚠️ A data: URI is decoded BY THE BROWSER rather than by us - it gets the charset right,
       which a hand-rolled base64-to-text step does not. */
    const asText = async (uri) => {
      try { return await (await fetch(uri)).text(); } catch (e) { return null; }
    };

    /* ⚠️⚠️ **A SECOND SOURCE FOR ANYTHING THE HARVEST MISSED, AND IT BEATS FETCHING IN NODE.**
       Two files still leaked after the first pass because the browser served them from its own
       cache, so CDP had no body. Measured on the retry: Node could not get them either - the
       SVG is a genuine 404 on the site and the font answers **403** to any non-browser request.
       But this code is running ON the page's own origin, so a same-origin fetch just works.
       Cross-origin without CORS still fails here, which is what the Node top-up is for. */
    const viaPage = async (abs) => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(abs, { credentials: "omit", signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const b = await r.blob();
        if (!b.size || b.size > MAXA) return null;
        return await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(b);
        });
      } catch (e) { return null; }
    };

    /* ⚠️⚠️ **THE PAGE'S OWN FETCH IS ONLY TRIED FOR ASSETS THE PAGE REALLY REQUESTED, and
       without that gate this whole call died.** The theme's CSS carries ~500 url() refs the page
       never loads; attempting a network fetch for each produced hundreds of requests, mostly
       404s, and Browserless killed the run with **HTTP 408 "Request has timed out"**. The
       resource timeline says which refs were real, so the fallback runs twice instead of 500
       times. Everything else is absolutised and left linked. */
    const usedSet = new Set(
      performance.getEntriesByType("resource").map((r) => r.name).filter((u) => /^https?:/.test(u))
    );
    let viaPageTries = 0;

    /* Harvested bytes first, then the page's own fetch - for real misses only. */
    const resolveAsset = async (abs) => {
      const hit = await window.__asset(abs);
      if (hit) return hit;
      if (!usedSet.has(abs) || viaPageTries >= 60) return null;
      viaPageTries++;
      return await viaPage(abs);
    };

    /* images: currentSrc is what the browser ACTUALLY chose, srcset and all */
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const pick = img.currentSrc || img.src;
      if (pick && !pick.startsWith("data:")) {
        const uri = await resolveAsset(pick);
        if (uri) { img.setAttribute("src", uri); out.images++; } else { out.imagesFailed++; }
      }
      /* ⚠️ A SURVIVING srcset SENDS THE BROWSER BACK TO THE NETWORK for a variant we did not
         embed, and the frozen src would be ignored. */
      img.removeAttribute("srcset");
      img.removeAttribute("data-srcset");
      img.removeAttribute("loading");
    }
    for (const s of Array.from(document.querySelectorAll("picture source, source[srcset]"))) s.remove();

    /* ---- @import FIRST, and splicing the TEXT in rather than data-URI-ing it ----------
       ⚠️⚠️ **THIS WAS A REAL LEAK, MEASURED.** The generic url() pass below happily turned
       '@import url(fonts.googleapis.com/...)' into '@import url(data:text/css;...)', which
       LOOKS frozen and is not: the imported sheet's own '@font-face src' URLs were still
       absolute, so opening the replica fetched p.typekit.net, use.typekit.net,
       fonts.googleapis.com and three woff2 files from fonts.gstatic.com. Splicing the text in
       means the url() pass then rewrites those too. */
    const inlineImports = async (cssText, sheetHref, depth) => {
      if (depth > 2) return cssText;
      const re = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi;
      const found = [];
      let m;
      while ((m = re.exec(cssText))) {
        found.push({ whole: m[0], target: (m[2] || m[4] || '').trim(), media: (m[5] || '').trim() });
      }
      for (const f of found) {
        if (!f.target || /^data:/i.test(f.target)) continue;
        let abs;
        try { abs = new URL(f.target, sheetHref).toString(); } catch (e) { continue; }
        const uri = await resolveAsset(abs);
        let text = uri ? await asText(uri) : null;
        if (text === null) { out.cssMissing++; continue; }
        text = await inlineImports(text, abs, depth + 1);
        /* The import's own media query has to survive, or rules meant for print apply here. */
        const wrapped = f.media ? '@media ' + f.media + '{' + text + '}' : text;
        cssText = cssText.split(f.whole).join(wrapped);
        out.imports++;
      }
      return cssText;
    };

    const rewrite = async (cssText, sheetHref) => {
      cssText = await inlineImports(cssText, sheetHref, 0);
      const refs = new Set();
      const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
      let m;
      while ((m = re.exec(cssText))) {
        const raw = m[2].trim();
        if (raw && !/^data:|^#/i.test(raw)) refs.add(raw);
      }
      for (const raw of refs) {
        let abs;
        try { abs = new URL(raw, sheetHref).toString(); } catch (e) { continue; }
        const uri = await resolveAsset(abs);
        if (!uri) out.cssMissing++;
        else out.cssRefs++;
        /* ⚠️⚠️ **WHEN IT CANNOT BE EMBEDDED IT IS STILL REWRITTEN TO THE ABSOLUTE URL, and
           skipping that step was a real bug.** Splicing a sheet's text into a <style> element
           changes what its RELATIVE urls resolve against: the theme's
           'url(../../frontend/.../schedule-an-appointment.svg)' was correct against the
           stylesheet and became a 404 against the page. Absolutising keeps every un-embedded
           ref pointing exactly where it pointed before. */
        const replacement = uri || abs;
        if (replacement === raw) continue;
        for (const form of [raw, abs]) {
          cssText = cssText.split("url(" + form + ")").join("url(" + replacement + ")")
            .split("url('" + form + "')").join("url('" + replacement + "')")
            .split('url("' + form + '")').join('url("' + replacement + '")');
        }
      }
      return cssText.replace(/<\/style/gi, "<\\/style");
    };

    for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))) {
      const href = link.href;
      let text = null;
      const uri = href ? await window.__asset(href) : null;
      if (uri) text = await asText(uri);
      if (text === null) {
        /* Backstop for a sheet served from cache, which has no harvestable body. */
        const sheet = Array.from(document.styleSheets).find((s) => s.href === href);
        try { text = sheet ? Array.from(sheet.cssRules).map((r) => r.cssText).join("\n") : null; } catch (e) { text = null; }
      }
      if (text === null) { out.sheetsFailed++; continue; }
      const style = document.createElement("style");
      style.setAttribute("data-replica-css", "1");
      style.setAttribute("data-replica-from", href);
      style.textContent = await rewrite(text, href);
      link.replaceWith(style);
      out.sheets++;
    }

    for (const style of Array.from(document.querySelectorAll("style:not([data-replica-css])"))) {
      if (style.textContent && style.textContent.indexOf("url(") !== -1) {
        style.textContent = await rewrite(style.textContent, document.baseURI);
      }
    }
    for (const el of Array.from(document.querySelectorAll('[style*="url("]'))) {
      const v = el.getAttribute("style");
      if (v) el.setAttribute("style", await rewrite(v, document.baseURI));
    }

    return out;
  }, MAX_ASSET);

  /* ---- same-origin iframes: the form is often IN one ----------------------
     ⚠️⚠️ **THIS IS WHY greenixpc.com CAME BACK WITH NO FORM AT ALL.** Its contact form is a
     HubSpot embed in an iframe with NO src (id 'hs-form-iframe-0'), so the top-level document
     has **0 forms and 0 inputs** - the fields live in the child document. Serialising
     documentElement.outerHTML keeps the iframe TAG and throws the contents away, and the
     sanitizer then strips the tag too. A SingleFile-style download works precisely because it
     walks into same-origin frames and inlines them, so this does the same.

     ⚠️ THE FRAME'S OWN ASSETS GET THE SAME TREATMENT, by running the identical swap inside it. */
  const frames = await page.evaluate(async (MAXA) => {
    const out = [];
    const list = Array.from(document.querySelectorAll("iframe"));
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      let doc = null;
      try { doc = f.contentDocument; } catch (e) { doc = null; }
      /* Cross-origin frames are unreadable by definition; they stay stripped. */
      if (!doc || !doc.documentElement) continue;
      /* A frame with nothing fillable is not worth embedding - ad and tracking pixels. */
      const fillable = Array.from(doc.querySelectorAll("input,select,textarea"))
        .filter((e) => ["hidden", "submit", "button", "reset", "image"].indexOf((e.type || "").toLowerCase()) === -1).length;
      if (!fillable) continue;
      const id = "rf" + i;
      f.setAttribute("data-replica-frame", id);
      f.removeAttribute("src");
      out.push({ id: id, html: "<!doctype html>" + doc.documentElement.outerHTML, fillable: fillable });
    }
    return out;
  }, MAX_ASSET);

  /* ---- what still leaks, judged by what the page ACTUALLY fetched ---------
     ⚠️⚠️ **A HARVEST MISS IS NOT THE SAME AS AN UNUSED REF, and only this tells them apart.**
     After the swap this page still pulled two files from aviandco.com - a hero SVG and a
     Font Awesome ttf - because the browser served them from its own cache, so
     Network.loadingFinished had no body to give us. Meanwhile 502 other url() refs in the
     theme's CSS are also still absolute and DO NOT MATTER, because nothing on the page ever
     asked for them. The resource timeline is the difference: it lists only what was really
     requested, so the top-up in Node fetches two files instead of five hundred. */
  const leaks = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    /* ⚠️⚠️ **ASSET-SHAPED ONLY — WITHOUT THIS FILTER THE FILE WENT FROM 7.5MB TO 10.6MB.** The
       first version took every http(s) entry in the resource timeline, which includes analytics
       beacons and Klaviyo XHRs, and dutifully embedded 39 of them as data URIs. None of them
       affect how the page looks. */
    const used = performance.getEntriesByType("resource")
      .filter((r) => ["css", "img", "link", "image", "font"].indexOf(r.initiatorType) !== -1
        || /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|css)(?:\?|$)/i.test(r.name))
      .map((r) => r.name)
      .filter((u) => /^https?:/.test(u));
    return Array.from(new Set(used)).filter((u) => html.indexOf(u) !== -1);
  });

  return {
    data: {
      html: "<!doctype html>" + (await page.evaluate(() => document.documentElement.outerHTML)),
      finalUrl: page.url(),
      report: report,
      harvested: store.size,
      embeddedBytes: total,
      skipped: skipped.slice(0, 40),
      leaks: leaks,
      frames: frames,
    },
    type: "application/json",
  };
}
`;

/** The same lead-shaped selector the live render path waits on. */
const LEAD_SELECTOR =
  'input[type="tel"],input[autocomplete*="tel"],input[name*="phone"],input[id*="phone"],input[placeholder*="Phone"],input[autocomplete*="given-name"],input[name*="first_name"],input[placeholder*="First Name"]';

/**
 * Load `url` in a real browser and return it with every asset it used embedded.
 * Throws `FreezeUnavailable` — a capture is a deliberate act, so there is nothing to degrade to.
 */
export async function freezePage(
  url: string,
  opts: { maxAsset?: number; maxTotal?: number } = {},
): Promise<{ html: string; finalUrl: string; frames: ReplicaFrame[]; report: FreezeReport }> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new FreezeUnavailable("No BROWSERLESS_TOKEN, so a page cannot be frozen.");

  const base = (process.env.BROWSERLESS_URL || ENDPOINT_DEFAULT).replace(/\/content\b/, "/function");
  const code = FN
    .replace("__URL__", url.replace(/"/g, '\\"'))
    .replace("__LEAD__", LEAD_SELECTOR.replace(/"/g, '\\"'))
    .replace("__MAX_ASSET__", String(opts.maxAsset ?? 3 * 1024 * 1024))
    .replace("__MAX_TOTAL__", String(opts.maxTotal ?? 12 * 1024 * 1024));

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FREEZE_TIMEOUT_MS);
  try {
    /* ⚠️⚠️ **`stealth=true` IS NOT OPTIONAL — MEASURED.** Without it `/function` drives a plain
       Chromium and `aviandco.com` served it Cloudflare's "Just a moment…" interstitial: 0 assets
       harvested, 0 sheets, 0 forms, and the capture correctly refused to write anything. With
       it, the same call gets the real page. `/unblock` has this behaviour built in; `/function`
       has to be asked.

       ⚠️⚠️ **AND `blockAds` IS DELIBERATELY ABSENT — IT DELETED THE FORM WE CAME FOR.** Measured
       side by side on the same page: with ad-blocking on, `form.klaviyo-form` count 0 and no
       "First Name" field, 4 forms total; with it off, 2 Klaviyo forms, the field present, 6
       forms. The appointment form IS a marketing widget, so a tracker blocklist takes it out.
       Never add it back for the sake of a smaller capture. */
    const res = await fetch(`${base}?token=${encodeURIComponent(token)}&stealth=true&timeout=${FREEZE_SESSION_MS}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/javascript" },
      body: code,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new FreezeUnavailable(`The freezer failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const j = (await res.json()) as {
      data?: {
        html?: string; finalUrl?: string; harvested?: number; embeddedBytes?: number;
        skipped?: { url: string; why: string }[];
        leaks?: string[];
        frames?: { id: string; html: string; fillable: number }[];
        report?: { sheets: number; sheetsFailed: number; images: number; imagesFailed: number; cssRefs: number; cssMissing: number; imports: number };
      };
    };
    const d = j?.data;
    if (!d?.html || d.html.length < 1000) throw new FreezeUnavailable("The freezer returned no page.");

    /* ---- top-up: fetch the few real leaks here, where there is no CORS ----- */
    let html = d.html;
    let toppedUp = 0;
    const maxAsset = opts.maxAsset ?? 3 * 1024 * 1024;

    /* ⚠️ ONE FORMAT PER FONT. A face can ship as woff2, woff, ttf, eot and svg; a browser uses
       the FIRST format it supports and ignores the rest, so fetching the others buys nothing.
       ⚠️ **AND TO BE HONEST ABOUT WHAT THIS DID NOT FIX:** it removed 0 assets on aviandco,
       because the font weight there is not duplication. Measured composition of that 17.8MB
       capture — `application/font-sfnt` 5.17MB, `text/plain` 3.07MB (a CDN mislabelling more of
       the same), against 0.2MB of images — comes from **20 distinct @font-face families the
       page genuinely loads** (Font Awesome 5 Pro, 5 Brands, 6 Pro, luma-icons, form-builder-font,
       futura-pt), out of 364 declared. The other 217 font URLs are unicode-range subsets the
       page never requested and are correctly left alone. Icon fonts are kept deliberately: a
       replica missing its icons is the exact complaint that started this work. */
    const FONT_RANK: Record<string, number> = { woff2: 0, woff: 1, ttf: 2, otf: 3, eot: 4, svg: 5 };
    const fontKey = (u: string) => {
        const path = u.split("?")[0];
        const m = path.match(/\/([^/]+)\.(woff2|woff|ttf|otf|eot)$/i);
        return m ? { family: `${path.slice(0, path.length - m[0].length)}/${m[1].toLowerCase()}`, ext: m[2].toLowerCase() } : null;
      };
    const bestFont = new Map<string, string>();
    for (const url of d.leaks ?? []) {
      const k = fontKey(url);
      if (!k) continue;
      const held = bestFont.get(k.family);
      if (!held || FONT_RANK[k.ext] < FONT_RANK[fontKey(held)!.ext]) bestFont.set(k.family, url);
    }
    const wanted = (d.leaks ?? []).filter((u) => {
      const k = fontKey(u);
      return !k || bestFont.get(k.family) === u;
    });

    for (const url of wanted.slice(0, 40)) {
      try {
        const res2 = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Referer: d.finalUrl || url } });
        if (!res2.ok) continue;
        const buf = Buffer.from(await res2.arrayBuffer());
        if (!buf.length || buf.length > maxAsset) continue;
        const mime = (res2.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
        const uri = `data:${mime};base64,${buf.toString("base64")}`;
        /* ⚠️ BOTH SPELLINGS. An attribute value in serialised HTML has its ampersands escaped,
           so a query-string URL appears as `&amp;` and a plain replace would miss it. */
        const escaped = url.replace(/&/g, "&amp;");
        const before = html;
        html = html.split(url).join(uri);
        if (escaped !== url) html = html.split(escaped).join(uri);
        if (html !== before) toppedUp++;
      } catch { /* leave it linked; the <base href> still resolves it */ }
    }

    return {
      html,
      frames: d.frames ?? [],
      finalUrl: d.finalUrl || url,
      report: {
        sheets: { inlined: d.report?.sheets ?? 0, failed: d.report?.sheetsFailed ?? 0 },
        images: { inlined: d.report?.images ?? 0, failed: d.report?.imagesFailed ?? 0 },
        cssRefs: { inlined: d.report?.cssRefs ?? 0, missing: d.report?.cssMissing ?? 0 },
        imports: d.report?.imports ?? 0,
        embeddedBytes: d.embeddedBytes ?? 0,
        harvested: d.harvested ?? 0,
        skipped: d.skipped ?? [],
        leaks: wanted.length,
        toppedUp,
        ms: Date.now() - started,
      },
    };
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof FreezeUnavailable) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new FreezeUnavailable(aborted ? `Freezing timed out after ${FREEZE_TIMEOUT_MS / 1000}s.` : `Could not reach the freezer: ${(e as Error)?.message}`);
  }
}
