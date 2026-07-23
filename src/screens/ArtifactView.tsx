import { Link, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { renderArtifact } from "../artifacts";

/* Renders one Gumloop artifact full-page inside an <iframe>. Self-contained HTML
   is passed via srcDoc; a hosted artifact is loaded via src. Opened from a
   "Complete" row in My Reports (/reports/artifact/:id). */
export function ArtifactView() {
  const { profile } = useProfile();
  const { id } = useParams();
  const artifact = profile.reports.gumloopArtifacts?.find((a) => a.id === id);
  // Prefer a live template render from profile data; fall back to inline html/url.
  const rendered = id ? renderArtifact(profile, id) : null;
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
