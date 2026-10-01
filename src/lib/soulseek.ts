// Soulseek search results as the UI and pipeline use them. Pure helpers, shared by server and browser.

/** One raw hit as the network reports it (the subset of slsk-client's SearchResult we use). */
export interface SlskHit {
	user: string;
	file: string;
	size: number;
	slots: boolean;
	speed: number;
	queueLength?: number;
	/** Soulseek attribute codes: 0 bitrate, 1 duration (s), 4 sample rate, 5 bit depth */
	attribs: Record<number, number | undefined>;
}

export interface SlskFile {
	user: string;
	/** Full path on the peer, backslash separated */
	file: string;
	name: string;
	ext: string;
	size: number;
	bitrate: number | null;
	durationSec: number | null;
	sampleRate: number | null;
	bitDepth: number | null;
	lossless: boolean;
}

/** Files one user offers from one folder — usually an album */
export interface SlskGroup {
	key: string;
	user: string;
	dir: string;
	/** Last two folder names, e.g. "Gorillaz / Cracker Island (2023) [FLAC]" */
	label: string;
	freeSlot: boolean;
	speed: number;
	queueLength: number;
	lossless: boolean;
	totalSize: number;
	files: SlskFile[];
}

export type SlskFormat = 'flac' | 'lossless' | 'any';

const LOSSLESS = new Set(['flac', 'wav', 'aif', 'aiff', 'ape', 'wv', 'alac']);
const AUDIO = new Set([...LOSSLESS, 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'wma']);

const split = (file: string) => file.split(/[\\/]+/).filter(Boolean);

export function fileParts(file: string) {
	const parts = split(file);
	const name = parts.pop() ?? file;
	const dot = name.lastIndexOf('.');
	return {
		name,
		ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
		dir: parts.join('\\'),
		folders: parts
	};
}

/**
 * Group raw hits into folders, keep only audio in the wanted format, and rank them: peers that can
 * send right away first, then lossless, then the fastest.
 */
export function shapeResults(
	hits: SlskHit[],
	opts: { format?: SlskFormat; maxGroups?: number } = {}
): SlskGroup[] {
	const format = opts.format ?? 'any';
	const groups = new Map<string, SlskGroup>();
	const seen = new Set<string>();
	for (const h of hits) {
		const { name, ext, dir, folders } = fileParts(h.file);
		if (!AUDIO.has(ext)) continue;
		if (format === 'flac' && ext !== 'flac') continue;
		if (format === 'lossless' && !LOSSLESS.has(ext)) continue;
		const id = `${h.user}\u0000${h.file}`;
		if (seen.has(id)) continue;
		seen.add(id);
		const key = `${h.user}\u0000${dir}`;
		let g = groups.get(key);
		if (!g) {
			g = {
				key,
				user: h.user,
				dir,
				label: folders.slice(-2).join(' / ') || '(root)',
				freeSlot: h.slots,
				speed: h.speed ?? 0,
				queueLength: h.queueLength ?? 0,
				lossless: true,
				totalSize: 0,
				files: []
			};
			groups.set(key, g);
		}
		const lossless = LOSSLESS.has(ext);
		g.lossless &&= lossless;
		g.totalSize += h.size;
		g.files.push({
			user: h.user,
			file: h.file,
			name,
			ext,
			size: h.size,
			bitrate: h.attribs[0] ?? null,
			durationSec: h.attribs[1] ?? null,
			sampleRate: h.attribs[4] ?? null,
			bitDepth: h.attribs[5] ?? null,
			lossless
		});
	}
	const out = [...groups.values()];
	for (const g of out)
		g.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	out.sort(
		(a, b) =>
			Number(b.freeSlot) - Number(a.freeSlot) ||
			Number(b.lossless) - Number(a.lossless) ||
			a.queueLength - b.queueLength ||
			b.speed - a.speed
	);
	return out.slice(0, opts.maxGroups ?? 150);
}

const stripBrackets = (s: string) =>
	s
		.replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * Provisional tags from a peer's path, shown while the file is queued. The file's own tags
 * replace them once it has been downloaded.
 */
export function guessTags(file: string): {
	title: string;
	artist: string;
	album: string | null;
	trackNumber: number | null;
} {
	const { name, folders } = fileParts(file);
	let rest = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
	let trackNumber: number | null = null;
	// "01 - Title", "01. Title", "1-03 Title" (disc-track)
	const num = rest.match(/^(?:\d{1,2}[-.])?(\d{1,3})\s*[-.)]?\s+(?=\S)/);
	if (num && Number(num[1]) > 0 && Number(num[1]) < 200) {
		trackNumber = Number(num[1]);
		rest = rest.slice(num[0].length);
	}
	rest = rest.replace(/^[-–—]\s*/, '').trim();

	const parent = folders.at(-1) ?? '';
	const grand = folders.at(-2) ?? '';
	// "Artist - Album (2023) [FLAC]"
	const pa = parent.match(/^(.+?)\s+[-–—]\s+(.+)$/);
	let artist = pa ? pa[1].trim() : grand;
	const album = stripBrackets(pa ? pa[2] : parent).replace(/^\d{4}\s*[-–—.]?\s*/, '') || null;

	let title = rest;
	const parts = rest.split(/\s+[-–—]\s+/);
	// "Artist - Album - 01 - Title": the number sits in the middle
	const at = trackNumber === null ? parts.findIndex((p) => /^\d{1,3}$/.test(p)) : -1;
	if (at >= 0 && at < parts.length - 1 && Number(parts[at]) > 0) {
		trackNumber = Number(parts[at]);
		title = parts.slice(at + 1).join(' - ');
		if (at > 0) artist = parts[0].trim();
	} else if (parts.length > 1) {
		artist = parts[0].trim();
		title = parts.slice(1).join(' - ').trim();
	}
	return { title: title || name, artist: artist || 'Unknown Artist', album, trackNumber };
}

/** Where a queued Soulseek download comes from, stored in the track's `matchUrl`. */
export interface SlskRef {
	user: string;
	file: string;
	size: number;
}

const SCHEME = 'soulseek:';

export const encodeRef = (r: SlskRef) =>
	`${SCHEME}${encodeURIComponent(r.user)}/${encodeURIComponent(r.file)}#${r.size}`;

export function decodeRef(url: string | null | undefined): SlskRef | null {
	if (!url?.startsWith(SCHEME)) return null;
	const m = url.slice(SCHEME.length).match(/^([^/]+)\/([^#]+)(?:#(\d+))?$/);
	if (!m) return null;
	try {
		return {
			user: decodeURIComponent(m[1]),
			file: decodeURIComponent(m[2]),
			size: Number(m[3] ?? 0)
		};
	} catch {
		return null;
	}
}
