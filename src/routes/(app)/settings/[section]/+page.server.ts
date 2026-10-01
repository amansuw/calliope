import { error } from '@sveltejs/kit';
import { isNotNull } from 'drizzle-orm';
import { checkBinaries } from '$lib/server/binaries';
import { db, schema } from '$lib/server/db';
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
		// Sources with their own format ignore the default chosen here: say so next to it
		formatOverrides:
			params.section === 'pipeline'
				? db
						.select({
							id: schema.sources.id,
							name: schema.sources.name,
							formatPreset: schema.sources.formatPreset
						})
						.from(schema.sources)
						.where(isNotNull(schema.sources.formatPreset))
						.all()
				: [],
		legacyDb: env.legacyDb ?? null,
		dataDir: env.dataDir
	};
};
