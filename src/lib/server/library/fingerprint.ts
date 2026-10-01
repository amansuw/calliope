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

/** A fingerprint ready to compare: its frames, plus keys sorted for finding how two copies line up. */
export interface Print {
	frames: Uint32Array;
	keys: Uint32Array;
}

/**
 * How far apart two copies of a recording may start, in frames (about 25 s; a frame is ~0.124 s).
 * A video upload often opens with an intro the album cut lacks.
 */
const MAX_SHIFT = 200;
/** A value repeated this often (silence, a held note) says nothing about alignment. */
const MAX_RUN = 64;
const votes = new Uint16Array(2 * MAX_SHIFT + 1);

/** The most stable bits of each frame with its position, sorted so two prints can be merge-joined. */
export function toPrint(frames: Uint32Array): Print {
	const keys = new Uint32Array(Math.min(frames.length, 0x10000));
	for (let i = 0; i < keys.length; i++) keys[i] = (((frames[i] >>> 18) << 16) | i) >>> 0;
	return { frames, keys: keys.sort() };
}

/** Fraction of differing bits between a and b shifted by `offset` (a[i] against b[i + offset]). */
function ber(a: Uint32Array, b: Uint32Array, offset: number): number {
	let bits = 0;
	let n = 0;
	const start = Math.max(0, -offset);
	const end = Math.min(a.length, b.length - offset);
	for (let i = start; i < end; i++) {
		bits += popcount(a[i] ^ b[i + offset]);
		n++;
	}
	// Too little overlap proves nothing
	return n < 16 || n < Math.min(a.length, b.length) / 2 ? 1 : bits / (n * 32);
}

/** The shift at which most frames of a and b agree, or null when none do. */
function alignment(a: Print, b: Print): number | null {
	votes.fill(0);
	const ka = a.keys;
	const kb = b.keys;
	let i = 0;
	let j = 0;
	while (i < ka.length && j < kb.length) {
		const x = ka[i] >>> 16;
		const y = kb[j] >>> 16;
		if (x < y) i++;
		else if (x > y) j++;
		else {
			let ie = i;
			let je = j;
			while (ie < ka.length && ka[ie] >>> 16 === x) ie++;
			while (je < kb.length && kb[je] >>> 16 === x) je++;
			if ((ie - i) * (je - j) <= MAX_RUN)
				for (let p = i; p < ie; p++)
					for (let q = j; q < je; q++) {
						const off = (kb[q] & 0xffff) - (ka[p] & 0xffff);
						if (off >= -MAX_SHIFT && off <= MAX_SHIFT) votes[off + MAX_SHIFT]++;
					}
			i = ie;
			j = je;
		}
	}
	let best = 0;
	let at: number | null = null;
	for (let k = 0; k < votes.length; k++) {
		if (votes[k] > best) {
			best = votes[k];
			at = k - MAX_SHIFT;
		}
	}
	return at;
}

/**
 * Similarity in 0..1 (1 = identical audio). Different songs land around 0.5; the same recording
 * in another bitrate/codec typically scores above 0.85. The copies need not start together: the
 * shift between them is found first, from the frames they have in common.
 */
export function similarity(a: Print, b: Print): number {
	const at = alignment(a, b) ?? 0;
	let best = ber(a.frames, b.frames, at);
	// Not even close: the neighbouring shifts won't change that
	if (best > 0.4) return 1 - best;
	// A true alignment can straddle two shifts
	for (const off of [at - 1, at + 1]) best = Math.min(best, ber(a.frames, b.frames, off));
	return 1 - best;
}
