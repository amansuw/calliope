/**
 * Folder/file template engine.
 *
 *   {artist}             field value
 *   {albumartist|artist} first non-empty of several fields, or a literal fallback: {album|Singles}
 *   {track:02}           zero-padded number
 *   [{track:02} - ]      optional section, dropped entirely if any field inside is empty
 *
 * `/` separates folders; each segment is sanitized for the filesystem.
 */
export interface TemplateFields {
	title?: string | null;
	artist?: string | null;
	albumartist?: string | null;
	album?: string | null;
	year?: number | string | null;
	track?: number | null;
	disc?: number | null;
	genre?: string | null;
	ext?: string | null;
	[key: string]: string | number | null | undefined;
}

const FIELD = /\{([a-z|: A-Za-z0-9_-]+)\}/g;

function resolveField(expr: string, fields: TemplateFields): string {
	const [names, pad] = expr.split(':');
	for (const name of names.split('|')) {
		const key = name.trim();
		const value = key.toLowerCase() in fields ? fields[key.toLowerCase()] : undefined;
		if (value !== undefined) {
			if (value === null || value === '' || value === 0) continue;
			const str = String(value);
			return pad && /^\d+$/.test(str) ? str.padStart(pad.length, '0') : str;
		}
		// Unknown name → literal fallback text (e.g. "Singles")
		if (!/^[a-z]+$/.test(key)) return key;
		if (
			![
				'title',
				'artist',
				'albumartist',
				'album',
				'year',
				'track',
				'disc',
				'genre',
				'ext'
			].includes(key)
		)
			return key;
	}
	return '';
}

export function sanitizeSegment(s: string): string {
	return (
		s
			.replace(/[\u0000-\u001f]/g, '')
			.replace(/[<>:"/\\|?*]/g, '_')
			.replace(/\s+/g, ' ')
			.replace(/^[.\s]+|[.\s]+$/g, '')
			.slice(0, 180) || '_'
	);
}

export function renderTemplate(template: string, fields: TemplateFields): string {
	// Optional sections first
	const withOptionals = template.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
		let empty = false;
		const out = inner.replace(FIELD, (_m, expr: string) => {
			const v = resolveField(expr, fields);
			if (!v) empty = true;
			return v;
		});
		return empty ? '' : out;
	});
	return withOptionals
		.split('/')
		.map((segment) =>
			segment.replace(FIELD, (_m, expr: string) =>
				resolveField(expr, fields).replace(/[/\\]/g, '_')
			)
		)
		.map((s) => s.trim())
		.filter(Boolean)
		.map(sanitizeSegment)
		.join('/');
}
