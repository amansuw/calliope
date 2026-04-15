import { parseFile } from "music-metadata";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { getDb } from "./db";

const MUSIC_DIR = process.env.MUSIC_LIBRARY_DIR || "/mnt/wd-hdd/Media/Music";
const AUDIO_EXTENSIONS = [".mp3", ".opus", ".flac", ".m4a", ".ogg", ".wav", ".aiff"];

interface LibraryTrack {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_s: number | null;
  file_size: number | null;
}

export async function scanLibraryFile(filePath: string): Promise<LibraryTrack | null> {
  try {
    const metadata = await parseFile(filePath, { duration: false });
    const stats = fs.statSync(filePath);
    return {
      id: uuid(),
      file_path: filePath,
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      album: metadata.common.album || null,
      duration_s: typeof metadata.format.duration === "number" ? Math.floor(metadata.format.duration) : null,
      file_size: stats.size,
    };
  } catch (err) {
    console.warn(`[library] Failed to parse ${filePath}:`, err);
    return null;
  }
}

export async function scanLibrary(force = false): Promise<{ scanned: number; errors: number }> {
  const db = getDb();

  if (force) {
    db.prepare("DELETE FROM library_tracks").run();
  }

  console.log(`[library] Starting full scan of ${MUSIC_DIR}`);

  if (!fs.existsSync(MUSIC_DIR)) {
    console.warn(`[library] Directory does not exist: ${MUSIC_DIR}`);
    return { scanned: 0, errors: 0 };
  }

  let scanned = 0;
  let errors = 0;

  const scanDir = async (dir: string) => {
    if (!fs.existsSync(dir)) {
      console.warn(`[library] Directory does not exist: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          const track = await scanLibraryFile(fullPath);
          if (track) {
            try {
              db.prepare(`
                INSERT OR REPLACE INTO library_tracks (id, file_path, title, artist, album, duration_s, file_size, scanned_at)
                VALUES (@id, @file_path, @title, @artist, @album, @duration_s, @file_size, CURRENT_TIMESTAMP)
              `).run(track);
              scanned++;
            } catch (err) {
              errors++;
              console.warn(`[library] DB insert error for ${fullPath}:`, err);
            }
          } else {
            errors++;
          }
        }
      }
    }
  };

  await scanDir(MUSIC_DIR);

  const allTracked = db.prepare("SELECT file_path FROM library_tracks").all() as { file_path: string }[];

  let removed = 0;
  for (const row of allTracked) {
    if (!fs.existsSync(row.file_path)) {
      db.prepare("DELETE FROM library_tracks WHERE file_path = ?").run(row.file_path);
      removed++;
    }
  }

  console.log(`[library] Scan complete: ${scanned} tracks, ${removed} removed`);
  return { scanned, errors };
}

export function isInLibrary(artist: string, title: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    SELECT 1 FROM library_tracks
    WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)
    LIMIT 1
  `).get(artist, title);
  return !!result;
}

export function getLibraryTrackCount(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as c FROM library_tracks").get() as { c: number }).c;
}

export function getLibraryStats() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM library_tracks").get() as { c: number }).c;
  const totalSize = (db.prepare("SELECT COALESCE(SUM(file_size), 0) as total FROM library_tracks").get() as { total: number }).total;
  const lastScanned = db.prepare("SELECT MAX(scanned_at) as last FROM library_tracks").get() as { last: string | null };
  return {
    trackCount: total,
    totalSize,
    lastScanned: lastScanned.last,
  };
}

let scanInProgress = false;
let lastScanResult: { scanned: number; errors: number } | null = null;

export async function requestLibraryScan(force = false): Promise<{ scanned: number; errors: number } | null> {
  if (scanInProgress) {
    console.log("[library] Scan already in progress, waiting for result...");
    return lastScanResult;
  }

  scanInProgress = true;
  try {
    lastScanResult = await scanLibrary(force);
    return lastScanResult;
  } finally {
    scanInProgress = false;
  }
}

export async function forceLibraryScan(): Promise<{ scanned: number; errors: number }> {
  return scanLibrary(true);
}