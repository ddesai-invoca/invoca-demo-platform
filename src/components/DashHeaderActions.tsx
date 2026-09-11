import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";

/* Shared dashboard page-header action row — download, UNDO (the history icon),
   the blue "Add Tile" button, and the kebab. Every dashboard renders this.
   ⚠️ NO AI ICON HERE, DELIBERATELY (removed 9/11/2026, asked for directly: "there
   is already one at the top of page"). TopBar's own hover-revealed sparkle
   (`.tb-ai`) opens the SAME "Ask AI" drawer on every page including this one, so
   a second one here was pure duplication, not a second capability. The history
   icon still lives here rather than in TopBar because it undoes THIS page's own
   edit stack, which TopBar's own undo button already does identically — keeping
   both is fine since undo is cheap chrome, not a second AI entry point. */
export function DashHeaderActions() {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { undo, canUndo } = useAiAssistant();
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
      <button className="save-btn"><span className="material-icons add-inline">add</span>Add Tile</button>
      <span className="material-icons">more_vert</span>
    </div>
  );
}
