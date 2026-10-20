/* =============================================================================
   screenRecorder — the hidden record button beside Ask AI (10/20/2026).

   Asked for: "a hidden record button next to the Ask AI icon that records the entire
   screen. Then I can click it again to stop, and then it just downloads it to my laptop.
   It asks me where to download it, so you're not saving it."

   ⚠️⚠️ NOTHING LEAVES THE BROWSER. The video is held in memory while recording and written
   straight to a file the user picks (`showSaveFilePicker`), never uploaded and never put in
   localStorage. Where the picker does not exist (Safari, Firefox) it falls back to an
   ordinary download, and whether that asks where to save is the browser's own setting.

   ⚠️ A MODULE-LEVEL SINGLETON, NOT COMPONENT STATE. The button lives in the top bar, which
   unmounts on the standalone screens (Preview Agent, Google Search, Salesforce). Holding the
   recorder in React state there would stop the recording the moment the demo moved to one of
   them, which is exactly when a demo is worth recording.

   ⚠️ THE SAVE DIALOG MUST OPEN INSIDE THE CLICK. `showSaveFilePicker` needs a user gesture,
   and the gesture is gone after the first `await`; so the click that stops the recording
   opens the dialog FIRST and only then waits for the last chunk. If the recording is ended
   any other way (the browser's own "Stop sharing" bar), there is no gesture, so the video is
   kept and `RecordingSaver` asks for one click to save it.
   ============================================================================= */

export type RecState = "idle" | "starting" | "recording" | "pending";

let state: RecState = "idle";
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let streams: MediaStream[] = [];
let audioCtx: AudioContext | null = null;
let pending: Blob | null = null;
let mime = "";
let startedAt = 0;
let fileStem = "Invoca demo";
let error = "";
const subs = new Set<() => void>();

const set = (s: RecState) => { state = s; subs.forEach((f) => f()); };
export const recState = () => state;
export const recError = () => error;
export const recStartedAt = () => startedAt;
export function subscribeRec(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** MP4 where the browser can record it (Chrome 126+), else WebM. */
function pickMime(): string {
  const want = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return want.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}
const ext = () => (mime.startsWith("video/mp4") ? "mp4" : "webm");
const pad = (n: number) => String(n).padStart(2, "0");
function fileName(): string {
  const d = new Date(startedAt || Date.now());
  const safe = fileStem.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Invoca demo";
  return `${safe} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${ext()}`;
}

function release() {
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  void audioCtx?.close().catch(() => {});
  audioCtx = null;
  recorder = null;
}

/** Starts recording the screen the user picks, with its sound and their microphone. */
export async function startRecording(stem: string): Promise<void> {
  if (state !== "idle") return;
  error = ""; fileStem = stem; set("starting");
  try {
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia: (o?: unknown) => Promise<MediaStream> };
    if (!md?.getDisplayMedia || typeof MediaRecorder === "undefined") throw new Error("This browser cannot record the screen.");
    /* The whole screen is offered first; the browser still lets the user pick a window or tab. */
    const display = await md.getDisplayMedia({
      video: { displaySurface: "monitor", frameRate: 30 }, audio: true,
      selfBrowserSurface: "include", systemAudio: "include", monitorTypeSurfaces: "include",
    });
    streams.push(display);
    /* The microphone too, so a voice-agent call records both sides. Optional: a refusal or no
       microphone still records the screen. */
    let mic: MediaStream | null = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }); streams.push(mic); }
    catch { mic = null; }
    const out = new MediaStream(display.getVideoTracks());
    const sources = [display, mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    if (sources.length === 1) out.addTrack(sources[0].getAudioTracks()[0]);
    else if (sources.length > 1) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      sources.forEach((s) => audioCtx!.createMediaStreamSource(s).connect(dest));
      out.addTrack(dest.stream.getAudioTracks()[0]);
    }
    mime = pickMime();
    chunks = [];
    recorder = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    mime = recorder.mimeType || mime;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    /* Ended from the browser's own "Stop sharing" bar: keep the video, ask for one save click. */
    display.getVideoTracks()[0].addEventListener("ended", () => { if (state === "recording") void finish().then(holdForSave); });
    recorder.start(1000);
    startedAt = Date.now();
    set("recording");
  } catch (e) {
    release();
    /* Cancelling the browser's screen picker is a choice, not a failure. */
    error = (e as DOMException)?.name === "NotAllowedError" ? "" : ((e as Error)?.message || "Could not start recording.");
    set("idle");
  }
}

/** Stops the recorder and resolves with the whole video. */
function finish(): Promise<Blob> {
  return new Promise((resolve) => {
    const r = recorder;
    if (!r || r.state === "inactive") { resolve(new Blob(chunks, { type: mime })); release(); return; }
    r.onstop = () => { resolve(new Blob(chunks, { type: mime || "video/webm" })); release(); };
    r.stop();
  });
}
function holdForSave(b: Blob) { pending = b; set("pending"); }

type Picker = (o: unknown) => Promise<FileSystemFileHandle>;
async function writeTo(handle: FileSystemFileHandle, b: Blob) {
  const w = await (handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
  await w.write(b); await w.close();
}
function download(b: Blob) {
  const url = URL.createObjectURL(b);
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName() });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const pickerOpts = () => ({
  suggestedName: fileName(),
  types: [{ description: "Video", accept: { [ext() === "mp4" ? "video/mp4" : "video/webm"]: [`.${ext()}`] } }],
});

/**
 * The second click: stop and save. Call it straight from the click handler, before any other
 * await, or the save dialog is refused for lack of a gesture.
 */
export async function stopAndSave(): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (state === "recording") {
    const handleP = picker ? picker(pickerOpts()) : null;    // opened inside the gesture
    const blobP = finish();
    if (!handleP) { download(await blobP); set("idle"); return; }
    try { const [h, b] = await Promise.all([handleP, blobP]); await writeTo(h, b); set("idle"); }
    catch { holdForSave(await blobP); }                       // dialog cancelled: keep the video
    return;
  }
  if (state === "pending" && pending) {
    const b = pending;
    if (!picker) { download(b); pending = null; set("idle"); return; }
    try { await writeTo(await picker(pickerOpts()), b); pending = null; set("idle"); }
    catch { /* cancelled again: still kept */ }
  }
}

/** Throws a finished-but-unsaved recording away. */
export function discardRecording() { pending = null; chunks = []; set("idle"); }
