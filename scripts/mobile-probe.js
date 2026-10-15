/* =============================================================================
   mobile-probe.js — paste into the browser console (or javascript_tool) on any
   screen with the viewport set to a phone (375x812) or tablet (820x1180).
   -----------------------------------------------------------------------------
   Two probes, because each catches what the other cannot:

     __probe()  anything wider than the screen: sideways page scroll, or an
                element running past the right edge that is NOT inside its own
                scrolling box (a table that scrolls inside its card is fine).
     __cramp()  text squeezed into a sliver: a block of 40+ characters rendered
                under 130px wide and over 60px tall. This is the one that found
                the transcript columns — a cramped column does not overflow, so
                __probe() reports it as clean.

   __walk(paths) visits each in-app route (history.pushState, no reload) and
   returns only the screens with findings. Keep a batch under ~12 routes per call
   or the tool times out.

   Both were proved to fire before being trusted (a 90px test block, and a
   wide element), which is the rule for every check in this repo.
   ============================================================================= */
window.__probe = () => {
  const W = innerWidth;
  const SHELL = /^(main|app|body|phone-page|ccr|pp-crm)$/;
  const SKIP = ".sidebar,.tour-root,.leaflet-container,.aiad:not(.aiad--open),.iad:not(.iad--open),.icta:not(.icta--open)";
  const hits = [];
  document.querySelectorAll("body *").forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.right <= W + 2 || e.closest(SKIP)) return;
    let p = e.parentElement, clipped = false;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      const cls = (p.className || "").toString().split(" ")[0];
      if ((ox === "auto" || ox === "scroll" || ox === "hidden") && !SHELL.test(cls)) { clipped = true; break; }
      p = p.parentElement;
    }
    if (!clipped) hits.push(`${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]} w${Math.round(r.width)} r${Math.round(r.right)}`);
  });
  return {
    hscroll: document.documentElement.scrollWidth - W,
    docW: document.documentElement.scrollWidth, W,
    n: hits.length, top: [...new Set(hits)].slice(0, 8),
  };
};

window.__cramp = () => {
  const out = [], seen = new Set();
  const SKIP = ".sidebar,.tour-root,.leaflet-container,svg,.aiad:not(.aiad--open),.iad:not(.iad--open),.wf-tree,table,.chart-wrap,.sfc-grid,.ccr-grid,.ica-heat,.ts-tablewrap";
  document.querySelectorAll("p,span,div,td,li,a,h1,h2,h3,h4,label").forEach((e) => {
    if (e.closest(SKIP)) return;
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (own.length < 40) return;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.width >= 130 || r.height <= 60) return;
    const k = (e.className || "").toString().split(" ")[0] || e.tagName;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(`${k} w${Math.round(r.width)} h${Math.round(r.height)} "${own.slice(0, 30)}"`);
  });
  return out;
};

window.__walk = async (paths, wait = 1100) => {
  const out = {};
  for (const p of paths) {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((r) => setTimeout(r, wait));
    const pr = window.__probe(), c = window.__cramp();
    if (pr.n || pr.hscroll || c.length) out[p] = { overflow: pr.top, cramped: c };
  }
  return out;
};
