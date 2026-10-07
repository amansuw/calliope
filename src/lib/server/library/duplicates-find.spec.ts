import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchKey } from '$lib/text';
import { encodeRaw } from './fingerprint';

vi.mock('../binaries', () => ({ bin: () => '', checkBinaries: async () => [] }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-dups-'));

/** Deterministic noise standing in for a recording's fingerprint frames. */
function frames(seed: number, n: number) {
	let x = seed;
	return Array.from({ length: n }, () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0));
}

describe('findDuplicates', () => {
	beforeAll(() => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it('groups files with the same artist and title, however far apart their lengths', async () => {
		const { db, schema } = await import('../db');
		const { findDuplicates } = await import('./duplicates');
		const add = (id: string, artist: string, title: string, durationMs: number, print?: number[]) =>
			db
				.insert(schema.libraryFiles)
				.values({
					id,
					path: `/music/${id}.flac`,
					relPath: `${id}.flac`,
					size: 1,
					mtimeMs: 1,
					artist,
					title,
					durationMs,
					matchKey: matchKey(artist, title),
					fingerprintRaw: print ? encodeRaw(print) : null
				})
				.run();

		const song = frames(1, 1500);
		// the album track, and a download of it with 40 s of something else on the end
		add('album', 'System of a Down', 'Hypnotize', 189_000, song);
		add('padded', 'System of a Down', 'Hypnotize', 229_000, [...song, ...frames(2, 320)]);
		// same name and a very different length, with no fingerprint to compare
		add('short', 'Tool', 'Lateralus', 200_000);
		add('long', 'Tool', 'Lateralus', 562_000);
		// far apart in length and named differently: never compared
		add('other', 'System of a Down', 'Lonely Day', 300_000, [...song, ...frames(3, 900)]);

		const groups = findDuplicates().map((g) => ({
			ids: g.files.map((f) => f.id).sort(),
			reasons: g.reasons
		}));
		expect(groups).toContainEqual({ ids: ['album', 'padded'], reasons: ['acoustic', 'metadata'] });
		expect(groups).toContainEqual({ ids: ['long', 'short'], reasons: ['metadata'] });
		expect(groups).toHaveLength(2);
	});
});
