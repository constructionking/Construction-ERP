# ---------------------------------------------------------------------------
# Construction ERP — web (Next.js) production image.
#
# Multi-stage: install deps → generate Prisma client + build → lean runner that
# serves the standalone output. `output: "standalone"` (next.config.ts) means
# the final image ships only the traced runtime, not the full node_modules.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS base
# openssl is required by Prisma's query engine at build and run time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---- deps: full install (dev deps needed for the build) --------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---- builder: prisma generate + next build ---------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runner: minimal image running the standalone server -------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone bundle (server.js + traced node_modules), static assets, public.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Storage lives on a mounted volume; make sure the app can write to it.
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
