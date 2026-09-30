import { json } from '@sveltejs/kit';
import { FORMAT_PRESET_IDS, type FormatPresetId } from '$lib/formats';
import { handler } from '$lib/server/http';
import { buildDownloadFlags, extraArgs } from '$lib/server/pipeline/download';
import { renderTemplate } from '$lib/server/pipeline/template';
import { getSettings } from '$lib/server/settings';

/** Live previews for the settings page: the yt-dlp command line and a sample library path. */
export const GET = handler(({ url }) => {
	const s = getSettings();
	const preset = (url.searchParams.get('preset') ?? s.pipeline.formatPreset) as FormatPresetId;
	const template = url.searchParams.get('template') ?? s.pipeline.pathTemplate;
	const samples = [
		{
			title: 'One More Time',
			artist: 'Daft Punk',
			albumartist: 'Daft Punk',
			album: 'Discovery',
			track: 1,
			year: 2001
		},
		{ title: 'Uprising', artist: 'Muse', albumartist: null, album: null, track: null, year: 2009 }
	];
	return json({
		flags: FORMAT_PRESET_IDS.includes(preset) ? buildDownloadFlags(preset) : [],
		rejected: extraArgs().rejected,
		paths: samples.map((f) => `${s.paths.libraryDir}/${renderTemplate(template, f)}.mp3`)
	});
});
