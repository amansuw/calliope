import { describe, expect, it } from 'vitest';
import { isCrossSite, isHttps } from './origin';

const req = (method: string, headers: Record<string, string>) =>
	new Request('https://ignored/login', { method, headers });

describe('isCrossSite', () => {
	it('allows posts whose origin matches the host, at any address', () => {
		expect(
			isCrossSite(req('POST', { origin: 'http://192.168.1.200:7200', host: '192.168.1.200:7200' }))
		).toBe(false);
		expect(
			isCrossSite(req('POST', { origin: 'https://music.example.com', host: 'music.example.com' }))
		).toBe(false);
		expect(
			isCrossSite(
				req('POST', {
					origin: 'https://music.example.com',
					host: 'calliope:7200',
					'x-forwarded-host': 'music.example.com'
				})
			)
		).toBe(false);
	});

	it('rejects posts from another site', () => {
		expect(
			isCrossSite(req('POST', { origin: 'https://evil.example', host: 'music.example.com' }))
		).toBe(true);
		expect(isCrossSite(req('DELETE', { origin: 'null', host: 'music.example.com' }))).toBe(true);
	});

	it('rejects origin-less form posts but allows origin-less API calls and reads', () => {
		expect(
			isCrossSite(req('POST', { host: 'a', 'content-type': 'application/x-www-form-urlencoded' }))
		).toBe(true);
		expect(isCrossSite(req('POST', { host: 'a', 'content-type': 'application/json' }))).toBe(false);
		expect(isCrossSite(req('GET', { origin: 'https://evil.example', host: 'a' }))).toBe(false);
	});
});

describe('isHttps', () => {
	it('follows x-forwarded-proto and defaults to http', () => {
		const url = new URL('https://a/login');
		expect(isHttps({ request: req('POST', { 'x-forwarded-proto': 'https' }), url })).toBe(true);
		expect(isHttps({ request: req('POST', { 'x-forwarded-proto': 'http' }), url })).toBe(false);
		expect(isHttps({ request: req('POST', {}), url })).toBe(false);
	});
});
