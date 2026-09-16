/* =============================================================================
   Replicate on demand — fetch a URL, make it inert, serve it as a working page
   -----------------------------------------------------------------------------
   Asked for directly (9/13/2026): *"i need the behavior to be that i paste a URL and when user
   clicks Replicate, it should replicate the page, and that page will more than likely have a
   form on it."*

   ⚠️⚠️ **A SERVER CANNOT RUN THE PAGE'S JAVASCRIPT, AND THAT IS THE WHOLE LIMIT OF THIS FILE.**
   Measured across ten prospect booking pages: only ONE served a real lead field, because modern
   booking widgets (ServiceTitan embeds, Salesforce Web-to-Lead, React apps) build their form
   after load. Aptive serves zero `<form>` elements to a server fetch and renders one with 38
   inputs in a browser. **So this reports what it got rather than pretending**: `formFields`
   counts the fillable controls it found, and the caller tells the SE plainly when the answer is
   zero. A styled page with no form, shown silently, is the worst outcome available — it looks
   like the feature working.
   Conventional server-rendered forms (WordPress, Contact Form 7, Gravity Forms, most
   mid-market "request a quote" pages) come through fine, which is the case this exists for.

   ⚠️⚠️ **STYLING SURVIVES WITHOUT INLINING ANYTHING, via `<base href>`.** A stylesheet can be
   loaded cross-origin without CORS — CORS only governs READING its rules from script — so the
   served copy pulls the site's own CSS, fonts and images straight from their origin and renders
   as itself. That is why this is fast: no asset rewriting, no inlining, no megabytes.

   ⚠️⚠️ **EVERY FORM IS NEUTRALISED BEFORE THE HTML IS EVER RETURNED.** These are real
   companies' lead forms; one that kept its `action` would file a REAL lead at that company the
   first time an SE demoed it. `action`/`method`/`target`/`onsubmit` and every `formaction` and
   `on*` attribute are stripped here, and `ReplicaPage` strips them again on load.

   ⚠️ **SSRF GUARD.** This takes a URL from the browser and fetches it from the server, so it
   must never be pointed at the private network. Only http/https, and hostnames that look
   internal are refused outright. It is not a substitute for network egress rules, but it stops
   the obvious `http://localhost:5173/api/...` and `http://169.254.169.254/` shapes.
   ============================================================================= */

import {
  renderViaService, renderViaUnblock, renderConfigured, RenderUnavailable,
  looksBotWalled, lacksLeadField,
} from "./renderService.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export interface ReplicaResult {
  html: string;
  finalUrl: string;
  title: string;
  /** Fillable controls found — 0 means the form is built by JavaScript we cannot run. */
  formFields: number;
  forms: number;
  bytes: number;
  ms: number;
  /** How this page was obtained — the screen tells the SE, since accuracy differs. */
  via: "render" | "unblock" | "fetch";
  /** Set when the accurate path was tried and fell back, so the reason is never swallowed. */
  fallbackReason?: string;
}

export class ReplicateError extends Error {}

/** Refuse anything pointed at our own network. See the header. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ReplicateError("That is not a valid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ReplicateError("Only http and https pages can be replicated.");
  }
  const h = u.hostname.toLowerCase();
  const privateHost =
    h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || !h.includes(".");
  if (privateHost) throw new ReplicateError("That address is not a public website.");
  return u;
}

/* ---- the transform ------------------------------------------------------- */

/** Remove a whole element and its contents, tag by tag, without a DOM. */
/**
 * Remove every `<tag>` element.
 *
 * `shouldStrip` narrows it to some of them, judged by the START TAG — used to keep the iframe
 * placeholders `freezePage` created while still removing everybody else's. When it is given, a
 * kept element's CONTENT is left alone too, so a placeholder is never half-erased.
 */
function stripElement(html: string, tag: string, shouldStrip?: (startTag: string) => boolean): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const lone = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
  const keep = (whole: string) => {
    if (!shouldStrip) return "";
    const start = whole.match(new RegExp(`^<${tag}\\b[^>]*>`, "i"))?.[0] ?? whole;
    return shouldStrip(start) ? "" : whole;
  };
  return html.replace(paired, keep).replace(lone, keep);
}

/**
 * Make a fetched page safe and self-contained enough to serve from our own origin.
 * Exported so the audit can run it over real HTML rather than over a description of it.
 */
export function sanitizeReplica(html: string, finalUrl: string): { html: string; forms: number; formFields: number } {
  let out = html;

  /* ⚠️ COMMENTS FIRST. A `<script>` inside a comment is inert, but leaving comments in means
     every later count has to know that; dropping them makes the counts mean what they say. */
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of ["script", "noscript", "object", "embed", "template"]) {
    out = stripElement(out, tag);
  }
  /* ⚠️⚠️ **AN IFRAME THE CAPTURE MADE IS KEPT; EVERY OTHER IFRAME IS STILL STRIPPED.** Stripping
     all of them is what lost greenixpc.com's form: its contact form is a HubSpot embed inside a
     same-origin iframe, so the top-level document has 0 forms and the fields only exist in the
     child document. `freezePage` marks the frames it serialised with `data-replica-frame` and
     hands their HTML back separately; those placeholders survive, and the capture script fills
     each one with its own sanitized copy as `srcdoc`.

     ⚠️ **AND NEVER ADD A `sandbox` THAT OMITS `allow-same-origin`.** A `srcdoc` frame inherits
     this origin, which is the only reason `contentDocument` is readable and the form inside it
     can be wired into the demo at all — the same property that makes our own replicas work and
     makes the ThoughtSpot and LSA-quote frames unreadable. */
  out = stripElement(out, "iframe", (tag) => !/\sdata-replica-frame\s*=/i.test(tag));
  /* Preloads and module preloads would fetch the scripts we just removed. */
  out = out.replace(/<link\b[^>]*rel=["']?(?:preload|modulepreload|prefetch)["']?[^>]*>/gi, "");
  /* Inline handlers: on<word>= up to the end of its quoted value. */
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "").replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");

  /* NEUTRALISE every form — see the header. */
  out = out.replace(/<form\b[^>]*>/gi, (tag) => {
    let t = tag;
    for (const attr of ["action", "method", "target", "onsubmit"]) {
      t = t.replace(new RegExp(`\\s${attr}\\s*=\\s*"[^"]*"`, "gi"), "")
           .replace(new RegExp(`\\s${attr}\\s*=\\s*'[^']*'`, "gi"), "")
           .replace(new RegExp(`\\s${attr}\\s*=\\s*[^\\s>]+`, "gi"), "");
    }
    return t.replace(/<form/i, '<form data-replica-form="1"');
  });
  out = out.replace(/\sformaction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  /* ⚠️ `<base href>` is what keeps the page STYLED without inlining a byte — see the header.
     Any existing base is removed first, or the site's own (often "/") wins and every relative
     asset resolves against OUR origin and 404s. */
  out = out.replace(/<base\b[^>]*>/gi, "");
  const base = `<base href="${finalUrl.replace(/"/g, "&quot;")}">`;
  out = /<head[^>]*>/i.test(out)
    ? out.replace(/<head([^>]*)>/i, `<head$1>${base}`)
    : `${base}${out}`;

  const forms = (out.match(/<form\b/gi) || []).length;
  /* What a person could actually fill in: visible-ish inputs, selects and textareas. Hidden
     and button-ish inputs are excluded, since a page full of tracking fields is not a form. */
  const inputs = (out.match(/<input\b[^>]*>/gi) || [])
    .filter((t) => !/type\s*=\s*["']?(hidden|submit|button|reset|image)["']?/i.test(t)).length;
  const others = (out.match(/<(select|textarea)\b/gi) || []).length;

  return { html: out, forms, formFields: inputs + others };
}

/* ---- the fetch ----------------------------------------------------------- */

/* ⚠️ A SMALL CACHE, because the page is fetched TWICE per click by design: once by the probe
   that drives the progress bar beside the Replicate button, and once by the iframe that
   actually shows it. Without this the SE waits for the same page twice and the second wait is
   invisible to them. Short TTL so a re-open during a demo is instant while an edit to the real
   site still shows up within the hour. */
const CACHE = new Map<string, { at: number; result: ReplicaResult }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 12;

function cacheGet(key: string): ReplicaResult | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  /* `ms` describes THIS answer, and answering from memory took no time. Saying 300ms again
     would make the progress bar look broken the second time. */
  return { ...hit.result, ms: 0 };
}

function cachePut(key: string, result: ReplicaResult): void {
  CACHE.set(key, { at: Date.now(), result });
  /* Each entry is up to 8MB, so this is bounded by memory, not by tidiness. */
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
}

/* =============================================================================
   ⚠️⚠️ **ONE RENDER PER URL AT A TIME — TWO OVERLAPPING PROBES WERE COSTING US A RENDER SLOT.**
   The normal flow asks for the same URL TWICE in quick succession: the Replicate button probes
   before navigating, then `/replica` probes again once it opens. The cache closes that gap only
   after the first one finishes, so for the ~12 seconds a stealth render takes, the second
   request found no entry and started its own. Measured consequence on `aviandco.com`: the first
   probe came back `403 … refuses automated fetches` because its renderer call had been rejected
   while another was already running, and the second — which happened to win — served the page
   fine. A feature that fails when it is used the way it is meant to be used is worse than a slow
   one, so a request for a URL already in flight now waits on that same promise.
   ============================================================================= */
const INFLIGHT = new Map<string, Promise<ReplicaResult>>();

export function fetchReplica(rawUrl: string): Promise<ReplicaResult> {
  const key = assertPublicUrl(rawUrl).toString();
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  const running = INFLIGHT.get(key);
  /* `ms: 0` for the same reason a cache hit reports it: this answer cost the caller a wait it
     did not spend rendering. */
  if (running) return running.then((r) => ({ ...r, ms: 0 }));

  const p = replicateNow(rawUrl).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}

async function replicateNow(rawUrl: string): Promise<ReplicaResult> {
  const started = Date.now();
  const u = assertPublicUrl(rawUrl);

  /* ⚠️⚠️ **THE ACCURATE PATH FIRST, AND ITS FAILURE IS NEVER SILENT.** A real browser resolves
     the lazy images, the background video and the injected SVG that a plain fetch cannot — see
     `renderService.ts`. When it is unavailable, times out, or the site blocks it, we fall
     through to the fetch below and CARRY THE REASON, so the screen can say the replica is the
     less accurate one rather than letting the SE discover it in front of a customer. */
  let fallbackReason: string | undefined;
  if (renderConfigured()) {
    let rendered: string | undefined;
    try {
      const r = await renderViaService(u.toString());
      rendered = r.html;
    } catch (e: unknown) {
      fallbackReason = e instanceof RenderUnavailable ? e.message : "The render service failed.";
    }

    if (rendered !== undefined) {
      /* ⚠️⚠️ **TWO WAYS A 200 IS STILL THE WRONG PAGE, and both were measured on
         `aviandco.com/schedule-an-appointment`.** A bot wall renders as a perfectly valid 24KB
         document titled "Just a moment…", and a real page can arrive with its lead form not yet
         mounted because a third-party script builds it. Escalating to the stealth renderer fixes
         both — see the stage-two block in `renderService.ts`.

         ⚠️ **THE WALL GETS THE RETRY, THE FORMLESS PAGE DOES NOT.** A page with genuinely no
         form (a homepage) must not pay two renders to be told what the first render already
         knew; a challenge page must, because keeping it is not an option. */
      const walled = looksBotWalled(rendered);
      if (walled || lacksLeadField(rendered)) {
        try {
          const r2 = await renderViaUnblock(u.toString(), { allowFixedWaitRetry: walled });
          /* If even the stealth renderer comes back walled, say so and let the fetch below
             produce the honest "this site refuses automated fetches" error. */
          if (!looksBotWalled(r2.html)) {
            return finish(u.toString(), r2.html, u.toString(), started, "unblock");
          }
          fallbackReason = `${u.hostname} is showing a bot challenge instead of the page.`;
          rendered = undefined;
        } catch (e: unknown) {
          if (walled) {
            fallbackReason = e instanceof RenderUnavailable ? e.message : "The render service failed.";
            rendered = undefined;         // never serve a challenge page as the replica
          }
          /* Not walled: the wait simply found no lead field, so the first render stands. */
        }
      }
    }
    if (rendered !== undefined) return finish(u.toString(), rendered, u.toString(), started, "render");
  } else {
    fallbackReason = "No render service is configured, so this is the fast (less accurate) copy.";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(u.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    const msg = (e as Error)?.name === "AbortError"
      ? `${u.hostname} did not respond within ${TIMEOUT_MS / 1000} seconds.`
      : `Could not reach ${u.hostname}.`;
    throw new ReplicateError(fallbackReason ? `${msg} ${fallbackReason}` : msg);
  }
  clearTimeout(timer);

  if (!res.ok) {
    /* ⚠️ NAME THE STATUS. 403 and 429 here mean the site is blocking a datacenter fetch, which
       is a different problem from a typo, and the SE can only tell them apart if we say so. */
    /* ⚠️⚠️ **AND CARRY THE RENDER PATH'S REASON, because the fetch's status is the LEAST useful
       half of the story.** A site that walls off the renderer walls off this fetch too, so the
       error read "www.aviandco.com blocked the request (HTTP 403)" while the thing that actually
       went wrong — the stealth renderer being turned away — went unsaid. Whoever reads this
       message is trying to work out which of the two to fix. */
    const site = res.status === 403 || res.status === 429
      ? `${u.hostname} blocked the request (HTTP ${res.status}). This site refuses automated fetches.`
      : `${u.hostname} returned HTTP ${res.status}.`;
    throw new ReplicateError(fallbackReason ? `${site} ${fallbackReason}` : site);
  }
  const ctype = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(ctype)) {
    throw new ReplicateError(`That URL is not a web page (${ctype.split(";")[0] || "unknown type"}).`);
  }

  const raw = await res.text();
  if (raw.length > MAX_BYTES) throw new ReplicateError("That page is too large to replicate.");

  const finalUrl = res.url || u.toString();
  return finish(u.toString(), raw, finalUrl, started, "fetch", fallbackReason);
}

/** Sanitize, measure, cache. Shared by both paths so they cannot diverge. */
function finish(
  key: string, raw: string, finalUrl: string, started: number,
  via: "render" | "unblock" | "fetch", fallbackReason?: string,
): ReplicaResult {
  const { html, forms, formFields } = sanitizeReplica(raw, finalUrl);
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 120);
  const result: ReplicaResult = {
    html, finalUrl, title, forms, formFields,
    bytes: html.length, ms: Date.now() - started, via, fallbackReason,
  };
  cachePut(key, result);
  return result;
}
