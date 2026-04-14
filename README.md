# Calliope

A self-hosted music downloader and organizer for Spotify + YouTube sources.

Calliope resolves tracks/playlists, downloads audio with `yt-dlp`, enriches files
with metadata/lyrics, moves them into your library structure, and keeps history
in SQLite with a Next.js UI.

## Features

- Download from Spotify track/playlist links and YouTube video/playlist links.
- Automatic YouTube matching for Spotify tracks (duration-aware best match).
- Audio output formats: `mp3`, `opus`, `flac`.
- Metadata embedding via FFmpeg (title, artist, album, lyrics, cover art).
- Fast duplicate detection by source ID + metadata/library checks.
- Playlist monitoring with immediate checks, hourly cron scans, and manual scan controls.
- Discord notifications for completed downloads, playlist updates, and errors.
- Optional Navidrome rescan trigger after successful downloads.
- Live dashboard (home), downloads queue/history view, playlist monitor, and settings.

## Tech Stack

- Next.js App Router (`app/` + API routes in `app/api/`)
- SQLite (`better-sqlite3`) in-process
- `yt-dlp` + `ffmpeg` external binaries
- Spotify metadata via `spotify-scraper` CLI with fallback parser from Spotify web page data

## Project Structure

- `app/page.tsx` - Dashboard (home)
- `app/downloads/page.tsx` - download queue/history
- `app/playlists/page.tsx` - monitored playlists
- `app/settings/page.tsx` - settings and integration status
- `app/api/*` - API routes
- `components/` - client UI components
- `lib/db.ts` - schema and DB helpers
- `lib/queue.ts` - core download pipeline and job orchestration
- `lib/downloader.ts` - yt-dlp search/playlist/download/auth logic
- `lib/cron.ts` - monitored playlist polling and enqueue behavior
- `lib/runtime.ts` - one-time background startup bootstrap
- `lib/metadata.ts` - FFmpeg metadata embedding
- `lib/mover.ts` - final library path generation and file move
- `docker-compose.yml` / `Dockerfile` - containerized deployment

## Requirements

### Local runtime requirements

- Node.js 20+
- `yt-dlp` available in `PATH`
- `ffmpeg` available in `PATH`
- `spotify-scraper` optional (recommended for full Spotify metadata); fallback parsing is built in

### Docker runtime requirements

Docker image installs `yt-dlp` and `ffmpeg` for you. You still need:

- working host path mounts for downloads/library
- valid environment configuration

## Quick Start (Local)

1. Install dependencies: `npm ci`
2. Configure environment (create/update `.env`)
3. Start dev server: `npm run dev`
4. Open `http://localhost:7200`

## Quick Start (Docker)

Run: `docker compose up -d --build`

Default port mapping is `7200:7200`.

## Environment Variables

### Core

- `DATABASE_URL`
  - `file:./calliope.db` (local)
  - `file:/app/data/calliope.db` (container)
- `TEMP_DOWNLOAD_DIR`
- `MUSIC_LIBRARY_DIR`

### Optional Integrations

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`
- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASSWORD`

### Downloader auth (age-restricted YouTube support)

Set one:

- `YTDLP_COOKIES_FROM_BROWSER` (`firefox`, `chrome`, `chromium`, `brave`, etc.)
- `YTDLP_COOKIES_FILE` (absolute path to `cookies.txt`)

If both are set, `YTDLP_COOKIES_FILE` takes precedence.

For headless servers, `YTDLP_COOKIES_FILE` is recommended.

### Spotify scraper override

- `SPOTIFY_SCRAPER_CMD` (defaults to `spotify-scraper`)

## Download Pipeline

For each track:

1. URL parsing and job creation
2. Resolve source metadata
3. Fast duplicate check by source ID (`spotify_id`/`youtube_id`)
4. Metadata duplicate check by artist/title (+ library file check)
5. Download audio via `yt-dlp`
6. Fetch lyrics from LRCLIB
7. Embed metadata/artwork with FFmpeg
8. Move into library path:
   - `{MUSIC_LIBRARY_DIR}/{artist}/{album}/{title}.{ext}`
   - or `{MUSIC_LIBRARY_DIR}/{artist}/{title}.{ext}`
9. Optional Discord notify + Navidrome rescan

## API Overview

- `POST /api/add` - enqueue one or many URLs
- `GET /api/jobs` - list jobs with tracks
- `GET /api/jobs/:id` - fetch one job
- `DELETE /api/jobs/:id` - remove job + tracks
- `GET /api/search?q=...` - search completed tracks
- `GET /api/stats` - aggregate stats
- `GET /api/settings` - integration/path/default settings snapshot
- `PATCH /api/settings` - update defaults (`default_format`, `default_quality`)
- `GET /api/playlists` - list monitored playlists (+ per-track statuses)
- `POST /api/playlists` - add monitored playlist
- `PATCH /api/playlists/:id` - update playlist flags and trigger immediate recheck
- `DELETE /api/playlists/:id` - remove monitored playlist
- `POST /api/playlists/scan` - run immediate scan across all playlists
- `GET /api/events` - Server-Sent Events stream for queue events

## Data Model (SQLite)

Tables created automatically:

- `settings`
- `jobs`
- `tracks`
- `monitored_playlists`

Default settings seed:

- `default_format = mp3`
- `default_quality = 320`

## Notes and Operational Caveats

- Queue processing is in-process; if the app process restarts, in-memory queue
  state is lost (DB history remains).
- Playlist monitor runs hourly via `lib/cron.ts` and starts automatically at runtime
  when API routes initialize background services.
- Playlists page includes per-playlist **Scan now** and global **Scan all** controls.
- Keep secrets out of version control. Use environment management practices and
  do not commit real tokens/passwords.

## Scripts

- `npm run dev` - start development server on port `7200`
- `npm run build` - production build
- `npm run start` - start production server on port `7200`

## License

No license file is currently defined in this repository.
