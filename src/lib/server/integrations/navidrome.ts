import crypto from 'node:crypto';
import { getSettings } from '../settings';

let pending: NodeJS.Timeout | null = null;

async function call(endpoint: string) {
	const { url, user, password } = getSettings().navidrome;
	if (!url || !user || !password) throw new Error('Navidrome URL, user and password are required');
	const salt = crypto.randomBytes(8).toString('hex');
	const token = crypto
		.createHash('md5')
		.update(password + salt)
		.digest('hex');
	const params = new URLSearchParams({
		u: user,
		t: token,
		s: salt,
		v: '1.16.1',
		c: 'calliope',
		f: 'json'
	});
	const res = await fetch(`${url.replace(/\/$/, '')}/rest/${endpoint}?${params}`, {
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`Navidrome returned ${res.status}`);
	const body = (await res.json())['subsonic-response'];
	if (body?.status !== 'ok')
		throw new Error(body?.error?.message ?? 'Navidrome rejected the request');
	return body;
}

/** Debounced: a burst of finished downloads triggers one rescan. */
export function scheduleNavidromeScan() {
	if (!getSettings().navidrome.enabled) return;
	if (pending) clearTimeout(pending);
	pending = setTimeout(() => {
		pending = null;
		call('startScan').catch((err) => console.warn('[navidrome] scan failed:', err.message));
	}, 30_000);
	pending.unref();
}

export async function testNavidrome() {
	const body = await call('ping');
	return `Connected to ${body.type ?? 'Subsonic'} ${body.serverVersion ?? body.version ?? ''}`.trim();
}
