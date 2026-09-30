import { eq } from 'drizzle-orm';
import type { TrackDTO } from '$lib/types';
import { db, schema } from '../db';
import type { Track } from '../db/schema';
import { bus } from '../events';

const ms = (d: Date | null) => (d ? d.getTime() : null);

export function toTrackDTO(t: Track): TrackDTO {
	return {
		id: t.id,
		status: t.status,
		priority: t.priority,
		position: t.position,
		provider: t.provider,
		sourceId: t.sourceId,
		requestedUrl: t.requestedUrl,
		spotifyId: t.spotifyId,
		youtubeId: t.youtubeId,
		title: t.title,
		artist: t.artist,
		album: t.album,
		durationMs: t.durationMs,
		artworkUrl: t.artworkUrl,
		matchUrl: t.matchUrl,
		matchTitle: t.matchTitle,
		matchScore: t.matchScore,
		formatPreset: t.formatPreset,
		hasLyrics: t.hasLyrics,
		hasSyncedLyrics: t.hasSyncedLyrics,
		hasArtwork: t.hasArtwork,
		filePath: t.filePath,
		fileSize: t.fileSize,
		bitrate: t.bitrate,
		attempts: t.attempts,
		error: t.error,
		skipReason: t.skipReason,
		createdAt: t.createdAt.getTime(),
		startedAt: ms(t.startedAt),
		finishedAt: ms(t.finishedAt)
	};
}

export function getTrack(id: string) {
	return db.select().from(schema.tracks).where(eq(schema.tracks.id, id)).get();
}

/** Update a track row and broadcast the new state. */
export function patchTrack(id: string, patch: Partial<typeof schema.tracks.$inferInsert>) {
	const row = db.update(schema.tracks).set(patch).where(eq(schema.tracks.id, id)).returning().get();
	if (row) bus.emit('track', toTrackDTO(row));
	return row;
}
