import { findDuplicateBySourceId, findDuplicateTrack } from "./db";
import { existsInLibrary } from "./mover";

export interface DedupResult {
  isDuplicate: boolean;
  reason?: string;
}

/**
 * Check if a track is a duplicate by checking both the database
 * and the filesystem (music library).
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

  // Check filesystem
  if (existsInLibrary(artist, title, album)) {
    return {
      isDuplicate: true,
      reason: "File already exists in music library",
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
