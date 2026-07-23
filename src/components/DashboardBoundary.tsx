import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";

/* Safety net around the routed screens. If an AI data edit produces something a
   dashboard can't render, this catches the error (instead of blanking the app)
   and offers a one-click Undo to restore the previous state. It resets whenever
   `resetKey` changes (route change, or the undo depth changing after an undo). */

class Boundary extends Component<{ resetKey: string; fallback: (reset: () => void) => ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children;
  }
}

function Fallback({ onReset }: { onReset: () => void }) {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { undo, canUndo } = useAiAssistant();
  const key = `${profileId}::${pathname}`;
  return (
    <div className="dash-error">
      <span className="material-icons">error_outline</span>
      <h2>That change couldn't be displayed</h2>
      <p className="muted">The last AI edit produced data this view can't render. Undo it to restore the dashboard.</p>
      {canUndo(key) ? (
        <button className="save-btn" onClick={() => { undo(key); onReset(); }}>
          <span className="material-icons add-inline">undo</span>Undo last change
        </button>
      ) : (
        <button className="save-btn" onClick={onReset}>Reload view</button>
      )}
    </div>
  );
}

export function DashboardBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { profileId } = useProfile();
  const { undoDepth } = useAiAssistant();
  const resetKey = `${pathname}:${undoDepth(`${profileId}::${pathname}`)}`;
  return <Boundary resetKey={resetKey} fallback={(reset) => <Fallback onReset={reset} />}>{children}</Boundary>;
}
