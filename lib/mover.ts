import fs from "fs";
import path from "path";

const MUSIC_DIR = process.env.MUSIC_LIBRARY_DIR || "/mnt/wd-hdd/Media/Music";

/**
 * Sanitize a string for safe use as a filesystem path component.
 */
function sanitize(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\.\.\./g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Build the final destination path for a downloaded track.
 * Pattern: {MUSIC_DIR}/{artist}/{album}/{title}.{ext}
 * If album is missing: {MUSIC_DIR}/{artist}/{title}.{ext}
 */
export function buildFinalPath(
  artist: string,
  title: string,
  album: string | null | undefined,
  ext: string
): string {
  const safeArtist = sanitize(artist) || "Unknown Artist";
  const safeTitle = sanitize(title) || "Unknown Track";
  const safeExt = ext.startsWith(".") ? ext : `.${ext}`;

  if (album && album.trim()) {
    const safeAlbum = sanitize(album);
    return path.join(MUSIC_DIR, safeArtist, safeAlbum, `${safeTitle}${safeExt}`);
  }

  return path.join(MUSIC_DIR, safeArtist, `${safeTitle}${safeExt}`);
}

/**
 * Move a file from temp path to its final destination.
 * Creates directories as needed. Returns the final path.
 */
export function moveToLibrary(tempPath: string, finalPath: string): string {
  const dir = path.dirname(finalPath);
  fs.mkdirSync(dir, { recursive: true });

  // If destination exists, add a suffix
  let dest = finalPath;
  if (fs.existsSync(dest)) {
    const ext = path.extname(dest);
    const base = dest.slice(0, -ext.length);
    let i = 1;
    while (fs.existsSync(dest)) {
      dest = `${base} (${i})${ext}`;
      i++;
    }
  }

  fs.copyFileSync(tempPath, dest);
  fs.unlinkSync(tempPath);

  return dest;
}
