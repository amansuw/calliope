import { and, inArray, notInArray } from 'drizzle-orm';
import { FINISHED_STATUSES } from '$lib/status';
import { db, schema } from '../db';
import { pipeline } from '../pipeline/queue';
import { toTrackDTO } from '../pipeline/tracks';
import { soulseek } from '../soulseek';
import { readMetadata } from '../tagger';

/**
 * Queue a search for a lossless copy of each lossy file. The pipeline tags what it finds like
 * the file it replaces, files it, and moves the old copy to quarantine.
 */
export async function queueUpgrades(ids: string[]) {
	const status = soulseek.status();
	if (!status.enabled || !status.configured)
		throw new Error('Soulseek is not set up — see Settings › Integrations');

	const files = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	// Don't queue a file that is already waiting or running
	const pending = new Set(
		db
			.select({ of: schema.tracks.upgradeOf })
			.from(schema.tracks)
			.where(
				and(
					inArray(schema.tracks.upgradeOf, ids),
					notInArray(schema.tracks.status, [...FINISHED_STATUSES])
				)
			)
			.all()
			.map((r) => r.of)
	);

	const skipped: { id: string; reason: string }[] = [];
	const rows = [];
	for (const f of files) {
		if (f.lossless) skipped.push({ id: f.id, reason: 'Already lossless' });
		else if (pending.has(f.id)) skipped.push({ id: f.id, reason: 'Already queued' });
		else if (!f.title || !f.artist)
			skipped.push({ id: f.id, reason: 'Needs a title and an artist to search for' });
		else {
			// The index joins several artists into one string; the file still has them apart
			const artists = (await readMetadata(f.path).catch(() => null))?.tags.artist;
			rows.push({
				provider: 'soulseek' as const,
				upgradeOf: f.id,
				title: f.title,
				artist: artists?.[0] ?? f.artist,
				artists: artists?.length ? artists : [f.artist],
				album: f.album,
				albumArtist: f.albumArtist,
				trackNumber: f.trackNumber,
				discNumber: f.discNumber,
				year: f.year,
				genre: f.genre,
				durationMs: f.durationMs,
				// The song is in the library by definition
				force: true
			});
		}
	}
	const queued = pipeline.enqueue(rows, { formatPreset: 'flac' });
	return { queued: queued.map((t) => ({ fileId: t.upgradeOf!, track: toTrackDTO(t) })), skipped };
}

/** The library files that finished upgrades produced, by pipeline track. */
export function upgradedFiles(trackIds: string[]): Record<string, string> {
	if (!trackIds.length) return {};
	const rows = db
		.select({ id: schema.libraryFiles.id, trackId: schema.libraryFiles.trackId })
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.trackId, trackIds))
		.all();
	return Object.fromEntries(rows.map((r) => [r.trackId!, r.id]));
}
