export type Provider = 'spotify' | 'youtube';
export type LinkKind = 'track' | 'playlist' | 'album' | 'channel';

export interface ParsedLink {
	provider: Provider;
	kind: LinkKind;
	id: string;
	/** Canonical URL for this entity */
	url: string;
}

const SPOTIFY_URI = /^spotify:(track|playlist|album):([A-Za-z0-9]{22})$/;
const SPOTIFY_PATH =
	/^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|playlist|album)\/([A-Za-z0-9]{22})/i;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseLink(raw: string): ParsedLink | null {
	const input = raw.trim();
	if (!input) return null;

	const uri = input.match(SPOTIFY_URI);
	if (uri) return spotify(uri[1] as LinkKind, uri[2]);

	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^(www|m)\./, '').toLowerCase();

	if (host === 'open.spotify.com' || host === 'play.spotify.com') {
		const m = url.pathname.match(SPOTIFY_PATH);
		return m ? spotify(m[1].toLowerCase() as LinkKind, m[2]) : null;
	}

	if (host === 'youtu.be') {
		const id = url.pathname.slice(1).split('/')[0];
		return YT_ID.test(id) ? ytVideo(id) : null;
	}

	if (host === 'youtube.com' || host === 'music.youtube.com') {
		const v = url.searchParams.get('v');
		const list = url.searchParams.get('list');
		const path = url.pathname;

		if (path === '/playlist' && list) return ytList(list);
		if (path === '/watch' && v && YT_ID.test(v)) return ytVideo(v);
		const short = path.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
		if (short) return ytVideo(short[1]);

		const channel =
			path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/) ??
			path.match(/^\/(@[^/]+)/) ??
			path.match(/^\/(?:c|user)\/([^/]+)/);
		if (channel) {
			const id = decodeURIComponent(channel[1]);
			const base = id.startsWith('UC')
				? `https://www.youtube.com/channel/${id}`
				: id.startsWith('@')
					? `https://www.youtube.com/${id}`
					: `https://www.youtube.com${path.split('/').slice(0, 3).join('/')}`;
			return { provider: 'youtube', kind: 'channel', id, url: base };
		}
	}
	return null;
}

/** Split pasted text (newlines, commas, spaces) into unique parsed links. */
export function parseLinks(input: string): { links: ParsedLink[]; invalid: string[] } {
	const links: ParsedLink[] = [];
	const invalid: string[] = [];
	const seen = new Set<string>();
	for (const token of input.split(/[\s,]+/).filter(Boolean)) {
		const link = parseLink(token);
		if (!link) {
			invalid.push(token);
			continue;
		}
		const key = `${link.provider}:${link.kind}:${link.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		links.push(link);
	}
	return { links, invalid };
}

function spotify(kind: LinkKind, id: string): ParsedLink {
	return { provider: 'spotify', kind, id, url: `https://open.spotify.com/${kind}/${id}` };
}

function ytVideo(id: string): ParsedLink {
	return { provider: 'youtube', kind: 'track', id, url: `https://www.youtube.com/watch?v=${id}` };
}

function ytList(id: string): ParsedLink {
	// OLAK5uy_ lists are YouTube Music album releases
	const kind: LinkKind = id.startsWith('OLAK5uy_') ? 'album' : 'playlist';
	return { provider: 'youtube', kind, id, url: `https://www.youtube.com/playlist?list=${id}` };
}
