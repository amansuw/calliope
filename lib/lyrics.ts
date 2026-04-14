const LRCLIB_BASE = "https://lrclib.net/api";

export interface LyricsResult {
  plainLyrics: string | null;
  syncedLyrics: string | null;
  synced: boolean;
}

/**
 * Fetch lyrics from lrclib.net by artist + title + duration.
 * Prefers synced (LRC) lyrics, falls back to plain text.
 */
export async function fetchLyrics(
  artist: string,
  title: string,
  durationS: number
): Promise<LyricsResult | null> {
  try {
    // Try exact match first
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      duration: String(durationS),
    });

    let res = await fetch(`${LRCLIB_BASE}/get?${params}`, {
      headers: { "User-Agent": "Calliope/0.1.0" },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        syncedLyrics: data.syncedLyrics || null,
        plainLyrics: data.plainLyrics || null,
        synced: !!data.syncedLyrics,
      };
    }

    // Fallback: search
    const searchParams = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });

    res = await fetch(`${LRCLIB_BASE}/search?${searchParams}`, {
      headers: { "User-Agent": "Calliope/0.1.0" },
    });

    if (!res.ok) return null;

    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    // Pick the best match by duration closeness
    const sorted = [...results].sort(
      (a, b) =>
        Math.abs((a.duration || 0) - durationS) -
        Math.abs((b.duration || 0) - durationS)
    );

    const best = sorted[0];
    return {
      syncedLyrics: best.syncedLyrics || null,
      plainLyrics: best.plainLyrics || null,
      synced: !!best.syncedLyrics,
    };
  } catch (err) {
    console.error("[lyrics] Failed to fetch:", err);
    return null;
  }
}
