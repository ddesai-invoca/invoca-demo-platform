/* =============================================================================
   capture-replica.js — make a Replicate page from a prospect's own booking page
   -----------------------------------------------------------------------------
   HOW TO USE. Open the prospect's real booking page in a browser, dismiss any cookie banner
   (so the capture is clean), paste this whole file into the console, and call:

       captureReplica("aptive")

   It serialises the RENDERED page and hands it to the browser as a DOWNLOAD; move the file to
   `public/replicas/<slug>.html` and register it in `src/data/replicaPages.ts`.

   ⚠️⚠️ **A DOWNLOAD, NOT A POST TO THE DEV SERVER — and the obvious version does not work.**
   The first build POSTed the HTML to a `/api/replica-capture` endpoint on `localhost:5173`,
   which is tidier and which `curl` confirmed worked. From a real capture it fails with a bare
   `TypeError: Failed to fetch`, because every page worth capturing is **HTTPS** and the
   browser blocks mixed content to `http://localhost`. The endpoint was deleted rather than
   kept: it could only ever be reached from an HTTP page, and a dev server that writes files
   from an unauthenticated body is not worth carrying for nothing.

   ⚠️⚠️ **IT HAS TO BE A BROWSER, AND THAT IS MEASURED.** These forms are JavaScript widgets:
   Aptive's booking page serves **zero `<form>` elements** to curl and renders **one with 38
   inputs** in a browser, and AutoNation **403s a server fetch** while loading normally in a
   real one. A server-side fetch produces a formless, unstyled skeleton — which is also why
   this repo has always captured with SingleFile rather than `curl`.

   ⚠️⚠️ **NEUTRALISING THE FORM IS THE POINT OF DOING IT HERE, NOT LATER.** AutoNation's fleet
   form is a **Salesforce Web-to-Lead** form (its `00N1U00000Utmts`-style field names are
   Salesforce custom field ids) and Aptive's posts to Aptive's own lead API. A replica that
   kept its `action` would file a REAL lead at the prospect's own company the first time an SE
   demoed it — far worse than having no feature. So `action`/`method`/`target`/`onsubmit` are
   stripped from every form and `formaction` from every button, at capture time, so a
   neutralised file is the only thing that ever reaches disk. The serving layer re-checks.

   ⚠️ **SCRIPTS AND IFRAMES ARE REMOVED.** Scripts because a replica must not run the site's
   own analytics, chat or form JS; iframes because with scripts gone they are third-party
   widgets that would phone home mid-demo. **Consequence: a form that lives INSIDE an iframe
   (some ServiceTitan embeds) cannot be captured this way** — for those, capture the iframe's
   own URL directly.

   ⚠️ **ASSETS STAY REMOTE, via `<base href>`.** Images and fonts load from the prospect's own
   CDN, so the replica needs internet at demo time — the same property the saved Invoca
   Exchange page already has. Inlining them would make the file several times larger; do that
   only if an offline demo is ever needed.
   ============================================================================= */
function captureReplica(slug) {
  const doc = document.documentElement.cloneNode(true);

  /* 1. strip anything that executes or phones home */
  /* ⚠️⚠️ **`link[rel=stylesheet]` IS KEPT, AND REMOVING IT WAS A REAL BUG.** Measured on
     ridgeline-roofing.com: the page has **37 stylesheets and only 17 are readable** from script
     (the rest are cross-origin without CORS). Stripping the links and inlining only what we can
     read therefore threw away 20 stylesheets and the header laid out wrong. A stylesheet loads
     cross-origin perfectly well — CORS only governs READING its rules — so the links stay and
     the inlined copy below is belt-and-braces for the ones we can read. */
  doc.querySelectorAll(
    'script,noscript,iframe,object,embed,' +
    'link[rel="preload"],link[rel="modulepreload"],link[rel="prefetch"]'
  ).forEach((el) => el.remove());
  /* inline handlers survive an attribute sweep that a tag sweep misses */
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  });

  /* 2. NEUTRALISE every form — see the header. */
  let forms = 0;
  doc.querySelectorAll("form").forEach((f) => {
    forms++;
    ["action", "method", "target", "onsubmit"].forEach((a) => f.removeAttribute(a));
    f.setAttribute("data-replica-form", String(forms));
  });
  doc.querySelectorAll("[formaction]").forEach((b) => b.removeAttribute("formaction"));

  /* 3. inline every readable stylesheet (cross-origin sheets without CORS throw) */
  let css = "", unreadable = 0;
  for (const sheet of document.styleSheets) {
    try { css += [...sheet.cssRules].map((r) => r.cssText).join("\n") + "\n"; }
    catch { unreadable++; }
  }

  /* 4. keep remote assets resolvable */
  const head = doc.querySelector("head");
  const base = document.createElement("base");
  base.href = location.href;
  head.prepend(base);
  const style = document.createElement("style");
  style.setAttribute("data-replica-css", "1");
  style.textContent = css;
  head.appendChild(style);

  const html = "<!doctype html>\n" + doc.outerHTML;
  const report = {
    slug, url: location.href, bytes: html.length, cssBytes: css.length,
    forms, unreadableSheets: unreadable,
    /* ⚠️ COUNTED AS ELEMENTS, NOT BY REGEX OVER THE TEXT. A naive `/<script/` match reports
       Aptive's capture as carrying 3 scripts; all three sit inside HTML COMMENTS in the
       original page (`<!--MARKETO <script …>-->`) and are inert. A counter that cries wolf on
       a clean capture is how a real one later gets waved through. */
    scriptsLeft: doc.querySelectorAll("script").length,
    iframesLeft: doc.querySelectorAll("iframe").length,
    actionsLeft: doc.querySelectorAll("form[action]").length,
  };

  /* 5. hand it to the browser as a download — see the header for why this is not a POST. */
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `replica-${slug}.html`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  return report;
}

if (typeof module !== "undefined") module.exports = { captureReplica };
