import { FORMAT_PRESETS } from '$lib/formats';
import type { Track } from '../db/schema';
import { getSettings } from '../settings';

type Kind = 'completed' | 'newTracks' | 'errors';
const COLORS: Record<Kind, number> = {
	completed: 0x2ecc71,
	newTracks: 0x8b5cf6,
	errors: 0xe74c3c
};

export interface Embed {
	title: string;
	description?: string;
	fields?: { name: string; value: string; inline?: boolean }[];
	thumbnail?: { url: string };
}

/** Discord accepts at most this many embeds in one message. */
const MAX_CARDS = 10;

export async function notifyDiscord(kind: Kind, embeds: Embed | Embed[], force = false) {
	const d = getSettings().discord;
	if (!force) {
		if (!d.enabled) return;
		if (kind === 'completed' && !d.notifyCompleted) return;
		if (kind === 'newTracks' && !d.notifyNewTracks) return;
		if (kind === 'errors' && !d.notifyErrors) return;
	}
	const timestamp = new Date().toISOString();
	const payload = [embeds].flat().map((e) => ({
		...e,
		title: e.title.slice(0, 256),
		description: e.description?.slice(0, 4000),
		color: COLORS[kind],
		timestamp,
		footer: { text: 'Calliope' }
	}));
	let res: Response;
	if (d.webhookUrl) {
		res = await fetch(d.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'Calliope', embeds: payload }),
			signal: AbortSignal.timeout(15_000)
		});
	} else if (d.botToken && d.channelId) {
		res = await fetch(`https://discord.com/api/v10/channels/${d.channelId}/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bot ${d.botToken}` },
			body: JSON.stringify({ embeds: payload }),
			signal: AbortSignal.timeout(15_000)
		});
	} else {
		if (force) throw new Error('Set a webhook URL, or a bot token and channel ID');
		return;
	}
	if (!res.ok)
		throw new Error(`Discord returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

type TrackInfo = Pick<
	Track,
	| 'artist'
	| 'title'
	| 'album'
	| 'requestedUrl'
	| 'filePath'
	| 'fileSize'
	| 'bitrate'
	| 'matchUrl'
	| 'artworkUrl'
	| 'error'
>;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const field = (name: string, value: string | null | undefined) =>
	value ? [{ name, value: value.slice(0, 1024), inline: true }] : [];

/** "**Artist** — Title", or the link for a track that has not been looked up yet. */
export const trackLine = (t: TrackInfo) =>
	t.title
		? `**${t.artist ?? 'Unknown Artist'}** — ${t.title}`
		: (t.requestedUrl ?? 'Unknown track');

/** What ended up on disk: "FLAC", or "MP3 · 320 kbps" for lossy files. */
function fileFormat(t: TrackInfo) {
	const ext = t.filePath?.split('.').pop()?.toLowerCase();
	if (!ext) return null;
	const lossy = Object.values(FORMAT_PRESETS).some((p) => p.ext === ext && p.lossy);
	return ext.toUpperCase() + (lossy && t.bitrate ? ` · ${t.bitrate} kbps` : '');
}

const origin = (t: TrackInfo) =>
	t.matchUrl?.startsWith('soulseek:') ? 'Soulseek' : t.matchUrl ? 'YouTube' : null;

const thumbnail = (t: TrackInfo) =>
	t.artworkUrl?.startsWith('http') ? { thumbnail: { url: t.artworkUrl } } : {};

/**
 * One card per downloaded track. More tracks than fit in a message (a playlist, a discography)
 * are listed in a single card instead.
 */
export function completedEmbeds(tracks: TrackInfo[]): Embed[] {
	if (tracks.length > MAX_CARDS) {
		const size = tracks.reduce((sum, t) => sum + (t.fileSize ?? 0), 0);
		return [
			{
				title: `✅ ${tracks.length} tracks downloaded`,
				description:
					tracks.slice(0, 25).map(trackLine).join('\n') +
					(tracks.length > 25 ? `\n…and ${tracks.length - 25} more` : ''),
				fields: field('Size', size ? megabytes(size) : null)
			}
		];
	}
	return tracks.map((t) => ({
		title: '✅ Track Downloaded',
		description: trackLine(t),
		fields: [
			...field('Album', t.album),
			...field('Format', fileFormat(t)),
			...field('Size', t.fileSize ? megabytes(t.fileSize) : null),
			...field('Source', origin(t))
		],
		...thumbnail(t)
	}));
}

export function failureEmbed(t: TrackInfo): Embed {
	return {
		title: '❌ Download Failed',
		description: trackLine(t),
		fields: field('Error', t.error).map((f) => ({ ...f, inline: false })),
		...thumbnail(t)
	};
}

/** Downloads that finish within this window are reported in one message. */
const WINDOW_MS = 15_000;
const finished: TrackInfo[] = [];
let timer: NodeJS.Timeout | null = null;

export function queueCompletionNotice(track: TrackInfo) {
	finished.push(track);
	if (timer) return;
	timer = setTimeout(() => {
		timer = null;
		notifyDiscord('completed', completedEmbeds(finished.splice(0))).catch((err) =>
			console.warn('[discord]', err.message)
		);
	}, WINDOW_MS);
	timer.unref();
}
