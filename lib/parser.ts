export type SourceType = "spotify" | "youtube";
export type LinkType = "track" | "playlist";

export interface ParsedUrl {
  url: string;
  source: SourceType;
  type: LinkType;
  id: string;
}

const SPOTIFY_TRACK_RE =
  /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/;
const SPOTIFY_PLAYLIST_RE =
  /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
const YT_MUSIC_VIDEO_RE =
  /music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/;
const YT_MUSIC_PLAYLIST_RE =
  /music\.youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/;
const YT_VIDEO_RE =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
const YT_PLAYLIST_RE =
  /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/;

export function parseUrl(raw: string): ParsedUrl | null {
  const url = raw.trim();
  if (!url) return null;

  let match: RegExpMatchArray | null;

  // Spotify track
  match = url.match(SPOTIFY_TRACK_RE);
  if (match) {
    return { url, source: "spotify", type: "track", id: match[1] };
  }

  // Spotify playlist
  match = url.match(SPOTIFY_PLAYLIST_RE);
  if (match) {
    return { url, source: "spotify", type: "playlist", id: match[1] };
  }

  // YouTube Music video
  match = url.match(YT_MUSIC_VIDEO_RE);
  if (match) {
    return { url, source: "youtube", type: "track", id: match[1] };
  }

  // YouTube Music playlist
  match = url.match(YT_MUSIC_PLAYLIST_RE);
  if (match) {
    return { url, source: "youtube", type: "playlist", id: match[1] };
  }

  // Regular YouTube video
  match = url.match(YT_VIDEO_RE);
  if (match) {
    return { url, source: "youtube", type: "track", id: match[1] };
  }

  // Regular YouTube playlist
  match = url.match(YT_PLAYLIST_RE);
  if (match) {
    return { url, source: "youtube", type: "playlist", id: match[1] };
  }

  return null;
}

export function parseBulkUrls(input: string): ParsedUrl[] {
  const lines = input
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedUrl[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const parsed = parseUrl(line);
    if (parsed && !seen.has(`${parsed.source}:${parsed.id}`)) {
      seen.add(`${parsed.source}:${parsed.id}`);
      results.push(parsed);
    }
  }

  return results;
}
