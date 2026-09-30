/**
 * One-time import from a Calliope v1 (Next.js) database: monitored playlists and finished downloads.
 * Download history matters because it's what stops monitored playlists re-queuing
 * everything that was already fetched.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { parseLink } from './sources/parse';

interface LegacyPlaylist {
	url: string;
	name: string | null;
	enabled: number;
}
interface LegacyTrack {
	spotify_id: string | null;
	youtube_id: string | null;
	youtube_url: string | null;
	title: string | null;
	artist: string | null;
	album: string | null;
	duration_s: number | null;
	cover_url: string | null;
	final_path: string | null;
	file_size: number | null;
	lyrics: string | null;
	lyrics_synced: number | null;
	created_at: string | null;
	format: string | null;
	quality: string | null;
}

const PRESET: Record<string, string> = { mp3: 'mp3-320', opus: 'opus', flac: 'flac' };

export function importLegacy(dbFile: string) {
	if (!fs.existsSync(dbFile)) throw new Error(`File not found: ${dbFile}`);
	const legacy = new Database(dbFile, { readonly: true, fileMustExist: true });
	try {
		const tables = new Set(
			(
				legacy.prepare("select name from sqlite_master where type='table'").all() as {
					name: string;
				}[]
			).map((t) => t.name)
		);
		if (!tables.has('tracks') || !tables.has('jobs'))
			throw new Error('This does not look like a Calliope v1 database');

		let sources = 0;
		let skippedSources = 0;
		if (tables.has('monitored_playlists')) {
			const rows = legacy
				.prepare('select url, name, enabled from monitored_playlists')
				.all() as LegacyPlaylist[];
			for (const row of rows) {
				const link = parseLink(row.url);
				if (!link || link.kind === 'track' || link.kind === 'channel') {
					skippedSources++;
					continue;
				}
				const exists = db
					.select({ id: schema.sources.id })
					.from(schema.sources)
					.where(
						and(eq(schema.sources.provider, link.provider), eq(schema.sources.externalId, link.id))
					)
					.get();
				if (exists) {
					skippedSources++;
					continue;
				}
				db.insert(schema.sources)
					.values({
						id: crypto.randomUUID(),
						provider: link.provider,
						kind: link.kind as 'playlist' | 'album',
						externalId: link.id,
						url: link.url,
						name: row.name || 'Imported playlist',
						enabled: row.enabled === 1,
						intervalMinutes: 60,
						autoQueue: true
					})
					.run();
				sources++;
			}
		}

		const done = legacy
			.prepare(
				`select t.*, j.format, j.quality from tracks t left join jobs j on j.id = t.job_id
				 where t.status = 'done'`
			)
			.all() as LegacyTrack[];
		let tracks = 0;
		db.transaction((tx) => {
			for (const t of done) {
				if (!t.spotify_id && !t.youtube_id) continue;
				const dup = tx
					.select({ id: schema.tracks.id })
					.from(schema.tracks)
					.where(
						t.spotify_id
							? eq(schema.tracks.spotifyId, t.spotify_id)
							: eq(schema.tracks.youtubeId, t.youtube_id!)
					)
					.get();
				if (dup) continue;
				const finished = t.created_at ? new Date(t.created_at.replace(' ', 'T') + 'Z') : new Date();
				tx.insert(schema.tracks)
					.values({
						id: crypto.randomUUID(),
						status: 'done',
						position: finished.getTime(),
						provider: t.spotify_id ? 'spotify' : 'youtube',
						spotifyId: t.spotify_id,
						youtubeId: t.youtube_id,
						title: t.title,
						artist: t.artist,
						album: t.album,
						durationMs: t.duration_s ? t.duration_s * 1000 : null,
						artworkUrl: t.cover_url,
						matchUrl: t.youtube_url,
						formatPreset: PRESET[t.format ?? 'mp3'] ?? 'mp3-320',
						hasLyrics: !!t.lyrics,
						hasSyncedLyrics: t.lyrics_synced === 1,
						hasArtwork: !!t.cover_url,
						filePath: t.final_path,
						fileSize: t.file_size,
						createdAt: finished,
						finishedAt: finished,
						log: 'Imported from Calliope v1'
					})
					.run();
				tracks++;
			}
		});
		return { sources, skippedSources, tracks };
	} finally {
		legacy.close();
	}
}
