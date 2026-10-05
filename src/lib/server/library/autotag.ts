/**
 * "Auto-tag": enrich existing library files from MusicBrainz — album, track numbers, original
 * year, genres and the album's cover art — then optionally move them to match the folder template.
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { applyEnrichment, enrich, splitGenres } from '../enrich';
import { bus } from '../events';
import { getSettings } from '../settings';
import { organize } from '../studio/service';
import { fetchImage, writeArtwork, writeTags } from '../tagger';
import { albumIdentity } from './lookup';
import { reindexFiles, setActivity } from './scanner';

let running = false;

export const autoTagRunning = () => running;

export function autoTagFiles(ids: string[], opts: { organize: boolean }) {
	if (running) throw new Error('Auto-tag is already running — wait for it to finish');
	const rows = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	if (!rows.length) throw new Error('No files selected');
	running = true;

	void (async () => {
		const matched: string[] = [];
		const written: string[] = [];
		const unmatched: string[] = [];
		try {
			for (const [i, r] of rows.entries()) {
				setActivity('tagging', i, rows.length, r.path);
				if (!r.artist || !r.title) {
					unmatched.push(r.relPath);
					continue;
				}
				try {
					const e = await enrich({
						artist: r.artist,
						title: r.title,
						durationMs: r.durationMs,
						file: r.path
					});
					if (!e) {
						unmatched.push(r.relPath);
						continue;
					}
					const p = applyEnrichment(r, e);
					const identity = albumIdentity({
						albumArtist: p.albumArtist,
						artist: p.artists?.[0] ?? p.artist ?? r.artist,
						album: p.album,
						releaseId: e.releaseId
					});
					await writeTags(r.path, {
						title: p.title,
						artists: p.artists?.length ? p.artists : undefined,
						album: identity.album,
						albumArtist: identity.albumArtist,
						year: p.year,
						trackNumber: p.trackNumber,
						trackTotal: e.trackTotal,
						discNumber: p.discNumber,
						genre: splitGenres(p.genre),
						mbRecordingId: e.recordingId,
						mbReleaseId: identity.releaseId,
						mbArtistId: e.artistId
					});
					// The user asked for the real album cover: replace whatever is embedded.
					if (e.artworkUrl) {
						const img = await fetchImage(e.artworkUrl);
						if (img) await writeArtwork(r.path, img.data, img.mime);
					}
					db.insert(schema.fileOps)
						.values({
							kind: 'retag',
							fromPath: r.path,
							toPath: r.path,
							detail: { source: 'musicbrainz', ...e }
						})
						.run();
					matched.push(r.id);
					written.push(r.path);
				} catch (err) {
					console.warn(`[autotag] ${r.path}:`, (err as Error).message);
					unmatched.push(r.relPath);
				}
			}
			await reindexFiles(written);
			let moved = 0;
			if (opts.organize && matched.length) {
				moved = (await organize(matched, getSettings().pipeline.pathTemplate, false)).moved;
			}
			bus.toast(
				matched.length ? 'success' : 'warning',
				`Auto-tagged ${matched.length} of ${rows.length}`,
				[
					moved ? `Moved ${moved} file${moved === 1 ? '' : 's'} to match the folder template.` : '',
					unmatched.length
						? `No confident match: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''}`
						: ''
				]
					.filter(Boolean)
					.join('\n') || undefined,
				'/library'
			);
		} finally {
			running = false;
			setActivity('idle');
		}
	})();
	return { started: rows.length };
}
