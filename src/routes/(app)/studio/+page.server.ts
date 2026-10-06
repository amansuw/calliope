import { getSettings } from '$lib/server/settings';
import { soulseek } from '$lib/server/soulseek';

export const load = () => {
	const s = getSettings();
	const slsk = soulseek.status();
	return {
		template: s.pipeline.pathTemplate,
		acoustid: !!s.acoustid.apiKey,
		soulseekReady: slsk.enabled && slsk.configured
	};
};
