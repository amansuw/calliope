import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.DATABASE_URL?.replace("file:", "").replace("./", "") ||
  "calliope.db";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = path.isAbsolute(DB_PATH)
      ? DB_PATH
      : path.join(process.cwd(), DB_PATH);
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error TEXT,
      format TEXT DEFAULT 'mp3',
      quality TEXT DEFAULT '320',
      track_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      spotify_id TEXT,
      youtube_id TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      duration_s INTEGER,
      cover_url TEXT,
      youtube_url TEXT,
      lyrics TEXT,
      lyrics_synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      error TEXT,
      confidence TEXT,
      file_size INTEGER,
      temp_path TEXT,
      final_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS monitored_playlists (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      name TEXT,
      track_ids TEXT,
      last_checked DATETIME,
      new_tracks_count INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS library_tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      duration_s INTEGER,
      file_size INTEGER,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_library_artist_title ON library_tracks(LOWER(artist), LOWER(title));
  `);

  // Seed default settings
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  insert.run("default_format", "mp3");
  insert.run("default_quality", "320");
  insert.run("temp_dir", process.env.TEMP_DOWNLOAD_DIR || "./downloads");
  insert.run("music_dir", process.env.MUSIC_LIBRARY_DIR || "./music");

  // Migration: if path settings don't exist in DB but env vars do, migrate to DB
  const migrateFromEnv = () => {
    const tempDir = process.env.TEMP_DOWNLOAD_DIR;
    const musicDir = process.env.MUSIC_LIBRARY_DIR;

    const existingTemp = db.prepare("SELECT value FROM settings WHERE key = 'temp_dir'").get() as { value: string } | undefined;
    if (!existingTemp && tempDir) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('temp_dir', ?)").run(tempDir);
    }

    const existingMusic = db.prepare("SELECT value FROM settings WHERE key = 'music_dir'").get() as { value: string } | undefined;
    if (!existingMusic && musicDir) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_dir', ?)").run(musicDir);
    }
  };
  migrateFromEnv();
}

// --- Settings helpers ---

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

// --- Job helpers ---

export interface JobRow {
  id: string;
  url: string;
  source: string;
  type: string;
  status: string;
  error: string | null;
  format: string;
  quality: string;
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface TrackRow {
  id: string;
  job_id: string;
  spotify_id: string | null;
  youtube_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_s: number | null;
  cover_url: string | null;
  youtube_url: string | null;
  lyrics: string | null;
  lyrics_synced: number;
  status: string;
  progress: number;
  error: string | null;
  confidence: string | null;
  file_size: number | null;
  temp_path: string | null;
  final_path: string | null;
  created_at: string;
}

export interface MonitoredPlaylistRow {
  id: string;
  url: string;
  source: string;
  name: string | null;
  track_ids: string | null;
  last_checked: string | null;
  new_tracks_count: number;
  enabled: number;
  created_at: string;
}

export interface PlaylistTrackStatus {
  source_id: string;
  track_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  progress: number;
  error: string | null;
}

export function createJob(job: {
  id: string;
  url: string;
  source: string;
  type: string;
  format: string;
  quality: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, url, source, type, format, quality)
       VALUES (@id, @url, @source, @type, @format, @quality)`
    )
    .run(job);
}

export function updateJob(
  id: string,
  updates: Partial<Pick<JobRow, "status" | "error" | "track_count">>
) {
  const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      sets.push(`${k} = @${k}`);
      params[k] = v;
    }
  }
  getDb()
    .prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = @id`)
    .run(params);
}

export function getJob(id: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | JobRow
    | undefined;
}

export function listJobs(limit = 50, offset = 0): JobRow[] {
  return getDb()
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as JobRow[];
}

export function deleteJob(id: string) {
  getDb().prepare("DELETE FROM tracks WHERE job_id = ?").run(id);
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

// --- Track helpers ---

export function createTrack(track: {
  id: string;
  job_id: string;
  spotify_id?: string | null;
  youtube_id?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration_s?: number | null;
  cover_url?: string | null;
  youtube_url?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO tracks (id, job_id, spotify_id, youtube_id, title, artist, album, duration_s, cover_url, youtube_url)
       VALUES (@id, @job_id, @spotify_id, @youtube_id, @title, @artist, @album, @duration_s, @cover_url, @youtube_url)`
    )
    .run({
      spotify_id: null,
      youtube_id: null,
      title: null,
      artist: null,
      album: null,
      duration_s: null,
      cover_url: null,
      youtube_url: null,
      ...track,
    });
}

export function updateTrack(
  id: string,
  updates: Partial<
    Pick<
      TrackRow,
      | "title"
      | "artist"
      | "album"
      | "duration_s"
      | "cover_url"
      | "youtube_url"
      | "youtube_id"
      | "lyrics"
      | "lyrics_synced"
      | "status"
      | "progress"
      | "error"
      | "confidence"
      | "file_size"
      | "temp_path"
      | "final_path"
    >
  >
) {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      sets.push(`${k} = @${k}`);
      params[k] = v;
    }
  }
  if (sets.length === 0) return;
  getDb()
    .prepare(`UPDATE tracks SET ${sets.join(", ")} WHERE id = @id`)
    .run(params);
}

export function getTracksForJob(jobId: string): TrackRow[] {
  return getDb()
    .prepare("SELECT * FROM tracks WHERE job_id = ? ORDER BY created_at ASC")
    .all(jobId) as TrackRow[];
}

export function getPendingTracks(jobId: string): TrackRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM tracks WHERE job_id = ? AND status = 'pending' ORDER BY created_at ASC"
    )
    .all(jobId) as TrackRow[];
}

export function searchTracks(query: string, limit = 50): TrackRow[] {
  const q = `%${query}%`;
  return getDb()
    .prepare(
      `SELECT * FROM tracks
       WHERE status = 'done' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(q, q, q, limit) as TrackRow[];
}

export function findDuplicateTrack(
  artist: string,
  title: string
): TrackRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM tracks
       WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)
       AND status IN ('done', 'downloading', 'converting', 'moving')
       LIMIT 1`
    )
    .get(artist, title) as TrackRow | undefined;
}

export function findDuplicateBySourceId(
  source: "spotify" | "youtube",
  sourceId: string,
  excludeTrackId?: string
): TrackRow | undefined {
  if (!sourceId) return undefined;
  const idColumn = source === "spotify" ? "spotify_id" : "youtube_id";
  if (excludeTrackId) {
    return getDb()
      .prepare(
        `SELECT * FROM tracks
         WHERE ${idColumn} = ?
         AND id != ?
         AND status IN ('done', 'downloading', 'converting', 'moving')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(sourceId, excludeTrackId) as TrackRow | undefined;
  }
  return getDb()
    .prepare(
      `SELECT * FROM tracks
       WHERE ${idColumn} = ?
       AND status IN ('done', 'downloading', 'converting', 'moving')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(sourceId) as TrackRow | undefined;
}

// --- Stats helpers ---

export function getStats() {
  const db = getDb();
  const totalTracks = (
    db
      .prepare("SELECT COUNT(*) as count FROM tracks WHERE status = 'done'")
      .get() as { count: number }
  ).count;
  const totalSize = (
    db
      .prepare(
        "SELECT COALESCE(SUM(file_size), 0) as total FROM tracks WHERE status = 'done'"
      )
      .get() as { total: number }
  ).total;
  const errorCount = (
    db
      .prepare("SELECT COUNT(*) as count FROM tracks WHERE status = 'error'")
      .get() as { count: number }
  ).count;
  const skippedCount = (
    db
      .prepare("SELECT COUNT(*) as count FROM tracks WHERE status = 'skipped'")
      .get() as { count: number }
  ).count;

  const topArtists = db
    .prepare(
      `SELECT artist, COUNT(*) as count FROM tracks
       WHERE status = 'done' AND artist IS NOT NULL
       GROUP BY artist ORDER BY count DESC LIMIT 10`
    )
    .all() as { artist: string; count: number }[];

  const formatBreakdown = db
    .prepare(
      `SELECT j.format, COUNT(*) as count FROM tracks t
       JOIN jobs j ON t.job_id = j.id
       WHERE t.status = 'done'
       GROUP BY j.format`
    )
    .all() as { format: string; count: number }[];

  const monthlyDownloads = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
       FROM tracks WHERE status = 'done'
       GROUP BY month ORDER BY month DESC LIMIT 12`
    )
    .all() as { month: string; count: number }[];

  return {
    totalTracks,
    totalSize,
    errorCount,
    skippedCount,
    successRate:
      totalTracks + errorCount > 0
        ? Math.round((totalTracks / (totalTracks + errorCount)) * 100)
        : 100,
    topArtists,
    formatBreakdown,
    monthlyDownloads: monthlyDownloads.reverse(),
  };
}

// --- Monitored playlists ---

export function createMonitoredPlaylist(playlist: {
  id: string;
  url: string;
  source: string;
  name: string | null;
  track_ids: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO monitored_playlists (id, url, source, name, track_ids, last_checked)
       VALUES (@id, @url, @source, @name, @track_ids, CURRENT_TIMESTAMP)`
    )
    .run(playlist);
}

export function updateMonitoredPlaylist(
  id: string,
  updates: Partial<
    Pick<
      MonitoredPlaylistRow,
      "name" | "track_ids" | "last_checked" | "new_tracks_count" | "enabled"
    >
  >
) {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      sets.push(`${k} = @${k}`);
      params[k] = v;
    }
  }
  if (sets.length === 0) return;
  getDb()
    .prepare(
      `UPDATE monitored_playlists SET ${sets.join(", ")} WHERE id = @id`
    )
    .run(params);
}

export function listMonitoredPlaylists(): MonitoredPlaylistRow[] {
  return getDb()
    .prepare("SELECT * FROM monitored_playlists ORDER BY created_at DESC")
    .all() as MonitoredPlaylistRow[];
}

export function getMonitoredPlaylist(
  id: string
): MonitoredPlaylistRow | undefined {
  return getDb()
    .prepare("SELECT * FROM monitored_playlists WHERE id = ?")
    .get(id) as MonitoredPlaylistRow | undefined;
}

export function deleteMonitoredPlaylist(id: string) {
  getDb().prepare("DELETE FROM monitored_playlists WHERE id = ?").run(id);
}

export function getPlaylistTrackStatuses(
  source: string,
  sourceIds: string[]
): PlaylistTrackStatus[] {
  if (sourceIds.length === 0) return [];

  const idColumn = source === "spotify" ? "spotify_id" : "youtube_id";
  const placeholders = sourceIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT
         id,
         ${idColumn} as source_id,
         title,
         artist,
         album,
         status,
         progress,
         error,
         created_at
       FROM tracks
       WHERE ${idColumn} IN (${placeholders})
       ORDER BY created_at DESC`
    )
    .all(...sourceIds) as Array<{
    id: string;
    source_id: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    status: string;
    progress: number;
    error: string | null;
    created_at: string;
  }>;

  const bySourceId = new Map<string, PlaylistTrackStatus>();
  for (const row of rows) {
    if (!row.source_id || bySourceId.has(row.source_id)) continue;
    bySourceId.set(row.source_id, {
      source_id: row.source_id,
      track_id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      status: row.status,
      progress: row.progress ?? 0,
      error: row.error,
    });
  }

  return sourceIds.map((sourceId) => {
    return (
      bySourceId.get(sourceId) || {
        source_id: sourceId,
        track_id: null,
        title: null,
        artist: null,
        album: null,
        status: "not_downloaded",
        progress: 0,
        error: null,
      }
    );
  });
}
