import { sql } from 'drizzle-orm';
import { TRACK_STATUSES, type TrackStatus } from '../../status';
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull()
});

export const sessions = sqliteTable('sessions', {
	/** sha256 of the session token; the raw token only ever lives in the cookie */
	id: text('id').primaryKey(),
	createdAt: timestamp('created_at').notNull().default(now),
	expiresAt: timestamp('expires_at').notNull()
});

/** A monitored remote collection: Spotify playlist/album, YouTube playlist/channel. */
export const sources = sqliteTable(
	'sources',
	{
		id: text('id').primaryKey(),
		provider: text('provider', { enum: ['spotify', 'youtube'] }).notNull(),
		kind: text('kind', { enum: ['playlist', 'album', 'channel'] }).notNull(),
		externalId: text('external_id').notNull(),
		url: text('url').notNull(),
		name: text('name').notNull(),
		owner: text('owner'),
		artworkUrl: text('artwork_url'),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		/** Detected tracks get queued automatically; otherwise they wait in the diff preview. */
		autoQueue: integer('auto_queue', { mode: 'boolean' }).notNull().default(true),
		/** 0 = manual only */
		intervalMinutes: integer('interval_minutes').notNull().default(60),
		formatPreset: text('format_preset'),
		lastCheckedAt: timestamp('last_checked_at'),
		nextCheckAt: timestamp('next_check_at'),
		lastError: text('last_error'),
		itemCount: integer('item_count').notNull().default(0),
		/** The provider returned a truncated listing (e.g. Spotify embed caps at 100). */
		truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [uniqueIndex('sources_provider_external').on(t.provider, t.kind, t.externalId)]
);

/** Every track a source has ever listed. Diffing these against `tracks` gives the "new" set. */
export const sourceItems = sqliteTable(
	'source_items',
	{
		sourceId: text('source_id')
			.notNull()
			.references(() => sources.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		title: text('title').notNull(),
		artist: text('artist').notNull(),
		album: text('album'),
		durationMs: integer('duration_ms'),
		artworkUrl: text('artwork_url'),
		position: integer('position').notNull().default(0),
		/** Still present in the latest listing */
		present: integer('present', { mode: 'boolean' }).notNull().default(true),
		/** User chose to never download this one */
		ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
		firstSeenAt: timestamp('first_seen_at').notNull().default(now)
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.externalId] })]
);

export { TRACK_STATUSES, type TrackStatus };

/** A unit of work in the download pipeline, and afterwards the permanent download record. */
export const tracks = sqliteTable(
	'tracks',
	{
		id: text('id').primaryKey(),
		status: text('status', { enum: TRACK_STATUSES }).notNull().default('queued'),
		/** Higher runs first; ties break on `position` */
		priority: integer('priority').notNull().default(0),
		position: real('position').notNull(),
		requestedUrl: text('requested_url'),
		sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
		provider: text('provider', { enum: ['spotify', 'youtube'] }).notNull(),
		spotifyId: text('spotify_id'),
		youtubeId: text('youtube_id'),
		title: text('title'),
		artist: text('artist'),
		artists: text('artists', { mode: 'json' }).$type<string[]>(),
		album: text('album'),
		albumArtist: text('album_artist'),
		trackNumber: integer('track_number'),
		discNumber: integer('disc_number'),
		year: integer('year'),
		genre: text('genre'),
		durationMs: integer('duration_ms'),
		artworkUrl: text('artwork_url'),
		matchUrl: text('match_url'),
		matchTitle: text('match_title'),
		matchScore: real('match_score'),
		formatPreset: text('format_preset').notNull(),
		/** Set on done: what actually ended up in the file */
		hasLyrics: integer('has_lyrics', { mode: 'boolean' }).notNull().default(false),
		hasSyncedLyrics: integer('has_synced_lyrics', { mode: 'boolean' }).notNull().default(false),
		hasArtwork: integer('has_artwork', { mode: 'boolean' }).notNull().default(false),
		filePath: text('file_path'),
		fileSize: integer('file_size'),
		bitrate: integer('bitrate'),
		attempts: integer('attempts').notNull().default(0),
		/** Don't wait before this time (retry backoff) */
		retryAt: timestamp('retry_at'),
		/** Bypass duplicate checks (user explicitly re-requested it) */
		force: integer('force', { mode: 'boolean' }).notNull().default(false),
		error: text('error'),
		skipReason: text('skip_reason'),
		/** Tail of the worker log, kept for failed/finished items */
		log: text('log'),
		createdAt: timestamp('created_at').notNull().default(now),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [
		index('tracks_status_order').on(t.status, t.priority, t.position),
		index('tracks_spotify').on(t.spotifyId),
		index('tracks_youtube').on(t.youtubeId),
		index('tracks_source').on(t.sourceId),
		index('tracks_finished').on(t.finishedAt)
	]
);

/** Every audio file found on disk under the library root. */
export const libraryFiles = sqliteTable(
	'library_files',
	{
		id: text('id').primaryKey(),
		path: text('path').notNull(),
		relPath: text('rel_path').notNull(),
		size: integer('size').notNull(),
		mtimeMs: integer('mtime_ms').notNull(),
		format: text('format'),
		codec: text('codec'),
		lossless: integer('lossless', { mode: 'boolean' }),
		bitrate: integer('bitrate'),
		sampleRate: integer('sample_rate'),
		bitsPerSample: integer('bits_per_sample'),
		channels: integer('channels'),
		durationMs: integer('duration_ms'),
		title: text('title'),
		artist: text('artist'),
		album: text('album'),
		albumArtist: text('album_artist'),
		trackNumber: integer('track_number'),
		trackTotal: integer('track_total'),
		discNumber: integer('disc_number'),
		year: integer('year'),
		genre: text('genre'),
		isrc: text('isrc'),
		hasArtwork: integer('has_artwork', { mode: 'boolean' }).notNull().default(false),
		hasLyrics: integer('has_lyrics', { mode: 'boolean' }).notNull().default(false),
		mbRecordingId: text('mb_recording_id'),
		mbReleaseId: text('mb_release_id'),
		acoustidId: text('acoustid_id'),
		/** sha256 of the audio payload only, so re-tagging doesn't change it */
		audioHash: text('audio_hash'),
		/** Chromaprint fingerprint (compressed base64) */
		fingerprint: text('fingerprint'),
		fingerprintDuration: integer('fingerprint_duration'),
		/** Raw Chromaprint frames (base64 of little-endian uint32s) for acoustic duplicate matching */
		fingerprintRaw: text('fingerprint_raw'),
		/** Normalized "artist|title" used for fuzzy duplicate grouping */
		matchKey: text('match_key'),
		/** Integrated loudness (LUFS) for playback normalization */
		loudness: real('loudness'),
		/** Pre-computed waveform peaks, JSON array of 0..255 */
		peaks: text('peaks'),
		trackId: text('track_id').references(() => tracks.id, { onDelete: 'set null' }),
		scannedAt: timestamp('scanned_at').notNull().default(now),
		addedAt: timestamp('added_at').notNull().default(now)
	},
	(t) => [
		uniqueIndex('library_path').on(t.path),
		index('library_match_key').on(t.matchKey),
		index('library_audio_hash').on(t.audioHash),
		index('library_artist_album').on(t.albumArtist, t.album)
	]
);

/** Resolved duplicate decisions so the same pair doesn't resurface. */
export const duplicateDismissals = sqliteTable('duplicate_dismissals', {
	groupKey: text('group_key').primaryKey(),
	createdAt: timestamp('created_at').notNull().default(now)
});

/** Every file operation that changes the library, so moves/quarantines can be undone. */
export const fileOps = sqliteTable('file_ops', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	kind: text('kind', { enum: ['quarantine', 'move', 'retag', 'restore'] }).notNull(),
	fromPath: text('from_path'),
	toPath: text('to_path'),
	detail: text('detail', { mode: 'json' }),
	createdAt: timestamp('created_at').notNull().default(now)
});

export type Source = typeof sources.$inferSelect;
export type SourceItem = typeof sourceItems.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type LibraryFile = typeof libraryFiles.$inferSelect;
