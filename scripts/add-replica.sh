#!/usr/bin/env bash
# =============================================================================
# add-replica.sh <slug> — move a fresh capture into the repo and check it
# -----------------------------------------------------------------------------
# Step 3 of the Replicate pipeline. Steps 1 and 2 happen in a browser:
#   1. open the page, dismiss any cookie banner
#   2. paste scripts/capture-replica.js into the console and run captureReplica("<slug>")
#   3. ./scripts/add-replica.sh <slug>
#   4. add a 5-line entry to src/data/replicaPages.ts (no field mapping — it is derived)
#
# ⚠️ The capture arrives as a DOWNLOAD rather than a POST to the dev server: every page worth
#    capturing is HTTPS and the browser blocks mixed content to http://localhost. See the
#    header of capture-replica.js.
# =============================================================================
set -euo pipefail

slug="${1:-}"
if [[ -z "$slug" ]]; then echo "usage: $0 <slug>" >&2; exit 2; fi
if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then echo "slug must be [a-z0-9-]" >&2; exit 2; fi

src="$HOME/Downloads/replica-${slug}.html"
# A download still in flight has a temp name; wait briefly for it to settle.
for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -f "$src" ]] && break; sleep 1; done
if [[ ! -f "$src" ]]; then
  echo "No ~/Downloads/replica-${slug}.html yet." >&2
  echo "Did captureReplica(\"${slug}\") run, and did the download finish?" >&2
  exit 1
fi

# CHECKED BEFORE IT IS COPIED. The first version copied first and validated after, which
# left an unsafe capture sitting in public/replicas - a directory the server happily serves.
dest="public/replicas/${slug}.html"

python3 - "$src" <<'PY'
import re, sys, os
p = sys.argv[1]
s = open(p, encoding="utf-8", errors="replace").read()
# HTML comments can legitimately contain <script>; strip them before counting. See audit-replicas.
live = re.sub(r"<!--[\s\S]*?-->", "", s)
n = lambda t: len(re.findall(rf"<{t}[\s>]", live, re.I))
actions  = len(re.findall(r"<form[^>]*\saction\s*=", live, re.I))
handlers = len(re.findall(r"\son(?:click|submit|load|change)\s*=", live, re.I))
print(f"  {os.path.basename(p)}  {len(s):,} bytes")
print(f"  forms {n('form')}   inputs {n('input')}   textarea {n('textarea')}   select {n('select')}")
print(f"  scripts {n('script')}   iframes {n('iframe')}   form actions {actions}   inline handlers {handlers}")
bad = []
if actions:  bad.append(f"{actions} form action(s) — WOULD POST TO THE REAL SITE")
if n('script'): bad.append(f"{n('script')} live script(s)")
if n('iframe'): bad.append(f"{n('iframe')} iframe(s)")
if handlers: bad.append(f"{handlers} inline handler(s)")
if not n('form'): bad.append("no form at all — the capture missed it")
if "data-replica-css" not in s: bad.append("no inlined CSS — it would render unstyled")
if "<base " not in s: bad.append("no <base href> — assets would 404")
if bad:
    print("\n  NOT SAFE TO SERVE:"); [print("   -", b) for b in bad]; sys.exit(1)
print("\n  clean: inert, styled, has a form")
PY

mkdir -p public/replicas
cp "$src" "$dest"

echo
echo "  -> $dest"
echo "  Add to src/data/replicaPages.ts:"
echo "      ${slug}: { file: \"${slug}.html\", domain: \"<prospect domain>\","
echo "        sourceUrl: \"<the page URL>\", capturedAt: \"$(date +%Y-%m-%d)\", label: \"<what it is>\" },"
echo "  Then open /replica/${slug}"
