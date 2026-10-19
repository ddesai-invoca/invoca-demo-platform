/* =============================================================================
   brandLogo — the prospect's own logo, for the RCS sender avatar (10/19/2026)
   -----------------------------------------------------------------------------
   Asked for against the RCS thread's "AP" tile: *"get the prospect's actual logo and use that"*,
   then, after an audit of 97 prospects: *"make sure they all have their logo, and fix it for them
   and all others too"*.

   ⚠️ THE SITE'S OWN ART, NOT GOOGLE'S FAVICON SERVICE FIRST. That service often hands back a 16px
   favicon scaled up. A site that cares publishes an apple-touch-icon (180px, square, on its own
   background: exactly an app-icon tile, which is what an RCS avatar is), a web-app manifest, or a
   large `<link rel=icon>`. Every candidate is fetched and its REAL dimensions read from its bytes,
   so a 404 page served as `.png` or a 16px icon cannot pass as a logo.

   ⚠️⚠️ WHAT THE 97-PROSPECT AUDIT FOUND (17 got initials, 19 Google's service), and the fix for
   each, in the order `pick` prefers them:
   1. AVIF WAS READ AS "NOT AN IMAGE". Kia's CDN content-negotiates its 256px apple-touch-icon to
      AVIF because the request said it accepted AVIF; `imageSize` did not know the format and
      returned 0. AVIF is parsed now (its `ispe` box), and AVIF is no longer asked for.
   2. MANY SITES ONLY SHIP A 16–32px FAVICON (Truist, Citizens Bank, Brink's, Denver Health,
      Christian Brothers…) and NOTHING bigger anywhere — Google's and DuckDuckGo's services return
      the same 16px file. Their real logo is the image in the site HEADER (and often the og:image,
      when its filename says "logo"), so those are candidates now.
   3. SOME SITES BLOCK A SERVER (Orlando Health 429, Mitel / Crescent / SCI / Blackhawk 403), so
      no icon was ever declared to us. The homepage is then read through the same page-render
      service the Replicate feature uses (Browserless), when it is configured.
   4. A SMALL ICON IS STILL THE BRAND'S MARK. A 32px favicon beats initials; the CLIENT draws it
      at a size that stays crisp instead of stretching it across the tile (see `RcsAvatar`).

   Same SSRF guard and cache shape as `ogImage.ts`: the domain comes from the browser, so only a
   public-looking host is ever fetched, and misses are cached so a blocked site is asked once.
   ============================================================================= */

const cache = new Map<string, string | null>();

function isPublicHost(host: string): boolean {
  if (!host.includes(".") || host.endsWith(".local")) return false;
  if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i.test(host)) return false;
  if (/^(10|127)\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
/* No AVIF in the Accept header: a CDN that negotiates (Kia's does) would otherwise answer every
   probe in a format older code could not read. AVIF is still PARSED, for a site that only has it. */
const IMG_ACCEPT = "image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5";

async function get(url: string, accept: string, ms = 5000): Promise<Response | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" } });
    clearTimeout(t);
    return res.ok ? res : null;
  } catch { return null; }
}

export interface Dims {
  w: number; h: number; svg?: boolean;
  /** An SVG whose every declared colour is white: a logo made for a dark header, invisible on the
      avatar's white tile (UT Southwestern's). */
  light?: boolean;
  /** An SVG that recolours itself for dark mode (PMG's favicon turns white), so it can vanish on
      the white tile whenever the viewer's device is dark. */
  adaptive?: boolean;
}

/** The image's real pixel dimensions from its own bytes; null when it is not an image at all (an
    HTML error page served under a .png name, which header checks let through). An SVG reports its
    viewBox (or width/height) with `svg: true`, since it is sharp at any size. */
export function imageDims(buf: Uint8Array): Dims | null {
  const n = buf.length;
  const u16 = (i: number) => buf[i] << 8 | buf[i + 1];
  const u32 = (i: number) => (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
  const le16 = (i: number) => buf[i] | buf[i + 1] << 8;
  const le24 = (i: number) => buf[i] | buf[i + 1] << 8 | buf[i + 2] << 16;
  if (n >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (n >= 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {               // ICO: largest entry
    let best: Dims | null = null;
    for (let k = 0; k < le16(4) && 6 + k * 16 + 1 < n; k++) {
      const w = buf[6 + k * 16] || 256, h = buf[7 + k * 16] || 256;
      if (!best || w * h > best.w * best.h) best = { w, h };
    }
    return best;
  }
  if (n >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {                                           // JPEG: scan for SOFn
    for (let i = 2; i < n - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  if (n >= 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {    // WebP
    const tag = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (tag === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
    if (tag === "VP8L") { const b = buf.subarray(21); return { w: 1 + ((b[1] & 0x3f) << 8 | b[0]), h: 1 + ((b[3] & 0xf) << 10 | b[2] << 2 | (b[1] & 0xc0) >> 6) }; }
    if (tag === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    return { w: 128, h: 128 };
  }
  if (n >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { w: le16(6), h: le16(8) }; // GIF
  if (n >= 12 && String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) === "ftyp") {              // AVIF / HEIF
    for (let i = 8; i < Math.min(n, 4096) - 16; i++) {
      if (buf[i] === 0x69 && buf[i + 1] === 0x73 && buf[i + 2] === 0x70 && buf[i + 3] === 0x65) return { w: u32(i + 8), h: u32(i + 12) };
    }
    return { w: 128, h: 128 };
  }
  const head = new TextDecoder().decode(buf.slice(0, 2000)).trimStart();
  const lower = head.toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype[^>]*>\s*)?<svg\b/.test(lower) || (lower.startsWith("<?xml") && lower.includes("<svg"))) {
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? "";
    const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    const w = Number(/\bwidth=["']?([\d.]+)/i.exec(tag)?.[1]), h = Number(/\bheight=["']?([\d.]+)/i.exec(tag)?.[1]);
    const dims = vb ? { w: Number(vb[1]), h: Number(vb[2]) } : w && h ? { w, h } : { w: 1, h: 1 };
    const text = new TextDecoder().decode(buf.slice(0, 200_000)).toLowerCase();
    const colours = [...text.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|white|rgb\([^)]*\)|[a-z]+)/g)]
      .map((m) => m[1]).filter((c) => !/^(none|transparent|currentcolor|inherit|url)$/.test(c));
    const whiteish = (c: string) => /^(white|#fff|#ffff|#ffffff|#ffffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/.test(c);
    const light = colours.length > 0 && colours.every(whiteish);
    return { ...dims, svg: true, light, adaptive: /prefers-color-scheme/.test(text) };
  }
  return null;
}

/** Back-compat: the short side in px, Infinity for SVG, 0 when it is not an image. */
export function imageSize(buf: Uint8Array): number {
  const d = imageDims(buf);
  if (!d) return 0;
  return d.svg ? Infinity : Math.min(d.w, d.h);
}

async function probe(url: string): Promise<Dims | null> {
  if (url.startsWith("data:image/svg+xml;base64,")) return imageDims(new Uint8Array(Buffer.from(url.slice(26), "base64")));
  if (url.startsWith("data:")) return null;
  const res = await get(url, IMG_ACCEPT, 4500);
  if (!res) return null;
  try { return imageDims(new Uint8Array((await res.arrayBuffer()).slice(0, 600_000))); } catch { return null; }
}

interface Candidate { url: string; score: number }

/* One attribute's value. A quoted value may be EMPTY: reading `alt=""` through the unquoted branch
   returned the two quote characters as the alt text, which made Brink's header logo look like it
   named something else. */
const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};
/** A Next.js `/_next/image?url=…` proxy link unwrapped to the image it serves. The proxy lives on
    the brand's own domain, which may block a server (Orlando Health's does) while the original
    file on its asset host loads fine. */
const unwrap = (u: string): string => {
  try { const x = new URL(u); const inner = x.pathname.endsWith("/_next/image") ? x.searchParams.get("url") : null; return inner ? new URL(inner, x).toString() : u; } catch { return u; }
};
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/");

/** The icons a page declares, best first. Exported for the audit. */
export function rankIcons(html: string, base: string): string[] {
  const out: Candidate[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const sizes = attr(tag, "sizes") ?? "";
    const px = Math.max(0, ...sizes.split(/\s+/).map((s) => Number(s.split("x")[0]) || 0));
    const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(attr(tag, "type") ?? "");
    let score = px || (svg ? 256 : 32);
    if (/apple-touch-icon/.test(rel)) score = Math.max(score, 180) + 1000;   // square app tile: the right shape
    if (px && px < 64) score -= 500;                                         // a 16/32px favicon blurs at 56px
    try { out.push({ url: new URL(decode(href), base).toString(), score }); } catch { /* bad href */ }
  }
  return [...new Set(out.sort((a, b) => b.score - a.score).map((c) => c.url))];
}

/** The page's own brand logo images: the header/home-link `<img>` whose class, id, alt or file
    name says logo (or names the brand), then an og:image whose file name says logo. These are what
    a site with only a 16px favicon actually draws as its logo. Exported for the audit. */
export function rankLogos(html: string, base: string, brand = ""): string[] {
  const out: Candidate[] = [];
  /* The WHOLE brand has to appear, not one word of it: "orlando" alone matched the Orlando City
     soccer club's logo on Orlando Health's homepage. Either every significant word, or the name
     run together the way file names write it ("orlandohealth", "valetliving"). */
  const words = brand.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(and|the|inc|llc|corp|co|of)$/.test(w));
  const brandWord = words.length ? "x" : "";
  const named = (hay: string) => !!words.length && (words.every((w) => hay.includes(w)) || hay.replace(/[^a-z0-9]/g, "").includes(words.join("")));
  /* One distinctive word ("citizens" in Citizens Bank's logo-citizens.svg) still counts, ranked
     below the full name, so a sponsor that shares one word cannot outrank the brand's own. */
  const partly = (hay: string) => words.some((w) => w.length >= 5 && hay.includes(w));
  const headerEnd = (() => { const i = html.search(/<\/header>|<main\b/i); return i > 0 ? i : 60_000; })();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src") && !/^data:/i.test(attr(tag, "src")!) ? attr(tag, "src") : attr(tag, "data-src") ?? attr(tag, "srcset")?.split(/[\s,]+/)[0];
    if (!src || /^data:/i.test(src)) continue;
    /* The file PATH, never the host: every image on valetliving.com has "valet" in its URL, which
       made a client's logo look like the brand's own. */
    const path = src.replace(/^(https?:)?\/\/[^/]+/i, "");
    const hay = [attr(tag, "class"), attr(tag, "id"), attr(tag, "alt"), path].join(" ").toLowerCase();
    /* ⚠️ "logo" HAS TO BE SAID. An earlier version also accepted an image whose alt merely named
       the brand, and the 97-prospect audit showed what that buys: hero photos (Baptist Health,
       Children's Health, Mutual of Omaha), a product shot (Saatva), a service tile (CHRISTUS). */
    if (!/logo|wordmark/.test(hay)) continue;
    /* …in the image's OWN name, class or alt, not merely its folder: Intermedia keeps its product
       marks ("Unite") under /logos/. */
    const fileName = (path.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase();
    if (!/logo|wordmark/.test([attr(tag, "class"), attr(tag, "id"), attr(tag, "alt"), fileName].join(" ").toLowerCase()) && !named(hay)) continue;
    /* A white or "reversed" version is made for a dark header and vanishes on the white tile
       (National Van Lines' logo-white.svg, Valet Living's _WHT.png); the colour version is
       usually on the same page. */
    if (/(^|[-_ .\/])(wht|white|reverse[ds]?|inverse|inverted|knock-?out|negative)([-_ .@]|$)/.test(hay)) continue;
    /* A long description is a photo caption, not a logo's alt text: Mutual of Omaha's hero photo
       is described as "…with the wild kingdom logo above them". */
    if ((attr(tag, "alt") ?? "").trim().split(/\s+/).length > 6) continue;
    /* An alt that names something else is somebody else's logo: Mitel's homepage shows its
       customers' (alt "HYATT", "Carlsberg"). */
    const alt = (attr(tag, "alt") ?? "").toLowerCase().trim();
    if (alt && brandWord && !named(alt) && !partly(alt) && !/logo|home/.test(alt)) continue;
    /* Another company's logo shown as an integration or "works with" mark (Intermedia's header
       lists Google's), unless that company IS the brand. */
    if (/integration|works-?with|powered-?by|google|microsoft|salesforce|hubspot|zoom|slack|amazon|aws|apple/.test(hay) && !named(hay)) continue;
    /* …and it has to be THEIRS: in the page header, or carrying the brand's own name. Citizens
       Bank's only other "logo" image is the Equal Housing Lender mark in its disclosures. */
    const inHeader = (m.index ?? 0) < headerEnd;
    if (!inHeader && !named(hay) && !partly(hay)) continue;
    /* …and somebody else's logo is not theirs: the FDIC mark beside a bank's, a J.D. Power or
       analyst award, partner and certification badges, app-store buttons. */
    if (/sprite|partner|client|award|badge|seal|certif|accredit|fdic|ncua|equal-?housing|housing|lender|disclosure|compliance|jd-?power|aragon|gartner|forrester|bbb|trustpilot|footer|social|facebook|twitter|linkedin|instagram|youtube|app-?store|google-?play|payment|visa|mastercard|sponsor/.test(hay)) continue;
    let score = 40 + (inHeader ? 30 : 0) + (/\.svg(\?|$)/i.test(src) ? 10 : 0);
    if (named(hay)) score += 25; else if (partly(hay)) score += 10;
    if (/header|nav|site-?logo|navbar/.test(hay)) score += 10;
    /* The image's OWN name or class saying logo outranks a folder called "logos": Intermedia's
       header carries both its logo (intm-logo-wide.svg) and a product mark from /logos/. */
    if (/logo/.test((path.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase())) score += 15;
    if (/logo/.test([attr(tag, "class"), attr(tag, "id")].join(" ").toLowerCase())) score += 10;
    try { out.push({ url: unwrap(new URL(decode(src), base).toString()), score }); } catch { /* bad src */ }
    if (out.length >= 10) break;
  }
  const og = /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*>/i.exec(html)?.[0];
  const ogUrl = og && attr(og, "content");
  if (ogUrl && /logo|icon/i.test(ogUrl.replace(/^(https?:)?\/\/[^/]+/i, ""))) { try { out.push({ url: new URL(decode(ogUrl), base).toString(), score: 15 }); } catch { /* bad url */ } }
  return [...new Set(out.sort((a, b) => b.score - a.score).map((c) => c.url))];
}

/** A logo drawn INLINE in the page header (`<svg class="logo-svg">`), returned as a data URI.
    Children's Health links a logo file that is a 404 on its own site; the logo visitors see is
    an inline SVG. Exported for the audit. */
export function inlineSvgLogos(html: string, brand = ""): string[] {
  const brandWord = brand.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).find((w) => w.length >= 4) ?? "";
  const headerEnd = (() => { const i = html.search(/<\/header>|<main\b/i); return i > 0 ? i : 60_000; })();
  const out: string[] = [];
  for (const m of html.matchAll(/<svg\b[^>]*>/gi)) {
    if ((m.index ?? 0) > headerEnd) break;
    const tag = m[0];
    const hay = [attr(tag, "class"), attr(tag, "id"), attr(tag, "aria-label")].join(" ").toLowerCase();
    if (!/logo|wordmark/.test(hay) && !(brandWord && hay.includes(brandWord))) continue;
    const end = html.indexOf("</svg>", m.index);
    if (end < 0) continue;
    let svg = html.slice(m.index, end + 6);
    if (svg.length > 40_000 || /<use\b[^>]*href=["']#/i.test(svg)) continue;   // a sprite reference draws nothing on its own
    if (!/xmlns=/.test(svg)) svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    out.push(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    if (out.length >= 2) break;
  }
  return out;
}

/** The icons a web-app manifest lists, largest first. */
async function manifestIcons(html: string, base: string): Promise<string[]> {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\bmanifest\b/i.test(attr(t, "rel") ?? ""));
  const href = tag && attr(tag, "href");
  if (!href) return [];
  let url: string;
  try { url = new URL(decode(href), base).toString(); } catch { return []; }
  const res = await get(url, "application/manifest+json,application/json,*/*", 4000);
  if (!res) return [];
  try {
    const j = await res.json() as { icons?: { src?: string; sizes?: string; purpose?: string }[] };
    return (j.icons ?? [])
      .filter((i) => i.src && !/monochrome/.test(i.purpose ?? ""))
      .map((i) => ({ src: i.src!, px: Math.max(0, ...(i.sizes ?? "").split(/\s+/).map((s) => Number(s.split("x")[0]) || 0)) }))
      .sort((a, b) => b.px - a.px)
      .map((i) => new URL(i.src, url).toString());
  } catch { return []; }
}

/** The homepage, fetched directly (www and bare host at once, first answer wins), or through the
    render service when the site blocks a server. */
async function homepage(hosts: string[]): Promise<{ html: string; url: string } | null> {
  const direct = await new Promise<{ html: string; url: string } | null>((resolve) => {
    let left = hosts.length;
    for (const h of hosts) {
      get(`https://${h}`, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", 6000)
        .then(async (page) => { if (page) resolve({ html: (await page.text()).slice(0, 400_000), url: page.url }); else if (--left === 0) resolve(null); })
        .catch(() => { if (--left === 0) resolve(null); });
    }
  });
  if (direct) return direct;
  try {
    const { renderViaService, renderConfigured } = await import("./renderService.ts");
    if (!renderConfigured()) return null;
    const url = `https://${hosts[0]}/`;
    const r = await renderViaService(url, { quiet: true });
    return { html: r.html.slice(0, 400_000), url };
  } catch { return null; }
}

type Kind = "icon" | "logo";
interface Probed { url: string; kind: Kind; d: Dims }

/* ⚠️ The order of preference, and why. The avatar is a small SQUARE tile:
   1. a sharp square-ish icon (apple-touch, manifest, a big declared icon, Google's service when
      it has a real one) — the brand's own app tile, the right shape;
   2. the header logo, when it is not a long thin wordmark — the actual brand art;
   3. a 48px+ icon;
   4. a 32px+ icon — the brand's square mark beats a 5:1 wordmark squeezed into a circle;
   5. a long wordmark;
   6. a 16px icon, drawn small by the client rather than blown up. */
function pick(found: Probed[], brand = ""): string | null {
  const short = (p: Probed) => (p.d.svg ? Infinity : Math.min(p.d.w, p.d.h));
  const aspect = (p: Probed) => Math.max(p.d.w, p.d.h) / Math.max(1, Math.min(p.d.w, p.d.h));
  /* An all-white SVG is never usable on the white tile; a dark-mode-adaptive one only when there is
     nothing else at all. */
  const usable = found.filter((p) => !p.d.light);
  const steady = usable.filter((p) => !p.d.adaptive);
  const pool = steady.length ? steady : usable;
  const icons = pool.filter((p) => p.kind === "icon");
  /* A "logo" smaller than 80px on its long side (or an SVG drawn on a 24-unit icon grid) is an
     icon that happens to sit in the header, like Denver Health's careers briefcase. */
  const logos = pool.filter((p) => p.kind === "logo" && Math.max(p.d.w, p.d.h) >= (p.d.svg ? 48 : 80));
  const first = (list: Probed[], ok: (p: Probed) => boolean) => list.find(ok)?.url ?? null;
  /* ⚠️ ONLY THE BEST-RANKED LOGO IS EVER CONSIDERED. Taking the first one that happened to be the
     right shape let a lower-ranked image win on shape alone: Orlando Health's header logo is a
     wide wordmark, so the squarer Orlando City soccer badge further down the page took its place. */
  /* …except that a SQUARER version carrying the brand's full name in its own file name is
     preferred to a long wordmark: Orlando Health's header logo is 4.3:1 and unreadable in the tile,
     and the same site publishes Orlando-Health-2022-Vertical-RGB-Logo. A sponsor cannot qualify,
     because its file does not carry the brand's whole name. */
  const words = brand.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(and|the|inc|llc|corp|co|of)$/.test(w));
  const fullyNamed = (u: string) => {
    if (!words.length || u.startsWith("data:")) return false;
    const path = decodeURIComponent(u.replace(/^(https?:)?\/\/[^/]+/i, "")).toLowerCase();
    return words.every((w) => path.includes(w)) || path.replace(/[^a-z0-9]/g, "").includes(words.join(""));
  };
  const squarer = logos[0] && aspect(logos[0]) > 3.2
    ? logos.slice(1).find((p) => fullyNamed(p.url) && aspect(p) <= 3.2) : undefined;
  const top = squarer ? [squarer] : logos.slice(0, 1);
  return first(icons, (p) => short(p) >= 120 && aspect(p) <= 1.3)
    ?? first(top, (p) => aspect(p) <= 3.2)
    ?? first([...icons].sort((a, b) => short(b) - short(a)), (p) => short(p) >= 48)
    ?? first([...icons].sort((a, b) => short(b) - short(a)), (p) => short(p) >= 32)
    ?? first(top, () => true)
    ?? first([...icons].sort((a, b) => short(b) - short(a)), (p) => short(p) >= 16);
}

export async function fetchBrandLogo(domain: string, brand = ""): Promise<string | null> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  if (!host || !isPublicHost(host)) return null;
  if (cache.has(host)) return cache.get(host)!;
  const hosts = host.startsWith("www.") ? [host, host.slice(4)] : [`www.${host}`, host];

  /* ⚠️ THE CONVENTIONAL FILES AND GOOGLE'S SERVICE ARE PROBED AT ONCE, IN PARALLEL WITH THE
     HOMEPAGE, so there is always an answer. Done in sequence behind a slow homepage and a render,
     the audit measured lookups of 13 to 35 seconds and two (Claffey Pools, Citizens Bank) that ran
     out of time and came back with nothing. */
  const fallbacks: string[] = [];
  for (const h of hosts) fallbacks.push(`https://${h}/apple-touch-icon.png`, `https://${h}/apple-touch-icon-precomposed.png`);
  fallbacks.push(`https://www.google.com/s2/favicons?sz=256&domain=${encodeURIComponent(host)}`);
  for (const h of hosts) fallbacks.push(`https://${h}/favicon.ico`);
  const probeAll = (list: { url: string; kind: Kind }[]) =>
    Promise.all(list.map(async (c) => { const d = await probe(c.url); return d && d.w > 0 && d.h > 0 ? { ...c, d } : null; }));
  const early = probeAll(fallbacks.map((url) => ({ url, kind: "icon" as const })));

  const page = await homepage(hosts);
  const found: Probed[] = [];
  if (page) {
    const finalHost = new URL(page.url).host;
    const declared = [
      ...rankIcons(page.html, page.url).slice(0, 5),
      ...(await manifestIcons(page.html, page.url)).slice(0, 2),
      ...(hosts.includes(finalHost) ? [] : [`https://${finalHost}/apple-touch-icon.png`]),
    ].filter((u) => !fallbacks.includes(u));
    const logos = [...rankLogos(page.html, page.url, brand).slice(0, 6), ...inlineSvgLogos(page.html, brand)];
    const fromPage = await probeAll([
      ...declared.map((url) => ({ url, kind: "icon" as const })),
      ...logos.map((url) => ({ url, kind: "logo" as const })),
    ]);
    found.push(...fromPage.filter((p): p is Probed => !!p));
  }
  found.push(...(await early).filter((p): p is Probed => !!p));
  const best = pick(found, brand);
  cache.set(host, best);
  return best;
}
