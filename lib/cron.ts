import {
  listMonitoredPlaylists,
  updateMonitoredPlaylist,
  getSetting,
} from "./db";
import { getPlaylistTracks } from "./spotify";
import { ytPlaylistItems } from "./downloader";
import { enqueueUrls } from "./queue";
import { notifyPlaylistNewTracks } from "./discord";

const SIX_HOURS = 6 * 60 * 60 * 1000;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the playlist monitoring cron job.
 * Runs every 6 hours, checks monitored playlists for new tracks.
 */
export function startCron() {
  if (intervalId) return;

  console.log("[cron] Starting playlist monitor (every 6 hours)");

  // Run immediately on start, then every 6 hours
  checkAllPlaylists();
  intervalId = setInterval(checkAllPlaylists, SIX_HOURS);
}

export function stopCron() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[cron] Stopped playlist monitor");
  }
}

async function checkAllPlaylists() {
  const playlists = listMonitoredPlaylists();
  const enabled = playlists.filter((p) => p.enabled === 1);

  console.log(`[cron] Checking ${enabled.length} monitored playlists`);

  for (const playlist of enabled) {
    try {
      await checkPlaylist(playlist.id, playlist.url, playlist.source, playlist.name, playlist.track_ids);
    } catch (err) {
      console.error(`[cron] Error checking playlist ${playlist.url}:`, err);
    }
  }
}

async function checkPlaylist(
  playlistDbId: string,
  url: string,
  source: string,
  name: string | null,
  knownTrackIdsJson: string | null
) {
  const knownIds: string[] = knownTrackIdsJson
    ? JSON.parse(knownTrackIdsJson)
    : [];

  let currentIds: string[] = [];
  let playlistName = name || "Unknown Playlist";

  if (source === "spotify") {
    const playlistId = url.match(/playlist\/([a-zA-Z0-9]+)/)?.[1];
    if (!playlistId) return;

    const { name: fetchedName, tracks } = await getPlaylistTracks(playlistId);
    playlistName = fetchedName || playlistName;
    currentIds = tracks.map((t) => t.id);
  } else {
    const playlistId = url.match(/[?&]list=([a-zA-Z0-9_-]+)/)?.[1];
    if (!playlistId) return;

    const items = await ytPlaylistItems(playlistId);
    currentIds = items.map((i) => i.id);
  }

  // Find new track IDs
  const knownSet = new Set(knownIds);
  const newIds = currentIds.filter((id) => !knownSet.has(id));

  // Update the monitored playlist record
  updateMonitoredPlaylist(playlistDbId, {
    name: playlistName,
    track_ids: JSON.stringify(currentIds),
    last_checked: new Date().toISOString(),
    new_tracks_count: newIds.length,
  });

  if (newIds.length === 0) {
    console.log(`[cron] ${playlistName}: no new tracks`);
    return;
  }

  console.log(`[cron] ${playlistName}: ${newIds.length} new tracks`);

  // Notify Discord
  await notifyPlaylistNewTracks(playlistName, newIds.length);

  // Enqueue the playlist URL for download
  // The queue processor will handle dedup per-track
  const format = getSetting("default_format") || "mp3";
  const quality = getSetting("default_quality") || "320";
  await enqueueUrls(url, format, quality);
}
