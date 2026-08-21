import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens/tokens.css'
import './tokens/thoughtspot.css'
import './styles/app.css'
import './styles/ts.css'
import './styles/standalone.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/* ---- service worker -------------------------------------------------------
   Registered in PRODUCTION ONLY. In dev it would cache a build that changes every
   few seconds and make HMR lie to us.

   Its single job is that a REFRESH during a deploy still loads the app instead of the
   browser's error page — a Render disk detaches before the new instance boots, which
   measured ~40s of dead origin on 2026-08-20. See public/sw.js for what it does and
   deliberately does not cache, and its KILL switch.

   `updateViaCache: "none"` so the worker SCRIPT is never served from the HTTP cache —
   without it a stale sw.js can outlive several deploys and the kill switch would not
   land either. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch((e) => console.warn("service worker registration failed (app still works):", e));
  });
}
