import { useEffect, useState, useSyncExternalStore } from "react";
import { useProfile } from "../data/ProfileContext";
import {
  recState, recError, recStartedAt, subscribeRec, startRecording, stopAndSave, discardRecording,
} from "../data/screenRecorder";

/* See src/data/screenRecorder.ts for why the recorder is not component state. */
const useRec = () => useSyncExternalStore(subscribeRec, recState, recState);

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The hidden record button, left of Ask AI in the top bar. Same hover-to-reveal contract as
 * the Ask AI pair (`.tb-ai-btn`), and it STAYS hidden while recording so it never shows in the
 * video; hovering shows a red stop with the elapsed time. The browser's own sharing indicator
 * is what says a recording is running.
 */
export function RecordButton() {
  const state = useRec();
  const { profile } = useProfile();
  const [, tick] = useState(0);
  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  const recording = state === "recording";
  const label = recording ? `Stop recording and save (${mmss(Date.now() - recStartedAt())})`
    : state === "pending" ? "Save the recording" : "Record the screen";
  return (
    <button
      className={"tb-ai-btn tb-rec" + (recording ? " tb-rec-on" : "")}
      onClick={() => {
        if (state === "idle") void startRecording(`${profile.customerName} demo`);
        else if (recording || state === "pending") void stopAndSave();
      }}
      disabled={state === "starting"}
      title={recError() || label}
      aria-label={label}
    >
      <span className="material-icons">{recording ? "stop_circle" : state === "pending" ? "save_alt" : "fiber_manual_record"}</span>
    </button>
  );
}

/**
 * Shown only AFTER a recording ends without the save click (the browser's "Stop sharing" bar,
 * or a cancelled save dialog), so it is never in the video. Mounted at the app root so it
 * appears on every screen, including the ones without a top bar.
 */
export function RecordingSaver() {
  const state = useRec();
  if (state !== "pending") return null;
  return (
    <div className="rec-save" role="status">
      <span className="material-icons">videocam</span>
      <span>Your screen recording is ready.</span>
      <button className="rec-save-go" onClick={() => void stopAndSave()}>Save</button>
      <button className="rec-save-x" onClick={discardRecording}>Discard</button>
    </div>
  );
}
