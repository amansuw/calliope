import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { bin } from '../binaries';
import { db, schema } from '../db';

const PEAKS = 800;
const RATE = 8000;

export interface Analysis {
	peaks: number[];
	/** Integrated RMS level in dBFS — a cheap stand-in for LUFS, good enough to level playback */
	loudness: number;
}

/** Decode to low-rate mono PCM once and derive waveform peaks + loudness from it. */
async function decode(file: string): Promise<Int16Array> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			bin('ffmpeg'),
			['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
			{
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		const chunks: Buffer[] = [];
		let err = '';
		child.stdout.on('data', (c: Buffer) => chunks.push(c));
		child.stderr.on('data', (c: Buffer) => (err += c.toString()));
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) return reject(new Error(`ffmpeg decode failed: ${err.slice(-300)}`));
			const buf = Buffer.concat(chunks);
			resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)));
		});
	});
}

export function computeAnalysis(samples: Int16Array): Analysis {
	const peaks: number[] = [];
	const bucket = Math.max(1, Math.floor(samples.length / PEAKS));
	let sumSq = 0;
	for (let b = 0; b < PEAKS; b++) {
		let max = 0;
		const end = Math.min(samples.length, (b + 1) * bucket);
		for (let i = b * bucket; i < end; i++) {
			const v = Math.abs(samples[i]);
			if (v > max) max = v;
		}
		peaks.push(Math.round((max / 32768) * 255));
	}
	for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
	const rms = Math.sqrt(sumSq / Math.max(1, samples.length)) / 32768;
	return { peaks, loudness: rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -70 };
}

const inflight = new Map<string, Promise<Analysis>>();

export function getAnalysis(id: string): Promise<Analysis> | Analysis | null {
	const row = db
		.select({
			path: schema.libraryFiles.path,
			peaks: schema.libraryFiles.peaks,
			loudness: schema.libraryFiles.loudness
		})
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, id))
		.get();
	if (!row) return null;
	if (row.peaks && row.loudness !== null)
		return { peaks: JSON.parse(row.peaks), loudness: row.loudness };
	let job = inflight.get(id);
	if (!job) {
		job = decode(row.path)
			.then(computeAnalysis)
			.then((a) => {
				db.update(schema.libraryFiles)
					.set({ peaks: JSON.stringify(a.peaks), loudness: a.loudness })
					.where(eq(schema.libraryFiles.id, id))
					.run();
				return a;
			})
			.finally(() => inflight.delete(id));
		inflight.set(id, job);
	}
	return job;
}
