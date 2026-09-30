import { describe, expect, it, vi } from 'vitest';

// The module imports the DB and binaries; keeper selection itself is pure.
vi.mock('../db', () => ({ db: {}, schema: {} }));
vi.mock('../binaries', () => ({ bin: () => '', checkBinaries: async () => [] }));

const { pickKeeper, qualityScore } = await import('./duplicates');

const file = (o: Record<string, unknown>) =>
	({
		id: String(Math.random()),
		relPath: 'A/B/Song.mp3',
		quality: 320,
		completeness: 5,
		fromPipeline: false,
		addedAt: 0,
		...o
	}) as never;

describe('duplicate keeper selection', () => {
	it('prefers lossless over lossy and efficient codecs at equal bitrate', () => {
		expect(
			qualityScore({
				lossless: true,
				bitrate: 900,
				sampleRate: 44100,
				bitsPerSample: 16,
				codec: 'FLAC',
				format: 'flac'
			})
		).toBeGreaterThan(
			qualityScore({
				lossless: false,
				bitrate: 320,
				sampleRate: 44100,
				bitsPerSample: null,
				codec: 'MP3',
				format: 'mp3'
			})
		);
		expect(
			qualityScore({
				lossless: false,
				bitrate: 160,
				sampleRate: 48000,
				bitsPerSample: null,
				codec: 'Opus',
				format: 'opus'
			})
		).toBeGreaterThan(
			qualityScore({
				lossless: false,
				bitrate: 192,
				sampleRate: 44100,
				bitsPerSample: null,
				codec: 'MP3',
				format: 'mp3'
			})
		);
	});

	it('avoids copy-named files when quality ties', () => {
		const original = file({
			id: 'orig',
			relPath: 'Daft Punk/Discovery/02 - Aerodynamic.mp3',
			addedAt: 5
		});
		const copy = file({ id: 'copy', relPath: 'Dupes/Aerodynamic (copy).mp3', addedAt: 1 });
		expect(pickKeeper([copy, original]).id).toBe('orig');
		expect(
			pickKeeper([
				file({ id: 'n2', relPath: 'X/Song (2).mp3' }),
				file({ id: 'n1', relPath: 'X/Song.mp3', addedAt: 9 })
			]).id
		).toBe('n1');
	});

	it('still prefers better quality over a clean name', () => {
		expect(
			pickKeeper([
				file({ id: 'lo', quality: 128 }),
				file({ id: 'hi', quality: 320, relPath: 'X/Song (copy).mp3' })
			]).id
		).toBe('hi');
	});
});
