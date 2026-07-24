/* =============================================================================
   google-ads-demo.js — re-skins the static Google Ads capture per prospect and
   drives a 3-page "conversions" walkthrough via the table's next/prev arrows.
   -----------------------------------------------------------------------------
   google-ads.html is an exact static copy of the real Google Ads console (its
   own Angular JS is inert), so this script reads the ACTIVE generated prospect
   from localStorage (shared with the React app) and rewrites the DOM:
     1/3. keyword text → a per-prospect keyword; the "Quote" conversion label →
          the prospect's conversion term (bookingTerm).
     2/4. clicking the Next arrow steps through 3 pages of conversion data;
          Prev steps back. Page 1 = form submit only; page 2 adds call-extensions
          + web-page-calls (25/25, total 100, $100 cost/conv); page 3 bumps them
          to 50/100 (total 200, $50 cost/conv).
   All edits are defensive (no-op if the capture's DOM ever changes). ============ */
(function () {
  "use strict";

  /* ---- active prospect (generated profiles are cached in localStorage) ------ */
  function activeProfile() {
    // Primary: the React app mirrors the active profile here (any prospect).
    try {
      const one = localStorage.getItem("invoca-demo:active-profile");
      if (one) { const p = JSON.parse(one); if (p && p.id) return p; }
    } catch (e) { /* ignore */ }
    // Fallback: match the active id against the cached generated profiles.
    try {
      const id = localStorage.getItem("invoca-demo:activeId");
      const arr = JSON.parse(localStorage.getItem("invoca-demo:profiles") || "[]");
      if (Array.isArray(arr)) return arr.find((x) => x && x.id === id) || null;
    } catch (e) { /* ignore */ }
    return null;
  }

  function deriveKeyword(p) {
    const cr = p.reports && p.reports.callReview;
    if (cr && Array.isArray(cr.searchSuggestions) && cr.searchSuggestions[0]) return cr.searchSuggestions[0];
    const md = p.reports && p.reports.marketingDashboard;
    const bds = (md && md.breakdowns) || [];
    const st = bds.find((b) => /search/i.test(b.title || ""));
    if (st && st.rows && st.rows[0] && st.rows[0].name) return st.rows[0].name;
    if (p.industry) return String(p.industry).toLowerCase();
    return null;
  }

  const profile = activeProfile();
  const CT = (profile && profile.bookingTerm) || "Quote";        // conversion term
  const KEYWORD = profile ? deriveKeyword(profile) : null;

  /* ---- DOM handles -------------------------------------------------------- */
  const kwEl = document.querySelector('ess-cell[essfield="keyword_text"] keyword-text div[dir="ltr"]');
  const segEl = document.querySelector('ess-cell[essfield="segmentation_info"] segmentation-cell');
  const closestRow = (el) => (el ? el.closest(".particle-table-row") : null);
  const kwRow = closestRow(kwEl);
  const segRow = closestRow(segEl);
  const statEllipsis = (row, field) => (row ? row.querySelector('ess-cell[essfield="' + field + '"] .ess-cell-ellipsis, ess-cell[essfield="' + field + '"] stats-field') : null);

  /* ---- 1 + 3: re-skin keyword + conversion term --------------------------- */
  if (kwEl && KEYWORD) kwEl.textContent = KEYWORD;

  /* ---- 2 + 4: the 3-page conversions walkthrough -------------------------- */
  // Each page: the segment lines (label + conversions) + the keyword-row totals.
  const PAGES = [
    { segs: [["form submit", "50"]], total: "50", costConv: "—" },
    { segs: [["form submit", "50"], ["call extensions", "25"], ["web page calls", "25"]], total: "100", costConv: "$100.00" },
    { segs: [["form submit", "50"], ["call extensions", "50"], ["web page calls", "100"]], total: "200", costConv: "$50.00" },
  ];
  let page = 0;

  const LH = 40; // line-height for stacked rows (px)
  function stack(items) {
    return items.map((t) => '<div class="ess-cell-ellipsis" style="line-height:' + LH + 'px;overflow:visible">' + t + "</div>").join("");
  }

  function render() {
    const pg = PAGES[page];

    // Let the segmentation row grow to fit stacked lines.
    if (segRow) { segRow.style.height = "auto"; segRow.style.minHeight = LH * pg.segs.length + "px"; }

    // Segmentation label column: stacked "<CT> (segment)" lines.
    if (segEl) {
      segEl.innerHTML = stack(pg.segs.map((s) => CT + " (" + s[0] + ")"));
      segEl.style.display = "block";
    }
    // Segmentation conversions column: stacked numbers aligned to the labels.
    const segConv = statEllipsis(segRow, "stats.conversions");
    if (segConv) {
      const host = segConv.closest("stats-field") || segConv;
      host.innerHTML = stack(pg.segs.map((s) => s[1]));
      const cell = host.closest("ess-cell"); if (cell) cell.style.overflow = "visible";
    }

    // Keyword-row totals: total conversions + cost/conv.
    const kwConv = statEllipsis(kwRow, "stats.conversions");
    if (kwConv) { const d = kwConv.closest("stats-field") ? kwConv.closest("stats-field").querySelector(".ess-cell-ellipsis") || kwConv : kwConv; d.textContent = pg.total; }
    const kwCost = statEllipsis(kwRow, "stats.cost_per_conversion");
    if (kwCost) { const d = kwCost.closest("stats-field") ? kwCost.closest("stats-field").querySelector(".ess-cell-ellipsis") || kwCost : kwCost; d.textContent = pg.costConv; }
  }

  function go(delta) {
    const next = Math.min(PAGES.length - 1, Math.max(0, page + delta));
    if (next === page) return;
    page = next;
    render();
  }

  // Own the Next/Prev arrows. The captured page has residual handlers on them that
  // navigate away, so we CLONE each button (cloneNode drops all event listeners),
  // force type="button" (kills any implicit form submit), and attach only our
  // handler. The clone looks identical but does nothing except step our pages.
  function wire() {
    document.querySelectorAll('button.next[aria-label="Next"], button.prev[aria-label="Previous"]').forEach((orig) => {
      const dir = orig.classList.contains("next") ? 1 : -1;
      const clone = orig.cloneNode(true);
      clone.setAttribute("type", "button");
      clone.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); go(dir); });
      orig.replaceWith(clone);
    });
  }

  render();  // page 1 (also applies the conversion-term re-skin to the segment label)
  wire();
})();
