import { useEffect, useState } from "react";
import { isShareMode } from "../data/shareMode";
import { useLocation, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { AiAssistantDrawer } from "../components/AiAssistantDrawer";
import { PhonePreview } from "./PhonePreview";
import { useExtraWorkflows } from "../data/quoteWorkflow";
import { builtInCopiesFor, isRcsSlug } from "../data/builtInCopies";
import { CustomCrm } from "./CustomCrm";
import { crmConnection, setCrmConnected } from "../data/customCrm";

/* Standalone browser-tab version of the "Preview Agent" SMS chat. The Agent
   Workflow's Preview Agent button opens this route in a new tab (window.open)
   instead of an in-app modal. Renders full-page (no app shell); the chat is
   captured to the SMS Conversation Intelligence report on exit (see PhonePreview).

   THE AI HERE SETS WHAT THE PHONE ASKS. `useBrain` in PhonePreview reads the
   EFFECTIVE agent config, so an edit made in this drawer changes the agent's
   qualifying questions and the very next reply follows them — it is not a note in
   a panel.

   Because this route is outside the app shell there is no top bar to hang the
   sparkle on, so the pair sits in the top-LEFT corner with the same
   hover-to-reveal contract: both buttons hold their layout space and only fade,
   which is what keeps an invisible zone hoverable, and focus-visible reveals them
   for the keyboard.

   The drawer is rendered HERE too. AppShell renders it for every in-shell screen
   and this route is deliberately not one of them, so without this the sparkle
   would open nothing. */
export function SmsPreviewPage() {
  const { profile, profileId } = useProfile();
  /* Includes any workflow created by an LSA quote request submitted during this demo,
     newest first — one definition, so a slug that lists here also resolves elsewhere. */
  const extraWfs = useExtraWorkflows(profile);
  const { pathname } = useLocation();
  const { openDrawer, undo, canUndo, readOnly } = useAiAssistant();
  /* ?wf=<slug> selects an extra workflow's agent (e.g. Reyes Law's SMS nurture)
     so the tab previews THAT playbook rather than the default sales one. */
  const [params] = useSearchParams();
  const wf = params.get("wf");
  const copy = builtInCopiesFor(profile).find((c) => c.slug === wf);
  /* The Google Search ad's Message button opens `?wf=rcs` for EVERY prospect, while the
     "<name> - RCS" workflow row is listed for Aptive only, so the title cannot rely on the copy. */
  const label = copy ? `${profile.customerName} - ${copy.suffix}`
    : isRcsSlug(wf) ? `${profile.customerName} - RCS`
    : extraWfs.find((w) => w.slug === wf)?.label;

  /* The same key the rest of the app uses, so this page has its own edits and its
     own undo stack and can never touch another screen. */
  const scopeKey = `${profileId}::${pathname}`;
  const undoable = canUndo(scopeKey) && !readOnly;

  /* ⚠️⚠️ SIDE BY SIDE WITH THE CUSTOM CRM (10/15/2026). Asked for: a hidden button beside Ask
     AI that shows the phone and the Custom CRM together, so every live update is visible while
     the conversation happens. Same tab, same capture store, so the CRM updates on the very
     render that adds a message — no cross-tab sync involved.
     ⚠️ Only for the built-in agent and its copies: an extra workflow is never handed the CRM's
     calendar, so the CRM would have nothing true to show. */
  const crmAble = !wf || !!copy;
  const splitKey = `invoca-demo:pp-split::${profileId}`;
  const [convId, setConvId] = useState<string | null>(null);
  const [split, setSplit] = useState(() => { try { return crmAble && sessionStorage.getItem(splitKey) === "1"; } catch { return false; } });
  const toggleSplit = () => {
    const on = !split;
    /* Connect on first use, so the agent offers the calendar's own openings. Never re-connect
       a CRM somebody switched off. */
    if (on && crmConnection(profile.id) === null) setCrmConnected(profile.id, true);
    setSplit(on);
    try { sessionStorage.setItem(splitKey, on ? "1" : "0"); } catch { /* private window */ }
  };

  /* Full screen (10/15/2026): hides the browser's tabs and address bar so the phone (and the
     CRM beside it) is all that is on screen. Escape leaves it, as the browser always allows. */
  const [full, setFull] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const canFull = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const prev = document.title;
    document.title = `Preview Agent — ${label ?? profile.customerName}`;
    return () => { document.title = prev; };
  }, [profile.customerName, label]);

  return (
    <>
      {/* ⚠️ This page renders OUTSIDE the app shell, so it carries its own Ask AI pair
          and its own drawer — neither of which the shell's guard can reach. A shared
          demo gets neither. */}
      {!isShareMode() && (
      <span className="pp-ai">
          <button
            className="tb-ai-btn tb-ai-spark"
            onClick={() => openDrawer()}
            title="Ask AI — set what this agent asks"
            aria-label="Ask AI to set what this agent asks"
          >
            <span className="material-icons">auto_awesome</span>
          </button>
          <button
            className={"tb-ai-btn" + (undoable ? "" : " tb-ai-btn-off")}
            onClick={() => undoable && undo(scopeKey)}
            disabled={!undoable}
            title={undoable ? "Undo the last AI change to this agent" : "Nothing to undo"}
            aria-label="Undo the last AI change to this agent"
          >
            <span className="material-icons">undo</span>
          </button>
          {crmAble && (
            <button
              className={"tb-ai-btn pp-split-btn" + (split ? " on" : "")}
              onClick={toggleSplit}
              aria-pressed={split}
              title={split ? "Hide the Custom CRM" : "Show the Custom CRM beside the phone"}
              aria-label={split ? "Hide the Custom CRM" : "Show the Custom CRM beside the phone"}
            >
              <span className="material-icons">vertical_split</span>
            </button>
          )}
          {canFull && (
            <button
              className={"tb-ai-btn pp-split-btn" + (full ? " on" : "")}
              onClick={toggleFull}
              aria-pressed={full}
              title={full ? "Exit full screen" : "Full screen"}
              aria-label={full ? "Exit full screen" : "Full screen"}
            >
              <span className="material-icons">{full ? "fullscreen_exit" : "fullscreen"}</span>
            </button>
          )}
        </span>
      )}

      <div className={split ? "pp-split" : undefined}>
        <PhonePreview mode="page" wf={wf} onConversation={setConvId} />
        {split && <div className="pp-crm"><CustomCrm embedded convId={convId} /></div>}
      </div>
      {!isShareMode() && <AiAssistantDrawer />}
    </>
  );
}
