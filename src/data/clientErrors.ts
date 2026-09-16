/* =============================================================================
   clientErrors.ts — the browser reports its own failures
   -----------------------------------------------------------------------------
   Built 9/16/2026, as the browser half of the alerting asked for in
   `engine/alerts.ts`. Before this the browser was completely dark: no
   `window.onerror`, no `unhandledrejection`, and `DashboardBoundary` caught render
   errors, showed an Undo and told NOBODY. A screen going blank mid-demo reached us
   only if the SE happened to mention it — which is the "small things like a feature
   is not working" case, and the one with no signal at all.

   ⚠️⚠️ **IT IS DEDUPED ON THIS SIDE TOO, and that is not belt-and-braces.** The
   server funnel dedupes per SIGNATURE, but a React render loop can fire the same
   error hundreds of times a second, and without a local guard every one of those is
   an HTTP request — from the browser, during a demo, on the machine that is already
   struggling. The local cache stops the traffic; the server's cooldown stops the
   notifications.

   ⚠️ **IT NEVER THROWS AND NEVER AWAITS.** It runs only when something is already
   broken, so a reporter that can fail gives the page a second failure to handle.
   `keepalive` so a report survives the navigation that a crash often triggers.
   ============================================================================= */

/** Signatures already sent from this page load, and when. */
const sent = new Map<string, number>();
/** How long one signature stays quiet locally. Shorter than the server's cooldown:
 *  its job is only to stop a render loop flooding the network. */
const LOCAL_QUIET_MS = 60_000;
/** A hard ceiling per page load, whatever the signatures. */
const MAX_PER_LOAD = 20;
let sentCount = 0;

export interface ClientErrorReport {
  /** "window" | "promise" | "boundary" | "voice-agent-missing" — what caught it. */
  where: string;
  name?: string;
  message?: string;
  stack?: string;
  /** The route it happened on. Falls back to the current pathname. */
  route?: string;
  /** Which demo was open, so a data-shaped bug can be reproduced. */
  prospect?: string;
}

/**
 * Report a client-side failure. Fire and forget, safe to call from anywhere.
 *
 * ⚠️ THE SIGNATURE IS route + error TYPE, matching what the server builds. Including
 * the message would defeat both dedupes the moment a message carries an id.
 */
export function reportClientError(r: ClientErrorReport): void {
  try {
    const route = r.route || location.pathname;
    const key = `${r.where}:${route}:${r.name ?? "Error"}`;
    const now = Date.now();
    const last = sent.get(key) ?? 0;
    if (now - last < LOCAL_QUIET_MS) return;
    if (sentCount >= MAX_PER_LOAD) return;
    sent.set(key, now);
    sentCount += 1;

    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* ⚠️ `keepalive` because a crash is often followed by a navigation or a
         reload, and an in-flight fetch dies with the page. */
      keepalive: true,
      body: JSON.stringify({
        where: r.where,
        route,
        name: r.name ?? "Error",
        message: (r.message ?? "").slice(0, 300),
        stack: (r.stack ?? "").slice(0, 600),
        prospect: r.prospect ?? "",
      }),
    }).catch(() => { /* reporting is best effort, by design */ });
  } catch { /* never throw from the reporter */ }
}

/**
 * Hook the two global channels. Called once from `main.tsx`.
 *
 * ⚠️⚠️ **BOTH, NOT JUST `onerror`.** A rejected promise never reaches `onerror`, and
 * this app is almost entirely async — every `/api/*` call, the SSE generation stream,
 * the LiveKit connection. Hooking only the synchronous channel would have left the
 * failures most likely to happen unreported.
 * ⚠️ **IT DOES NOT PREVENT DEFAULT.** The console must still show the error, or
 * debugging locally gets worse in exchange for reporting remotely.
 */
export function installClientErrorReporting(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (e) => {
    /* ⚠️ A FAILED IMAGE OR SCRIPT ALSO FIRES "error", with no `error` object and the
       ELEMENT as the target — that is a broken asset, not an exception, and left
       unfiltered it would report every 404 favicon as a platform failure. */
    if (!(e as ErrorEvent).error && (e.target as Element)?.tagName) return;
    const err = (e as ErrorEvent).error as Error | undefined;
    reportClientError({
      where: "window",
      name: err?.name || "Error",
      message: err?.message || (e as ErrorEvent).message,
      stack: err?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    const err = reason instanceof Error ? reason : undefined;
    reportClientError({
      where: "promise",
      name: err?.name || "UnhandledRejection",
      message: err?.message || String(reason).slice(0, 300),
      stack: err?.stack,
    });
  });
}
