# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:24-alpine AS deps

# Keep Alpine's official CDN; the previous Aliyun mirror could stall
# indefinitely while downloading the CJK font package. Pin https because this
# build network cannot reach the CDN over plain http.
RUN sed -i 's|http://dl-cdn.alpinelinux.org|https://dl-cdn.alpinelinux.org|g' /etc/apk/repositories \
 && apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm ci --ignore-scripts

# ============================================
# Stage 2: Build the application
# ============================================
FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time environment variables (required for Next.js static optimization)
# These will be baked into the client bundle at build time.
# Runtime environment variables (DATABASE_URL, JWT_SECRET) are injected via docker-compose.
ARG NEXT_PUBLIC_APP_NAME="量房大师管理后台"

RUN npm run build

# Whole-project tracing copies every scripts/ file into the standalone output.
# Remove that traced copy before it becomes an image layer; the runner receives
# only the approved runtime scripts below.
RUN rm -rf /app/.next/standalone/scripts

# The TypeScript build checks scripts/, so the full source tree must stay in the
# build context. The runtime image only receives the scripts that deploy,
# migration, Worker healthchecks and knowledge file parsing actually execute;
# acceptance, live and fixture helpers never enter any runtime layer.
RUN mkdir -p /app/runtime-scripts \
 && cp -p /app/scripts/postgres-migrate.mjs \
      /app/scripts/postgres-integration-migrations.mjs \
      /app/scripts/production-env-check.mjs \
      /app/scripts/lead-claim-worker.mjs \
      /app/scripts/lead-claim-worker-healthcheck.mjs \
      /app/scripts/assistant-worker.mjs \
      /app/scripts/assistant-worker-healthcheck.mjs \
      /app/scripts/assistant-worker-health.mjs \
      /app/scripts/assistant-speech-local.py \
      /app/scripts/assistant-file-parser.mjs \
      /app/scripts/assistant-text-parser.mjs \
      /app/scripts/assistant-xlsx-parser.mjs \
      /app/runtime-scripts/

# ============================================
# Stage 3: Production runner
# ============================================
FROM node:24-alpine AS runner

WORKDIR /app

ARG SFP_RELEASE_VERSION=development
LABEL org.opencontainers.image.title="Smart Floor Planner Admin" \
      org.opencontainers.image.version="$SFP_RELEASE_VERSION"

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3005

RUN sed -i 's|http://dl-cdn.alpinelinux.org|https://dl-cdn.alpinelinux.org|g' /etc/apk/repositories \
 && apk add --no-cache font-noto-cjk libc6-compat
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /data/ai-assets && chown -R nextjs:nodejs /data/ai-assets

# Copy standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Runtime configuration comes from the compose env_file/mounted secrets, never
# from a developer .env file that happened to be present during the build.
RUN rm -f .env .env.local .env.production .env.development .env.test

# Approved runtime script allowlist (see builder stage). Never copy the full
# scripts/ tree because it contains acceptance, live and fixture helpers.
COPY --from=builder /app/runtime-scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle
# Runtime reads opening/workflow registries from this directory.
COPY --from=builder /app/deployment ./deployment
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/@napi-rs/canvas ./node_modules/@napi-rs/canvas
COPY --from=builder /app/node_modules/@napi-rs/canvas-linux-x64-musl ./node_modules/@napi-rs/canvas-linux-x64-musl
# qiniu → urllib → os-name always require()s osx-release/win-release at load
# time. Next standalone tracing on Alpine omits those helpers, so any route
# that shares the Qiniu server chunk (including /api/admin-users) crashes.
COPY --from=builder /app/node_modules/qiniu ./node_modules/qiniu
COPY --from=builder /app/node_modules/os-name ./node_modules/os-name
COPY --from=builder /app/node_modules/osx-release ./node_modules/osx-release
COPY --from=builder /app/node_modules/win-release ./node_modules/win-release
COPY --from=builder /app/node_modules/urllib ./node_modules/urllib
COPY --from=builder /app/node_modules/default-user-agent ./node_modules/default-user-agent

USER nextjs

EXPOSE 3005

CMD ["node", "server.js"]
