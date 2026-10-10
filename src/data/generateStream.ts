/* =============================================================================
   generateStream.ts — one reader for /api/generate's Server-Sent Events
   -----------------------------------------------------------------------------
   Extracted 10/8/2026 when bulk generation arrived and needed the same stream the
   launch form has read since the beginning.

   ⚠️⚠️ **ONE DEFINITION, TWO CALLERS — and a second copy would have been the easy
   thing to write.** The parse is fiddly (events are separated by a blank line, a
   `data:` line can be missing, a partial chunk must be buffered) and the two callers
   would then drift the first time the engine added an event type: the launch form's
   checklist would keep working and the bulk panel would silently stop advancing, or
   the reverse. This repo records that exact failure for the SMS brain and for the
   workflow scope key.
   ============================================================================= */

export type PhaseStatus = "building" | "done" | "skipped";

export interface GenerateOpts {
  name: string;
  url: string;
  /** Called for every phase event, so a caller can drive its own checklist. */
  onPhase?: (phase: string, status: PhaseStatus) => void;
  /** Aborts the request — used by the bulk panel's Stop button. */
  signal?: AbortSignal;
  /* ⚠️ **THE EXISTING `steer` PATH, FINALLY GIVEN A CALLER AGAIN (10/9/2026).**
     `/api/generate` has accepted this since 9/10 and both twins still parse it
     (`engine/genContext.ts`); what went away in the "remove the advanced settings"
     pass was the UI, not the plumbing. It is appended to the research brief BEFORE
     `generateTerms` runs, so it reaches the phase that picks `bookingTerm` and
     `customerNoun` and therefore every screen downstream of them.
     ⚠️ Omitted entirely when absent, so a generation with no custom prompt sends the
     byte-identical two-field body it always has. */
  steer?: string;
}

/**
 * Resolves the generated profile, or throws with the engine's own message.
 *
 * ⚠️ **A STREAM THAT ENDS WITH NEITHER `done` NOR `error` THROWS.** Returning null
 * there would let a caller report success having built nothing — the silent no-op
 * this repo has paid for repeatedly, and the same rule the Ask AI stream follows.
 */
export async function generateProfile({ name, url, onPhase, signal, steer }: GenerateOpts): Promise<unknown> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, url, ...(steer?.trim() ? { steer: steer.trim() } : {}) }),
    signal,
  });
  if (!res.body) throw new Error("Generation failed: no response stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let profile: unknown = null;
  let streamError: string | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt: { type?: string; phase?: string; status?: string; profile?: unknown; error?: string };
      try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (evt.type === "progress" && evt.phase) {
        onPhase?.(evt.phase, evt.status === "done" ? "done" : evt.status === "skip" ? "skipped" : "building");
      } else if (evt.type === "done") {
        profile = evt.profile;
      } else if (evt.type === "error") {
        streamError = evt.error ?? "Generation failed.";
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!profile) throw new Error("Generation ended without a profile.");
  return profile;
}
