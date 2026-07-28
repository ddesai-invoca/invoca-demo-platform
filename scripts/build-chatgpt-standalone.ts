/* One-off: emit a SELF-CONTAINED html of the ChatGPT feature for one prospect.

   Everything is inlined as base64 — map images, hero photo, the OpenAI mark — so
   the file works from disk with no network and no API keys. That matters
   specifically because the Mapbox token is URL-restricted: a standalone page
   opened over file:// would be refused by Mapbox if it requested tiles live.

   States, in the order the user asked for: blank landing -> answer -> flyout ->
   expanded map. CSS is lifted verbatim from src/styles/standalone.css so the
   file looks identical to the app rather than being a re-implementation. */
import fs from "node:fs";
import path from "node:path";

const REPO = "/Users/ddesai/invoca-demo-platform";
const SLUG = process.argv[2] ?? "surfside-healthcare";
const OUT = process.argv[3] ?? `${process.env.HOME}/Downloads/chatgpt-${SLUG}.html`;

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const TOKEN = env.VITE_MAPBOX_TOKEN;

const p = JSON.parse(fs.readFileSync(path.join(REPO, `src/data/generated/${SLUG}.json`), "utf8"));
const r = p.reports;

/* --- the same derivations the screen makes, replicated for this one-off ---- */
const CITY_LL: Record<string, [number, number]> = {
  "santa barbara": [34.4208, -119.6982], orlando: [28.5383, -81.3792],
  dallas: [32.7767, -96.797], phoenix: [33.4484, -112.074],
  portland: [45.5152, -122.6784], "san francisco": [37.7749, -122.4194],
  "thousand oaks": [34.1706, -118.8376], "winter park": [28.6, -81.3392],
};
const shortArea = (raw?: string) => {
  if (!raw) return undefined;
  const s = raw.split(/[—(,;]/)[0].replace(/^\s*(the\s+)?(greater\s+)?/i, "")
    .replace(/\s+(metro(politan)?\s+)?area\s*$/i, "").trim();
  return s && s.length <= 34 ? s : undefined;
};
const vs = r.voiceScreenpop ?? {};
const stated = shortArea(r.agentConfig?.serviceArea)
  ?? (vs.city ? `${vs.city}${vs.state ? `, ${vs.state}` : ""}` : undefined);
const key = Object.keys(CITY_LL).find((k) => (stated ?? "").toLowerCase().includes(k));
const city = key ? stated! : "Santa Barbara, CA";
const [lat, lon] = CITY_LL[key ?? "santa barbara"];
const shortCity = city.split(",")[0].split(/\s*[–—-]\s*|\s+and\s+/i)[0].trim();

const products: string[] = (r.marketingDashboard.breakdowns
  .find((b: any) => /Product Category/i.test(b.title))?.rows ?? []).map((x: any) => x.name);
const hero = products[0] ?? p.industry;
const industrySeg = (ind: string) => {
  const head = ind.split(/[/,]/)[0].trim();
  const parts = head.split("&").map((x) => x.trim()).filter(Boolean);
  const pick = parts.find((x) => x.split(/\s+/).length >= 2) ?? parts[0] ?? ind;
  /* Cap at two words. "Ambulatory Healthcare Services" produced "Santa Barbara
     Ambulatory Healthcare Services", which reads like a directory entry rather
     than a business. The TAIL is the useful half ("Healthcare Services",
     "Care Services"); the leading qualifier is what makes it clumsy. */
  const words = pick.split(/\s+/);
  const capped = words.length > 2 ? words.slice(-2).join(" ") : pick;
  return capped.replace(/\b\w/g, (c) => c.toUpperCase());
};
const seg = industrySeg(p.industry);
const STOP = new Set(["group", "center", "centre", "clinic", "the", "and", "inc", "llc"]);
const sig = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
const brandWords = sig(p.customerName);
const collides = (n: string) => [...sig(n)].filter((w) => brandWords.has(w)).length >= 2;
const rivals = [`${shortCity} ${seg}`, `Premier ${seg}`, `${seg} of ${shortCity}`,
  `Summit ${seg}`, `Cornerstone ${seg}`, `First Choice ${seg}`]
  .filter((n) => !collides(n)).slice(0, 3);

const booking = p.bookingTerm.toLowerCase();
/* Prospect site + Invoca's opportunity-reference token, so the click is
   traceable back to the placement. URL() rather than concatenation so an
   existing query string survives. Mirrors trackedSiteUrl in ChatGptAd.tsx. */
const siteUrl = (() => {
  const u = new URL(`https://${p.brandDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`);
  u.searchParams.set("oppref", "gAAAAABqZosEcRIQ_xkq");
  return u.toString();
})();
const d = {
  brand: p.customerName, domain: p.brandDomain, industry: p.industry,
  icon: r.voiceRoutingDemo?.brandIcon ?? "◆",
  phone: vs.callerPhone ?? "(805) 555-0142",
  caller: (vs.callerName ?? "A").split(/\s+/)[0],
  initials: (vs.callerName ?? "A").split(/\s+/).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase(),
  query: `best ${hero.toLowerCase()} near me`,
  hero, others: products.slice(1, 4), city, shortCity,
  offer: `${p.bookingTerm} availability this week`, booking,
  address: `${shortCity}${vs.state ? `, ${vs.state}` : ""}`,
  places: [
    { name: p.customerName, rating: "4.9", type: hero, prospect: true,
      a: `Books ${booking}s over the phone, usually with same-week availability.`,
      b: "Strong reviews for getting people booked in quickly." },
    { name: rivals[0], rating: "4.7", type: seg, prospect: false,
      a: "Long-established locally, with a high volume of reviews.",
      b: "Good if you want to talk options through in person first." },
    { name: rivals[1], rating: "4.6", type: seg, prospect: false,
      a: "Competitive on price, though waits can run longer at busy times.",
      b: "Worth a call if budget is the deciding factor." },
    { name: rivals[2], rating: "4.4", type: seg, prospect: false,
      a: "Broad range of services, less specialised in any one of them.",
      b: "Fine for something straightforward." },
  ],
};

/* --- inline every remote asset as a data URI ------------------------------ */
async function dataUri(url: string, label: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" },
    });
    if (!res.ok) { console.warn(`  ! ${label}: HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
    console.log(`  ✓ ${label}: ${(buf.length / 1024).toFixed(0)}KB`);
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch (e) {
    console.warn(`  ! ${label}: ${(e as Error).message}`);
    return null;
  }
}

const staticMap = (z: number, w: number, h: number) =>
  `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/${lon},${lat},${z},0/${w}x${h}@2x`
  + `?access_token=${TOKEN}&logo=false&attribution=false`;

async function main() {
console.log("Inlining assets…");
const [mapInline, mapExpanded, heroImg, mark, favicon] = await Promise.all([
  dataUri(staticMap(12, 1000, 300), "inline map"),
  dataUri(staticMap(14, 1000, 640), "expanded map"),
  (async () => {
    const og = await fetch(`http://localhost:5173/api/og-image?domain=${d.domain}`)
      .then((x) => x.json()).catch(() => ({ url: null }));
    return og.url ? dataUri(og.url, "hero photo") : null;
  })(),
  Promise.resolve(`data:image/svg+xml;base64,${Buffer.from(
    fs.readFileSync(path.join(REPO, "public/chatgpt/mark.svg"))).toString("base64")}`),
  dataUri(`https://www.google.com/s2/favicons?sz=128&domain=${d.domain}`, "site icon"),
]);

const iconFont = `data:font/woff2;base64,${Buffer.from(
  fs.readFileSync(path.join(REPO, "public/fonts/material-icons.woff2"))).toString("base64")}`;
console.log(`  ✓ icon font: ${(fs.statSync(path.join(REPO, "public/fonts/material-icons.woff2")).size / 1024).toFixed(0)}KB`);

/* --- the app's own CSS, verbatim ------------------------------------------ */
const css = fs.readFileSync(path.join(REPO, "src/styles/standalone.css"), "utf8");
const cgCss = css.slice(css.indexOf("/* ===================== CHATGPT SPONSORED PLACEMENT"));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const chip = (t: string) => `<span class="wf-chip">${esc(t)}</span>`;
void chip;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT sponsored placement — ${esc(d.brand)}</title>
<link rel="icon" href="${favicon ?? mark}">
<style>
/* Material Icons inlined from public/fonts rather than linked from Google, so
   the file needs no network at all. Without this, every icon renders as its
   literal ligature text ("expand_more") when offline. */
@font-face{font-family:'Material Icons';font-style:normal;font-weight:400;
  src:url(${iconFont}) format('woff2')}

*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}
.material-icons{font-family:'Material Icons';font-style:normal;font-size:24px;line-height:1;
  letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;
  word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
${cgCss}
/* standalone-only: state switching + assets baked in */
[hidden]{display:none!important}
.cg-mapbox,.cg-exp-map{width:100%;height:100%;object-fit:cover;display:block}
.cg-fly-hero-photo .cg-fly-photo{width:100%;height:100%;object-fit:cover}
.sa-note{position:fixed;bottom:6px;left:66px;font-size:11px;color:#ffffff5c;z-index:60}
</style></head><body>
<div class="cg-root" id="root">
  <nav class="cg-rail">
    <a class="cg-rail-mark" href="#" onclick="return reset()"><img src="${mark}" width="24" height="25" alt=""></a>
    <button class="cg-rail-btn" onclick="reset()" title="New chat"><span class="material-icons" style="font-size:20px">edit_square</span></button>
    <button class="cg-rail-btn" title="Search"><span class="material-icons" style="font-size:20px">search</span></button>
    <button class="cg-rail-btn" title="Library"><span class="material-icons" style="font-size:20px">chat_bubble_outline</span></button>
    <span class="cg-avatar">${esc(d.initials)}</span>
  </nav>

  <div class="cg-main">
    <header class="cg-top">
      <span class="cg-top-name">ChatGPT<span class="material-icons" style="font-size:16px;color:#ffffff94">expand_more</span></span>
      <span class="cg-top-right">
        <span class="cg-upgrade"><span class="cg-spark">✦</span>Upgrade</span>
        <span class="cg-panel"><span class="material-icons" style="font-size:20px">view_sidebar</span></span>
      </span>
    </header>

    <!-- 1. blank landing state -->
    <div class="cg-splash" id="splash">
      <h1 class="cg-headline">What&rsquo;s on your mind today?</h1>
      <form class="cg-composer" onsubmit="return ask()">
        <button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">add</span></button>
        <input class="cg-input" id="q" placeholder="Ask anything" autocomplete="off">
        <button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">mic_none</span></button>
        <button type="submit" class="cg-voice" aria-label="Send"><span></span><span></span><span></span><span></span></button>
      </form>
      <div class="cg-chips">
        <button class="cg-chip"><span class="material-icons" style="font-size:20px">image</span><span>Create an image</span></button>
        <button class="cg-chip"><span class="material-icons" style="font-size:20px">edit</span><span>Write or edit</span></button>
        <button class="cg-chip"><span class="material-icons" style="font-size:20px">public</span><span>Search the web</span></button>
      </div>
    </div>

    <!-- 2. answer state -->
    <div class="cg-thread" id="thread" hidden>
      <div class="cg-user"><span id="asked"></span></div>

      <div class="cg-think" id="think" hidden>
        <span class="cg-think-label">Searching the web</span>
        <span class="cg-think-dots"><i></i><i></i><i></i></span>
      </div>

      <div id="results">
      <div class="cg-map">
        ${mapInline ? `<img class="cg-mapbox" src="${mapInline}" alt="Map of ${esc(d.city)}">` : `<div class="cg-map-offline"></div>`}
        ${d.places.slice(0, 3).map((pl, i) => `
        <div class="cg-pin" style="left:${[50, 68, 33][i]}%;top:${[28, 44, 52][i]}%">
          <span class="cg-pin-badge">★ ${pl.rating}</span>
          <span class="cg-pin-label">${esc(pl.name)}</span>
        </div>`).join("")}
        <button class="cg-map-expand">Expand <span class="material-icons" style="font-size:13px">open_in_full</span></button>
        <span class="cg-map-attr">© Mapbox © OpenStreetMap</span>
        <div class="cg-places">
          ${d.places.slice(0, 2).map((pl) => `
          <div class="cg-place${pl.prospect ? " cg-place-open-btn" : ""}"${pl.prospect ? ' onclick="expand()"' : ""}>
            <span class="cg-place-img${pl.prospect ? "" : " cg-place-img-alt"}">${
              pl.prospect && favicon ? `<img src="${favicon}" alt="">` : `<span class="material-icons" style="font-size:22px;color:#ffffff9e">store</span>`}</span>
            <span class="cg-place-txt">
              <span class="cg-place-name">${esc(pl.name)}</span>
              <span class="cg-place-meta">★ ${pl.rating} • ${esc(pl.type)}</span>
              <span class="cg-place-open">Open now</span>
            </span>
          </div>`).join("")}
        </div>
      </div>
      <div class="cg-feedback">Give feedback</div>

      <div class="cg-answer">
        <!-- Matches the app exactly: a single lead-in, then the results. An
             earlier draft of this file carried a generic "three things worth
             checking" intro plus bullets that the app does not have. -->
        <p>If you&rsquo;re in the ${esc(d.city)} area, here are some well-rated options nearby:</p>
        <ol class="cg-list">
          ${d.places.map((pl) => `<li>
            <span class="cg-list-name${pl.prospect ? " cg-list-open" : ""}"${pl.prospect ? ' onclick="openFly()"' : ""}>${esc(pl.name)}</span>
            <span class="cg-list-city">(${esc(d.shortCity)})</span>
            <ul><li>${esc(pl.a)}</li><li>${esc(pl.b)}</li></ul></li>`).join("")}
        </ol>
        <p>If you mainly want this <strong>sorted quickly</strong>, ${esc(d.brand)} is the one
          most people call first, they&rsquo;ll give you a firm number over the phone rather than
          a range, and they cover ${esc(d.shortCity)}.</p>
        <p>If you tell me:</p>
        <ul><li>what you need it for, and</li><li>your <strong>budget</strong>,</li></ul>
        <p>I can narrow this down to the best option for you and estimate the total cost.</p>
      </div>

      <div class="cg-loc"><span class="material-icons" style="font-size:14px">place</span>${esc(d.shortCity)}
        &nbsp;•&nbsp;<span class="cg-loc-link">Use precise location</span></div>

      <div class="cg-toolrow">
        ${["content_copy", "thumb_up_off_alt", "thumb_down_off_alt", "ios_share", "refresh"]
          .map((i) => `<span class="cg-tool"><span class="material-icons" style="font-size:17px">${i}</span></span>`).join("")}
        <span class="cg-tool cg-dots">···</span><span class="cg-sources">Sources</span>
      </div>

      <div class="cg-adwrap">
        <div class="cg-ad" onclick="openFly()">
          <div class="cg-ad-logo">${esc(d.icon)}</div>
          <div class="cg-ad-body">
            <div class="cg-ad-row"><span class="cg-ad-domain">${esc(d.domain)}</span><span class="cg-ad-badge">Ad</span></div>
            <div class="cg-ad-head">${esc(d.offer)}, book by phone in under a minute</div>
            <div class="cg-ad-sub">Speak to a specialist about ${esc(d.hero.toLowerCase())}${
              d.others.length ? `, ${esc(d.others.join(", ").toLowerCase())}` : ""} and what it&rsquo;ll actually cost, no obligation.</div>
            <div class="cg-ad-actions">
              <a class="cg-call" href="tel:${d.phone.replace(/[^\d+]/g, "")}"><span class="material-icons">call</span>${esc(d.phone)}</a>
              <button class="cg-visit">Visit site</button>
            </div>
          </div>
        </div>
        <p class="cg-adnote">Ads do not influence the answers you get from ChatGPT. Your chats stay private.
          <span class="cg-loc-link">Learn about ads and personalization &rsaquo;</span></p>
      </div>
      <p class="cg-mistakes">ChatGPT can make mistakes. Check important info.</p>
      </div>
    </div>

    <div class="cg-dock" id="dock" hidden>
      <form class="cg-composer" onsubmit="return ask()">
        <button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">add</span></button>
        <input class="cg-input" placeholder="Ask anything" autocomplete="off">
        <button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">mic_none</span></button>
        <button type="submit" class="cg-voice" aria-label="Send"><span></span><span></span><span></span><span></span></button>
      </form>
      <p class="cg-disclaimer">Demo mock-up of a sponsored placement, not a live ChatGPT session.</p>
    </div>
  </div>

  <!-- 4. expanded map -->
  <div class="cg-exp" id="exp" hidden>
    ${mapExpanded ? `<img class="cg-exp-map" src="${mapExpanded}" alt="Map of ${esc(d.city)}">` : `<div class="cg-map-offline"></div>`}
    <div class="cg-exp-pin"><span class="cg-pin-badge">★ 4.9</span><span class="cg-pin-label">${esc(d.brand)}</span></div>
    <button class="cg-exp-close" onclick="collapse()" aria-label="Close map"><span class="material-icons" style="font-size:18px">close</span></button>
    <div class="cg-exp-zoom"><button>+</button><button>−</button></div>
    <span class="cg-exp-open">Open Now</span>
    <span class="cg-map-attr cg-exp-attr">© Mapbox © OpenStreetMap</span>
    <div class="cg-exp-dock">
      <button class="cg-exp-collapse" onclick="collapse()" aria-label="Collapse map"><span class="material-icons" style="font-size:18px">keyboard_arrow_up</span></button>
      <form class="cg-composer" onsubmit="return false"><button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">add</span></button>
        <input class="cg-input" placeholder="Ask anything"><button type="button" class="cg-cbtn"><span class="material-icons" style="font-size:20px">mic_none</span></button>
        <button type="submit" class="cg-voice"><span></span><span></span><span></span><span></span></button></form>
    </div>
  </div>

  <!-- 3. business flyout -->
  <aside class="cg-fly" id="fly" hidden>
    <button class="cg-fly-close" id="flyBtn" onclick="closeFly()" aria-label="Close"><span class="material-icons" style="font-size:18px" id="flyIcon">close</span></button>
    <div class="cg-fly-hero${heroImg ? " cg-fly-hero-photo" : ""}">
      ${heroImg ? `<img class="cg-fly-photo" src="${heroImg}" alt="">`
        : favicon ? `<img src="${favicon}" alt="">` : `<span>${esc(d.icon)}</span>`}
    </div>
    <div class="cg-fly-body">
      <h2 class="cg-fly-name">${esc(d.brand)}</h2>
      <div class="cg-fly-rate"><strong>4.9</strong><span class="cg-fly-stars">★★★★★</span><span>• ${esc(d.hero)}</span></div>
      <div class="cg-fly-actions"><button>Directions</button>
        <a href="${siteUrl}" target="_blank" rel="noopener noreferrer">Website</a>
        <a class="cg-fly-call" href="tel:${d.phone.replace(/[^\d+]/g, "")}">Call</a></div>
      <div class="cg-fly-row"><span class="material-icons" style="font-size:16px">schedule</span>
        <span><span class="cg-open">Open</span> until 6:00 PM</span>
        <span class="material-icons" style="font-size:15px">expand_more</span></div>
      <div class="cg-fly-row"><span class="material-icons" style="font-size:16px">place</span><span>${esc(d.address)}</span></div>
      <div class="cg-fly-row"><span class="material-icons" style="font-size:16px">call</span><span>${esc(d.phone)}</span></div>
      <p class="cg-fly-desc">${esc(d.brand)} is ${/^[aeiou]/i.test(seg) ? "an" : "a"} ${esc(seg.toLowerCase())} provider
        serving ${esc(d.shortCity)} and the surrounding area, offering ${esc(d.hero.toLowerCase())}${
          d.others.length ? `, ${esc(d.others.join(", ").toLowerCase())}` : ""}.
        Bookings are taken by phone, with ${esc(d.booking)}s usually available the same week.</p>
      <h3 class="cg-fly-h">What people say</h3>
      <div class="cg-fly-score"><strong>4.9</strong><span class="cg-fly-stars">★★★★★</span></div>
      <ul class="cg-fly-list">
        <li>Reviewers consistently mention <strong>short wait times</strong> and being able to get booked in quickly.</li>
        <li>Staff are described as <strong>knowledgeable and easy to deal with</strong> on the phone.</li>
        <li>Pricing is regularly called out as <strong>clear and quoted up front</strong>.</li>
      </ul>
      <h3 class="cg-fly-h">Services</h3>
      <p class="cg-fly-desc">${esc([d.hero, ...d.others].join(", "))}. Enquiries and bookings are handled by phone,
        and the team can talk through options and pricing on the call.</p>
      <h3 class="cg-fly-h">Good to know</h3>
      <ul class="cg-fly-list">
        <li><strong>Calling ahead</strong> is the fastest route, ${esc(d.booking)}s are confirmed on the call.</li>
        <li>Covers ${esc(d.shortCity)} and the surrounding area.</li>
      </ul>
      <p class="cg-fly-note">Demo mock-up, not a real listing.</p>
    </div>
  </aside>
</div>
<span class="sa-note">Standalone demo · ${esc(d.brand)} · all assets embedded, works offline</span>

<script>
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).hidden = !on;
function ask(){
  const v = ($('q').value || '').trim() || ${JSON.stringify(d.query)};
  $('asked').textContent = v;
  show('splash', false); show('thread', true); show('dock', true);
  // a beat of "thinking" before the results, same as the app
  show('think', true); show('results', false);
  setTimeout(function(){ show('think', false); show('results', true); }, 1700);
  return false;
}
function openFly(){ $('flyIcon').textContent='close'; $('fly').classList.remove('cg-fly-back'); show('fly', true); }
function expand(){
  show('exp', true); show('fly', true);
  $('flyIcon').textContent = 'chevron_left';
  $('flyBtn').classList.add('cg-fly-back');
  $('root').classList.add('cg-root-flyout');
}
function collapse(){ show('exp', false); show('fly', false); $('flyBtn').classList.remove('cg-fly-back'); $('root').classList.remove('cg-root-flyout'); }
function closeFly(){ if(!$('exp').hidden) return collapse(); show('fly', false); }
function reset(){ show('think', false); show('results', true); collapse(); show('fly', false); show('thread', false); show('dock', false); show('splash', true); $('q').value=''; return false; }
</script>
</body></html>`;

fs.writeFileSync(OUT, html);
console.log(`\nWrote ${OUT}`);
console.log(`Size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
}
main();
