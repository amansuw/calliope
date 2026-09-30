import { describe, expect, it } from 'vitest';
import { decodeRaw, encodeRaw, similarity } from './fingerprint';

function rand(seed: number, n: number) {
	const out: number[] = [];
	let x = seed;
	for (let i = 0; i < n; i++) {
		x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
		out.push(x);
	}
	return out;
}

describe('fingerprint similarity', () => {
	const a = rand(1, 400);

	it('round-trips encoding', () => {
		expect([...decodeRaw(encodeRaw(a))]).toEqual(a);
	});

	it('scores identical and shifted audio high', () => {
		const A = Uint32Array.from(a);
		expect(similarity(A, A)).toBe(1);
		expect(similarity(A, Uint32Array.from([...rand(9, 3), ...a]))).toBeGreaterThan(0.99);
	});

	it('scores lightly corrupted copies high and unrelated audio low', () => {
		const noisy = a.map((v, i) => (i % 5 === 0 ? v ^ 0b1011 : v));
		expect(similarity(Uint32Array.from(a), Uint32Array.from(noisy))).toBeGreaterThan(0.95);
		expect(similarity(Uint32Array.from(a), Uint32Array.from(rand(2, 400)))).toBeLessThan(0.65);
	});
});
