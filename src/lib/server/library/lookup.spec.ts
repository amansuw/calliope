import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-lookup-'));

describe('albumIdentity', () => {
	beforeAll(() => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it('files a track with the album the library already has', async () => {
		const { db, schema } = await import('../db');
		const { albumIdentity } = await import('./lookup');
		let n = 0;
		const add = (albumArtist: string, album: string, mbReleaseId: string | null) =>
			db
				.insert(schema.libraryFiles)
				.values({
					id: String(++n),
					path: `/music/${n}.flac`,
					relPath: `${n}.flac`,
					size: 1,
					mtimeMs: 1,
					albumArtist,
					album,
					mbReleaseId
				})
				.run();
		const ask = (albumArtist: string | null, album: string | null, releaseId: string | null) =>
			albumIdentity({ albumArtist, artist: 'Josh Homme', album, releaseId });

		// Nothing known yet: the first track decides, and the next one follows it even before the
		// first has reached the index — however its source spells the artist
		expect(ask('Disturbed', 'Asylum', 'pressing-a')).toEqual({
			albumArtist: 'Disturbed',
			album: 'Asylum',
			releaseId: 'pressing-a'
		});
		expect(ask('DISTURBED', 'asylum', 'pressing-b')).toEqual({
			albumArtist: 'Disturbed',
			album: 'Asylum',
			releaseId: 'pressing-a'
		});
		// Another album is not affected
		expect(ask('Disturbed', 'Immortalized', 'other').releaseId).toBe('other');

		// What the library's files carry wins, the most common value first
		add('Tool', 'Fear Inoculum', 'common');
		add('Tool', 'Fear Inoculum', 'common');
		add('Tool', 'Fear Inoculum', 'rare');
		add('TOOL', 'Fear Inoculum', null);
		expect(ask('TOOL', 'Fear Inoculum', 'new')).toEqual({
			albumArtist: 'Tool',
			album: 'Fear Inoculum',
			releaseId: 'common'
		});
		// The artist keeps that spelling on an album the library does not have yet
		expect(ask('TOOL', 'Lateralus', null).albumArtist).toBe('Tool');
		expect(ask('TOOL', null, 'solo')).toEqual({
			albumArtist: 'Tool',
			album: null,
			releaseId: 'solo'
		});

		// A compilation track whose source named no album artist joins the compilation…
		add('Various Artists', 'Sound City - Real to Reel', 'ost');
		expect(ask(null, 'Sound City - Real to Reel', null)).toEqual({
			albumArtist: 'Various Artists',
			album: 'Sound City - Real to Reel',
			releaseId: 'ost'
		});
		// …but another artist's album of the same name stays its own
		expect(ask('Someone Else', 'Fear Inoculum', 'theirs')).toEqual({
			albumArtist: 'Someone Else',
			album: 'Fear Inoculum',
			releaseId: 'theirs'
		});
	});
});
