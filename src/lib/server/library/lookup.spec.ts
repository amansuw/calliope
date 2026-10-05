import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-lookup-'));

describe('albumReleaseId', () => {
	beforeAll(() => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it('gives every track of an album the release ID its first track got', async () => {
		const { db, schema } = await import('../db');
		const { albumReleaseId } = await import('./lookup');
		const add = (name: string, album: string, mbReleaseId: string | null) =>
			db
				.insert(schema.libraryFiles)
				.values({
					id: name,
					path: `/music/${name}.flac`,
					relPath: `${name}.flac`,
					size: 1,
					mtimeMs: 1,
					albumArtist: 'Disturbed',
					album,
					mbReleaseId
				})
				.run();

		// Nothing known yet: the first track's own lookup decides, and the next one follows it
		// even before the first has reached the index
		expect(albumReleaseId('Disturbed', 'Asylum', 'pressing-a')).toBe('pressing-a');
		expect(albumReleaseId('Disturbed', 'Asylum', 'pressing-b')).toBe('pressing-a');
		expect(albumReleaseId('Disturbed', 'Asylum', null)).toBe('pressing-a');
		// Another album is not affected
		expect(albumReleaseId('Disturbed', 'Immortalized', 'other')).toBe('other');

		// What the library's files carry wins, the most common ID first
		add('one', 'Ten Thousand Fists', 'rare');
		add('two', 'Ten Thousand Fists', 'common');
		add('three', 'Ten Thousand Fists', 'common');
		add('four', 'Ten Thousand Fists', null);
		expect(albumReleaseId('Disturbed', 'Ten Thousand Fists', 'new')).toBe('common');

		// No album to group by: the track keeps its own
		expect(albumReleaseId('Disturbed', null, 'solo')).toBe('solo');
		expect(albumReleaseId(null, 'Asylum', null)).toBeNull();
	});
});
