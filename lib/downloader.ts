import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const TEMP_DIR = process.env.TEMP_DOWNLOAD_DIR || "/mnt/nvme-ssd/calliope/downloads";

export interface DownloadProgress {
  percent: number;
  speed: string;
  eta: string;
}

export interface YtSearchResult {
  id: string;
  url: string;
  title: string;
  duration: number; // seconds
  uploader: string;
}

/**
 * Search YouTube for a track, returning top N results with metadata.
 */
export async function ytSearch(
  query: string,
  count = 3
): Promise<YtSearchResult[]> {
  return new Promise((resolve, reject) => {
    const args = [
      `ytsearch${count}:${query}`,
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--default-search", "ytsearch",
    ];

    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`yt-dlp search failed: ${stderr}`));
      }

      const results: YtSearchResult[] = [];
      for (const line of stdout.trim().split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          results.push({
            id: obj.id,
            url: obj.url || `https://www.youtube.com/watch?v=${obj.id}`,
            title: obj.title || "",
            duration: obj.duration || 0,
            uploader: obj.uploader || obj.channel || "",
          });
        } catch {
          // skip malformed lines
        }
      }
      resolve(results);
    });
  });
}

/**
 * Find the best YouTube match for a Spotify track.
 * Returns the closest duration match within ±5s tolerance.
 * If none match, returns the closest overall and flags low_confidence.
 */
export async function findBestMatch(
  artist: string,
  title: string,
  durationS: number
): Promise<{ result: YtSearchResult; confidence: "high" | "low" }> {
  const query = `${artist} - ${title}`;
  const results = await ytSearch(query, 3);

  if (results.length === 0) {
    throw new Error(`No YouTube results found for: ${query}`);
  }

  // Sort by duration closeness
  const sorted = [...results].sort(
    (a, b) =>
      Math.abs(a.duration - durationS) - Math.abs(b.duration - durationS)
  );

  const best = sorted[0];
  const diff = Math.abs(best.duration - durationS);

  return {
    result: best,
    confidence: diff <= 5 ? "high" : "low",
  };
}

/**
 * Get playlist items from YouTube, filtering out auto-suggestions.
 */
export async function ytPlaylistItems(
  playlistId: string
): Promise<YtSearchResult[]> {
  return new Promise((resolve, reject) => {
    const args = [
      `https://www.youtube.com/playlist?list=${playlistId}`,
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
    ];

    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`yt-dlp playlist failed: ${stderr}`));
      }

      const items: YtSearchResult[] = [];
      let playlistCount = 0;

      const lines = stdout.trim().split("\n");
      // First pass: determine playlist_count
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.playlist_count) playlistCount = obj.playlist_count;
        } catch {
          // skip
        }
      }

      // Second pass: only keep items within official playlist range
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const idx = obj.playlist_index;

          // Filter auto-suggestions: they have no playlist_index
          // or their index exceeds the playlist_count
          if (idx === null || idx === undefined) continue;
          if (playlistCount > 0 && idx > playlistCount) continue;

          items.push({
            id: obj.id,
            url: obj.url || `https://www.youtube.com/watch?v=${obj.id}`,
            title: obj.title || "",
            duration: obj.duration || 0,
            uploader: obj.uploader || obj.channel || "",
          });
        } catch {
          // skip
        }
      }

      resolve(items);
    });
  });
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: string; // mp3 | opus | flac
  quality: string; // 128 | 192 | 256 | 320
  filename?: string; // without extension
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Download audio from a YouTube URL using yt-dlp.
 * Returns the path to the downloaded file.
 */
export function downloadAudio(opts: DownloadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { url, outputDir, format, quality, filename, onProgress } = opts;

    fs.mkdirSync(outputDir, { recursive: true });

    const outputTemplate = filename
      ? path.join(outputDir, `${filename}.%(ext)s`)
      : path.join(outputDir, "%(title)s.%(ext)s");

    const args = [
      url,
      "-x",
      "--audio-format", format === "flac" ? "flac" : format === "opus" ? "opus" : "mp3",
      "--audio-quality", format === "flac" ? "0" : quality + "k",
      "-o", outputTemplate,
      "--no-playlist",
      "--no-warnings",
      "--progress",
      "--newline",
      "--embed-thumbnail",
    ];

    const proc = spawn("yt-dlp", args);
    let lastFile = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      for (const line of text.split("\n")) {
        // Parse progress: [download]  45.2% of 5.23MiB at  1.2MiB/s ETA 00:03
        const progressMatch = line.match(
          /\[download\]\s+([\d.]+)%\s+of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/
        );
        if (progressMatch && onProgress) {
          onProgress({
            percent: parseFloat(progressMatch[1]),
            speed: progressMatch[2],
            eta: progressMatch[3],
          });
        }

        // Capture output filename
        const destMatch = line.match(
          /\[(?:ExtractAudio|Merger)\]\s+Destination:\s+(.+)/
        );
        if (destMatch) {
          lastFile = destMatch[1].trim();
        }

        // Also check for already-downloaded files
        const alreadyMatch = line.match(
          /\[download\]\s+(.+)\s+has already been downloaded/
        );
        if (alreadyMatch) {
          lastFile = alreadyMatch[1].trim();
        }
      }
    });

    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp download failed (code ${code}): ${stderr}`));
      }

      // If we didn't capture the file from output, find it in the directory
      if (!lastFile || !fs.existsSync(lastFile)) {
        const ext = format === "flac" ? ".flac" : format === "opus" ? ".opus" : ".mp3";
        const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(ext));
        if (files.length > 0) {
          lastFile = path.join(outputDir, files[files.length - 1]);
        }
      }

      if (!lastFile || !fs.existsSync(lastFile)) {
        return reject(new Error("Downloaded file not found"));
      }

      resolve(lastFile);
    });
  });
}
