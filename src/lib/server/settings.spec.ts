import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-settings-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Settings as a fresh process would read them from rows written by an older version. */
async function load(name: string, rows: Record<string, object>) {
	vi.resetModules();
	delete (globalThis as { __calliope_db__?: unknown }).__calliope_db__;
	process.env.CALLIOPE_DATA_DIR = path.join(tmp, name);
	process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
	const { db, schema } = await import('./db');
	for (const [key, value] of Object.entries(rows))
		db.insert(schema.settings).values({ key, value }).run();
	return (await import('./settings')).getSettings();
}

describe('settings from older versions', () => {
	it('FLAC with Soulseek enabled becomes "Soulseek first"', async () => {
		const s = await load('a', {
			pipeline: { formatPreset: 'flac', preferYtMusic: false },
			soulseek: { enabled: true, username: 'u', password: 'p', autoLossless: true }
		});
		expect(s.pipeline.preferredSource).toBe('soulseek');
		expect(s.soulseek).not.toHaveProperty('autoLossless');
	});

	it('the YouTube Music switch maps to the matching source', async () => {
		const off = await load('b', { pipeline: { formatPreset: 'mp3-320', preferYtMusic: false } });
		expect(off.pipeline.preferredSource).toBe('youtube');
		const on = await load('c', { pipeline: { formatPreset: 'flac', preferYtMusic: true } });
		expect(on.pipeline.preferredSource).toBe('ytmusic');
	});

	it('keeps a source chosen with the new setting', async () => {
		const s = await load('d', {
			pipeline: { formatPreset: 'flac', preferredSource: 'ytmusic' },
			soulseek: { enabled: true, username: 'u', password: 'p', autoLossless: true }
		});
		expect(s.pipeline.preferredSource).toBe('ytmusic');
	});
});
