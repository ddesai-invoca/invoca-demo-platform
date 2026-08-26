# The LiveKit voice agent worker.
#
# ⚠️ THIS IS THE WORKER ONLY, not the web app. It ships just `agent/`, so the React bundle,
# the demo store and the engine never enter this image — and nothing here can accidentally
# be imported by the browser.
#
# ⚠️ `npm start`, NOT `npm run dev`. The framework picks its health port by mode: start binds
# a fixed 8081 (right for a container, which owns its port space), dev binds an ephemeral one
# (right for a laptop, where a leftover worker would otherwise collide). Getting this backwards
# gives you EADDRINUSE in one place and an unreachable health check in the other.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so a code-only change does not reinstall them.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY voiceAgent.js ./

# The framework serves its health endpoint here in production mode.
EXPOSE 8081

CMD ["node", "voiceAgent.js", "start"]
