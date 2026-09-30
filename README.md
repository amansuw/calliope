# Calliope

Self-hosted music harvester and library studio. Paste Spotify or YouTube links, or monitor playlists,
albums and channels, and Calliope matches, downloads, tags and files every track into your library.

Calliope v2: a ground-up rewrite of the original Next.js app on SvelteKit 5, Drizzle and SQLite.

## Features

**Sync Hub**

- **Pipeline:** a persistent download queue that survives restarts, with parallel workers, live
  progress/speed/ETA over SSE, per-track yt-dlp logs, drag-and-drop reordering, pause/resume and
  retries with backoff.
- **Sources:** monitor Spotify playlists and albums, and YouTube playlists, albums and channels.
  Each source has its own schedule (15 min to daily, or manual), and new tracks are either
  auto-queued or held in a diff preview for you to pick from.
- **Matching:** Spotify tracks are matched to YouTube using the top YouTube Music result plus
  YouTube search. Candidates are scored on title, artist and duration, and live, cover and remix
  uploads are penalized. Low-confidence matches are flagged, and very low ones are rejected.
- **Tagging:** title, artists, album, album artist, track/disc numbers, year, cover art and
  (synced) lyrics from LRCLIB, written natively with TagLib for MP3, M4A, Opus and FLAC.
- **Filing:** a folder template engine, e.g. `{albumartist|artist}/{album|Singles}/[{track:02} - ]{title}`.
- **Integrations:** Navidrome rescan and Discord notifications (webhook or bot).

**Library**

- **Library Explorer:** an incremental scanner (re-reads only changed files), a virtualized track
  table with multi-column sort (shift-click adds a sort key), instant search, format/quality/missing-tag
  filters, an artist facet, an album grid and a track details drawer.
- **Player:** Web Audio playback with an interactive waveform, live spectrum visualizer,
  near-gapless transitions, loudness normalization (capped by each track's peak headroom), media keys
  and a play queue.
- **Metadata Studio:** a spreadsheet-style tag grid with staged edits (nothing is written until you
  save). Tools:
  - bulk edit
  - find/replace, with regex
  - casing fixes
  - filename pattern parser (`%track% - %artist% - %title%`)
  - track numbering
  - MusicBrainz search and auto-match, plus AcoustID audio identification
  - Cover Art Archive artwork, image upload, LRCLIB lyrics
  - organize files by template
- **Duplicate Inspector:** three engines (identical audio hash, same normalized tags, Chromaprint
  acoustic similarity) and a side-by-side comparison matrix. The best copy is picked automatically,
  and resolving can merge missing tags, artwork and lyrics into it. Removed copies go to a quarantine
  folder with one-click restore; permanent deletion requires typing a confirmation.

## Running with Docker

```bash
cp docker-compose.example.yml docker-compose.yml   # edit the volume paths and password
docker compose up -d --build
```

Open `http://localhost:7200`. The image bundles FFmpeg, Chromaprint, deno and yt-dlp, and updates
yt-dlp on every start (`YTDLP_AUTO_UPDATE=1`). YouTube regularly breaks old yt-dlp releases.

Behind a reverse proxy, set `ORIGIN` to the public URL, or sign-in form posts are rejected.

## Running locally

Requirements: Node 24+, `yt-dlp` (recent), `ffmpeg`/`ffprobe`, and ideally `deno` (yt-dlp uses it
for YouTube). `fpcalc` (Chromaprint) is optional.

```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:7200
```

The first visit opens a setup screen to choose the library and staging folders and set a password.

## Coming from Calliope v1

Mount the old data volume and use **Settings › Account & data › Import from Calliope v1** (or set
`LEGACY_DB`). This imports monitored playlists and finished-download history, so monitors don't
re-download what you already have.

## Notes

- **Spotify:** playlists are read from public embed pages, which list at most 100 tracks. Spotify's
  February 2026 API changes restrict playlist contents to playlists the app owner owns. Adding API
  credentials still helps with album and track metadata (album names, track numbers, release dates).
- **Formats:** YouTube audio is lossy. The FLAC preset stores it losslessly but adds no quality.
  Opus avoids re-encoding.

## Development

| Command                      |                                                                  |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Dev server on :7200                                              |
| `npm run check`              | Type-check (svelte-check)                                        |
| `npm test`                   | Unit tests (vitest)                                              |
| `npm run db:generate`        | Generate a migration after editing `src/lib/server/db/schema.ts` |
| `npm run build && npm start` | Production build                                                 |

Layout: `src/lib/server/` holds the pipeline, sources, sync scheduler, tagging and integrations.
`src/lib/components/` holds the UI. Routes live under `src/routes/(app)` and `src/routes/api`.

## License

The Unlicense. See `LICENSE`.
