import { eq } from 'drizzle-orm';
import { bin } from '../binaries';
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

/** Fingerprint (cached on the row) for a library file. */
export async function fingerprintFor(id: string) {
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

/** Identify a file by its audio: AcoustID → MusicBrainz recordings. */
export async function identify(id: string): Promise<MbCandidate[]> {
	const key = getSettings().acoustid.apiKey;
	if (!key) throw new Error('Add an AcoustID API key in Settings › Integrations first');
	const fp = await fingerprintFor(id);
	const body = new URLSearchParams({
		client: key,
		duration: String(fp.duration),
		fingerprint: fp.fingerprint,
		meta: 'recordingids'
	});
	const res = await fetch('https://api.acoustid.org/v2/lookup', {
		method: 'POST',
		body,
		signal: AbortSignal.timeout(20_000)
	});
	const data = (await res.json()) as {
		status: string;
		error?: { message: string };
		results?: { id: string; score: number; recordings?: { id: string }[] }[];
	};
	if (data.status !== 'ok') throw new Error(`AcoustID: ${data.error?.message ?? 'lookup failed'}`);
	const scores = new Map<string, number>();
	for (const r of data.results ?? [])
		for (const rec of r.recordings ?? []) if (!scores.has(rec.id)) scores.set(rec.id, r.score);
	if (!scores.size) return [];
	const acoustidId = data.results?.[0]?.id;
	if (acoustidId)
		db.update(schema.libraryFiles).set({ acoustidId }).where(eq(schema.libraryFiles.id, id)).run();
	const raws = await lookupRecordings([...scores.keys()]);
	return raws.map((r) => toCandidate(r as never, 'acoustid', scores.get(r.id)));
}
