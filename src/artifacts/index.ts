import type { CustomerProfile, GumloopArtifact, VoiceRoutingDemo, VoiceScreenpop } from "../data/schema";
import { renderVoiceScreenpop } from "./voiceScreenpop";
import { renderSmsScreenpop } from "./smsScreenpop";
import { renderVoiceRoutingDemo } from "./voiceRoutingDemo";

/* Resolve a Gumloop artifact id → self-contained HTML, rendered from the
   profile's typed data slices. Returns null when the profile has no data for
   that artifact (callers then fall back to any inline html/url on the
   artifact). */
export interface ArtifactOverrides {
  /* The two (Voice AI) artifacts, derived from a call the SE just had. Absent for the seeded
     ones, so those render exactly as before. */
  voiceRoutingDemo?: VoiceRoutingDemo;
  voiceScreenpop?: VoiceScreenpop;
}

/** The two ids that only exist once a real call has been transferred. */
export const VOICE_AI_ROUTING_ID = "voice-routing-demo-ai";
export const VOICE_AI_SCREENPOP_ID = "voice-screenpop-ai";

export function renderArtifact(profile: CustomerProfile, id: string, ov?: ArtifactOverrides): string | null {
  switch (id) {
    /* ⚠️ **THE (Voice AI) PAIR RENDERS THE SAME TEMPLATES, ONLY THE DATA DIFFERS.** They are
       not a second copy of the artifact: the whole point is that a prospect sees the identical
       leave-behind, carrying the call that just happened. Returns null without an override, so
       a stale row can never fall back to the seeded script and read as the live call. */
    case VOICE_AI_ROUTING_ID:
      return ov?.voiceRoutingDemo ? renderVoiceRoutingDemo(ov.voiceRoutingDemo) : null;
    case VOICE_AI_SCREENPOP_ID:
      return ov?.voiceScreenpop ? renderVoiceScreenpop(ov.voiceScreenpop) : null;
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
export function openArtifact(profile: CustomerProfile, artifact: GumloopArtifact, ov?: ArtifactOverrides): void {
  if (artifact.status !== "complete") return;
  const html = renderArtifact(profile, artifact.id, ov) ?? artifact.html;
  if (html) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // Revoke after the new tab has had time to load (keeps reload working briefly).
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else if (artifact.url) {
    window.open(artifact.url, "_blank", "noopener");
  }
}
