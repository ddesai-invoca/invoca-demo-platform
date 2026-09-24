import { assertPublicUrl, fetchReplica } from "./replicate.ts";

/* =============================================================================
   siteLinks.ts — match a Knowledge Source label to a REAL page on the site
   -----------------------------------------------------------------------------
   Reported: *"all the links are still going to the same home page"*. They were,
   deliberately — nothing in a profile carries a URL (453 label-only rows across
   91 profiles) and this repo refuses to invent a path, because a guessed
   `/find-your-home` 404s on the prospect's own website mid-demo.

   ⚠️⚠️ **SO THIS DOES NOT GUESS — IT READS THE SITE'S OWN NAVIGATION.** The
   homepage is fetched and its anchors extracted, and a label is matched against
   the real link TEXT and the real URL slug. "Find Your Home" resolves because
   LGI Homes' own nav has an anchor reading exactly that. A path is only ever
   returned because the site published it, which is the difference between this
   and slugifying a label.
   ⚠️ **AND THE LABEL CAME FROM THE SITE IN THE FIRST PLACE**, which is why the
   hit rate is good: the generator wrote "Find Your Home" because it researched
   that site, so an anchor with that text almost always exists.

   ⚠️ **IT REUSES `fetchReplica`, WHICH RENDERS FIRST.** A marketing site whose nav
   is JS-injected serves no anchors to a plain fetch — the same finding that made
   the replica capture render-first (21 `data-src` attributes and zero inline SVG
   on the page that prompted it). Reusing it also inherits `assertPublicUrl`'s
   SSRF guard and the render service's circuit breaker.

   ⚠️ **EVERY FAILURE FALLS BACK TO THE HOMEPAGE, which is exactly today's
   behaviour** — a site that 403s a datacenter IP (measured: AutoNation, Orlando
   Health, Mattress Firm) is no worse off than before, never broken.
   ============================================================================= */

interface Anchor { href: string; text: string }

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; anchors: Anchor[] }>();

/** Words that carry no matching signal — a label and an anchor sharing only
 *  these is not a match. */
const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "our", "your", "my", "we", "us", "with", "by", "at", "page", "home"]);

const norm = (s: string) =>
  s.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));

/** Anchors on one page, same-origin only, deduped, text-bearing. */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const base = new URL(baseUrl);
  const out = new Map<string, Anchor>();
  /* Attribute values may be unquoted — SingleFile and plenty of real sites emit
     `href=/about` — which is the trap the replica capture already records. */
  const re = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || /^(#|mailto:|tel:|javascript:)/i.test(raw)) continue;
    let u: URL;
    try { u = new URL(raw, base); } catch { continue; }
    if (u.origin !== base.origin) continue;          // never leave the prospect's site
    if (u.pathname === "/" && !u.search) continue;   // the homepage is the fallback, not a match
    const text = m[4].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) continue;
    u.hash = "";
    const key = u.toString();
    /* First occurrence wins: site navigation comes before footer boilerplate,
       and the nav's wording is what a label was written from. */
    if (!out.has(key)) out.set(key, { href: key, text });
  }
  return [...out.values()];
}

/**
 * The best real page for one label, or null.
 *
 * ⚠️ NULL IS A LEGITIMATE ANSWER and the caller falls back to the homepage. A
 * weak match is worse than no match: it sends the SE somewhere the label does
 * not describe, which is the failure mode this whole approach exists to avoid.
 */
export function matchLabel(label: string, anchors: Anchor[]): string | null {
  const want = norm(label);
  if (!want) return null;
  /* "Homepage" names the root, which is the fallback anyway. */
  if (/^home ?(page)?$/.test(want)) return null;

  const wantTokens = tokens(label);
  if (!wantTokens.length) return null;

  let best: { href: string; score: number } | null = null;
  for (const a of anchors) {
    const text = norm(a.text);
    const slug = norm(new URL(a.href).pathname);
    let score = 0;

    if (text === want) score = 100;                                  // the nav says exactly this
    else if (slug === want) score = 95;                              // the URL says exactly this
    else {
      const at = new Set([...tokens(a.text), ...tokens(new URL(a.href).pathname)]);
      const hits = wantTokens.filter((t) => at.has(t)).length;
      /* ⚠️ TWO SIGNIFICANT WORDS MINIMUM — the threshold this repo already
         settled for keyword-to-ad-group matching after ONE shared word matched
         "continuing CARE" to "Memory Care". A single-token label can match on
         its one token, since that token is the entire thing being named. */
      const need = wantTokens.length === 1 ? 1 : 2;
      if (hits >= need) score = 50 + hits * 5 + (hits === wantTokens.length ? 10 : 0);
    }
    if (score && (!best || score > best.score)) best = { href: a.href, score };
  }
  return best ? best.href : null;
}

/** Fetch (and cache) the anchors on a site's homepage. Never throws. */
export async function siteAnchors(rawUrl: string): Promise<Anchor[]> {
  let origin: string;
  try { origin = assertPublicUrl(rawUrl).origin; } catch { return []; }
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.anchors;
  try {
    const r = await fetchReplica(origin);
    const anchors = extractAnchors(r.html, r.finalUrl || origin);
    cache.set(origin, { at: Date.now(), anchors });
    return anchors;
  } catch {
    /* Cached as empty so a blocked site is not re-fetched on every page view —
       it degrades to the homepage, which is where it was already going. */
    cache.set(origin, { at: Date.now(), anchors: [] });
    return [];
  }
}

/** label -> real URL, for the labels that could be resolved. */
export async function resolveLabels(rawUrl: string, labels: string[]): Promise<Record<string, string>> {
  const anchors = await siteAnchors(rawUrl);
  const out: Record<string, string> = {};
  if (!anchors.length) return out;
  for (const l of labels) {
    const href = matchLabel(l, anchors);
    if (href) out[l] = href;
  }
  return out;
}
