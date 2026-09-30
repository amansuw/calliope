import { describe, expect, it } from 'vitest';
import { computeAnalysis } from './analysis';

describe('computeAnalysis', () => {
	it('derives peaks and loudness', () => {
		const samples = new Int16Array(16000);
		for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i / 10) * 16384); // -6 dBFS sine
		const { peaks, loudness } = computeAnalysis(samples);
		expect(peaks).toHaveLength(800);
		expect(Math.max(...peaks)).toBeGreaterThan(120);
		expect(loudness).toBeCloseTo(-9, 0); // sine RMS = peak - 3 dB
	});

	it('handles silence', () => {
		expect(computeAnalysis(new Int16Array(100)).loudness).toBe(-70);
	});
});
