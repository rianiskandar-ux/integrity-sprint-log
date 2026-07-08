FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
# npm ci is NOT run as a Dockerfile RUN step. On this corporate network a
# plain `docker run node:20-alpine npm ci` reliably succeeds (~6-7min, some
# individual package fetches take 40-60s but do complete) while the
# identical install run as a BuildKit RUN step reliably died at ~328-330s
# every single time, including with --network=host (which rules out
# Docker's virtual network/DNS as the cause). That near-identical timing
# across unrelated attempts pointed at BuildKit's own RUN-step session
# handling on Docker Desktop for Windows, not the npm registry connection
# itself. Fix: install deps OUTSIDE the build via `docker run`, then
# `docker commit` that container into a local image (isl-deps-snapshot) and
# COPY --from it here — this stays entirely inside Docker's Linux-side
# storage, avoiding a Windows-symlink-privilege failure that hits if you try
# to `docker cp` node_modules (with its .bin symlinks) out onto the Windows
# host filesystem instead. Run `./prebuild-deps.sh` after any
# package.json/package-lock.json change, before `docker compose build`.
COPY --from=isl-deps-snapshot:latest /app/node_modules ./node_modules

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# CACHE_BUST: pass --build-arg CACHE_BUST=$(date +%s) to force source re-copy.
# The RUN echo creates a real layer dependency so BuildKit busts COPY . . too.
ARG CACHE_BUST=0
RUN echo "cache-bust: $CACHE_BUST"
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

ENV HOME=/home/nextjs

# Claude Code CLI — dipakai provider claude-cli di ISL chat.
# || true: corporate network may block npm during build; fallback = runtime install
# oleh server-wrapper.js ke /opt/claude-cli (named volume, survive rebuild).
RUN npm install -g @anthropic-ai/claude-code || true

# Prefix untuk runtime install claude CLI. Dibuat + di-chown SEBELUM volume mount
# pertama: Docker menyalin ownership dari image ke named volume yang baru.
RUN mkdir -p /opt/claude-cli && chown nextjs:nodejs /opt/claude-cli
ENV PATH="/opt/claude-cli/bin:${PATH}"

# Create writable data dirs
RUN mkdir -p /app/daily-sprints /app/auth-data /app/cache-data /app/data \
    && echo '{"mode":"live"}' > /app/data/op-mode.json \
    && chown -R nextjs:nodejs /app/daily-sprints /app/auth-data /app/cache-data /app/data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ws + node-pty prebuilt from deps stage — copy directly, no compilation.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/ws ./node_modules/ws
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@homebridge ./node_modules/@homebridge
# Doc parser (pdf-parse v1 pure-JS + mammoth) — same standalone-tracing gap as
# above (ws/@homebridge): copy directly, don't rely on Next's file tracing.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/mammoth ./node_modules/mammoth

COPY --chown=nextjs:nodejs server-wrapper.js ./server-wrapper.js

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server-wrapper.js"]
