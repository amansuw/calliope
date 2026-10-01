import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { ACTIVE_STATUSES } from '$lib/status';
import { matchKey } from '$lib/text';
import type { SourceDTO, SourceItemDTO, TrackStatus } from '$lib/types';
import { db, schema } from '../db';
import type { Source, SourceItem } from '../db/schema';
import { bus } from '../events';
import { notifyDiscord } from '../integrations/discord';
import { pipeline } from '../pipeline/queue';
import { parseLink, type ParsedLink } from '../sources/parse';
import { spotifyCollection } from '../sources/spotify';
import type { RemoteCollection, RemoteTrack } from '../sources/types';
import { ytChannelFeed, ytCollection } from '../sources/youtube';

const CHANNEL_INITIAL_LIMIT = 50;
const syncing = new Set<string>();

// ---------------- fetching ----------------

async function fetchCollection(
	link: Pick<ParsedLink, 'provider' | 'kind' | 'id' | 'url'>,
	incremental = false
): Promise<RemoteCollection & { partial?: boolean }> {
	if (link.provider === 'spotify') {
		if (link.kind !== 'playlist' && link.kind !== 'album')
			throw new Error('Not a Spotify collection');
		return spotifyCollection(link.kind, link.id);
	}
	if (link.kind === 'channel') {
		// After the first listing, poll the cheap RSS feed; it only has the latest uploads.
		if (incremental && link.id.startsWith('UC')) {
			const items = await ytChannelFeed(link.id);
			return { name: '', owner: null, artworkUrl: null, items, truncated: true, partial: true };
		}
		return ytCollection(link.url, 'channel', { limit: CHANNEL_INITIAL_LIMIT });
	}
	if (link.kind === 'track') throw new Error('Not a collection');
	return ytCollection(link.url, link.kind);
}

/** One-off expansion of a playlist/album link into tracks (no monitoring). */
export async function listCollection(link: ParsedLink) {
	return fetchCollection(link);
}

// ---------------- item state ----------------

const STATE_RANK: Record<string, number> = {
	done: 6,
	downloading: 5,
	queued: 4,
	failed: 2,
	skipped: 3,
	cancelled: 1
};

function chunk<T>(arr: T[], size = 400): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/** For each external id: the most relevant pipeline state, or 'library' / 'new'. */
export function resolveItemStates(
	provider: Source['provider'],
	items: Pick<SourceItem, 'externalId' | 'artist' | 'title'>[]
) {
	const col = provider === 'spotify' ? schema.tracks.spotifyId : schema.tracks.youtubeId;
	const states = new Map<string, { state: SourceItemDTO['state']; trackId: string | null }>();
	for (const part of chunk(items.map((i) => i.externalId))) {
		const rows = db
			.select({ id: schema.tracks.id, status: schema.tracks.status, ext: col })
			.from(schema.tracks)
			.where(inArray(col, part))
			.all();
		for (const r of rows) {
			if (!r.ext) continue;
			const rank = (s: TrackStatus) => (ACTIVE_STATUSES.includes(s) ? 5 : (STATE_RANK[s] ?? 0));
			const prev = states.get(r.ext);
			if (!prev || rank(r.status) > rank(prev.state as TrackStatus))
				states.set(r.ext, { state: r.status, trackId: r.id });
		}
	}
	const unresolved = items.filter((i) => {
		const s = states.get(i.externalId)?.state;
		return !s || s === 'failed' || s === 'cancelled' || s === 'skipped';
	});
	const keys = new Map<string, string[]>();
	for (const i of unresolved) {
		const k = matchKey(i.artist, i.title);
		if (k) keys.set(k, [...(keys.get(k) ?? []), i.externalId]);
	}
	for (const part of chunk([...keys.keys()])) {
		const hits = db
			.select({ key: schema.libraryFiles.matchKey })
			.from(schema.libraryFiles)
			.where(inArray(schema.libraryFiles.matchKey, part))
			.all();
		for (const h of hits) {
			for (const ext of keys.get(h.key!) ?? []) {
				states.set(ext, { state: 'library', trackId: states.get(ext)?.trackId ?? null });
			}
		}
	}
	for (const i of items)
		if (!states.has(i.externalId)) states.set(i.externalId, { state: 'new', trackId: null });
	return states;
}

function isMissing(state: SourceItemDTO['state']) {
	return state === 'new' || state === 'cancelled';
}

// ---------------- DTOs ----------------

export function toSourceDTO(s: Source): SourceDTO {
	const items = db
		.select({
			externalId: schema.sourceItems.externalId,
			artist: schema.sourceItems.artist,
			title: schema.sourceItems.title,
			ignored: schema.sourceItems.ignored
		})
		.from(schema.sourceItems)
		.where(and(eq(schema.sourceItems.sourceId, s.id), eq(schema.sourceItems.present, true)))
		.all();
	const states = resolveItemStates(s.provider, items);
	let have = 0;
	let missing = 0;
	for (const i of items) {
		const st = states.get(i.externalId)!.state;
		if (st === 'done' || st === 'library' || st === 'skipped') have++;
		else if (isMissing(st) && !i.ignored) missing++;
	}
	return {
		id: s.id,
		provider: s.provider,
		kind: s.kind,
		url: s.url,
		name: s.name,
		owner: s.owner,
		artworkUrl: s.artworkUrl,
		enabled: s.enabled,
		autoQueue: s.autoQueue,
		intervalMinutes: s.intervalMinutes,
		formatPreset: s.formatPreset,
		lastCheckedAt: s.lastCheckedAt?.getTime() ?? null,
		nextCheckAt: s.nextCheckAt?.getTime() ?? null,
		lastError: s.lastError,
		itemCount: items.length,
		truncated: s.truncated,
		haveCount: have,
		missingCount: missing,
		syncing: syncing.has(s.id)
	};
}

export function listSources(): SourceDTO[] {
	return db
		.select()
		.from(schema.sources)
		.orderBy(asc(schema.sources.createdAt))
		.all()
		.map(toSourceDTO);
}

export function getSource(id: string) {
	return db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
}

export function sourceItems(id: string): SourceItemDTO[] {
	const source = getSource(id);
	if (!source) return [];
	const items = db
		.select()
		.from(schema.sourceItems)
		.where(eq(schema.sourceItems.sourceId, id))
		.orderBy(asc(schema.sourceItems.position))
		.all();
	const states = resolveItemStates(source.provider, items);
	return items.map((i) => ({
		externalId: i.externalId,
		title: i.title,
		artist: i.artist,
		album: i.album,
		durationMs: i.durationMs,
		artworkUrl: i.artworkUrl,
		position: i.position,
		present: i.present,
		ignored: i.ignored,
		firstSeenAt: i.firstSeenAt.getTime(),
		...states.get(i.externalId)!
	}));
}

function emitSource(id: string) {
	const s = getSource(id);
	if (s) bus.emit('source', toSourceDTO(s));
}

// ---------------- mutations ----------------

export async function addSource(input: {
	url: string;
	intervalMinutes: number;
	autoQueue: boolean;
	formatPreset?: string | null;
}) {
	const link = parseLink(input.url);
	if (!link) throw new Error('Unrecognized URL');
	if (link.kind === 'track')
		throw new Error('That is a single track — use Download instead of Monitor');

	const existing = db
		.select()
		.from(schema.sources)
		.where(
			and(
				eq(schema.sources.provider, link.provider),
				eq(schema.sources.kind, link.kind),
				eq(schema.sources.externalId, link.id)
			)
		)
		.get();
	if (existing) throw new Error(`Already monitoring "${existing.name}"`);

	const collection = await fetchCollection(link);
	const id = crypto.randomUUID();
	db.insert(schema.sources)
		.values({
			id,
			provider: link.provider,
			kind: link.kind as Source['kind'],
			externalId: collection.externalId ?? link.id,
			url: link.url,
			name: collection.name,
			owner: collection.owner,
			artworkUrl: collection.artworkUrl,
			intervalMinutes: input.intervalMinutes,
			autoQueue: input.autoQueue,
			formatPreset: input.formatPreset || null
		})
		.run();
	await applyListing(id, collection, { initial: true });
	return toSourceDTO(getSource(id)!);
}

export function updateSource(
	id: string,
	patch: Partial<
		Pick<Source, 'enabled' | 'autoQueue' | 'intervalMinutes' | 'formatPreset' | 'name'>
	>
) {
	const current = getSource(id);
	if (!current) throw new Error('Source not found');
	const interval = patch.intervalMinutes ?? current.intervalMinutes;
	const nextCheckAt =
		patch.intervalMinutes !== undefined && interval > 0
			? new Date((current.lastCheckedAt?.getTime() ?? Date.now()) + interval * 60_000)
			: current.nextCheckAt;
	db.update(schema.sources)
		.set({ ...patch, nextCheckAt: interval > 0 ? nextCheckAt : null })
		.where(eq(schema.sources.id, id))
		.run();
	emitSource(id);
}

export function deleteSource(id: string) {
	db.delete(schema.sources).where(eq(schema.sources.id, id)).run();
	bus.emit('source:removed', { id });
}

export function setItemsIgnored(sourceId: string, externalIds: string[], ignored: boolean) {
	for (const part of chunk(externalIds)) {
		db.update(schema.sourceItems)
			.set({ ignored })
			.where(
				and(eq(schema.sourceItems.sourceId, sourceId), inArray(schema.sourceItems.externalId, part))
			)
			.run();
	}
	emitSource(sourceId);
}

/** Queue specific items (from the diff preview) — or every missing one when ids is omitted. */
export function queueItems(sourceId: string, externalIds?: string[]) {
	const source = getSource(sourceId);
	if (!source) throw new Error('Source not found');
	const items = db
		.select()
		.from(schema.sourceItems)
		.where(eq(schema.sourceItems.sourceId, sourceId))
		.all();
	const states = resolveItemStates(source.provider, items);
	const wanted = externalIds
		? items.filter((i) => externalIds.includes(i.externalId))
		: items.filter((i) => i.present && !i.ignored && isMissing(states.get(i.externalId)!.state));
	// Never double-queue something already in flight or done
	const toQueue = wanted.filter((i) => {
		const st = states.get(i.externalId)!.state;
		return !(st === 'done' || st === 'queued' || ACTIVE_STATUSES.includes(st as TrackStatus));
	});
	const rows = toQueue.map((i) => itemToTrackRow(source, i, externalIds ? true : false));
	const inserted = pipeline.enqueue(rows, { formatPreset: source.formatPreset });
	emitSource(sourceId);
	return inserted.length;
}

function itemToTrackRow(source: Source, i: SourceItem, force: boolean) {
	return {
		provider: source.provider,
		sourceId: source.id,
		requestedUrl:
			source.provider === 'spotify'
				? `https://open.spotify.com/track/${i.externalId}`
				: `https://www.youtube.com/watch?v=${i.externalId}`,
		spotifyId: source.provider === 'spotify' ? i.externalId : null,
		youtubeId: source.provider === 'youtube' ? i.externalId : null,
		title: i.title,
		artist: i.artist,
		album: i.album,
		albumArtist: source.kind === 'album' ? source.owner : null,
		trackNumber: source.kind === 'album' ? i.position : null,
		durationMs: i.durationMs,
		artworkUrl: i.artworkUrl ?? (source.kind === 'album' ? source.artworkUrl : null),
		force
	};
}

export function remoteToTrackRow(
	provider: Source['provider'],
	r: RemoteTrack,
	requestedUrl: string
) {
	return {
		provider,
		requestedUrl,
		spotifyId: provider === 'spotify' ? r.externalId : null,
		youtubeId: provider === 'youtube' ? r.externalId : null,
		title: r.title,
		artist: r.artist,
		artists: r.artists,
		album: r.album ?? null,
		albumArtist: r.albumArtist ?? null,
		trackNumber: r.trackNumber ?? null,
		discNumber: r.discNumber ?? null,
		year: r.year ?? null,
		durationMs: r.durationMs ?? null,
		artworkUrl: r.artworkUrl ?? null
	};
}

/** Merge a fresh listing into source_items and react to new tracks. */
async function applyListing(
	sourceId: string,
	listing: RemoteCollection & { partial?: boolean },
	opts: { initial?: boolean } = {}
) {
	const source = getSource(sourceId)!;
	const existing = new Map(
		db
			.select()
			.from(schema.sourceItems)
			.where(eq(schema.sourceItems.sourceId, sourceId))
			.all()
			.map((i) => [i.externalId, i])
	);
	const seen = new Set<string>();
	const fresh: RemoteTrack[] = [];
	const maxPos = Math.max(0, ...[...existing.values()].map((i) => i.position));

	db.transaction((tx) => {
		for (const item of listing.items) {
			if (seen.has(item.externalId)) continue;
			seen.add(item.externalId);
			const prev = existing.get(item.externalId);
			const values = {
				title: item.title,
				artist: item.artist,
				album: item.album ?? prev?.album ?? null,
				durationMs: item.durationMs ?? prev?.durationMs ?? null,
				artworkUrl: item.artworkUrl ?? prev?.artworkUrl ?? null,
				// RSS feeds list newest first and only partially; keep stable positions there.
				position: listing.partial ? (prev?.position ?? maxPos + seen.size) : item.position,
				present: true
			};
			if (prev) {
				tx.update(schema.sourceItems)
					.set(values)
					.where(
						and(
							eq(schema.sourceItems.sourceId, sourceId),
							eq(schema.sourceItems.externalId, item.externalId)
						)
					)
					.run();
			} else {
				tx.insert(schema.sourceItems)
					.values({ sourceId, externalId: item.externalId, ...values })
					.run();
				fresh.push(item);
			}
		}
		// A partial or capped listing can't tell what was removed further down.
		if (!listing.partial && !listing.truncated) {
			const gone = [...existing.keys()].filter((k) => !seen.has(k));
			for (const part of chunk(gone)) {
				tx.update(schema.sourceItems)
					.set({ present: false })
					.where(
						and(
							eq(schema.sourceItems.sourceId, sourceId),
							inArray(schema.sourceItems.externalId, part)
						)
					)
					.run();
			}
		}
		const now = new Date();
		tx.update(schema.sources)
			.set({
				name: listing.name || source.name,
				owner: listing.owner ?? source.owner,
				artworkUrl: listing.artworkUrl ?? source.artworkUrl,
				truncated: listing.partial ? source.truncated : listing.truncated,
				itemCount: listing.partial ? source.itemCount + fresh.length : seen.size,
				lastCheckedAt: now,
				nextCheckAt:
					source.intervalMinutes > 0
						? new Date(now.getTime() + source.intervalMinutes * 60_000)
						: null,
				lastError: null
			})
			.where(eq(schema.sources.id, sourceId))
			.run();
	});

	let queued = 0;
	if (source.autoQueue && source.enabled) queued = queueItems(sourceId);

	if (fresh.length && !opts.initial) {
		const names = fresh.slice(0, 5).map((f) => `${f.artist} — ${f.title}`);
		bus.toast(
			'info',
			`${fresh.length} new in ${source.name}`,
			names.join('\n'),
			`/sources/${sourceId}`
		);
		notifyDiscord(
			'newTracks',
			`${fresh.length} new track${fresh.length === 1 ? '' : 's'} in ${source.name}`,
			names.join('\n') +
				(fresh.length > 5 ? `\n…and ${fresh.length - 5} more` : '') +
				(queued ? `\n\nQueued ${queued}.` : '')
		).catch(() => {});
	}
	emitSource(sourceId);
	return { fresh: fresh.length, queued };
}

export async function syncSource(id: string) {
	if (syncing.has(id)) return { fresh: 0, queued: 0 };
	const source = getSource(id);
	if (!source) throw new Error('Source not found');
	syncing.add(id);
	emitSource(id);
	try {
		const listing = await fetchCollection(
			{ provider: source.provider, kind: source.kind, id: source.externalId, url: source.url },
			source.kind === 'channel'
		);
		return await applyListing(id, listing);
	} catch (err) {
		const message = (err as Error).message;
		const retryMinutes = Math.min(source.intervalMinutes || 60, 60);
		db.update(schema.sources)
			.set({
				lastError: message,
				lastCheckedAt: new Date(),
				nextCheckAt:
					source.intervalMinutes > 0 ? new Date(Date.now() + retryMinutes * 60_000) : null
			})
			.where(eq(schema.sources.id, id))
			.run();
		bus.toast('warning', `Sync failed: ${source.name}`, message, `/sources/${id}`);
		throw err;
	} finally {
		syncing.delete(id);
		emitSource(id);
	}
}

// ---------------- scheduler ----------------

let schedulerTimer: NodeJS.Timeout | null = null;
let running = false;

async function schedulerTick() {
	if (running) return;
	running = true;
	try {
		const due = db
			.select({ id: schema.sources.id })
			.from(schema.sources)
			.where(
				and(
					eq(schema.sources.enabled, true),
					sql`${schema.sources.intervalMinutes} > 0`,
					lte(schema.sources.nextCheckAt, new Date())
				)
			)
			.orderBy(asc(schema.sources.nextCheckAt))
			.all();
		// One at a time: gentle on Spotify/YouTube and keeps yt-dlp spawns bounded.
		for (const s of due)
			await syncSource(s.id).catch((err) => console.warn(`[sync] ${s.id}:`, err.message));
	} finally {
		running = false;
	}
}

export function startScheduler() {
	if (schedulerTimer) return;
	// Sources never checked (e.g. imported) get a first check soon after boot.
	db.update(schema.sources)
		.set({ nextCheckAt: new Date(Date.now() + 30_000) })
		.where(
			and(sql`${schema.sources.nextCheckAt} is null`, sql`${schema.sources.intervalMinutes} > 0`)
		)
		.run();
	schedulerTimer = setInterval(() => void schedulerTick(), 60_000);
	schedulerTimer.unref();
	setTimeout(() => void schedulerTick(), 10_000).unref();
}
