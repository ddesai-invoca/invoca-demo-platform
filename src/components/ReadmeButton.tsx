/* The floating "Read.Me" button, bottom-right of every in-app screen.

   Opens the full documentation: what the tool is, how it works, what it costs, and the
   maintenance guide. Two audiences share one page -- a "The short version" tab for anyone
   and a "Technical detail" tab for maintainers.

   The docs ship WITH the app: `public/readme.html` is copied into `dist/` by the build and
   served by express.static, so the link works on Render, on a local `npm run serve`, and in
   dev -- no external host, no claude.ai account needed to read it. Keep the Markdown source
   of truth at ARCHITECTURE.md in sync when the docs change. */
const README_URL = "/readme.html";

export function ReadmeButton() {
  return (
    <a
      className="readme-fab"
      href={README_URL}
      /* New tab, so clicking the docs never loses the demo the SE is mid-way through. */
      target="_blank"
      rel="noopener noreferrer"
      title="How this tool works, what it costs, and how to maintain it"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H19" />
        <path d="M8.5 7h7M8.5 10.5h4.5" />
      </svg>
      Read.Me
    </a>
  );
}
