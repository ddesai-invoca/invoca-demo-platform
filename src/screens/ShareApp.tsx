import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CustomerProfile } from "../data/schema";
import { ProfileProvider } from "../data/ProfileContext";
import { SmsCaptureProvider } from "../data/SmsCaptureContext";
import { VoiceCaptureProvider } from "../data/VoiceCaptureContext";
import { QuoteCaptureProvider } from "../data/QuoteCaptureContext";
import { AiAssistantProvider, useAiAssistant } from "../data/AiAssistantContext";
import { AppShell } from "../layout/AppShell";
import { AgentStudio } from "./AgentStudio";
import { AgentConfig } from "./AgentConfig";
import { KnowledgeSources } from "./KnowledgeSources";
import { AiRecommendations } from "./AiRecommendations";
import { AgentWorkflow } from "./AgentWorkflow";
import { MyReports } from "./MyReports";
import { SmsConversationIntelligence } from "./SmsConversationIntelligence";
import { VoiceConversationIntelligence } from "./VoiceConversationIntelligence";
import { SmsPreviewPage } from "./SmsPreviewPage";
import { SHARE_TOKEN, SHARE_BASENAME, SHARE_LANDING, shareAllows } from "../data/shareMode";
import { GuidedTour, hasSeenTour, onTourRequest } from "../components/GuidedTour";

/* =============================================================================
   ShareApp — what a PROSPECT sees, and deliberately nothing else
   -----------------------------------------------------------------------------
   Asked for 10/6/2026, and clarified: the prospect sees only THEIR demo, cannot
   switch networks, never sees the launch screen, and lands straight on Agent
   Studio.

   ⚠️⚠️ **A SEPARATE ROUTE TREE, NOT THE REAL ONE WITH THINGS HIDDEN.** The app's
   own `<Routes>` carries every dashboard, Signal, the Salesforce screens and the
   launch form. Reusing it and filtering would mean one forgotten entry is a live
   screen on a prospect's machine — and this repo has already paid for that shape
   once: gating a dashboard's LIST ROW left a bookmarked URL rendering the whole
   dashboard. Here the routes a prospect may reach are the only routes that exist,
   so an unlisted path has nothing to render rather than something to refuse.

   ⚠️⚠️ **`AiAssistantProvider` IS mounted, and an earlier note here claimed it was not.**
   Correcting it rather than deleting it, because the false version was load-bearing
   reading: screens read that context for their effective data, so it has to be here or
   every one of them throws. What is absent is Ask AI's own UI — `TopBarAi` and the
   per-tile sparkles are simply not rendered — and `hydrateDemo` is called with
   `canEdit: false`, so the context a prospect gets can be READ and never written.
   ============================================================================= */

type Phase =
  | { k: "loading" }
  | { k: "locked"; prospect: string; error?: string }
  | { k: "gone"; message: string }
  | { k: "open"; profile: CustomerProfile; demoId: string; customizations: unknown };

function Shell({ children }: { children: ReactNode }) {
  return <div className="share-gate"><div className="share-card">{children}</div></div>;
}

export default function ShareApp() {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /* ⚠️⚠️ **TWO STEPS, NOT A SECOND FACTOR (10/8/2026).** Asked for as *"instead of us
     giving them the password… they have to enter their email, and then a password is
     send to them."* The password is the prospect's own name, which this page prints in
     its own heading — so the email step is what RECORDS WHO OPENED THE DEMO, and the
     32-byte token in the URL is still the only real secret. `sentTo` is what moves the
     card from asking for an address to asking for the password. */
  const [email, setEmail] = useState("");
  /* ⚠️⚠️ **WHICH STEP WE ARE ON IS ITS OWN STATE, AND IT HAS TO BE.** It was derived from
     `sentTo` — `if (!sentTo)` showed the email step — and "I already have the password"
     advanced by setting it to `""`. An empty string is FALSY, so that guard could not tell
     "advanced without an address" from "has not advanced", and the link did nothing at all.
     One value was answering two questions: WHICH STEP, and WHICH ADDRESS to name. They are
     two now; `sentTo` is only ever the address, and only ever for the message. */
  const [step, setStep] = useState<"email" | "password">("email");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** Pull the demo once the link is unlocked. */
  async function openDemo(): Promise<boolean> {
    const res = await fetch(`/api/share/${SHARE_TOKEN}/demo`);
    if (!res.ok) return false;
    const body = await res.json();
    const parsed = CustomerProfile.safeParse(body?.demo?.profile);
    if (!parsed.success) {
      setPhase({ k: "gone", message: "This demo could not be loaded. Please contact your Invoca contact." });
      return true;
    }
    setPhase({ k: "open", profile: parsed.data, demoId: body.demo.id, customizations: body.demo.customizations ?? {} });
    return true;
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/share/${SHARE_TOKEN}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setPhase({ k: "gone", message: body?.error || "This demo link is not valid." });
      /* ⚠️ A returning visitor still holds the unlock cookie, so the password is not
         asked for twice inside the same link's lifetime. */
      if (!body.needsPassword && (await openDemo())) return;
      setPhase({ k: "locked", prospect: body.prospect || "" });
    })().catch(() => setPhase({ k: "gone", message: "This demo link is not available right now." }));
  }, []);

  async function requestPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${SHARE_TOKEN}/request-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase((p) => (p.k === "locked" ? { ...p, error: body?.error || "That could not be sent." } : p));
        return;
      }
      setSentTo(email.trim());
      setStep("password");
      setPhase((p) => (p.k === "locked" ? { ...p, error: undefined } : p));
      /* ⚠️ **AN UNSENT EMAIL SAYS SO RATHER THAN SENDING SOMEBODY TO AN EMPTY INBOX.**
         `sendMail` legitimately declines off production and with no mailer configured,
         and the step still advances so a password given by hand is usable. */
      if (!body?.sent) setNote("We could not send the email. Please ask your Invoca contact for the password.");
    } finally { setBusy(false); }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${SHARE_TOKEN}/unlock`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        /* ⚠️ The address rides the unlock so the server can stamp it into the session
           cookie — activity has to stay attributable after a reload, and this is the only
           moment the page is certain to know it. Empty when somebody came through
           "I already have the password", which the Activity sheet shows as such. */
        body: JSON.stringify({ password, email: sentTo ?? "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 410) return setPhase({ k: "gone", message: body?.error || "This demo link has expired." });
      if (!res.ok) {
        setPhase((p) => (p.k === "locked" ? { ...p, error: body?.error || "That password is not right." } : p));
        return;
      }
      await openDemo();
    } finally { setBusy(false); }
  }

  if (phase.k === "loading") return <Shell><p className="share-muted">Opening your demo…</p></Shell>;

  if (phase.k === "gone") {
    return (
      <Shell>
        <h1 className="share-title">This demo is no longer available</h1>
        <p className="share-muted">{phase.message}</p>
        <p className="share-muted">Please get in touch with your Invoca contact for a new link.</p>
      </Shell>
    );
  }

  if (phase.k === "locked") {
    const title = phase.prospect ? `${phase.prospect} AI Agent demo` : "AI Agent demo";
    /* Step one: who are you? The password is emailed rather than passed along by hand. */
    if (step === "email") {
      return (
        <Shell>
          <h1 className="share-title">{title}</h1>
          <p className="share-muted">
            Enter your email and we will send you the password for this demo.
          </p>
          <form onSubmit={requestPassword} className="share-form">
            <label className="share-label" htmlFor="share-email">Email</label>
            <input id="share-email" className="share-input" type="email" value={email} autoFocus
              autoComplete="email" inputMode="email" placeholder="you@company.com"
              onChange={(e) => { setEmail(e.target.value); setNote(null); }} />
            {phase.error && <p className="share-error">{phase.error}</p>}
            <button className="share-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me the password"}
            </button>
            {/* ⚠️ A way through when the mail does not arrive — a spam filter or a mailer
                that is not configured must not leave somebody with no route at all, and
                somebody who was given the password by hand should not have to ask for a
                second copy. */}
            <button type="button" className="share-link"
              onClick={() => { setStep("password"); setNote(null); }}>
              I already have the password
            </button>
          </form>
        </Shell>
      );
    }

    return (
      <Shell>
        <h1 className="share-title">{title}</h1>
        <p className="share-muted">
          {sentTo
            ? <>We sent the password to <strong>{sentTo}</strong>. Enter it below.</>
            : "Enter the password for this demo."}
        </p>
        <form onSubmit={unlock} className="share-form">
          <label className="share-label" htmlFor="share-pw">Password</label>
          <input id="share-pw" className="share-input" type="password" value={password} autoFocus
            autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          {note && <p className="share-note">{note}</p>}
          {phase.error && <p className="share-error">{phase.error}</p>}
          <button className="share-btn" type="submit" disabled={busy || !password}>
            {busy ? "Checking…" : "Open demo"}
          </button>
          <button type="button" className="share-link"
            onClick={() => { setStep("email"); setSentTo(null); setNote(null); setPassword(""); }}>
            {sentTo ? "Use a different email" : "Email me the password instead"}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <ProfileProvider only={phase.profile}>
      <AiAssistantProvider>
      <HydrateShared demoId={phase.demoId} customizations={phase.customizations} />
      <SmsCaptureProvider>
      <VoiceCaptureProvider>
      <QuoteCaptureProvider>
        {/* ⚠️ `basename` is what lets every existing screen keep its own paths — the
            prospect's URL is `/share/<token>/agent-studio` and the app reads
            `/agent-studio`, so no screen needed changing. */}
        <BrowserRouter basename={SHARE_BASENAME}>
          <ShareRoutes />
          {/* ⚠️ INSIDE the router: the tour navigates between screens, so it needs
              `useNavigate`. Outside it, every route step would be a no-op. */}
          <ShareTour />
        </BrowserRouter>
      </QuoteCaptureProvider>
      </VoiceCaptureProvider>
      </SmsCaptureProvider>
      </AiAssistantProvider>
    </ProfileProvider>
  );
}

/**
 * ⚠️⚠️ **THIS IS WHAT MAKES "the SE's changes reach the prospect" TRUE.** An SE's Ask AI
 * edits are not in the profile — they live in the demo record's `customizations`, which
 * the override layer merges on top. Without this the prospect would see the generated
 * base and none of the tuning, and the share would silently show a different agent from
 * the one the SE configured.
 * ⚠️ `canEdit: true` keeps the drawers working, which was asked for; the SYNC is blocked
 * inside `AiAssistantContext` for a share, so nothing a prospect does leaves their browser.
 */
/**
 * The first-run tour, and the quiet way back into it.
 *
 * ⚠️⚠️ **FIRST OPEN ONLY, BUT ALWAYS REPLAYABLE.** Asked for as "the first time" — so it
 * auto-starts once per link per browser. A tour that can only ever be seen once is one
 * nobody can show a colleague, and the prospect who skipped it in a hurry has no way back,
 * so the pill stays in the corner afterwards.
 * ⚠️ **IT WAITS FOR THE PROFILE TO BE REAL.** Mounting on the loading phase would measure
 * a target that has not rendered and spend the whole first step's budget degrading to a
 * centred card.
 */
function ShareTour() {
  const [open, setOpen] = useState(() => !hasSeenTour());
  const { pathname } = useLocation();
  /* The big callout on the landing page asks for the tour through this. */
  useEffect(() => onTourRequest(() => setOpen(true)), []);
  /* ⚠️ ONE WAY IN PER SCREEN. The landing page carries the large callout in its own
     whitespace, so the corner pill would be a second, smaller version of the same button
     six inches away. Every other screen keeps the pill, because there is no whitespace
     there and the tour is not the point of those pages. */
  const onLanding = pathname === SHARE_LANDING;

  /* ⚠️⚠️ **ON THE LANDING PAGE THE PILL SURVIVES ONLY WHILE THE CALLOUT IS OFF SCREEN.**
     Measured: the workflow table is tall enough that on a 935px laptop the callout sits
     below the fold, so "hide the pill on this page" would have left a prospect with NO
     visible way in on exactly the screen size most of them use. Observing the callout
     gives one entry point at all times and never two at once. */
  const [ctaSeen, setCtaSeen] = useState(false);
  useEffect(() => {
    if (!onLanding) { setCtaSeen(false); return; }
    /* ⚠️⚠️ **MEASURED ON SCROLL, NOT VIA IntersectionObserver — and the observer version
       silently never updated.** `.main` is the scroll container, not the window, and the
       observer did not report the callout coming into view when that box scrolled. The
       capture phase is required because scroll does not bubble, which is the same fix the
       sidebar flyout and the tour's own spotlight already use. */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const el = document.querySelector(".tour-cta");
      if (!el) { setCtaSeen(false); return; }
      const r = el.getBoundingClientRect();
      /* Comfortably in view, not merely touching the edge. */
      setCtaSeen(r.top < window.innerHeight - 60 && r.bottom > 80);
    };
    const poll = () => { read(); timer = setTimeout(poll, 400); };
    poll();
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
    };
  }, [onLanding, pathname, open]);

  return (
    <>
      {open && <GuidedTour onClose={() => setOpen(false)} />}
      {!open && !(onLanding && ctaSeen) && (
        <button className="tour-replay tour-replay--fixed" onClick={() => setOpen(true)}>
          <span className="material-icons" aria-hidden="true">play_circle</span>
          Take the tour
        </button>
      )}
    </>
  );
}

function HydrateShared({ demoId, customizations }: { demoId: string; customizations: unknown }) {
  const { hydrateDemo } = useAiAssistant();
  useEffect(() => {
    /* ⚠️⚠️ **`canEdit: false`, WHICH REVERSES AN EARLIER DECISION ON PURPOSE.** It used to
       hydrate `true` so the drawers' Apply and the voice picker kept working for a
       prospect; asked for directly on 10/8/2026, a shared demo is now a read-only preview.
       Doing it HERE rather than screen by screen is what makes it structural: `readOnly`
       is the one flag `applyEdits`, `mutate` and `undo` all check, so every editable
       surface a prospect can reach is covered — including any added later, which a
       per-screen lock would silently miss.
       ⚠️ It does NOT hide the SE's own customizations: `readOnly` gates writes only, and
       the overrides above are merged in regardless. */
    hydrateDemo(demoId, (customizations ?? {}) as never, false, { name: "", email: "" });
  }, [demoId, customizations, hydrateDemo]);
  return null;
}

/** A path the shared demo does not carry. Not a 404 — it is not theirs to see. */
function NotInThisDemo() {
  return (
    <div className="placeholder">
      <h2>Not part of this demo</h2>
      <p className="muted">This page isn't included in the demo that was shared with you.</p>
    </div>
  );
}

function ShareRoutes() {
  const { pathname } = useLocation();
  /* ⚠️ A SECOND, BELT-AND-BRACES GUARD over the route list itself, so a route added
     to this file later without a thought still has to pass `shareAllows`. */
  if (!shareAllows(pathname)) {
    /* ⚠️ Rendered WITHOUT the shell on purpose: the sidebar and top bar belong to a
       demo, and this path is not part of one. The catch-all route below covers the
       same ground from inside the shell for a path that merely has no element. */
    return <Shell><h1 className="share-title">Not part of this demo</h1><p className="share-muted">This page isn't included in the demo that was shared with you.</p></Shell>;
  }
  return (
    <Routes>
      {/* ⚠️ OUTSIDE the shell, exactly as the real route tree registers it: the phone
          preview is a full-page screen opened in its own tab. */}
      <Route path="/agent-studio/agent/preview" element={<SmsPreviewPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={SHARE_LANDING} replace />} />
        <Route path="/agent-studio" element={<AgentStudio />} />
        {/* ⚠️ `AgentStudioLayout` is NOT a route layout — each of these screens wraps
            itself in it, the same way the real route tree registers them. */}
        <Route path="/agent-studio/agent" element={<AgentConfig />} />
        <Route path="/agent-studio/agent/knowledge" element={<KnowledgeSources />} />
        <Route path="/agent-studio/agent/recommendations" element={<AiRecommendations />} />
        <Route path="/agent-studio/agent/workflow/:channel" element={<AgentWorkflow />} />
        <Route path="/reports" element={<MyReports />} />
        <Route path="/reports/sms-conversation-intelligence" element={<SmsConversationIntelligence />} />
        <Route path="/reports/voice-conversation-intelligence" element={<VoiceConversationIntelligence />} />
        <Route path="*" element={<NotInThisDemo />} />
      </Route>
    </Routes>
  );
}
