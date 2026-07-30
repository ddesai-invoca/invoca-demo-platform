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

  const breakdown = (p, re_) => {
    const bds = ((p.reports || {}).marketingDashboard || {}).breakdowns || [];
    const b = bds.find((x) => re_.test(x.title || ""));
    return (b && b.rows) || [];
  };
  const firstRow = (p, re_) => {
    const r = breakdown(p, re_)[0];
    return (r && r.name) || null;
  };

  /* THE KEYWORD is the dashboard's top SEARCH TERM — an actual phrase somebody
     types into Google ("home security systems near me", "emergency room near
     me"). It used to come from callReview.searchSuggestions, which are single
     words lifted from call transcripts ("monitoring", "appointment"); those read
     as a transcript search, not a paid keyword, which is what looked wrong. */
  function deriveKeyword(p) {
    return firstRow(p, /search term/i)
      || firstRow(p, /search/i)
      || (p.industry ? String(p.industry).toLowerCase() : null);
  }

  /* THE AD GROUP is a product/service category, which is how ad groups are really
     organised (the capture's "Shades" was a Shady Blinds product).

     Picked by OVERLAP WITH THE KEYWORD rather than just taking the first row: an
     ad group contains its keywords, so "used cars for sale near me" sitting in a
     "New Cars" ad group is the kind of detail that makes an account look fake.
     Falls back to the top category when nothing overlaps. */
  function deriveAdGroup(p, keyword) {
    const rows = breakdown(p, /product category/i).length
      ? breakdown(p, /product category/i) : breakdown(p, /product/i);
    if (!rows.length) return null;
    const words = String(keyword || "").toLowerCase().match(/[a-z]{4,}/g) || [];
    /* TWO shared words minimum. One is too weak a signal: "continuing CARE
       retirement community" matched "Memory Care" on that single generic word and
       beat the better "Independent Living". Below the threshold, the top category
       (the biggest by volume) is the safer answer. */
    let best = rows[0].name, bestScore = 1;
    for (const r of rows) {
      const rw = String(r.name || "").toLowerCase().match(/[a-z]{4,}/g) || [];
      const score = rw.filter((w) => words.includes(w)).length;
      if (score > bestScore) { bestScore = score; best = r.name; }
    }
    return best;
  }

  /* THE CONVERSION ACTION is the prospect's booked-lead outcome: "Appointment
     Booked", "Tour Booked", "Consultation Booked". bookingTerm alone read as the
     noun ("Appointment") rather than the conversion an advertiser would name in
     Google Ads. */
  function deriveConversion(p) {
    const t = (p && p.bookingTerm) || "Lead";
    return /\b(booked|scheduled|complete|won)\b/i.test(t) ? t : t + " Booked";
  }

  /* ---- per-prospect overrides ---------------------------------------------- */
  /* A per-prospect escape hatch, keyed by profile id. Everything is derived from
     the prospect's OWN dashboard data now (search term, product category,
     bookingTerm), so an entry here is only for a prospect that genuinely needs to
     differ from its own data.

     Empty on purpose. The vector-security entry that lived here set the
     keyword to "home security systems near me" by hand — which is EXACTLY what
     the Search Term breakdown returns, so the generic rule covers it and a
     hand-maintained exception would only drift. Add an entry only when a prospect
     genuinely needs to differ from its own data. */
  var OVERRIDES = {};

  const profile = activeProfile();
  const ov = (profile && OVERRIDES[profile.id]) || {};
  const KEYWORD = ov.keyword || (profile ? deriveKeyword(profile) : null);

  /* THE EDITABLE STATE of this page. Derived from the prospect to begin with, then
     the in-page assistant (bottom of this file) may change any of these SIX
     fields and nothing else — which is what keeps rule 2 true here by
     construction rather than by asking the model nicely. Persisted per prospect
     so an edit survives a reload, like the platform's AI layer. */
  const FIELDS = ["keyword", "campaign", "adGroup", "conversion", "impressions", "clicks"];
  const DEFAULTS = {
    keyword: KEYWORD,
    campaign: null,                                  // the capture's "Non Brand Terms" stands
    adGroup: ov.adGroup || (profile ? deriveAdGroup(profile, KEYWORD) : null),
    conversion: ov.conversionTerm || (profile ? deriveConversion(profile) : "Lead Booked"),
    impressions: null,                               // the capture's own numbers stand
    clicks: null,
  };
  const LS_AI = "invoca-demo:google-ads-ai::" + ((profile && profile.id) || "none");
  let S = Object.assign({}, DEFAULTS);
  let UNDO = [];
  try {
    const saved = JSON.parse(localStorage.getItem(LS_AI) || "null");
    if (saved && saved.state) { S = Object.assign({}, DEFAULTS, saved.state); UNDO = saved.undo || []; }
  } catch (e) { /* ignore */ }
  const saveAi = () => {
    try { localStorage.setItem(LS_AI, JSON.stringify({ state: S, undo: UNDO })); } catch (e) { /* ignore */ }
  };

  /* ---- DOM handles -------------------------------------------------------- */
  const kwEl = document.querySelector('ess-cell[essfield="keyword_text"] keyword-text div[dir="ltr"]');
  const segEl = document.querySelector('ess-cell[essfield="segmentation_info"] segmentation-cell');
  const closestRow = (el) => (el ? el.closest(".particle-table-row") : null);
  const kwRow = closestRow(kwEl);
  const segRow = closestRow(segEl);
  const statEllipsis = (row, field) => (row ? row.querySelector('ess-cell[essfield="' + field + '"] .ess-cell-ellipsis, ess-cell[essfield="' + field + '"] stats-field') : null);

  /* The ad group and campaign cells are LINKS in the capture ("Shades", "Non Brand
     Terms"); replace only their text so the link styling survives. */
  const agEl = document.querySelector('ess-cell[essfield="ad_group_name"] a, ess-cell[essfield="ad_group_name"] .ess-cell-ellipsis');
  const cpEl = document.querySelector('ess-cell[essfield="campaign_name"] a, ess-cell[essfield="campaign_name"] .ess-cell-ellipsis');

  /* ---- 1 + 3: write the re-skinned identity cells ------------------------- */
  /* The CAPTURE'S OWN text, snapshotted before anything is written over it.

     A null field means "leave the captured value alone", and without these
     originals undo could not honour that: reverting impressions from 4,120 back
     to null left 4,120 on screen, because the write was skipped rather than
     restored. Undo has to put the page back, not just stop changing it. */
  const imprEl = statEllipsis(kwRow, "stats.impressions");
  const clkEl = statEllipsis(kwRow, "stats.clicks");
  const ORIGINAL = {
    keyword: kwEl ? kwEl.textContent : null,
    adGroup: agEl ? agEl.textContent : null,
    campaign: cpEl ? cpEl.textContent : null,
    impressions: imprEl ? imprEl.textContent : null,
    clicks: clkEl ? clkEl.textContent : null,
  };

  function renderIdentity() {
    const put = (el, key) => { if (el) el.textContent = S[key] || ORIGINAL[key] || ""; };
    put(kwEl, "keyword");
    put(agEl, "adGroup");
    put(cpEl, "campaign");
    put(imprEl, "impressions");
    put(clkEl, "clicks");
  }

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
    renderIdentity();
    const pg = PAGES[page];

    // Let the segmentation row grow to fit stacked lines.
    if (segRow) { segRow.style.height = "auto"; segRow.style.minHeight = LH * pg.segs.length + "px"; }

    // Segmentation label column: stacked "<CT> (segment)" lines.
    if (segEl) {
      segEl.innerHTML = stack(pg.segs.map((s) => S.conversion + " (" + s[0] + ")"));
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

  /* ==========================================================================
     IN-PAGE AI + UNDO

     This page is a saved static document, not a React screen, so the platform's
     Ask AI drawer cannot render here. This is a compact equivalent: same
     /api/ai-assistant endpoint, same hover-revealed sparkle-and-undo pair, and
     the same three rules.

     Rule 2 is enforced STRUCTURALLY rather than by prompt: an edit is only
     applied when its path names one of the SIX fields in FIELDS and its value is
     a string or a number. There is no path from a reply to CSS, to the layout, or
     to any part of the page that is not one of those six cells — a model that
     tried to restyle the page could not, whatever it returned.
     ====================================================================== */
  const CSS = `
    .iga-zone{display:inline-flex;align-items:center;gap:14px;margin-right:14px}
    .iga-btn{border:0;background:none;padding:0;cursor:pointer;opacity:0;transition:opacity .15s;
      color:#fff;display:inline-flex;align-items:center;font-family:inherit}
    .iga-zone:hover .iga-btn,.iga-btn:focus-visible{opacity:1}
    .iga-btn-off{cursor:default}.iga-zone:hover .iga-btn-off{opacity:.38}
    /* The CAPTURE ships "Material Icons Extended", not "Material Icons" — asking
       for the latter left the ligature rendering as the literal text
       "auto_awesome", 119px wide. Use the font the page actually has, with the
       ligature settings the icon fonts need. */
    .iga-btn i{font-family:'Material Icons Extended','Google Material Icons','Material Icons';
      font-size:20px;font-style:normal;line-height:1;font-weight:normal;letter-spacing:normal;
      text-transform:none;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';
      -webkit-font-smoothing:antialiased}
    .iga-wrap{position:fixed;inset:0;z-index:2147483100;display:none}
    .iga-wrap.on{display:block}
    .iga-back{position:absolute;inset:0;background:rgba(15,23,42,.28)}
    .iga-panel{position:absolute;top:0;right:0;width:400px;max-width:92vw;height:100%;
      background:#fff;box-shadow:-8px 0 28px rgba(0,0,0,.18);display:flex;flex-direction:column;
      font-family:Roboto,Arial,sans-serif}
    .iga-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #e7e9eb}
    .iga-head b{font-size:15px;color:#15243e;font-weight:700}
    .iga-head small{display:block;color:#5b6577;font-weight:400;font-size:12px;margin-top:2px}
    .iga-x{margin-left:auto;cursor:pointer;color:#5b6577;font-family:'Material Icons';font-style:normal}
    .iga-body{flex:1;overflow-y:auto;padding:16px 18px;font-size:13.5px;line-height:1.5}
    .iga-hint{color:#5b6577}
    .iga-msg{margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#f5f6fa;color:#15243e}
    .iga-msg.me{background:#2666f9;color:#fff;margin-left:auto;max-width:85%}
    .iga-in{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e7e9eb}
    .iga-in textarea{flex:1;resize:none;border:1px solid #d9dee4;border-radius:8px;padding:9px 11px;
      font:inherit;font-size:13.5px;outline:none}
    .iga-in button{border:0;background:#2666f9;color:#fff;border-radius:8px;width:38px;cursor:pointer;
      font-family:'Material Icons';font-style:normal}
    .iga-in button:disabled{opacity:.45;cursor:default}
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  /* The two buttons, injected LEFT of the Google Ads SEARCH icon. Same
     hover-to-reveal contract as the platform top bar: they always hold their
     layout space and only fade, so the invisible zone is still hoverable. */
  const zone = document.createElement("span");
  zone.className = "iga-zone";
  zone.innerHTML =
    '<button class="iga-btn" id="iga-spark" title="Ask AI about this page"><i>auto_awesome</i></button>' +
    '<button class="iga-btn" id="iga-undo" title="Undo the last AI change on this page"><i>undo</i></button>';
  const searchBtn = document.querySelector(".place-search-and-icon-container");
  if (searchBtn && searchBtn.parentElement) searchBtn.parentElement.insertBefore(zone, searchBtn);

  const wrap = document.createElement("div");
  wrap.className = "iga-wrap";
  wrap.innerHTML =
    '<div class="iga-back"></div><aside class="iga-panel" role="dialog" aria-label="Ask AI">' +
    '<div class="iga-head"><b>Ask AI<small>Google Ads · ' +
      ((profile && profile.customerName) || "this page") + '</small></b><i class="iga-x">close</i></div>' +
    '<div class="iga-body"><p class="iga-hint">Change what this account shows: the keyword, the campaign or ad group, ' +
      'the conversion name, impressions or clicks. For example "change the ad group to Emergency Care" or ' +
      '"set impressions to 4,120". I change the data on this page only, never the styling.</p></div>' +
    '<div class="iga-in"><textarea rows="1" placeholder="Ask or change something…"></textarea>' +
    '<button title="Send">arrow_upward</button></div></aside>';
  document.body.appendChild(wrap);

  const $ = (sel) => wrap.querySelector(sel);
  const body = $(".iga-body"), ta = $("textarea"), send = $(".iga-in button");
  const undoBtn = document.getElementById("iga-undo");

  const syncUndo = () => {
    undoBtn.classList.toggle("iga-btn-off", UNDO.length === 0);
    undoBtn.disabled = UNDO.length === 0;
  };
  syncUndo();

  const open = (on) => wrap.classList.toggle("on", on);
  document.getElementById("iga-spark").addEventListener("click", () => { open(true); setTimeout(() => ta.focus(), 80); });
  $(".iga-x").addEventListener("click", () => open(false));
  $(".iga-back").addEventListener("click", () => open(false));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });

  undoBtn.addEventListener("click", () => {
    if (!UNDO.length) return;
    S = UNDO.pop();
    saveAi(); render(); syncUndo();
  });

  function say(text, mine) {
    const d = document.createElement("div");
    d.className = "iga-msg" + (mine ? " me" : "");
    d.textContent = text;
    const hint = body.querySelector(".iga-hint");
    if (hint) hint.remove();
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  /* Rule 2, in code: only the six known fields, only scalar values. */
  function applyEdits(edits) {
    const next = Object.assign({}, S);
    let n = 0;
    for (const e of edits || []) {
      const key = String(e.path || "").split(/[.\[]/).filter(Boolean).pop();
      if (FIELDS.indexOf(key) === -1) continue;                    // not one of ours
      let v;
      try { v = JSON.parse(e.value); } catch (err) { v = e.value; }
      if (typeof v !== "string" && typeof v !== "number") continue; // no objects, no arrays
      /* The stats columns are thousands-separated in the capture ("1,560"), so a
         bare 4120 from the model would read as a different account's formatting. */
      next[key] = (key === "impressions" || key === "clicks")
        ? Number(String(v).replace(/[^\d.]/g, "") || 0).toLocaleString("en-US")
        : String(v);
      n++;
    }
    if (n) {
      UNDO.push(Object.assign({}, S));
      if (UNDO.length > 50) UNDO.shift();
      S = next; saveAi(); render(); syncUndo();
    }
    return n;
  }

  async function ask() {
    const q = ta.value.trim();
    if (!q || send.disabled) return;
    ta.value = ""; say(q, true);
    send.disabled = true;
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: (profile && profile.customerName) || "this prospect",
          dashboardTitle: "Google Ads · Search Keywords",
          dataContext: JSON.stringify(S),
          question: q,
          focus: null,
          history: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data && data.error ? data.error : "Assistant failed.");
      const r = data.result || {};
      if (r.kind === "editData" && Array.isArray(r.edits) && r.edits.length) {
        const n = applyEdits(r.edits);
        say(n ? (r.answer || "Updated " + n + " value" + (n > 1 ? "s" : "") + " on this page.")
              : "I can only change the keyword, campaign, ad group, conversion name, impressions or clicks on this page.");
      } else {
        say(r.answer || "…");
      }
    } catch (err) {
      say((err && err.message) || "Something went wrong.");
    } finally {
      send.disabled = false;
      ta.focus();
    }
  }
  send.addEventListener("click", ask);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
})();
