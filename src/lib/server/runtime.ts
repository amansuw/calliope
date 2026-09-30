import fs from 'node:fs';
import { ensurePasswordFromEnv, pruneSessions } from './auth';
import { checkBinaries } from './binaries';
import { bus } from './events';
import { pipeline } from './pipeline/queue';
import { getSettings } from './settings';
import { startScheduler } from './sync/sources';
import { startLibraryWatch } from './library/scanner';

declare global {
	var __calliope_runtime__: Promise<void> | undefined;
}

async function boot() {
	await ensurePasswordFromEnv();
	pruneSessions();
	const { paths } = getSettings();
	for (const dir of [paths.stagingDir, paths.quarantineDir]) fs.mkdirSync(dir, { recursive: true });

	const bins = await checkBinaries(true);
	const missing = bins.filter((b) => b.required && b.error);
	if (missing.length) {
		console.warn('[runtime] missing binaries:', missing.map((b) => b.label).join(', '));
		// Pipeline would fail every job; hold it until the user fixes paths in Settings.
		bus.toast(
			'error',
			'Missing dependencies',
			`${missing.map((b) => b.label).join(', ')} not found — see Settings › Binaries`,
			'/settings/binaries'
		);
	}

	pipeline.start();
	startScheduler();
	startLibraryWatch();
	console.log('[runtime] Calliope started');
}

/** Idempotent: first caller boots background services, the rest await the same promise. */
export function ensureRuntime() {
	return (globalThis.__calliope_runtime__ ??= boot().catch((err) => {
		console.error('[runtime] boot failed', err);
		globalThis.__calliope_runtime__ = undefined;
		throw err;
	}));
}
