import { describe, expect, it } from 'vitest';
import { decodeRaw, encodeRaw, similarity, toPrint } from './fingerprint';

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

	const print = (frames: number[]) => toPrint(Uint32Array.from(frames));

	it('scores identical and shifted audio high', () => {
		const A = print(a);
		expect(similarity(A, A)).toBe(1);
		expect(similarity(A, print([...rand(9, 3), ...a]))).toBeGreaterThan(0.99);
	});

	it('lines up copies that start many seconds apart, in either order', () => {
		const intro = print([...rand(9, 120), ...a]);
		expect(similarity(print(a), intro)).toBeGreaterThan(0.99);
		expect(similarity(intro, print(a))).toBeGreaterThan(0.99);
	});

	it('scores lightly corrupted copies high and unrelated audio low', () => {
		const noisy = a.map((v, i) => (i % 5 === 0 ? v ^ 0b1011 : v));
		expect(similarity(print(a), print(noisy))).toBeGreaterThan(0.95);
		expect(similarity(print(a), print([...rand(9, 120), ...noisy]))).toBeGreaterThan(0.95);
		expect(similarity(print(a), print(rand(2, 400)))).toBeLessThan(0.65);
	});

	it('does not match on silence alone', () => {
		const silence = new Array(300).fill(0);
		const one = print([...silence, ...rand(3, 400)]);
		const other = print([...silence, ...rand(4, 400)]);
		expect(similarity(one, other)).toBeLessThan(0.82);
	});
});
