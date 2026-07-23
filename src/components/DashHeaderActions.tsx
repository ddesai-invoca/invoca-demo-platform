import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";

/* Shared dashboard page-header action row — download, UNDO (the history icon),
   an AI action (auto_awesome), the blue "Add Tile" button, and the kebab. Every
   dashboard renders this. The AI icon opens the "Ask AI" drawer scoped to the
   WHOLE dashboard; the history icon undoes the last AI change (one per click). */
export function DashHeaderActions() {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { openDrawer, undo, canUndo } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  const undoable = canUndo(key);
  return (
    <div className="title-actions">
      <span className="material-icons">file_download</span>
      <span
        className={"material-icons dash-undo" + (undoable ? "" : " dash-undo--off")}
        title={undoable ? "Undo last AI change" : "Nothing to undo"}
        onClick={() => undoable && undo(key)}
      >
        history
      </span>
      <span className="material-icons dash-ai-header" title="Ask AI" onClick={() => openDrawer({ scope: "dashboard" })}>auto_awesome</span>
      <button className="save-btn"><span className="material-icons add-inline">add</span>Add Tile</button>
      <span className="material-icons">more_vert</span>
    </div>
  );
}
