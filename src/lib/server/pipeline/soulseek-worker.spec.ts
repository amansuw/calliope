import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeRef } from '$lib/soulseek';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-slsk-'));
const fixture = path.join(tmp, 'fixture.flac');

// The peer transfer is replaced by a local copy: everything after it is the real pipeline.
const net = vi.hoisted(() => ({ hits: [] as unknown[], youtube: 0 }));
vi.mock('../soulseek', () => ({
	soulseek: {
		status: () => ({ enabled: true, configured: true }),
		search: async () => net.hits,
		download: async (_ref: unknown, dest: string) => fs.copyFileSync(fixture, dest)
	}
}));
// YouTube is replaced too: the match is canned and "yt-dlp" hands back the same fixture.
vi.mock('../sources/match', () => ({
	findMatch: async () => ({ candidate: { id: 'yt123', title: 'Silent Running' }, score: 0.9 })
}));
vi.mock('./download', async (original) => ({
	...(await original<typeof import('./download')>()),
	downloadAudio: async (_url: string, id: string) => {
		net.youtube++;
		const dest = path.join(tmp, 'staging', `${id}.flac`);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(fixture, dest);
		return dest;
	}
}));

describe.skipIf(!hasFfmpeg)('soulseek downloads in the pipeline', () => {
	beforeAll(() => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
		execFileSync('ffmpeg', [
			...['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
			...['-metadata', 'title=Silent Running', '-metadata', 'artist=Gorillaz'],
			...['-metadata', 'album=Cracker Island', '-metadata', 'album_artist=Gorillaz'],
			...['-metadata', 'track=4', '-metadata', 'date=2023', '-metadata', 'genre=Alternative'],
			fixture
		]);
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it('keeps the original file and files it by its own tags, not the path guess', async () => {
		const { updateSettings } = await import('../settings');
		const { pipeline } = await import('./queue');
		const { getTrack } = await import('./tracks');
		const { processTrack } = await import('./worker');
		const libraryDir = path.join(tmp, 'music');
		updateSettings({
			paths: { libraryDir, stagingDir: path.join(tmp, 'staging') },
			pipeline: { enrichMusicBrainz: false },
			lyrics: { enabled: false }
		});

		const [track] = pipeline.enqueue(
			[
				{
					provider: 'soulseek',
					title: 'wrong guess',
					artist: 'Unknown Artist',
					matchUrl: encodeRef({ user: 'peer', file: 'x\\y\\04 wrong guess.flac', size: 1 }),
					force: true
				}
			],
			{ formatPreset: 'flac' }
		);
		const stages: string[] = [];
		await processTrack(track, {
			signal: new AbortController().signal,
			log: () => {},
			stage: (s) => stages.push(s),
			progress: () => {}
		});

		const done = getTrack(track.id)!;
		expect(done).toMatchObject({
			title: 'Silent Running',
			artist: 'Gorillaz',
			album: 'Cracker Island',
			trackNumber: 4,
			year: 2023,
			genre: 'Alternative'
		});
		expect(done.filePath).toBe(
			path.join(libraryDir, 'Gorillaz', 'Cracker Island', '04 - Silent Running.flac')
		);
		expect(fs.statSync(done.filePath!).size).toBe(done.fileSize);
		expect(stages).toEqual(['resolving', 'downloading', 'tagging', 'moving']);
		expect(fs.readdirSync(path.join(tmp, 'staging'))).toEqual([]);
	});

	const spotifyTrack = (title: string) => ({
		provider: 'spotify' as const,
		spotifyId: title,
		title,
		artist: 'Gorillaz',
		artists: ['Gorillaz'],
		album: 'Cracker Island (Deluxe)',
		durationMs: 1000,
		// the same song is downloaded by every test here
		force: true
	});
	const run = async (title: string, formatPreset: string) => {
		const { pipeline } = await import('./queue');
		const { getTrack } = await import('./tracks');
		const { processTrack } = await import('./worker');
		const [track] = pipeline.enqueue([spotifyTrack(title)], { formatPreset });
		const log: string[] = [];
		await processTrack(track, {
			signal: new AbortController().signal,
			log: (l) => log.push(l),
			stage: () => {},
			progress: () => {}
		});
		return { track: getTrack(track.id)!, log };
	};
	const peerHit = {
		user: 'peer',
		file: 'music\\Gorillaz\\Cracker Island\\04 - Silent Running.flac',
		size: 30 * 1024 * 1024,
		slots: true,
		speed: 1,
		attribs: { 1: 1 }
	};

	it('fetches a FLAC track from Soulseek when a lossless match exists, keeping its metadata', async () => {
		net.hits = [peerHit];
		net.youtube = 0;
		const { track } = await run('Silent Running', 'flac');
		expect(net.youtube).toBe(0);
		expect(track.matchUrl).toMatch(/^soulseek:peer\//);
		// The Spotify album stays; the file's own tags only fill what was missing
		expect(track).toMatchObject({ album: 'Cracker Island (Deluxe)', trackNumber: 4, year: 2023 });
		expect(track.filePath).toMatch(/Cracker Island \(Deluxe\)[\\/]04 - Silent Running\.flac$/);
	});

	it('falls back to YouTube when Soulseek has no lossless match', async () => {
		net.hits = [{ ...peerHit, file: 'music\\Gorillaz\\Other\\01 - Something Else.flac' }];
		net.youtube = 0;
		const { track, log } = await run('Silent Running', 'flac');
		expect(net.youtube).toBe(1);
		expect(track.matchUrl).toBe('https://www.youtube.com/watch?v=yt123');
		expect(log.join('\n')).toContain('No lossless match on Soulseek');
	});

	it('does not touch Soulseek for other formats', async () => {
		net.hits = [peerHit];
		net.youtube = 0;
		const { track, log } = await run('Silent Running', 'mp3-320');
		expect(net.youtube).toBe(1);
		expect(track.matchUrl).toBe('https://www.youtube.com/watch?v=yt123');
		expect(log.join('\n')).not.toContain('Soulseek');
	});
});
