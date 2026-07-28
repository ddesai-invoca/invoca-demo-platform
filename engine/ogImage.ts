/* Resolves a real hero photo for a prospect from its OWN website — the
   <meta property="og:image"> every marketing site sets for link previews.

   Why this and not a places API: the constraint was generation time. A places
   lookup (Google/Yelp) needs a key, an account with billing, and two round
   trips. This needs neither, and — more importantly — NOTHING here runs during
   profile generation. The image is resolved lazily the first time a prospect's
   ChatGPT page is opened and then cached, so the 17-phase pipeline is
   completely untouched: zero milliseconds added to a generation.

   It's also the right image editorially: og:image is the picture the company
   chose to represent itself, which is what belongs in a mock of their own ad. */

const cache = new Map<string, string | null>();

/* The domain arrives from the client, so this is an SSRF sink: without a guard
   someone could point it at internal addresses and use the server as a proxy.
   Only public-looking hostnames get fetched. */
function isPublicHost(host: string): boolean {
  if (!host.includes(".") || host.endsWith(".local")) return false;
  if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i.test(host)) return false;
  if (/^(10|127)\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

function pickMeta(html: string, ...names: string[]): string | null {
  for (const n of names) {
    // property/name can sit either side of content, so try both orders
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']` +
      `|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`,
      "i",
    );
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v) return v;
  }
  return null;
}

export async function fetchOgImage(domain: string): Promise<string | null> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!host || !isPublicHost(host)) return null;
  if (cache.has(host)) return cache.get(host)!;

  /* Try the apex AND the www host. Plenty of sites only serve one of the two —
     vectorsecurity.com refuses connections on the apex while www. serves a
     perfectly good og:image, so trying a single form silently loses them.
     A full browser UA matters too: a bot-shaped one gets 403 more often. */
  const hosts = host.startsWith("www.")
    ? [host, host.slice(4)]
    : [host, `www.${host}`];

  let found: string | null = null;
  for (const h of hosts) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(`https://${h}`, {
        signal: ctl.signal,
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      // The <head> is all we need; don't pull megabytes of body for one tag.
      const html = (await res.text()).slice(0, 250_000);
      const raw = pickMeta(html, "og:image", "og:image:secure_url", "twitter:image");
      if (raw) { found = new URL(raw, res.url).toString(); break; }
    } catch {
      /* offline, timeout, TLS, refused — try the next host form */
    }
  }

  cache.set(host, found);               // negatives cached too — don't retry a miss
  return found;
}
