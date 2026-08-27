# The LiveKit voice agent worker, built for LiveKit Cloud.
#
# ⚠️ Requirements this file exists to satisfy, from LiveKit's own build docs — each one is a
# failed deploy if you get it wrong:
#   • a glibc base (Debian/Ubuntu). Alpine/musl is NOT supported.
#   • do NOT run as root.
#   • an explicit WORKDIR.
#   • a fixed CMD that launches the agent with the `start` command directly, no wrapper script
#     and no backgrounding. `dev` is for a laptop; `start` is what connects and waits for jobs.
#   • do NOT set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET here — LiveKit Cloud injects
#     them at runtime, and baking them into an image is how a key ends up in a registry.
#
# ⚠️ THIS SHIPS `agent/` ONLY, so the React bundle, the demo store and the engine never enter
# the image and nothing in it can be imported by the browser.
FROM node:22-slim

# The agent reaches Anthropic over TLS; the slim image ships without the CA bundle.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code-only change does not reinstall them.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY voiceAgent.js ./

# ⚠️ NOT ROOT. `node` is an unprivileged user the base image already provides; it owns /app so
# the runtime can write its own caches.
RUN chown -R node:node /app
USER node

CMD ["node", "voiceAgent.js", "start"]
