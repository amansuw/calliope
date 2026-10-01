# ── build ──────────────────────────────────────────────────────────────
FROM node:24-trixie-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── runtime ────────────────────────────────────────────────────────────
FROM node:24-trixie-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools python3 python3-venv ca-certificates tini \
	&& rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# yt-dlp lives in a venv owned by the app user so it can update itself at startup.
RUN python3 -m venv /opt/yt-dlp \
	&& /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]" \
	&& ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
	&& chown -R node:node /opt/yt-dlp

WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./
COPY --chown=node:node docker/reset-password.mjs ./reset-password.mjs
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /data /music && chown node:node /data /music

ENV NODE_ENV=production \
	PORT=7200 \
	CALLIOPE_DATA_DIR=/data \
	MUSIC_DIR=/music \
	STAGING_DIR=/data/staging \
	YTDLP_AUTO_UPDATE=1 \
	BODY_SIZE_LIMIT=10M

USER node
VOLUME ["/data"]
EXPOSE 7200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7200)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD ["node", "build"]
