import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { AiAssistantDrawer } from "../components/AiAssistantDrawer";
import { PhonePreview } from "./PhonePreview";

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
  const { pathname } = useLocation();
  const { openDrawer, undo, canUndo, readOnly } = useAiAssistant();
  /* ?wf=<slug> selects an extra workflow's agent (e.g. Reyes Law's SMS nurture)
     so the tab previews THAT playbook rather than the default sales one. */
  const [params] = useSearchParams();
  const wf = params.get("wf");
  const label = (profile.reports.extraWorkflows ?? []).find((w) => w.slug === wf)?.label;

  /* The same key the rest of the app uses, so this page has its own edits and its
     own undo stack and can never touch another screen. */
  const scopeKey = `${profileId}::${pathname}`;
  const undoable = canUndo(scopeKey) && !readOnly;

  useEffect(() => {
    const prev = document.title;
    document.title = `Preview Agent — ${label ?? profile.customerName}`;
    return () => { document.title = prev; };
  }, [profile.customerName, label]);

  return (
    <>
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
      </span>

      <PhonePreview mode="page" wf={wf} />
      <AiAssistantDrawer />
    </>
  );
}
