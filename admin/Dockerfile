# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:20-alpine AS deps

# Keep Alpine's official CDN; the previous Aliyun mirror could stall
# indefinitely while downloading the CJK font package.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm ci --ignore-scripts

# ============================================
# Stage 2: Build the application
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time environment variables (required for Next.js static optimization)
# These will be baked into the client bundle at build time.
# Runtime environment variables (DATABASE_URL, JWT_SECRET) are injected via docker-compose.
ARG NEXT_PUBLIC_APP_NAME="量房大师管理后台"

RUN npm run build

# ============================================
# Stage 3: Production runner
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

ARG SFP_RELEASE_VERSION=development
LABEL org.opencontainers.image.title="Smart Floor Planner Admin" \
      org.opencontainers.image.version="$SFP_RELEASE_VERSION"

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3005

RUN apk add --no-cache font-noto-cjk libc6-compat
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /data/ai-assets && chown -R nextjs:nodejs /data/ai-assets

# Copy standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 2. 【新增】明确拷贝 scripts 目录，这样镜像里才有 seed-admin.js
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle
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
