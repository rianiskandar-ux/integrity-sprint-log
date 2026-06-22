FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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

# Claude Code CLI (untuk LLM provider 'claude-cli').
# Alpine/musl: butuh libc6-compat + ripgrep sistem (jangan pakai ripgrep bawaan glibc).
RUN apk add --no-cache libc6-compat ripgrep git \
    && npm install -g @anthropic-ai/claude-code \
    && mkdir -p /home/nextjs/.claude \
    && chown -R nextjs:nodejs /home/nextjs
ENV HOME=/home/nextjs
ENV USE_BUILTIN_RIPGREP=0

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
