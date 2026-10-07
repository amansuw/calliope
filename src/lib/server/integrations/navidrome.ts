import crypto from 'node:crypto';
import { bus } from '../events';
import { getSettings } from '../settings';

/** What Navidrome says about its scanner. `error` only exists on newer versions. */
export interface NavidromeScanStatus {
	scanning: boolean;
	count?: number;
	lastScan?: string;
	error?: string;
}

let pending: NodeJS.Timeout | null = null;
/** The scan being followed to its end, if any */
let following: Promise<void> | null = null;
/** When a failed automatic scan was last reported, so a broken Navidrome is not announced per download */
let warnedAt = 0;

const POLL_MS = 2000;
const GIVE_UP_MS = 30 * 60_000;
const WARN_EVERY_MS = 6 * 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function navidromeConfigured() {
	const { url, user, password } = getSettings().navidrome;
	return !!url && !!user && !!password;
}

async function call(endpoint: string, extra: Record<string, string> = {}) {
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
		f: 'json',
		...extra
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

const scanStatus = async () =>
	((await call('getScanStatus')).scanStatus ?? { scanning: false }) as NavidromeScanStatus;

/**
 * Did the scan that was just followed finish properly? Navidrome answers "ok" as soon as a scan
 * is queued and (before it grew an `error` field) says nothing when the scan fails, but it only
 * moves `lastScan` forward when a scan completes.
 */
export function scanOutcome(
	before: NavidromeScanStatus,
	after: NavidromeScanStatus
): { ok: boolean; message: string } {
	if (after.scanning)
		return { ok: false, message: 'The scan is still running; Calliope stopped waiting for it.' };
	if (after.error) return { ok: false, message: after.error };
	if (!after.lastScan || after.lastScan === before.lastScan)
		return {
			ok: false,
			message:
				'Navidrome ended the scan without recording it, which usually means the scan failed. Its log has the reason.'
		};
	return {
		ok: true,
		message: after.count ? `${after.count.toLocaleString('en-US')} tracks in its library.` : ''
	};
}

async function follow(before: NavidromeScanStatus, quiet: boolean) {
	const started = Date.now();
	let after = before;
	try {
		do {
			await sleep(POLL_MS);
			after = await scanStatus();
			// A queued scan may not have begun at the first look
		} while (
			Date.now() - started < GIVE_UP_MS &&
			(after.scanning || (after.lastScan === before.lastScan && Date.now() - started < 3 * POLL_MS))
		);
	} catch (err) {
		after = { scanning: false, error: `Lost contact with Navidrome: ${(err as Error).message}` };
	}
	const outcome = scanOutcome(before, after);
	if (outcome.ok) {
		warnedAt = 0;
		if (!quiet) bus.toast('success', 'Navidrome rescanned', outcome.message || undefined);
	} else if (!quiet || Date.now() - warnedAt > WARN_EVERY_MS) {
		warnedAt = Date.now();
		bus.toast('error', 'Navidrome scan did not complete', outcome.message);
	}
	if (!outcome.ok) console.warn('[navidrome] scan did not complete:', outcome.message);
}

/**
 * Ask Navidrome to rescan its library and follow the scan to its end; the result arrives as a
 * toast. `quiet` (scans Calliope starts by itself) only speaks up when the scan fails.
 */
export async function startNavidromeScan(opts: { full?: boolean; quiet?: boolean } = {}) {
	if (following) {
		if (opts.quiet) return null;
		throw new Error('A Navidrome scan is already running');
	}
	const before = await scanStatus();
	const res = await call('startScan', opts.full ? { fullScan: 'true' } : {});
	following = follow(before, !!opts.quiet).finally(() => {
		following = null;
	});
	return (res.scanStatus ?? { scanning: true }) as NavidromeScanStatus;
}

/** Debounced: a burst of finished downloads or edits triggers one rescan. */
export function scheduleNavidromeScan() {
	if (!getSettings().navidrome.enabled) return;
	if (pending) clearTimeout(pending);
	pending = setTimeout(() => {
		pending = null;
		startNavidromeScan({ quiet: true }).catch((err) =>
			console.warn('[navidrome] scan failed:', err.message)
		);
	}, 30_000);
	pending.unref();
}

export async function testNavidrome() {
	const body = await call('ping');
	return `Connected to ${body.type ?? 'Subsonic'} ${body.serverVersion ?? body.version ?? ''}`.trim();
}
