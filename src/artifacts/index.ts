import type { CustomerProfile, GumloopArtifact } from "../data/schema";
import { renderVoiceScreenpop } from "./voiceScreenpop";
import { renderSmsScreenpop } from "./smsScreenpop";
import { renderVoiceRoutingDemo } from "./voiceRoutingDemo";

/* Resolve a Gumloop artifact id → self-contained HTML, rendered from the
   profile's typed data slices. Returns null when the profile has no data for
   that artifact (callers then fall back to any inline html/url on the
   artifact). */
export function renderArtifact(profile: CustomerProfile, id: string): string | null {
  switch (id) {
    case "voice-screenpop":
      return profile.reports.voiceScreenpop
        ? renderVoiceScreenpop(profile.reports.voiceScreenpop)
        : null;
    case "sms-screenpop":
      return profile.reports.smsScreenpop
        ? renderSmsScreenpop(profile.reports.smsScreenpop)
        : null;
    case "voice-routing-demo":
      return profile.reports.voiceRoutingDemo
        ? renderVoiceRoutingDemo(profile.reports.voiceRoutingDemo)
        : null;
    default:
      return null;
  }
}

/* Open a (complete) artifact in a NEW browser tab, standalone — no platform
   chrome. Rendered HTML is served via a Blob URL; a hosted artifact opens its
   url directly. No-ops for artifacts that aren't ready. */
export function openArtifact(profile: CustomerProfile, artifact: GumloopArtifact): void {
  if (artifact.status !== "complete") return;
  const html = renderArtifact(profile, artifact.id) ?? artifact.html;
  if (html) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // Revoke after the new tab has had time to load (keeps reload working briefly).
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else if (artifact.url) {
    window.open(artifact.url, "_blank", "noopener");
  }
}
