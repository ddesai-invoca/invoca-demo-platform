import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { AiAssistantDrawer } from "./AiAssistantDrawer";
import { isShareMode } from "../data/shareMode";

/* =============================================================================
   StandaloneAi — Ask AI + Undo for a screen that renders OUTSIDE the app shell
   -----------------------------------------------------------------------------
   The standing rule (10/16/2026) is that Ask AI may change any data on any page.
   The Salesforce, Google, ChatGPT and Custom CRM screens are replicas of somebody
   else's product, so they carry no Invoca top bar, which is where the sparkle and
   the drawer live everywhere else. This is that pair for them: one fixed corner,
   INVISIBLE until hovered (the same fade contract as `.tb-ai`), so at rest the
   replica still looks exactly like the product it copies.

   It edits THIS page's own scope (`<profileId>::<pathname>`), which the screen
   registers by passing its derived data to `usePageData` and drawing from the
   result. A screen that registers nothing gets a drawer with nothing to change, so
   mount this only beside a `usePageData` call. Never on a shared demo.
   ============================================================================= */
export function StandaloneAi({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { openDrawer, undo, canUndo, readOnly } = useAiAssistant();
  if (isShareMode()) return null;
  const key = `${profileId}::${pathname}`;
  const undoable = canUndo(key) && !readOnly;
  return (
    <>
      <span className={"sa-ai sa-ai--" + tone}>
        <button className="tb-ai-btn tb-ai-spark" onClick={() => openDrawer()}
          title="Ask AI about this page" aria-label="Ask AI about this page">
          <span className="material-icons">auto_awesome</span>
        </button>
        <button className={"tb-ai-btn" + (undoable ? "" : " tb-ai-btn-off")}
          onClick={() => undoable && undo(key)} disabled={!undoable}
          title={undoable ? "Undo the last AI change on this page" : "Nothing to undo"}
          aria-label="Undo the last AI change on this page">
          <span className="material-icons">undo</span>
        </button>
      </span>
      <AiAssistantDrawer />
    </>
  );
}
