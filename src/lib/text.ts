// Text normalization shared by matching, dedup grouping and the tag studio.

const NOISE =
	/[([](?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video|hd\s*video)?|music\s*video|lyrics?(?:\s*video)?|audio|visuali[sz]er|hd|hq|4k|explicit|clean|m\/v|mv)[)\]]/gi;

/** Strip YouTube upload decorations: "(Official Video)", "[HD]", "| Topic" etc. */
export function cleanTitle(title: string): string {
	return title
		.replace(NOISE, '')
		.replace(/\s*[|｜]\s*.*$/, '')
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([)\]])/g, '$1')
		.trim();
}

/** Guess artist/title from a YouTube video title + channel. */
export function splitArtistTitle(
	rawTitle: string,
	channel?: string | null
): { artist: string; title: string } {
	const title = cleanTitle(rawTitle);
	const topic = channel?.match(/^(.*) - Topic$/);
	if (topic) return { artist: topic[1], title };
	const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
	if (m) return { artist: m[1].trim(), title: m[2].trim().replace(/^["“](.*)["”]$/, '$1') };
	return { artist: (channel ?? '').replace(/VEVO$/i, '').trim() || 'Unknown Artist', title };
}

/** Lowercase, strip accents/punctuation/feat. credits for comparison. */
export function normalize(s: string | null | undefined): string {
	return (s ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\((?:feat|ft|with)\.?[^)]*\)|\[(?:feat|ft|with)\.?[^\]]*\]/g, '')
		.replace(/\s\b(?:feat|ft)\b\.?\s.*$/, '')
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

export function tokens(s: string | null | undefined): Set<string> {
	return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Dice coefficient over word tokens: 1 = same words. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
	const ta = tokens(a);
	const tb = tokens(b);
	if (!ta.size || !tb.size) return 0;
	let shared = 0;
	for (const t of ta) if (tb.has(t)) shared++;
	return (2 * shared) / (ta.size + tb.size);
}

/** Primary artist only: "A, B & C" → "a" */
export function primaryArtist(s: string | null | undefined): string {
	return normalize((s ?? '').split(/\s*(?:,|;|\/|&|\sx\s|\sand\s|\b(?:feat|ft)\b\.?)\s*/i)[0]);
}

/** Key used to group likely duplicates: primary artist + title without version noise. */
export function matchKey(
	artist: string | null | undefined,
	title: string | null | undefined
): string | null {
	const a = primaryArtist(artist);
	const t = normalize(cleanTitle(title ?? ''))
		.replace(
			/\b(?:remaster(?:ed)?|\d{4} remaster(?:ed)?|mono|stereo|radio edit|single version|album version)\b/g,
			''
		)
		.replace(/\s+/g, ' ')
		.trim();
	return a && t ? `${a}|${t}` : null;
}
