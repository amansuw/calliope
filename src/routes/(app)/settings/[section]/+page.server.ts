import { error } from '@sveltejs/kit';
import { checkBinaries } from '$lib/server/binaries';
import { env } from '$lib/server/env';
import { checkDir } from '$lib/server/paths';
import { publicSettings } from '$lib/server/settings';

const SECTIONS = ['library', 'pipeline', 'downloader', 'binaries', 'integrations', 'account'];

export const load = async ({ params }) => {
	if (!SECTIONS.includes(params.section)) error(404, 'Unknown settings section');
	const settings = publicSettings();
	return {
		section: params.section,
		settings,
		binaries:
			params.section === 'binaries' || params.section === 'downloader' ? await checkBinaries() : [],
		pathChecks:
			params.section === 'library'
				? {
						libraryDir: checkDir(settings.paths.libraryDir),
						stagingDir: checkDir(settings.paths.stagingDir),
						quarantineDir: checkDir(settings.paths.quarantineDir)
					}
				: null,
		legacyDb: env.legacyDb ?? null,
		dataDir: env.dataDir
	};
};
