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
const net = vi.hoisted(() => ({
	hits: [] as unknown[],
	/** Results for specific searches; anything else gets `hits` */
	byQuery: {} as Record<string, unknown[]>,
	searches: [] as string[],
	youtube: 0,
	youtubeFails: false
}));
vi.mock('../soulseek', () => ({
	soulseek: {
		status: () => ({ enabled: true, configured: true }),
		search: async (query: string) => {
			net.searches.push(query);
			return net.byQuery[query] ?? net.hits;
		},
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
		if (net.youtubeFails) throw new Error('yt-dlp exploded');
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

	const spotifyTrack = (title: string, album: string) => ({
		provider: 'spotify' as const,
		spotifyId: title,
		title,
		artist: 'Gorillaz',
		artists: ['Gorillaz'],
		album,
		trackNumber: 4,
		durationMs: 1000,
		// the same song is downloaded by every test here
		force: true
	});
	const run = async (
		preferredSource: 'soulseek' | 'ytmusic',
		formatPreset = 'mp3-320',
		album = 'Cracker Island (Deluxe)'
	) => {
		const { updateSettings } = await import('../settings');
		const { pipeline } = await import('./queue');
		const { getTrack } = await import('./tracks');
		const { processTrack } = await import('./worker');
		updateSettings({ pipeline: { preferredSource } });
		const [track] = pipeline.enqueue([spotifyTrack('Silent Running', album)], { formatPreset });
		const log: string[] = [];
		const error = await processTrack(track, {
			signal: new AbortController().signal,
			log: (l) => log.push(l),
			stage: () => {},
			progress: () => {}
		}).then(
			() => null,
			(err: Error) => err
		);
		return { track: getTrack(track.id)!, log: log.join('\n'), error };
	};
	const peerHit = {
		user: 'peer',
		file: 'music\\Gorillaz\\Cracker Island\\04 - Silent Running.flac',
		size: 30 * 1024 * 1024,
		slots: true,
		speed: 1,
		attribs: { 1: 1 }
	};
	const otherSong = { ...peerHit, file: 'music\\Gorillaz\\Other\\01 - Something Else.flac' };
	const YOUTUBE_URL = 'https://www.youtube.com/watch?v=yt123';

	it('Soulseek preferred: fetches the lossless file whatever the output format, keeping metadata', async () => {
		Object.assign(net, { hits: [peerHit], youtube: 0, youtubeFails: false });
		const { track } = await run('soulseek', 'mp3-320');
		expect(net.youtube).toBe(0);
		expect(track.matchUrl).toMatch(/^soulseek:peer\//);
		// The Spotify album stays; the file's own tags only fill what was missing
		expect(track).toMatchObject({ album: 'Cracker Island (Deluxe)', trackNumber: 4, year: 2023 });
		expect(track.filePath).toMatch(/Cracker Island \(Deluxe\)[\\/]04 - Silent Running\.flac$/);
	});

	it('Soulseek preferred: falls back to YouTube when there is no lossless match', async () => {
		Object.assign(net, { hits: [otherSong], youtube: 0, youtubeFails: false });
		const { track, log } = await run('soulseek', 'mp3-320', 'Humanz');
		expect(net.youtube).toBe(1);
		expect(track.matchUrl).toBe(YOUTUBE_URL);
		expect(log).toContain('Soulseek search 1/3 (artist + title) "gorillaz silent running"');
		expect(log).toContain('1 lossless file — 1 another title');
		expect(log).toContain('No usable lossless copy on Soulseek');
		expect(log).toContain('Falling back to YouTube');
	});

	it('Soulseek preferred: widens the search when the precise one finds nothing', async () => {
		Object.assign(net, { hits: [], youtube: 0, youtubeFails: false, searches: [] });
		// shared without the artist in the path: only the title search finds it
		const bare = {
			...peerHit,
			file: 'Discography\\2018 - The Now Now [FLAC]\\04 -Silent Running.flac'
		};
		net.byQuery = { 'silent running': [bare] };
		const { track, log } = await run('soulseek', 'mp3-320', 'The Now Now (Deluxe)');
		net.byQuery = {};
		expect(net.searches).toEqual(['gorillaz silent running', 'silent running']);
		expect(net.youtube).toBe(0);
		expect(track.matchUrl).toMatch(/^soulseek:peer\//);
		expect(log).toContain('(title, album, track number, length)');
	});

	it('looks in the folder that already delivered the album before searching wider', async () => {
		// the first test above fetched a "Cracker Island (Deluxe)" track from this peer's folder
		Object.assign(net, { hits: [peerHit], youtube: 0, youtubeFails: false, searches: [] });
		const { track, log } = await run('soulseek');
		expect(net.searches).toEqual(['gorillaz cracker island']);
		expect(log).toContain('Soulseek search 1/4 (artist + album) "gorillaz cracker island"');
		expect(track.matchUrl).toMatch(/^soulseek:peer\//);
	});

	it('YouTube preferred: does not touch Soulseek while YouTube works', async () => {
		Object.assign(net, { hits: [peerHit], youtube: 0, youtubeFails: false });
		const { track, log } = await run('ytmusic', 'flac');
		expect(net.youtube).toBe(1);
		expect(track.matchUrl).toBe(YOUTUBE_URL);
		expect(log).not.toContain('Soulseek');
	});

	it('YouTube preferred: falls back to Soulseek when YouTube fails', async () => {
		Object.assign(net, { hits: [peerHit], youtube: 0, youtubeFails: true });
		const { track, log, error } = await run('ytmusic');
		expect(error).toBeNull();
		expect(track.matchUrl).toMatch(/^soulseek:peer\//);
		expect(log).toContain('Falling back to Soulseek');
	});

	it('reports the YouTube error when neither source has the track', async () => {
		Object.assign(net, { hits: [otherSong], youtube: 0, youtubeFails: true });
		const { error } = await run('ytmusic');
		expect(error?.message).toBe('yt-dlp exploded');
	});

	/** A lossy library file as a video rip leaves it, queued for a lossless upgrade. */
	const upgrade = async (name: string) => {
		const { eq } = await import('drizzle-orm');
		const { db, schema } = await import('../db');
		const { reindexFiles } = await import('../library/scanner');
		const { queueUpgrades, upgradedFiles } = await import('../studio/upgrade');
		const { getTrack } = await import('./tracks');
		const { processTrack } = await import('./worker');
		const mp3 = path.join(tmp, 'music', 'Gorillaz', 'My Mix', `${name}.mp3`);
		fs.mkdirSync(path.dirname(mp3), { recursive: true });
		execFileSync('ffmpeg', [
			...['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
			...['-metadata', 'title=Gorillaz - Silent Running (Official Video)'],
			...['-metadata', 'artist=Gorillaz', '-metadata', 'album=My Mix'],
			mp3
		]);
		await reindexFiles([mp3]);
		const row = () =>
			db.select().from(schema.libraryFiles).where(eq(schema.libraryFiles.path, mp3)).get();
		const old = row()!;
		const { queued, skipped } = await queueUpgrades([old.id]);
		expect(skipped).toEqual([]);
		// asking again while it waits queues nothing
		expect((await queueUpgrades([old.id])).skipped).toEqual([
			{ id: old.id, reason: 'Already queued' }
		]);
		const log: string[] = [];
		const error = await processTrack(getTrack(queued[0].track.id)!, {
			signal: new AbortController().signal,
			log: (l) => log.push(l),
			stage: () => {},
			progress: () => {}
		}).then(
			() => null,
			(err: Error) => err
		);
		const track = getTrack(queued[0].track.id)!;
		const fresh = upgradedFiles([track.id])[track.id];
		return { mp3, old, stillIndexed: !!row(), track, fresh, error, log: log.join('\n') };
	};

	it('upgrade: replaces a lossy library file with the lossless copy, keeping its tags', async () => {
		Object.assign(net, { hits: [peerHit], youtube: 0, youtubeFails: false, searches: [] });
		const { mp3, old, stillIndexed, track, fresh, error } = await upgrade('upgrade me');
		expect(error).toBeNull();
		expect(old.lossless).toBe(false);
		// searched by the song, not by the video title
		expect(net.searches[0]).toBe('gorillaz silent running');
		expect(net.youtube).toBe(0);
		expect(track).toMatchObject({ album: 'My Mix', artist: 'Gorillaz', trackNumber: 4 });
		expect(track.filePath).toMatch(/Gorillaz[\\/]My Mix[\\/].*\.flac$/);
		expect(fs.existsSync(track.filePath!)).toBe(true);
		// the old copy left the library for quarantine, and the new one is indexed in its place
		expect(fs.existsSync(mp3)).toBe(false);
		expect(stillIndexed).toBe(false);
		expect(fresh).toBeTruthy();
		const { listQuarantine } = await import('../library/duplicates');
		expect(listQuarantine().some((q) => q.from === mp3)).toBe(true);
	});

	it('upgrade: leaves the file alone when there is no lossless copy', async () => {
		Object.assign(net, { hits: [otherSong], youtube: 0, youtubeFails: false });
		const { mp3, stillIndexed, error } = await upgrade('keep me');
		expect(error?.message).toBe('No lossless copy found on Soulseek');
		expect(net.youtube).toBe(0);
		expect(fs.existsSync(mp3)).toBe(true);
		expect(stillIndexed).toBe(true);
	});
});
