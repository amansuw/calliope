#!/bin/sh
set -e

# YouTube breaks old yt-dlp releases regularly; stay current unless told not to.
if [ "${YTDLP_AUTO_UPDATE}" = "1" ]; then
	echo "[entrypoint] updating yt-dlp…"
	/opt/yt-dlp/bin/pip install --no-cache-dir --quiet --upgrade "yt-dlp[default]" \
		|| echo "[entrypoint] yt-dlp update failed, continuing with $(yt-dlp --version)"
fi
echo "[entrypoint] yt-dlp $(yt-dlp --version)"

exec "$@"
