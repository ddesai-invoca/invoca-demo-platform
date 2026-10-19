/* =============================================================================
   brandLogo — the prospect's own icon, for the RCS sender avatar (10/19/2026)
   -----------------------------------------------------------------------------
   Asked for against the RCS thread's "AP" tile: *"get the prospect's actual logo and use that"*.

   ⚠️ THE SITE'S OWN DECLARED ICON, NOT GOOGLE'S FAVICON SERVICE FIRST. That service often hands
   back a 16px favicon scaled up, which is a blur at the 56px the avatar renders. A site that cares
   publishes an apple-touch-icon (180px, square, on its own background: exactly an app-icon tile,
   which is what an RCS sender avatar is), and many declare larger `<link rel=icon sizes=…>` or a
   web-app manifest. So: read the homepage, rank what it declares, prefer the apple-touch-icon,
   then the largest declared icon; then the conventional `/apple-touch-icon.png`, which is a static
   file and often served even where the homepage blocks a server; then Google's service at 256px.
   Every candidate is fetched and must actually be an image, or the phone draws a broken tile.

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

async function get(url: string, accept: string, ms = 5000): Promise<Response | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" } });
    clearTimeout(t);
    return res.ok ? res : null;
  } catch { return null; }
}

/** The image's real pixel size from its own bytes: Infinity for SVG (vector), 0 when it is not an
    image at all (an HTML error page served under a .png name, which header checks let through). */
export function imageSize(buf: Uint8Array): number {
  const u32 = (i: number) => (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return Math.min(u32(16), u32(20));
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {               // ICO: largest entry
    let best = 0;
    for (let n = 0; n < (buf[4] | buf[5] << 8); n++) { const w = buf[6 + n * 16] || 256; best = Math.max(best, w); }
    return best;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {                                           // JPEG: scan for SOFn
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf[i + 2] << 8 | buf[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return Math.min(buf[i + 5] << 8 | buf[i + 6], buf[i + 7] << 8 | buf[i + 8]);
      i += 2 + len;
    }
    return 0;
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 128;   // WebP: assume usable
  const head = new TextDecoder().decode(buf.slice(0, 600)).trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/.test(head) || (head.startsWith("<?xml") && head.includes("<svg"))) return Infinity;
  return 0;
}

/** The candidate's real size, or 0 when it is missing or not an image. */
async function probe(url: string): Promise<number> {
  const res = await get(url, "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8", 4000);
  if (!res) return 0;
  try { return imageSize(new Uint8Array((await res.arrayBuffer()).slice(0, 600_000))); } catch { return 0; }
}

interface Candidate { url: string; score: number }

/** The icons a page declares, best first. Exported for the audit. */
export function rankIcons(html: string, base: string): string[] {
  const out: Candidate[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /\brel=["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const sizes = /\bsizes=["']?([^"'>]+)/i.exec(tag)?.[1] ?? "";
    const px = Math.max(0, ...sizes.split(/\s+/).map((s) => Number(s.split("x")[0]) || 0));
    const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(/\btype=["']?([^"'>]+)/i.exec(tag)?.[1] ?? "");
    let score = px || (svg ? 256 : 32);
    if (/apple-touch-icon/.test(rel)) score = Math.max(score, 180) + 1000;   // square app tile: the right shape
    if (px && px < 64) score -= 500;                                         // a 16/32px favicon blurs at 56px
    try { out.push({ url: new URL(href, base).toString(), score }); } catch { /* bad href */ }
  }
  return out.sort((a, b) => b.score - a.score).map((c) => c.url);
}

export async function fetchBrandLogo(domain: string): Promise<string | null> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  if (!host || !isPublicHost(host)) return null;
  if (cache.has(host)) return cache.get(host)!;
  const hosts = host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];

  /* Gather candidates best-first, probe each for its REAL size, and take the first sharp one
     (an SVG, or 120px and up). Failing that, the largest real image of at least 48px; below
     that the initials tile looks better than a blur. Bounded, so a slow site cannot hold it. */
  const started = Date.now();
  const candidates: string[] = [];
  for (const h of hosts) {
    if (Date.now() - started > 6_000) break;
    const page = await get(`https://${h}`, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
    if (!page) continue;
    candidates.push(...rankIcons((await page.text()).slice(0, 300_000), page.url).slice(0, 5));
    break;
  }
  for (const h of hosts) candidates.push(`https://${h}/apple-touch-icon.png`, `https://${h}/apple-touch-icon-precomposed.png`);
  candidates.push(`https://www.google.com/s2/favicons?sz=256&domain=${encodeURIComponent(host)}`);

  let found: string | null = null, bestPx = 0, bestUrl: string | null = null;
  for (const u of [...new Set(candidates)]) {
    if (Date.now() - started > 12_000) break;
    const px = await probe(u);
    if (px >= 120) { found = u; break; }
    if (px >= 48 && px > bestPx) { bestPx = px; bestUrl = u; }
  }
  found = found ?? bestUrl;
  cache.set(host, found);
  return found;
}
