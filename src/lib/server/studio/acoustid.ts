/**
 * AcoustID: identify a recording by its audio (Chromaprint fingerprint) instead of its tags.
 * Needs `fpcalc` and an *application* API key from https://acoustid.org/new-application —
 * the per-user key on acoustid.org/api-key is only for submitting fingerprints.
 */
import { eq } from 'drizzle-orm';
import { bin, checkBinaries } from '../binaries';
import { db, schema } from '../db';
import { runOk } from '../proc';
import { getSettings } from '../settings';
import { lookupRecordings, toCandidate, type MbCandidate } from './musicbrainz';

export async function fingerprint(
	file: string
): Promise<{ fingerprint: string; duration: number }> {
	const res = await runOk(bin('fpcalc'), ['-json', '-length', '120', file], { timeoutMs: 60_000 });
	const data = JSON.parse(res.stdout) as { fingerprint: string; duration: number };
	return { fingerprint: data.fingerprint, duration: Math.round(data.duration) };
}

/** True when fingerprint lookups can run (key configured and fpcalc installed). */
export async function acoustidReady(): Promise<boolean> {
	if (!getSettings().acoustid.apiKey) return false;
	const fpcalc = (await checkBinaries()).find((b) => b.name === 'fpcalc');
	return !!fpcalc && !fpcalc.error;
}

/** Fingerprint for a library file, cached on its row. */
async function fingerprintFor(id: string) {
	const row = db
		.select({
			path: schema.libraryFiles.path,
			fingerprint: schema.libraryFiles.fingerprint,
			fingerprintDuration: schema.libraryFiles.fingerprintDuration
		})
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, id))
		.get();
	if (!row) throw new Error('File not found');
	if (row.fingerprint && row.fingerprintDuration)
		return { fingerprint: row.fingerprint, duration: row.fingerprintDuration };
	const fp = await fingerprint(row.path);
	db.update(schema.libraryFiles)
		.set({ fingerprint: fp.fingerprint, fingerprintDuration: fp.duration })
		.where(eq(schema.libraryFiles.id, id))
		.run();
	return fp;
}

interface LookupResult {
	acoustidId: string | null;
	/** MusicBrainz recording id → match score (0..1), strongest first */
	recordings: { id: string; score: number; sources: number }[];
}

async function lookup(fp: { fingerprint: string; duration: number }): Promise<LookupResult> {
	const key = getSettings().acoustid.apiKey;
	if (!key) throw new Error('Add an AcoustID application API key in Settings › Integrations first');
	const res = await fetch('https://api.acoustid.org/v2/lookup', {
		method: 'POST',
		// `sources` = how many submissions back a recording; the canonical one has the most
		body: new URLSearchParams({
			client: key,
			duration: String(fp.duration),
			fingerprint: fp.fingerprint,
			meta: 'recordingids sources'
		}),
		signal: AbortSignal.timeout(20_000)
	});
	const data = (await res.json()) as {
		status: string;
		error?: { message: string };
		results?: { id: string; score: number; recordings?: { id: string; sources?: number }[] }[];
	};
	if (data.status !== 'ok') {
		const msg = data.error?.message ?? 'lookup failed';
		if (/invalid api key/i.test(msg)) {
			throw new Error(
				'AcoustID rejected the API key. Lookups need an application key from acoustid.org/new-application — the key on your acoustid.org account page is a user key for submissions only.'
			);
		}
		throw new Error(`AcoustID: ${msg}`);
	}
	const byId = new Map<string, { id: string; score: number; sources: number }>();
	for (const r of data.results ?? [])
		for (const rec of r.recordings ?? []) {
			const prev = byId.get(rec.id);
			if (!prev || r.score > prev.score)
				byId.set(rec.id, { id: rec.id, score: r.score, sources: rec.sources ?? 0 });
		}
	const recordings = [...byId.values()].sort((a, b) => b.score - a.score || b.sources - a.sources);
	return { acoustidId: data.results?.[0]?.id ?? null, recordings };
}

/**
 * Identify audio → MusicBrainz candidates (with releases). Only the strongest few recordings
 * are looked up, since MusicBrainz allows ~1 request/second.
 */
async function toCandidates(result: LookupResult, max: number): Promise<MbCandidate[]> {
	const top = result.recordings.filter((r) => r.score >= 0.5).slice(0, max);
	if (!top.length) return [];
	const scores = new Map(top.map((r) => [r.id, r.score]));
	const raws = await lookupRecordings(top.map((r) => r.id));
	return raws.map((r) => toCandidate(r as never, 'acoustid', scores.get(r.id)));
}

export async function identifyFile(path: string, max = 3): Promise<MbCandidate[]> {
	return toCandidates(await lookup(await fingerprint(path)), max);
}

/** Library file by id (fingerprint cached, AcoustID id stored). */
export async function identify(id: string): Promise<MbCandidate[]> {
	const result = await lookup(await fingerprintFor(id));
	if (result.acoustidId)
		db.update(schema.libraryFiles)
			.set({ acoustidId: result.acoustidId })
			.where(eq(schema.libraryFiles.id, id))
			.run();
	return toCandidates(result, 5);
}
