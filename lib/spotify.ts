import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration_s: number;
  cover_url: string | null;
}

/**
 * Use yt-dlp to extract metadata from a Spotify track URL.
 * No API key required.
 */
export async function getTrack(spotifyIdOrUrl: string): Promise<SpotifyTrack> {
  const url = spotifyIdOrUrl.startsWith("http")
    ? spotifyIdOrUrl
    : `https://open.spotify.com/track/${spotifyIdOrUrl}`;

  const { stdout } = await execFileAsync("yt-dlp", [
    "--dump-json",
    "--no-download",
    url,
  ], { timeout: 30_000 });

  const data = JSON.parse(stdout);

  return {
    id: data.id || spotifyIdOrUrl,
    title: data.track || data.title || "Unknown",
    artist: data.artist || data.creator || data.uploader || "Unknown",
    album: data.album || "",
    duration_s: Math.round(data.duration || 0),
    cover_url: data.thumbnail || null,
  };
}

/**
 * Use yt-dlp to enumerate all tracks in a Spotify playlist.
 * --flat-playlist gets metadata without downloading.
 */
export async function getPlaylistTracks(
  playlistIdOrUrl: string
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const url = playlistIdOrUrl.startsWith("http")
    ? playlistIdOrUrl
    : `https://open.spotify.com/playlist/${playlistIdOrUrl}`;

  const { stdout } = await execFileAsync("yt-dlp", [
    "--flat-playlist",
    "--dump-json",
    "--no-download",
    url,
  ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

  const lines = stdout.trim().split("\n").filter(Boolean);
  const tracks: SpotifyTrack[] = [];
  let playlistName = "Spotify Playlist";

  for (const line of lines) {
    try {
      const data = JSON.parse(line);

      if (data.playlist_title) {
        playlistName = data.playlist_title;
      }

      tracks.push({
        id: data.id || data.url || String(tracks.length),
        title: data.title || data.track || "Unknown",
        artist: data.artist || data.creator || data.uploader || "Unknown",
        album: data.album || "",
        duration_s: Math.round(data.duration || 0),
        cover_url: data.thumbnail || data.thumbnails?.[0]?.url || null,
      });
    } catch {
      // skip malformed lines
    }
  }

  // Try oEmbed for playlist name if not found
  if (playlistName === "Spotify Playlist") {
    try {
      const res = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
      );
      if (res.ok) {
        const oembed = await res.json();
        if (oembed.title) playlistName = oembed.title;
      }
    } catch {
      // ignore
    }
  }

  return { name: playlistName, tracks };
}
