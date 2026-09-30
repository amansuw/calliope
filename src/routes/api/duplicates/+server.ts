import { json } from '@sveltejs/kit';
import { checkBinaries } from '$lib/server/binaries';
import { handler } from '$lib/server/http';
import { findDuplicates, fingerprintStats } from '$lib/server/library/duplicates';

export const GET = handler(async ({ url }) => {
	const threshold = Number(url.searchParams.get('threshold') ?? '0.82');
	const fpcalc = (await checkBinaries()).find((b) => b.name === 'fpcalc');
	return json({
		groups: findDuplicates({ acousticThreshold: threshold }),
		fingerprints: fingerprintStats(),
		fpcalc: !fpcalc?.error
	});
});
