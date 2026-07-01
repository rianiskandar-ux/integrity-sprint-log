FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
# @homebridge/node-pty-prebuilt-multiarch bundles musl/Alpine prebuilts — no compilation needed.
RUN npm ci

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

# Create writable data dirs
RUN mkdir -p /app/daily-sprints /app/auth-data /app/cache-data /app/data \
    && echo '{"mode":"live"}' > /app/data/op-mode.json \
    && chown -R nextjs:nodejs /app/daily-sprints /app/auth-data /app/cache-data /app/data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Claude Code CLI — pure Node.js, no glibc deps needed with USE_BUILTIN_RIPGREP=0.
RUN npm install -g @anthropic-ai/claude-code \
    && mkdir -p /home/nextjs/.claude \
    && chown -R nextjs:nodejs /home/nextjs
ENV HOME=/home/nextjs
ENV USE_BUILTIN_RIPGREP=0

# ws + node-pty prebuilt from deps stage — copy directly, no compilation.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/ws ./node_modules/ws
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@homebridge ./node_modules/@homebridge

COPY --chown=nextjs:nodejs server-wrapper.js ./server-wrapper.js

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server-wrapper.js"]
