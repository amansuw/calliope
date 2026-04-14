FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install yt-dlp, ffmpeg, and build tools for native modules
RUN apk add --no-cache ffmpeg python3 py3-pip libc6-compat make g++ && \
    python3 -m pip install --break-system-packages yt-dlp && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data /app/downloads /app/music && \
    chown -R nextjs:nodejs /app/data /app/downloads

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 7200
ENV PORT=7200
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/calliope.db"
ENV TEMP_DOWNLOAD_DIR="/app/downloads"
ENV MUSIC_LIBRARY_DIR="/app/music"

CMD ["node", "server.js"]
