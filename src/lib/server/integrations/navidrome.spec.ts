import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings', () => ({ getSettings: () => ({ navidrome: {} }) }));
vi.mock('../events', () => ({ bus: { toast: () => {} } }));

const { scanOutcome } = await import('./navidrome');

describe('reading the outcome of a Navidrome scan', () => {
	const before = { scanning: false, count: 279, lastScan: '2026-10-06T02:17:04Z' };

	it('is a success when Navidrome recorded a newer completed scan', () => {
		expect(
			scanOutcome(before, { scanning: false, count: 277, lastScan: '2026-10-07T09:00:00Z' })
		).toEqual({ ok: true, message: '277 tracks in its library.' });
	});

	it('is a failure when the scan ended without being recorded', () => {
		// what Navidrome reports after a scan that died half way: "ok", idle, same last scan
		expect(scanOutcome(before, { ...before }).ok).toBe(false);
		expect(scanOutcome({ scanning: false }, { scanning: false }).ok).toBe(false);
	});

	it('passes on the error newer Navidrome versions report', () => {
		expect(
			scanOutcome(before, {
				scanning: false,
				lastScan: '2026-10-07T09:00:00Z',
				error: 'FOREIGN KEY constraint failed'
			})
		).toEqual({ ok: false, message: 'FOREIGN KEY constraint failed' });
	});

	it('says so when the scan outlasted the wait', () => {
		expect(scanOutcome(before, { ...before, scanning: true }).ok).toBe(false);
	});
});
