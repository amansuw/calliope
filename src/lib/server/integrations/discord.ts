import { getSettings } from '../settings';

type Kind = 'completed' | 'newTracks' | 'errors';
const COLORS: Record<Kind, number> = { completed: 0xf5a524, newTracks: 0x8b5cf6, errors: 0xef4444 };

export async function notifyDiscord(kind: Kind, title: string, description: string, force = false) {
	const d = getSettings().discord;
	if (!force) {
		if (!d.enabled) return;
		if (kind === 'completed' && !d.notifyCompleted) return;
		if (kind === 'newTracks' && !d.notifyNewTracks) return;
		if (kind === 'errors' && !d.notifyErrors) return;
	}
	const embed = {
		title,
		description: description.slice(0, 4000),
		color: COLORS[kind],
		timestamp: new Date().toISOString(),
		footer: { text: 'Calliope' }
	};
	let res: Response;
	if (d.webhookUrl) {
		res = await fetch(d.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'Calliope', embeds: [embed] }),
			signal: AbortSignal.timeout(15_000)
		});
	} else if (d.botToken && d.channelId) {
		res = await fetch(`https://discord.com/api/v10/channels/${d.channelId}/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bot ${d.botToken}` },
			body: JSON.stringify({ embeds: [embed] }),
			signal: AbortSignal.timeout(15_000)
		});
	} else {
		if (force) throw new Error('Set a webhook URL, or a bot token and channel ID');
		return;
	}
	if (!res.ok)
		throw new Error(`Discord returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Collects completions and sends one summary message per quiet period. */
const batch: string[] = [];
let timer: NodeJS.Timeout | null = null;

export function queueCompletionNotice(line: string) {
	batch.push(line);
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		const lines = batch.splice(0);
		timer = null;
		const shown =
			lines.slice(0, 25).join('\n') + (lines.length > 25 ? `\n…and ${lines.length - 25} more` : '');
		notifyDiscord(
			'completed',
			`Downloaded ${lines.length} track${lines.length === 1 ? '' : 's'}`,
			shown
		).catch((err) => console.warn('[discord]', err.message));
	}, 60_000);
	timer.unref();
}
