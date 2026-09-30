/** Output format presets shared by the server pipeline and the settings UI. */
export const FORMAT_PRESETS = {
	'mp3-320': {
		label: 'MP3 320',
		detail: 'CBR 320 kbps',
		ext: 'mp3',
		ytdlp: ['mp3', '320K'],
		lossy: true
	},
	'mp3-v0': {
		label: 'MP3 V0',
		detail: 'VBR ~245 kbps',
		ext: 'mp3',
		ytdlp: ['mp3', '0'],
		lossy: true
	},
	'aac-256': {
		label: 'AAC 256',
		detail: 'M4A container',
		ext: 'm4a',
		ytdlp: ['m4a', '256K'],
		lossy: true
	},
	opus: {
		label: 'Opus',
		detail: 'Native stream, no re-encode',
		ext: 'opus',
		ytdlp: ['opus', '0'],
		lossy: true
	},
	flac: {
		label: 'FLAC',
		detail: 'Lossless container of a lossy source',
		ext: 'flac',
		ytdlp: ['flac', '0'],
		lossy: false
	}
} as const;

export type FormatPresetId = keyof typeof FORMAT_PRESETS;
export const FORMAT_PRESET_IDS = Object.keys(FORMAT_PRESETS) as [
	FormatPresetId,
	...FormatPresetId[]
];

export const POLL_INTERVALS = [
	{ minutes: 0, label: 'Manual' },
	{ minutes: 15, label: '15 min' },
	{ minutes: 60, label: 'Hourly' },
	{ minutes: 360, label: '6 hours' },
	{ minutes: 720, label: '12 hours' },
	{ minutes: 1440, label: 'Daily' }
] as const;
