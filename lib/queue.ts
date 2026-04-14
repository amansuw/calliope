import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
import {
  getDb,
  createJob,
  updateJob,
  createTrack,
  updateTrack,
  getJob,
  getTracksForJob,
  getPendingTracks,
  getSetting,
  JobRow,
  TrackRow,
} from "./db";
import { parseUrl, parseBulkUrls, ParsedUrl } from "./parser";
import { getTrack, getPlaylistTracks, SpotifyTrack } from "./spotify";
import {
  findBestMatch,
  downloadAudio,
  ytPlaylistItems,
  ytVideoInfo,
  DownloadProgress,
} from "./downloader";
import { fetchLyrics } from "./lyrics";
import { embedMetadata } from "./metadata";
import { buildFinalPath, moveToLibrary } from "./mover";
import { checkDuplicate, checkDuplicateBySourceId } from "./dedup";
import {
  notifyDownloadComplete,
  notifyError,
} from "./discord";
import { triggerNavidromeScan } from "./navidrome";

const TEMP_DIR =
  process.env.TEMP_DOWNLOAD_DIR || "/mnt/nvme-ssd/calliope/downloads";

// SSE event emitter — simple pub/sub for progress updates
type Listener = (event: string, data: unknown) => void;
const listeners = new Set<Listener>();

export function addSSEListener(fn: Listener) {
  listeners.add(fn);
}
export function removeSSEListener(fn: Listener) {
  listeners.delete(fn);
}
function emit(event: string, data: unknown) {
  for (const fn of listeners) {
    try {
      fn(event, data);
    } catch {
      // ignore listener errors
    }
  }
}

let processing = false;
const jobQueue: string[] = [];

/**
 * Enqueue URLs for download. Creates jobs and tracks in the DB,
 * then kicks off processing.
 */
export async function enqueueUrls(
  input: string,
  format?: string,
  quality?: string
): Promise<string[]> {
  const parsed = parseBulkUrls(input);
  if (parsed.length === 0) {
    throw new Error("No valid URLs found");
  }

  const fmt = format || getSetting("default_format") || "mp3";
  const qual = quality || getSetting("default_quality") || "320";
  const jobIds: string[] = [];

  for (const p of parsed) {
    const jobId = uuid();
    createJob({
      id: jobId,
      url: p.url,
      source: p.source,
      type: p.type,
      format: fmt,
      quality: qual,
    });
    jobIds.push(jobId);
    jobQueue.push(jobId);
  }

  // Resolve tracks in background (don't await)
  resolveJobsInBackground();

  return jobIds;
}

async function resolveJobsInBackground() {
  if (processing) return;
  processing = true;

  try {
    while (jobQueue.length > 0) {
      const jobId = jobQueue.shift()!;
      try {
        await resolveAndProcess(jobId);
      } catch (err) {
        console.error(`[queue] Job ${jobId} failed:`, err);
        updateJob(jobId, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        emit("job:update", { jobId, status: "error" });
      }
    }
  } finally {
    processing = false;
  }
}

async function resolveAndProcess(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;

  updateJob(jobId, { status: "resolving" });
  emit("job:update", { jobId, status: "resolving" });

  // Resolve track metadata
  if (job.source === "spotify") {
    await resolveSpotifyJob(job);
  } else {
    await resolveYoutubeJob(job);
  }

  // Process each track
  const tracks = getPendingTracks(jobId);
  let doneCount = 0;
  let errorCount = 0;

  for (const track of tracks) {
    try {
      await processTrack(track, job);
      doneCount++;
    } catch (err) {
      errorCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      updateTrack(track.id, { status: "error", error: errMsg });
      emit("track:update", { trackId: track.id, status: "error", error: errMsg });

      if (track.artist && track.title) {
        notifyError(track.artist, track.title, errMsg);
      }
    }
  }

  // Update job status
  const allTracks = getTracksForJob(jobId);
  const allDone = allTracks.every(
    (t) => t.status === "done" || t.status === "skipped" || t.status === "error"
  );

  if (allDone) {
    const hasErrors = allTracks.some((t) => t.status === "error");
    updateJob(jobId, { status: hasErrors ? "error" : "done" });
    emit("job:update", { jobId, status: hasErrors ? "error" : "done" });

    // Trigger Navidrome rescan if any tracks completed
    if (doneCount > 0) {
      triggerNavidromeScan();
    }
  }
}

async function resolveSpotifyJob(job: JobRow) {
  if (job.type === "track") {
    const meta = await getTrack(job.url.match(/track\/([a-zA-Z0-9]+)/)?.[1] || "");
    const trackId = uuid();
    createTrack({
      id: trackId,
      job_id: job.id,
      spotify_id: meta.id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      duration_s: meta.duration_s,
      cover_url: meta.cover_url,
    });
    updateJob(job.id, { track_count: 1 });
    emit("track:new", { trackId, jobId: job.id });
  } else {
    const playlistId = job.url.match(/playlist\/([a-zA-Z0-9]+)/)?.[1] || "";
    const { tracks } = await getPlaylistTracks(playlistId);

    for (const meta of tracks) {
      const trackId = uuid();
      createTrack({
        id: trackId,
        job_id: job.id,
        spotify_id: meta.id,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        duration_s: meta.duration_s,
        cover_url: meta.cover_url,
      });
      emit("track:new", { trackId, jobId: job.id });
    }
    updateJob(job.id, { track_count: tracks.length });
  }
}

async function resolveYoutubeJob(job: JobRow) {
  if (job.type === "track") {
    const videoId = job.url.match(/[?&]v=([a-zA-Z0-9_-]+)/)?.[1] || "";
    const trackId = uuid();
    createTrack({
      id: trackId,
      job_id: job.id,
      youtube_id: videoId,
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
    });
    updateJob(job.id, { track_count: 1 });
    emit("track:new", { trackId, jobId: job.id });
  } else {
    const playlistId =
      job.url.match(/[?&]list=([a-zA-Z0-9_-]+)/)?.[1] || "";
    const items = await ytPlaylistItems(playlistId);

    for (const item of items) {
      const trackId = uuid();
      createTrack({
        id: trackId,
        job_id: job.id,
        youtube_id: item.id,
        youtube_url: item.url,
        title: item.title,
        artist: item.uploader,
        duration_s: item.duration,
      });
      emit("track:new", { trackId, jobId: job.id });
    }
    updateJob(job.id, { track_count: items.length });
  }
}

async function processTrack(track: TrackRow, job: JobRow) {
  // Step 0: Fast duplicate check by source-native ID.
  const sourceId = job.source === "spotify" ? track.spotify_id : track.youtube_id;
  const idDedup = checkDuplicateBySourceId(
    job.source === "spotify" ? "spotify" : "youtube",
    sourceId,
    track.id
  );
  if (idDedup.isDuplicate) {
    updateTrack(track.id, {
      status: "skipped",
      error: idDedup.reason || "Duplicate",
    });
    emit("track:update", {
      trackId: track.id,
      status: "skipped",
      reason: idDedup.reason,
    });
    return;
  }

  // Step 0b: Enrich YouTube tracks before metadata-based dedup/pathing.
  if (job.source === "youtube" && track.youtube_url) {
    const needsMeta =
      !track.title || !track.artist || !track.album || !track.duration_s;
    if (needsMeta) {
      try {
        const info = await ytVideoInfo(track.youtube_url);
        updateTrack(track.id, {
          title: track.title || info.title || undefined,
          artist: track.artist || info.artist || undefined,
          album: track.album || info.album || undefined,
          duration_s: track.duration_s || info.duration || undefined,
        });
        track = {
          ...track,
          title: track.title || info.title || null,
          artist: track.artist || info.artist || null,
          album: track.album || info.album || null,
          duration_s: track.duration_s || info.duration || null,
        };
      } catch (err) {
        console.warn("[queue] Failed to enrich YouTube metadata:", err);
      }
    }
  }

  // Step 1: Duplicate check
  if (track.artist && track.title) {
    const dedup = checkDuplicate(track.artist, track.title, track.album);
    if (dedup.isDuplicate) {
      updateTrack(track.id, {
        status: "skipped",
        error: dedup.reason || "Duplicate",
      });
      emit("track:update", {
        trackId: track.id,
        status: "skipped",
        reason: dedup.reason,
      });
      return;
    }
  }

  // Step 2: Resolve YouTube URL (for Spotify tracks)
  let youtubeUrl = track.youtube_url;
  let confidence: "high" | "low" = "high";

  if (job.source === "spotify" && !youtubeUrl && track.artist && track.title) {
    updateTrack(track.id, { status: "downloading", progress: 0 });
    emit("track:update", { trackId: track.id, status: "downloading", progress: 0 });

    const match = await findBestMatch(
      track.artist,
      track.title,
      track.duration_s || 0
    );
    youtubeUrl = match.result.url;
    confidence = match.confidence;
    updateTrack(track.id, {
      youtube_url: youtubeUrl,
      youtube_id: match.result.id,
      confidence,
    });
  }

  if (!youtubeUrl) {
    throw new Error("No YouTube URL to download from");
  }

  // Step 3: Download
  updateTrack(track.id, { status: "downloading", progress: 0 });
  emit("track:update", { trackId: track.id, status: "downloading", progress: 0 });

  const outputDir = path.join(TEMP_DIR, job.id);
  const downloadedFile = await downloadAudio({
    url: youtubeUrl,
    outputDir,
    format: job.format,
    quality: job.quality,
    onProgress: (p: DownloadProgress) => {
      const pct = Math.min(Math.round(p.percent), 99);
      updateTrack(track.id, { progress: pct });
      emit("track:progress", { trackId: track.id, progress: pct });
    },
  });

  // Step 4: Get metadata for YouTube-sourced tracks if needed
  if (job.source === "youtube" && (!track.title || !track.artist)) {
    // yt-dlp already named the file, extract info from filename or use what we have
    const baseName = path.basename(downloadedFile, path.extname(downloadedFile));
    if (!track.title) {
      updateTrack(track.id, { title: baseName });
    }
  }

  // Refresh track data after updates
  const freshTrack = getDb()
    .prepare("SELECT * FROM tracks WHERE id = ?")
    .get(track.id) as TrackRow;

  // Step 5: Fetch lyrics
  updateTrack(track.id, { status: "converting", progress: 95 });
  emit("track:update", { trackId: track.id, status: "converting", progress: 95 });

  if (freshTrack.artist && freshTrack.title) {
    const lyrics = await fetchLyrics(
      freshTrack.artist,
      freshTrack.title,
      freshTrack.duration_s || 0
    );
    if (lyrics) {
      updateTrack(track.id, {
        lyrics: lyrics.syncedLyrics || lyrics.plainLyrics,
        lyrics_synced: lyrics.synced ? 1 : 0,
      });
    }
  }

  // Step 6: Embed metadata
  const updatedTrack = getDb()
    .prepare("SELECT * FROM tracks WHERE id = ?")
    .get(track.id) as TrackRow;

  if (updatedTrack.artist && updatedTrack.title) {
    await embedMetadata(downloadedFile, {
      title: updatedTrack.title!,
      artist: updatedTrack.artist!,
      album: updatedTrack.album || undefined,
      coverUrl: updatedTrack.cover_url,
      lyrics: updatedTrack.lyrics || undefined,
      syncedLyrics:
        updatedTrack.lyrics_synced && updatedTrack.lyrics
          ? updatedTrack.lyrics
          : undefined,
    });
  }

  // Step 7: Move to library
  updateTrack(track.id, { status: "moving", progress: 98 });
  emit("track:update", { trackId: track.id, status: "moving", progress: 98 });

  const ext = path.extname(downloadedFile);
  const finalPath = buildFinalPath(
    updatedTrack.artist || "Unknown Artist",
    updatedTrack.title || "Unknown Track",
    updatedTrack.album,
    ext
  );

  const actualPath = moveToLibrary(downloadedFile, finalPath);
  const fileSize = fs.statSync(actualPath).size;

  updateTrack(track.id, {
    status: "done",
    progress: 100,
    final_path: actualPath,
    file_size: fileSize,
    temp_path: null,
  });
  emit("track:update", { trackId: track.id, status: "done", progress: 100 });

  // Notify Discord
  if (updatedTrack.artist && updatedTrack.title) {
    notifyDownloadComplete(
      updatedTrack.artist,
      updatedTrack.title,
      updatedTrack.album || undefined
    );
  }

  // Cleanup temp directory if empty
  try {
    const dir = path.join(TEMP_DIR, job.id);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // ignore cleanup errors
  }
}
