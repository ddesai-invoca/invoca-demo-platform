import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { reportClientError } from "../data/clientErrors";

/* Safety net around the routed screens. If an AI data edit produces something a
   dashboard can't render, this catches the error (instead of blanking the app)
   and offers a one-click Undo to restore the previous state. It resets whenever
   `resetKey` changes (route change, or the undo depth changing after an undo). */

class Boundary extends Component<{ resetKey: string; report?: (e: unknown) => void; fallback: (reset: () => void) => ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  /* ⚠️⚠️ **THIS BOUNDARY USED TO SWALLOW THE ERROR ENTIRELY (fixed 9/16/2026).** It
     caught the throw, rendered a tidy Undo button and reported it NOWHERE — so the
     one screen in the app that knows a render has failed was also the one place
     certain not to tell anybody. `componentDidCatch` is the React-sanctioned side
     effect hook, and it runs in addition to `getDerivedStateFromError`, so the
     fallback behaves exactly as before. */
  componentDidCatch(error: unknown) { this.props.report?.(error); }
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
  return (
    <Boundary
      resetKey={resetKey}
      /* The prospect goes along because this boundary's whole subject is data that
         a view could not render — which demo was open is the first thing anybody
         would ask, and it is what makes the failure reproducible. */
      report={(e) => reportClientError({
        where: "boundary", route: pathname, prospect: profileId,
        name: (e as Error)?.name, message: (e as Error)?.message, stack: (e as Error)?.stack,
      })}
      fallback={(reset) => <Fallback onReset={reset} />}
    >{children}</Boundary>
  );
}

/**
 * The same net, for the screens that are NOT inside the app shell.
 *
 * ⚠️⚠️ **`DashboardBoundary` ONLY EVER WRAPPED `AppShell`'s `<Outlet/>`**, so Launch,
 * the Preview Agent phone, Google Search, the four Salesforce screens and `/replica`
 * had no boundary at all — a render error there blanked the whole app rather than one
 * pane. Those routes render outside the shell on purpose, which also means they have
 * no `useAiAssistant` scope and no undo to offer, so this one reports and offers a
 * reload instead of pretending an Undo exists.
 */
export function ScreenBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Boundary
      resetKey={pathname}
      report={(e) => reportClientError({
        where: "boundary", route: pathname,
        name: (e as Error)?.name, message: (e as Error)?.message, stack: (e as Error)?.stack,
      })}
      fallback={(reset) => (
        <div className="dash-error">
          <span className="material-icons">error_outline</span>
          <h2>This screen could not be displayed</h2>
          <p className="muted">Something went wrong rendering it. It has been reported.</p>
          <button className="save-btn" onClick={reset}>Try again</button>
        </div>
      )}
    >{children}</Boundary>
  );
}
