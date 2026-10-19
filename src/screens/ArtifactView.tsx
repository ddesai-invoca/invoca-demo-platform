import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { useProfile } from "../data/ProfileContext";
import { usePageData } from "../components/GeneratedTiles";
import { renderArtifact } from "../artifacts";

/* Renders one Gumloop artifact full-page inside an <iframe>. Self-contained HTML
   is passed via srcDoc; a hosted artifact is loaded via src. Opened from a
   "Complete" row in My Reports (/reports/artifact/:id). */
export function ArtifactView() {
  const { profile } = useProfile();
  const { id } = useParams();
  const artifact = profile.reports.gumloopArtifacts?.find((a) => a.id === id);
  // Prefer a live template render from profile data; fall back to inline html/url.
  /* ⚠️ THE ARTIFACT'S SOURCE DATA IS REGISTERED (10/19/2026), the standing rule that Ask AI may
     change any data on any page: the screen-pop and routing-demo slices it is rendered from. The
     artifact is re-rendered from the edited slices, so an edit shows in the iframe. */
  const r = profile.reports;
  const base = useMemo(() => ({ title: artifact?.name ?? "Artifact", data: {
    voiceScreenpop: r.voiceScreenpop, smsScreenpop: r.smsScreenpop, voiceRoutingDemo: r.voiceRoutingDemo,
  } }), [artifact?.name, r.voiceScreenpop, r.smsScreenpop, r.voiceRoutingDemo]);
  const view = usePageData(base);
  const edited = useMemo(() => ({ ...profile, reports: { ...profile.reports, ...(view.data ?? {}) } }) as typeof profile, [profile, view.data]);
  const rendered = id ? renderArtifact(edited, id) : null;
  const html = rendered ?? artifact?.html;
  const url = rendered ? undefined : artifact?.url;

  return (
    <div className="artifact-page">
      <div className="artifact-bar">
        <Link to="/reports" className="artifact-back">
          <span className="material-icons">arrow_back</span> My Reports
        </Link>
        <span className="artifact-name">{artifact?.name ?? "Artifact"}</span>
        <span className="artifact-tag">Gumloop</span>
      </div>

      {artifact && (html || url) ? (
        <iframe
          className="artifact-frame"
          title={artifact.name}
          {...(html ? { srcDoc: html } : { src: url })}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      ) : (
        <div className="placeholder">
          <span className="material-icons placeholder-icon">hourglass_empty</span>
          <h2>{artifact ? "Not ready yet" : "Artifact not found"}</h2>
          <p className="muted">
            {artifact
              ? `"${artifact.name}" is still being created. It'll be ready shortly.`
              : "This artifact isn't available for this prospect."}
          </p>
        </div>
      )}
    </div>
  );
}
