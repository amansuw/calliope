import { findDuplicateBySourceId, findDuplicateTrack } from "./db";
import { isInLibrary } from "./library-index";

export interface DedupResult {
  isDuplicate: boolean;
  reason?: string;
}

/**
 * Check if a track is a duplicate by checking both the database
 * and the music library (by reading actual file metadata).
 */
export function checkDuplicate(
  artist: string,
  title: string,
  album?: string | null
): DedupResult {
  if (!artist || !title) {
    return { isDuplicate: false };
  }

  // Check database first (fast)
  const dbMatch = findDuplicateTrack(artist, title);
  if (dbMatch) {
    return {
      isDuplicate: true,
      reason: "Already in DB",
    };
  }

  // Check music library by reading metadata from actual files
  if (isInLibrary(artist, title)) {
    return {
      isDuplicate: true,
      reason: "Already in music library",
    };
  }

  return { isDuplicate: false };
}

export function checkDuplicateBySourceId(
  source: "spotify" | "youtube",
  sourceId?: string | null,
  currentTrackId?: string
): DedupResult {
  if (!sourceId) return { isDuplicate: false };
  const dbMatch = findDuplicateBySourceId(source, sourceId, currentTrackId);
  if (!dbMatch) return { isDuplicate: false };
  return {
    isDuplicate: true,
    reason: "Already in DB",
  };
}
