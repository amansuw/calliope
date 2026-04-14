import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export interface TrackMetadata {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string | null;
  lyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * Embed metadata (title, artist, album, cover art, lyrics) into an audio file using FFmpeg.
 * Returns the path to the output file (overwrites in place).
 */
export async function embedMetadata(
  filePath: string,
  meta: TrackMetadata
): Promise<string> {
  const ext = path.extname(filePath);
  const tmpOut = filePath.replace(ext, `.tmp${ext}`);

  // Download cover art to temp file if URL provided
  let coverPath: string | null = null;
  if (meta.coverUrl) {
    try {
      coverPath = path.join(os.tmpdir(), `calliope-cover-${Date.now()}.jpg`);
      const res = await fetch(meta.coverUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(coverPath, buffer);
      } else {
        coverPath = null;
      }
    } catch {
      coverPath = null;
    }
  }

  // Write synced lyrics to LRC file for embedding
  let lrcPath: string | null = null;
  if (meta.syncedLyrics) {
    lrcPath = path.join(os.tmpdir(), `calliope-lyrics-${Date.now()}.lrc`);
    fs.writeFileSync(lrcPath, meta.syncedLyrics);
  }

  const args: string[] = ["-y", "-i", filePath];

  // Add cover art input
  if (coverPath && fs.existsSync(coverPath)) {
    args.push("-i", coverPath);
  }

  // Metadata
  args.push(
    "-metadata", `title=${meta.title}`,
    "-metadata", `artist=${meta.artist}`
  );

  if (meta.album) {
    args.push("-metadata", `album=${meta.album}`);
  }

  // Embed plain lyrics as metadata
  const lyricsText = meta.lyrics || meta.syncedLyrics;
  if (lyricsText) {
    args.push("-metadata", `lyrics=${lyricsText}`);
  }

  // Map streams
  if (coverPath && fs.existsSync(coverPath)) {
    if (ext === ".mp3") {
      args.push(
        "-map", "0:a",
        "-map", "1:v",
        "-c:a", "copy",
        "-c:v", "mjpeg",
        "-id3v2_version", "3",
        "-metadata:s:v", "title=Album cover",
        "-metadata:s:v", "comment=Cover (front)"
      );
    } else {
      // For opus/flac, just copy audio and attach cover
      args.push(
        "-map", "0:a",
        "-c:a", "copy",
        "-map", "1:v",
        "-c:v", "copy",
        "-disposition:v", "attached_pic"
      );
    }
  } else {
    args.push("-c", "copy");
  }

  args.push(tmpOut);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg metadata embed failed: ${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });

  // Replace original with tagged version
  fs.renameSync(tmpOut, filePath);

  // Cleanup temp files
  if (coverPath && fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
  if (lrcPath && fs.existsSync(lrcPath)) fs.unlinkSync(lrcPath);

  return filePath;
}
