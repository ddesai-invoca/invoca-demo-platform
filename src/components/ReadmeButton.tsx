/* The floating "Readme" button, bottom-right of every in-app screen.

   Opens the architecture write-up — what the tool is, how it works, what it costs, and
   the maintenance guide — in a new tab. Two audiences share one page: it has a
   "The short version" tab for anyone and a "Technical detail" tab for maintainers.

   ⚠️ The URL is a published artifact, not a repo file, so it cannot be verified by the
   typechecker or the build. If the link ever 404s, republish the doc and update the
   constant here. The Markdown source of truth lives at ARCHITECTURE.md in this repo. */
const README_URL = "https://claude.ai/code/artifact/1a1bd651-eb04-4445-9977-3c8c336f09fc";

export function ReadmeButton() {
  return (
    <a
      className="readme-fab"
      href={README_URL}
      target="_blank"
      /* noopener keeps the new tab from getting a handle on this one. */
      rel="noopener noreferrer"
      title="How this tool works, what it costs, and how to maintain it"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H19" />
        <path d="M8.5 7h7M8.5 10.5h4.5" />
      </svg>
      Readme
    </a>
  );
}
