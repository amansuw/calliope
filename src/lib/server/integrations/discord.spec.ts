import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings', () => ({ getSettings: () => ({ discord: {} }) }));

const { completedEmbeds, failureEmbed } = await import('./discord');

const track = (o: Record<string, unknown> = {}) => ({
	artist: 'Disturbed',
	title: 'Decadence',
	album: 'Ten Thousand Fists',
	requestedUrl: null,
	filePath: '/music/Disturbed/Ten Thousand Fists/09 - Decadence.flac',
	fileSize: 30 * 1024 * 1024,
	bitrate: 1000,
	matchUrl: 'soulseek:peer/x.flac#1',
	artworkUrl: 'https://example.com/cover.jpg',
	error: null,
	...o
});

describe('discord messages', () => {
	it('sends a card per downloaded track with what ended up on disk', () => {
		const [card, mp3] = completedEmbeds([
			track(),
			track({ filePath: '/music/a.mp3', bitrate: 320, matchUrl: 'https://youtu.be/x', album: null })
		]);
		expect(card.title).toBe('✅ Track Downloaded');
		expect(card.description).toBe('**Disturbed** — Decadence');
		expect(card.fields?.map((f) => `${f.name}: ${f.value}`)).toEqual([
			'Album: Ten Thousand Fists',
			'Format: FLAC',
			'Size: 30.0 MB',
			'Source: Soulseek'
		]);
		expect(card.thumbnail?.url).toBe('https://example.com/cover.jpg');
		expect(mp3.fields?.map((f) => f.value)).toEqual(['MP3 · 320 kbps', '30.0 MB', 'YouTube']);
	});

	it('lists a large batch in one card', () => {
		const cards = completedEmbeds(Array.from({ length: 40 }, () => track()));
		expect(cards).toHaveLength(1);
		expect(cards[0].title).toBe('✅ 40 tracks downloaded');
		expect(cards[0].description).toContain('…and 15 more');
		expect(cards[0].fields?.[0].value).toBe('1200.0 MB');
	});

	it('names a failed track by its link when it was never looked up', () => {
		const card = failureEmbed(
			track({ title: null, artist: null, requestedUrl: 'https://youtu.be/x', error: 'no match' })
		);
		expect(card.description).toBe('https://youtu.be/x');
		expect(card.fields?.[0]).toMatchObject({ name: 'Error', value: 'no match', inline: false });
	});
});
