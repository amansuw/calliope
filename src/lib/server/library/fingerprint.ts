/** Chromaprint raw-fingerprint comparison (bit error rate over the best alignment). */

export function encodeRaw(frames: number[]): string {
	const buf = Buffer.alloc(frames.length * 4);
	frames.forEach((f, i) => buf.writeUInt32LE(f >>> 0, i * 4));
	return buf.toString('base64');
}

export function decodeRaw(b64: string): Uint32Array {
	const buf = Buffer.from(b64, 'base64');
	return new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function popcount(x: number) {
	x -= (x >>> 1) & 0x55555555;
	x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
	return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Fraction of differing bits between a and b shifted by `offset`, over at most `span` frames. */
function ber(a: Uint32Array, b: Uint32Array, offset: number, span: number): number {
	let bits = 0;
	let n = 0;
	const start = Math.max(0, -offset);
	const end = Math.min(a.length, b.length - offset, start + span);
	for (let i = start; i < end; i++) {
		bits += popcount(a[i] ^ b[i + offset]);
		n++;
	}
	return n < 16 ? 1 : bits / (n * 32);
}

/**
 * Similarity in 0..1 (1 = identical audio). Different songs land around 0.5; the same recording
 * in another bitrate/codec typically scores above 0.85. A cheap probe at few offsets rejects
 * most non-matches before the full comparison.
 */
export function similarity(a: Uint32Array, b: Uint32Array): number {
	let best = 1;
	for (let off = -4; off <= 4; off++) best = Math.min(best, ber(a, b, off, 48));
	if (best > 0.35) return 1 - best;
	best = 1;
	for (let off = -12; off <= 12; off++) best = Math.min(best, ber(a, b, off, 1000));
	return 1 - best;
}
