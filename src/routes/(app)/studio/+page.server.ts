import { getSettings } from '$lib/server/settings';

export const load = () => {
	const s = getSettings();
	return { template: s.pipeline.pathTemplate, acoustid: !!s.acoustid.apiKey };
};
