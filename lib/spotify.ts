import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
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

const SPOTIFY_SCRAPER_CMD =
  process.env.SPOTIFY_SCRAPER_CMD || "spotify-scraper";

type ScraperArtist = { name?: string };
type ScraperImage = { url?: string };
type ScraperAlbum = { name?: string; images?: ScraperImage[] };
type ScraperTrack = {
  id?: string;
  name?: string;
  title?: string;
  artists?: ScraperArtist[];
  artist?: string;
  album?: ScraperAlbum | string;
  duration_ms?: number;
  duration?: number;
};

type EmbeddedTrack = {
  id?: string;
  name?: string;
  duration?: { totalMilliseconds?: number };
  artists?: { items?: Array<{ profile?: { name?: string } }> };
  albumOfTrack?: {
    name?: string;
    coverArt?: { sources?: Array<{ url?: string }> };
  };
  uri?: string;
};

async function runSpotifyScraperToJson(
  command: "track" | "playlist",
  url: string
): Promise<unknown> {
  const outputPath = path.join(
    os.tmpdir(),
    `calliope-spotify-scraper-${command}-${Date.now()}.json`
  );
  try {
    try {
      await execFileAsync(
        SPOTIFY_SCRAPER_CMD,
        [command, url, "-f", "json", "-o", outputPath],
        { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        if (command === "track") {
          return await getTrackFromSpotifyPage(url);
        }
        return await getPlaylistFromSpotifyPage(url);
      }
      throw err;
    }
    const raw = await fs.readFile(outputPath, "utf8");
    return JSON.parse(raw);
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }
}

function decodeInitialState(html: string): Record<string, unknown> {
  const match = html.match(
    /<script[^>]*id="initialState"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match?.[1]) {
    throw new Error("Spotify page did not include initialState");
  }
  const base64Payload = match[1].trim();
  const decoded = Buffer.from(base64Payload, "base64").toString("utf8");
  return JSON.parse(decoded) as Record<string, unknown>;
}

function uriId(uri?: string): string {
  if (!uri) return "";
  const parts = uri.split(":");
  return parts[parts.length - 1] || "";
}

async function getSpotifyInitialState(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Calliope)" },
  });
  if (!res.ok) throw new Error(`Spotify page fetch failed: ${res.status}`);
  return decodeInitialState(await res.text());
}

function extractPlaylistEntity(initialState: Record<string, unknown>, playlistId: string) {
  const entities = (initialState.entities as { items?: Record<string, unknown> } | undefined)
    ?.items;
  if (!entities) return null;

  for (const value of Object.values(entities)) {
    const obj = value as Record<string, unknown>;
    if (obj?.__typename !== "Playlist") continue;
    const idFromUri = uriId(typeof obj.uri === "string" ? obj.uri : undefined);
    const id = typeof obj.id === "string" ? obj.id : idFromUri;
    if (id === playlistId) return obj;
  }
  return null;
}

async function getPlaylistFromSpotifyPage(url: string): Promise<{
  name: string;
  tracks: ScraperTrack[];
}> {
  const playlistId = url.match(/playlist\/([a-zA-Z0-9]+)/)?.[1] || "";
  if (!playlistId) throw new Error("Invalid Spotify playlist URL");

  const initialState = await getSpotifyInitialState(url);
  const playlist = extractPlaylistEntity(initialState, playlistId);
  if (!playlist) throw new Error("Could not parse Spotify playlist metadata");

  const content = (playlist.content as { items?: Array<Record<string, unknown>> } | undefined)
    ?.items || [];
  const tracks: ScraperTrack[] = [];
  for (const entry of content) {
    const data = entry.itemV2 as { data?: EmbeddedTrack } | undefined;
    const track = data?.data;
    if (!track) continue;
    const id = track.id || uriId(track.uri);
    if (!id) continue;
    tracks.push({
      id,
      name: track.name || "",
      artists: (track.artists?.items || []).map((a) => ({ name: a.profile?.name || "" })),
      album: {
        name: track.albumOfTrack?.name || "",
        images: (track.albumOfTrack?.coverArt?.sources || [])
          .map((s) => ({ url: s.url || "" }))
          .filter((s) => !!s.url),
      },
      duration_ms: track.duration?.totalMilliseconds || 0,
    });
  }

  return {
    name:
      typeof playlist.name === "string" && playlist.name
        ? playlist.name
        : "Spotify Playlist",
    tracks,
  };
}

async function getTrackFromSpotifyPage(url: string): Promise<ScraperTrack> {
  const trackId = url.match(/track\/([a-zA-Z0-9]+)/)?.[1] || "";
  if (!trackId) throw new Error("Invalid Spotify track URL");

  const initialState = await getSpotifyInitialState(url);
  const entities = (initialState.entities as { items?: Record<string, unknown> } | undefined)
    ?.items || {};

  for (const value of Object.values(entities)) {
    const obj = value as Record<string, unknown>;
    if (obj?.__typename !== "Track") continue;
    const idFromUri = uriId(typeof obj.uri === "string" ? obj.uri : undefined);
    const id = typeof obj.id === "string" ? obj.id : idFromUri;
    if (id !== trackId) continue;

    const artists =
      (obj.artists as { items?: Array<{ profile?: { name?: string } }> } | undefined)?.items || [];
    const album = obj.albumOfTrack as
      | { name?: string; coverArt?: { sources?: Array<{ url?: string }> } }
      | undefined;
    const duration = obj.duration as { totalMilliseconds?: number } | undefined;

    return {
      id,
      name: typeof obj.name === "string" ? obj.name : "Unknown",
      artists: artists.map((a) => ({ name: a.profile?.name || "" })),
      album: {
        name: album?.name || "",
        images: (album?.coverArt?.sources || [])
          .map((s) => ({ url: s.url || "" }))
          .filter((s) => !!s.url),
      },
      duration_ms: duration?.totalMilliseconds || 0,
    };
  }

  throw new Error("Could not parse Spotify track metadata");
}

function normalizeTrack(data: ScraperTrack, fallbackId: string): SpotifyTrack {
  const firstArtist = data.artists?.[0]?.name;
  const albumName =
    typeof data.album === "string" ? data.album : data.album?.name || "";
  const coverUrl =
    typeof data.album === "string" ? null : data.album?.images?.[0]?.url || null;
  return {
    id: data.id || fallbackId,
    title: data.name || data.title || "Unknown",
    artist: firstArtist || data.artist || "Unknown",
    album: albumName,
    duration_s: Math.round((data.duration_ms || data.duration || 0) / 1000),
    cover_url: coverUrl,
  };
}

export async function getTrack(spotifyIdOrUrl: string): Promise<SpotifyTrack> {
  const url = spotifyIdOrUrl.startsWith("http")
    ? spotifyIdOrUrl
    : `https://open.spotify.com/track/${spotifyIdOrUrl}`;
  const data = (await runSpotifyScraperToJson("track", url)) as ScraperTrack;
  return normalizeTrack(data, spotifyIdOrUrl);
}

export async function getPlaylistTracks(
  playlistIdOrUrl: string
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const url = playlistIdOrUrl.startsWith("http")
    ? playlistIdOrUrl
    : `https://open.spotify.com/playlist/${playlistIdOrUrl}`;

  const data = (await runSpotifyScraperToJson("playlist", url)) as {
    name?: string;
    title?: string;
    tracks?: ScraperTrack[];
  };

  return {
    name: data.name || data.title || "Spotify Playlist",
    tracks: (data.tracks || []).map((track, idx) =>
      normalizeTrack(track, String(idx))
    ),
  };
}
