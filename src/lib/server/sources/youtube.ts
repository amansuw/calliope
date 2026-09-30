import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitArtistTitle } from '$lib/text';
import { bin } from '../binaries';
import { runOk, type RunOptions } from '../proc';
import { getSettings } from '../settings';
import type { RemoteCollection, RemoteTrack } from './types';

export interface YtEntry {
	id: string;
	title: string;
	durationSec: number | null;
	channel: string | null;
	channelId: string | null;
	viewCount: number | null;
	url: string;
}

export interface YtVideoInfo extends YtEntry {
	/** YouTube Music provides structured music metadata for official releases */
	track: string | null;
	artist: string | null;
	artists: string[];
	album: string | null;
	releaseYear: number | null;
	thumbnail: string | null;
}

/**
 * Arguments shared by every yt-dlp call: cookies and config isolation.
 * A cookies file is copied to a temp path first because yt-dlp rewrites it on exit,
 * which fails on read-only mounts and races between concurrent workers.
 */
export function baseArgs(): { args: string[]; cleanup: () => void } {
	const { cookiesFile, cookiesFromBrowser } = getSettings().ytdlp;
	const args = ['--ignore-config', '--no-colors'];
	if (cookiesFile && fs.existsSync(cookiesFile)) {
		const tmp = path.join(os.tmpdir(), `calliope-cookies-${crypto.randomUUID()}.txt`);
		fs.copyFileSync(cookiesFile, tmp);
		args.push('--cookies', tmp);
		return { args, cleanup: () => fs.rmSync(tmp, { force: true }) };
	}
	if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);
	return { args, cleanup: () => {} };
}

export async function ytdlpJson<T = Record<string, unknown>>(
	args: string[],
	opts: RunOptions = {}
): Promise<T> {
	const base = baseArgs();
	try {
		const res = await runOk(bin('ytdlp'), [...base.args, '-J', ...args], {
			timeoutMs: 120_000,
			...opts
		});
		return JSON.parse(res.stdout) as T;
	} finally {
		base.cleanup();
	}
}

type RawEntry = {
	id?: string;
	title?: string;
	duration?: number;
	channel?: string;
	uploader?: string;
	channel_id?: string;
	view_count?: number;
	url?: string;
	thumbnails?: { url: string; width?: number }[];
	thumbnail?: string;
	track?: string;
	artist?: string;
	artists?: string[];
	creators?: string[];
	album?: string;
	release_year?: number;
	release_date?: string;
	upload_date?: string;
};

function toEntry(e: RawEntry): YtEntry | null {
	if (!e.id || !e.title || e.title === '[Private video]' || e.title === '[Deleted video]')
		return null;
	return {
		id: e.id,
		title: e.title,
		durationSec: typeof e.duration === 'number' ? e.duration : null,
		channel: e.channel ?? e.uploader ?? null,
		channelId: e.channel_id ?? null,
		viewCount: e.view_count ?? null,
		url: `https://www.youtube.com/watch?v=${e.id}`
	};
}

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export async function ytVideoInfo(idOrUrl: string, opts: RunOptions = {}): Promise<YtVideoInfo> {
	const url = idOrUrl.startsWith('http') ? idOrUrl : `https://music.youtube.com/watch?v=${idOrUrl}`;
	const raw = await ytdlpJson<RawEntry>(['--skip-download', '--no-playlist', url], opts);
	const entry = toEntry(raw);
	if (!entry) throw new Error('Video is unavailable');
	const artists = raw.artists ?? raw.creators ?? (raw.artist ? raw.artist.split(/,\s*/) : []);
	const year = raw.release_year ?? (raw.release_date ? Number(raw.release_date.slice(0, 4)) : null);
	return {
		...entry,
		track: raw.track ?? null,
		artist: artists[0] ?? raw.artist ?? null,
		artists,
		album: raw.album ?? null,
		releaseYear: year || null,
		thumbnail: bestThumb(raw) ?? thumb(entry.id)
	};
}

function bestThumb(raw: RawEntry) {
	const list = (raw.thumbnails ?? []).filter((t) => t.url && !t.url.includes('.webp'));
	list.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
	return list[0]?.url ?? raw.thumbnail ?? null;
}

/** Plain YouTube search — returns durations and channels, which matching needs. */
export async function ytSearch(
	query: string,
	count = 6,
	opts: RunOptions = {}
): Promise<YtEntry[]> {
	const res = await ytdlpJson<{ entries?: RawEntry[] }>(
		['--flat-playlist', `ytsearch${count}:${query}`],
		opts
	);
	return (res.entries ?? []).map(toEntry).filter((e): e is YtEntry => !!e);
}

/** YouTube Music "Songs" search. Flat results carry only id + title, so ranking comes from YTM itself. */
export async function ytMusicSearch(
	query: string,
	count = 3,
	opts: RunOptions = {}
): Promise<{ id: string; title: string }[]> {
	const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`;
	const res = await ytdlpJson<{ entries?: RawEntry[] }>(
		['--flat-playlist', '--playlist-end', String(count), url],
		opts
	);
	return (res.entries ?? [])
		.filter((e) => e.id && e.title)
		.map((e) => ({ id: e.id!, title: e.title! }));
}

function entryToTrack(e: YtEntry, position: number, album?: string | null): RemoteTrack {
	const { artist, title } = splitArtistTitle(e.title, e.channel);
	return {
		externalId: e.id,
		title,
		artist,
		artists: [artist],
		album: album ?? null,
		durationMs: e.durationSec ? Math.round(e.durationSec * 1000) : null,
		artworkUrl: thumb(e.id),
		trackNumber: album ? position : null,
		position
	};
}

/** List a playlist/album/channel via yt-dlp's flat extraction. */
export async function ytCollection(
	url: string,
	kind: 'playlist' | 'album' | 'channel',
	opts: RunOptions & { limit?: number } = {}
): Promise<RemoteCollection> {
	const target = kind === 'channel' ? `${url.replace(/\/$/, '')}/videos` : url;
	const args = ['--flat-playlist'];
	if (opts.limit) args.push('--playlist-end', String(opts.limit));
	const raw = await ytdlpJson<
		RawEntry & { entries?: RawEntry[]; channel_id?: string; playlist_count?: number }
	>([...args, target], { ...opts, timeoutMs: 300_000 });
	const albumName = kind === 'album' ? (raw.title ?? '').replace(/^Album - /, '') : null;
	const entries = (raw.entries ?? []).map(toEntry).filter((e): e is YtEntry => !!e);
	return {
		name: (raw.title ?? 'YouTube').replace(/ - Videos$/, ''),
		owner: raw.channel ?? raw.uploader ?? null,
		artworkUrl: bestThumb(raw) ?? (entries[0] ? thumb(entries[0].id) : null),
		externalId: kind === 'channel' ? (raw.channel_id ?? undefined) : undefined,
		items: entries.map((e, i) => entryToTrack(e, i + 1, albumName)),
		truncated: !!opts.limit && entries.length >= opts.limit
	};
}

/**
 * Cheap channel poll through the public RSS feed (latest ~15 uploads, no yt-dlp spawn).
 * Durations aren't in the feed, so they're filled in during matching.
 */
export async function ytChannelFeed(channelId: string): Promise<RemoteTrack[]> {
	const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) throw new Error(`YouTube feed returned ${res.status}`);
	const xml = await res.text();
	const author = xml.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1] ?? null;
	const items: RemoteTrack[] = [];
	for (const [, body] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
		const id = body.match(/<yt:videoId>([^<]+)</)?.[1];
		const title = decodeXml(body.match(/<title>([^<]+)</)?.[1] ?? '');
		if (!id || !title) continue;
		items.push(
			entryToTrack(
				{ id, title, durationSec: null, channel: author, channelId, viewCount: null, url: '' },
				items.length + 1
			)
		);
	}
	return items;
}

function decodeXml(s: string) {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
