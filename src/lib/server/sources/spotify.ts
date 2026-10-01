/**
 * Spotify metadata.
 *
 * Primary path: the public embed pages (open.spotify.com/embed/…), whose __NEXT_DATA__ carries
 * the entity and up to 100 tracks. No credentials needed. Playlists are then listed in full
 * through the web player's own query, using the anonymous session token the embed page hands out.
 *
 * Optional path: the Web API with client credentials. Since the Feb 2026 dev-mode changes it
 * only lists items of playlists the app owner owns/collaborates on, but single track and album
 * lookups still return album name, track/disc numbers and release date — which the embed lacks.
 */
import { getSettings } from '../settings';
import type { RemoteCollection, RemoteTrack } from './types';

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const EMBED_LIMIT = 100;

// ---------------- embed scraping ----------------

type EmbedImage = { url?: string; maxWidth?: number; width?: number | null };
interface EmbedEntity {
	type: string;
	id: string;
	name?: string;
	title?: string;
	subtitle?: string;
	artists?: { name: string }[];
	releaseDate?: { isoString?: string } | null;
	duration?: number;
	coverArt?: { sources?: EmbedImage[] };
	visualIdentity?: { image?: EmbedImage[] };
	trackList?: { uri: string; title: string; subtitle: string; duration: number }[];
}

/** Embed entity plus the anonymous web-player token the page was rendered with. */
type Embed = EmbedEntity & { accessToken: string | null };

async function fetchEmbed(kind: 'track' | 'album' | 'playlist', id: string): Promise<Embed> {
	const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
		headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
		signal: AbortSignal.timeout(20_000)
	});
	if (res.status === 404) throw new Error(`Spotify ${kind} not found (it may be private)`);
	if (!res.ok) throw new Error(`Spotify embed returned ${res.status}`);
	const html = await res.text();
	const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
	if (!json) throw new Error('Spotify embed page format changed (no __NEXT_DATA__)');
	const state = JSON.parse(json)?.props?.pageProps?.state;
	const entity = state?.data?.entity as EmbedEntity | undefined;
	if (!entity?.id) throw new Error('Spotify embed page had no entity data');
	return { ...entity, accessToken: state?.settings?.session?.accessToken ?? null };
}

function embedArtwork(e: EmbedEntity): string | null {
	const images = [...(e.visualIdentity?.image ?? []), ...(e.coverArt?.sources ?? [])].filter(
		(i) => i.url
	);
	images.sort((a, b) => (b.maxWidth ?? b.width ?? 0) - (a.maxWidth ?? a.width ?? 0));
	return images[0]?.url ?? null;
}

const splitArtists = (s: string) =>
	s
		.split(/,\s*/)
		.map((a) => a.replace(/ /g, ' ').trim())
		.filter(Boolean);

const uriId = (uri: string) => uri.split(':').pop() ?? uri;

// ---------------- web player query (full playlists) ----------------

// Persisted-query id of the web player's fetchPlaylist operation. Spotify rotates these now and
// then; when this one stops resolving, listing falls back to the embed's first 100 tracks.
const FETCH_PLAYLIST_HASH = '19ff1327c29e99c208c86d7a9d8f1929cfdf3d3202a0ff4253c821f1901aa94d';
const PLAYLIST_PAGE = 100;

type PartnerImage = { url: string; width: number | null };
type PartnerArtists = { items?: { profile?: { name?: string } }[] };
interface PartnerItem {
	itemV2?: {
		data?: {
			__typename?: string;
			uri?: string;
			name?: string;
			trackNumber?: number;
			discNumber?: number;
			trackDuration?: { totalMilliseconds?: number };
			artists?: PartnerArtists;
			albumOfTrack?: {
				name?: string;
				artists?: PartnerArtists;
				coverArt?: { sources?: PartnerImage[] };
			};
		};
	};
}

async function playlistPage(id: string, accessToken: string, offset: number) {
	const res = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {
		method: 'POST',
		headers: {
			'User-Agent': UA,
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			operationName: 'fetchPlaylist',
			variables: {
				uri: `spotify:playlist:${id}`,
				offset,
				limit: PLAYLIST_PAGE,
				enableWatchFeedEntrypoint: false
			},
			extensions: { persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST_HASH } }
		}),
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) throw new Error(`playlist query returned ${res.status}`);
	const data = (await res.json()) as {
		data?: { playlistV2?: { content?: { totalCount?: number; items?: PartnerItem[] } } };
		errors?: { message?: string }[];
	};
	const content = data.data?.playlistV2?.content;
	if (!content?.items)
		throw new Error(data.errors?.[0]?.message ?? 'playlist query had no content');
	return { items: content.items, total: content.totalCount ?? content.items.length };
}

const partnerNames = (a?: PartnerArtists) =>
	(a?.items ?? []).map((i) => i.profile?.name).filter((n): n is string => !!n);

/** Every track of a public playlist, in order. Episodes and local files are skipped. */
async function playlistTracks(id: string, accessToken: string): Promise<RemoteTrack[]> {
	const rows: PartnerItem[] = [];
	for (let offset = 0, total = 1; offset < total; offset += PLAYLIST_PAGE) {
		const page = await playlistPage(id, accessToken, offset);
		if (!page.items.length) break;
		rows.push(...page.items);
		total = page.total;
	}
	const tracks: RemoteTrack[] = [];
	for (const row of rows) {
		const t = row.itemV2?.data;
		if (t?.__typename !== 'Track' || !t.uri?.startsWith('spotify:track:') || !t.name) continue;
		const artists = partnerNames(t.artists);
		const cover = [...(t.albumOfTrack?.coverArt?.sources ?? [])].sort(
			(a, b) => (b.width ?? 0) - (a.width ?? 0)
		)[0];
		tracks.push({
			externalId: uriId(t.uri),
			title: t.name,
			artist: artists[0] ?? 'Unknown Artist',
			artists,
			album: t.albumOfTrack?.name ?? null,
			albumArtist: partnerNames(t.albumOfTrack?.artists)[0] ?? null,
			durationMs: t.trackDuration?.totalMilliseconds ?? null,
			artworkUrl: cover?.url ?? null,
			trackNumber: t.trackNumber ?? null,
			discNumber: t.discNumber ?? null,
			position: tracks.length + 1
		});
	}
	return tracks;
}

// ---------------- Web API (optional) ----------------

let token: { value: string; expires: number } | null = null;

function apiConfigured() {
	const { clientId, clientSecret } = getSettings().spotify;
	return !!(clientId && clientSecret);
}

async function apiToken(): Promise<string> {
	if (token && token.expires > Date.now() + 60_000) return token.value;
	const { clientId, clientSecret } = getSettings().spotify;
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials',
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
	const data = (await res.json()) as { access_token: string; expires_in: number };
	token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
	return token.value;
}

async function api<T>(pathOrUrl: string, attempt = 0): Promise<T> {
	const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${await apiToken()}` },
		signal: AbortSignal.timeout(20_000)
	});
	if (res.status === 429 && attempt < 3) {
		const wait = Number(res.headers.get('retry-after') ?? '2');
		await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
		return api(pathOrUrl, attempt + 1);
	}
	if (res.status === 401 && attempt === 0) {
		token = null;
		return api(pathOrUrl, 1);
	}
	if (!res.ok)
		throw new Error(
			`Spotify API ${res.status} for ${url.replace('https://api.spotify.com/v1', '')}`
		);
	return (await res.json()) as T;
}

interface ApiTrack {
	id: string;
	name: string;
	duration_ms: number;
	track_number: number;
	disc_number: number;
	artists: { name: string }[];
	album?: {
		name: string;
		release_date?: string;
		images?: { url: string; width: number }[];
		artists?: { name: string }[];
	};
}

function apiTrackToRemote(
	t: ApiTrack,
	position: number,
	albumOverride?: ApiTrack['album']
): RemoteTrack {
	const album = albumOverride ?? t.album;
	return {
		externalId: t.id,
		title: t.name,
		artist: t.artists[0]?.name ?? 'Unknown Artist',
		artists: t.artists.map((a) => a.name),
		album: album?.name ?? null,
		albumArtist: album?.artists?.[0]?.name ?? null,
		durationMs: t.duration_ms,
		artworkUrl: album?.images?.sort((a, b) => b.width - a.width)[0]?.url ?? null,
		trackNumber: t.track_number,
		discNumber: t.disc_number,
		year: album?.release_date ? Number(album.release_date.slice(0, 4)) : null,
		position
	};
}

// ---------------- public ----------------

export async function spotifyTrack(id: string): Promise<RemoteTrack> {
	if (apiConfigured()) {
		try {
			return apiTrackToRemote(await api<ApiTrack>(`/tracks/${id}`), 1);
		} catch (err) {
			console.warn('[spotify] API track lookup failed, using embed:', (err as Error).message);
		}
	}
	const e = await fetchEmbed('track', id);
	const artists = e.artists?.map((a) => a.name) ?? splitArtists(e.subtitle ?? '');
	const iso = e.releaseDate?.isoString;
	return {
		externalId: e.id,
		title: e.title ?? e.name ?? 'Unknown',
		artist: artists[0] ?? 'Unknown Artist',
		artists,
		album: null,
		durationMs: e.duration ?? null,
		artworkUrl: embedArtwork(e),
		year: iso ? Number(iso.slice(0, 4)) : null,
		position: 1
	};
}

export async function spotifyCollection(
	kind: 'playlist' | 'album',
	id: string
): Promise<RemoteCollection> {
	if (apiConfigured()) {
		try {
			const viaApi = kind === 'album' ? await apiAlbum(id) : await apiPlaylist(id);
			if (viaApi) return viaApi;
		} catch (err) {
			console.warn(`[spotify] API ${kind} lookup failed, using embed:`, (err as Error).message);
		}
	}
	const e = await fetchEmbed(kind, id);
	const albumName = kind === 'album' ? (e.name ?? e.title ?? null) : null;
	const albumArtist = kind === 'album' ? (splitArtists(e.subtitle ?? '')[0] ?? null) : null;
	const artwork = embedArtwork(e);
	if (kind === 'playlist' && e.accessToken) {
		try {
			const items = await playlistTracks(id, e.accessToken);
			// An empty answer for a playlist the embed shows tracks for means the query broke.
			if (items.length || !e.trackList?.length)
				return {
					name: e.name ?? e.title ?? 'Spotify',
					owner: e.subtitle ?? null,
					artworkUrl: artwork,
					items,
					truncated: false
				};
		} catch (err) {
			console.warn('[spotify] full playlist listing failed, using embed:', (err as Error).message);
		}
	}
	const items: RemoteTrack[] = (e.trackList ?? []).map((t, i) => {
		const artists = splitArtists(t.subtitle);
		return {
			externalId: uriId(t.uri),
			title: t.title,
			artist: artists[0] ?? 'Unknown Artist',
			artists,
			album: albumName,
			albumArtist,
			durationMs: t.duration,
			// Playlist embeds don't carry per-track art; albums share the cover.
			artworkUrl: kind === 'album' ? artwork : null,
			trackNumber: kind === 'album' ? i + 1 : null,
			position: i + 1
		};
	});
	return {
		name: e.name ?? e.title ?? 'Spotify',
		owner: e.subtitle ?? null,
		artworkUrl: artwork,
		items,
		truncated: kind === 'playlist' && items.length >= EMBED_LIMIT
	};
}

async function apiAlbum(id: string): Promise<RemoteCollection> {
	type Album = NonNullable<ApiTrack['album']> & {
		tracks: { items: ApiTrack[]; next: string | null };
	};
	const album = await api<Album>(`/albums/${id}`);
	const items = [...album.tracks.items];
	for (let next = album.tracks.next; next;) {
		const page = await api<{ items: ApiTrack[]; next: string | null }>(next);
		items.push(...page.items);
		next = page.next;
	}
	return {
		name: album.name,
		owner: album.artists?.map((a) => a.name).join(', ') ?? null,
		artworkUrl: album.images?.[0]?.url ?? null,
		items: items.map((t, i) => apiTrackToRemote(t, i + 1, album)),
		truncated: false
	};
}

/** Returns null when the API withholds items (playlists the app owner doesn't own). */
async function apiPlaylist(id: string): Promise<RemoteCollection | null> {
	type Page = {
		items?: { item?: ApiTrack | null; track?: ApiTrack | null }[];
		next: string | null;
	};
	const meta = await api<{
		name: string;
		owner?: { display_name?: string };
		images?: { url: string }[];
		items?: Page;
		tracks?: Page;
	}>(`/playlists/${id}`);
	const first = meta.items ?? meta.tracks;
	if (!first?.items) return null;
	const rows = [...first.items];
	for (let next = first.next; next;) {
		const page = await api<Page>(next);
		rows.push(...(page.items ?? []));
		next = page.next;
	}
	const tracks = rows.map((r) => r.item ?? r.track).filter((t): t is ApiTrack => !!t?.id);
	return {
		name: meta.name,
		owner: meta.owner?.display_name ?? null,
		artworkUrl: meta.images?.[0]?.url ?? null,
		items: tracks.map((t, i) => apiTrackToRemote(t, i + 1)),
		truncated: false
	};
}

/** Used by the settings page "Test" button. */
export async function testSpotifyApi(): Promise<string> {
	token = null;
	await apiToken();
	const t = await api<ApiTrack>('/tracks/4uLU6hMCjMI75M1A2tKUQC');
	return `Authenticated — looked up "${t.name}"`;
}
