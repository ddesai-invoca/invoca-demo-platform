import { useEffect, useState } from "react";

/* =============================================================================
   EnvBadge — you are not on production
   -----------------------------------------------------------------------------
   Added 9/8/2026 with the staging service. This whole app is a REPLICA of Invoca shown to
   prospects, so the one thing a second environment must never do is look identical to the
   first: an SE who demos from staging shows stale demos and a half-tested build, and whoever
   is testing needs to know they are not about to change what the team is using.

   ⚠️ **PRODUCTION RENDERS NOTHING AT ALL** — not a hidden node, not an empty div. The badge
   only exists once `/api/status` says otherwise, so a production screenshot is byte-identical
   to before this component existed.

   ⚠️ **THE ENVIRONMENT IS ASKED FOR AT RUNTIME, NOT BAKED IN AT BUILD TIME.** A
   `VITE_APP_ENV` would be one more build-time variable to forget on a new service, and this
   file already records what that costs: "the frontend needs that token at BUILD time, so
   runtime presence does NOT prove the deployed bundle carries it". The server derives the
   environment from its own service name, so a staging service is labelled by construction.

   ⚠️ **DELIBERATELY NOT HOVER-REVEALED**, unlike the Ask AI and Read.Me affordances. Those
   hide so they stay out of a demo; this one's entire job is to be impossible to miss.
   ============================================================================= */

type Env = "production" | "staging" | "local" | null;

/* Module scope, so navigating between screens does not re-ask. One request per page load. */
let cached: Env | undefined;

export function EnvBadge() {
  const [env, setEnv] = useState<Env>(cached ?? null);

  useEffect(() => {
    if (cached !== undefined) return;
    let alive = true;
    /* A failure means "say nothing": a badge that appears because a fetch broke would be
       worse than none, and /api/status is public so this needs no session. */
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { cached = (j?.environment as Env) ?? null; if (alive) setEnv(cached); })
      .catch(() => { cached = null; });
    return () => { alive = false; };
  }, []);

  if (env !== "staging") return null;
  return (
    <div className="envbadge" role="status" aria-live="polite" title="This is the staging service, not the demo platform the team uses">
      STAGING
    </div>
  );
}
