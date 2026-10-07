import { navidromeConfigured } from '$lib/server/integrations/navidrome';
import { listSources } from '$lib/server/sync/sources';
import { libraryStatus } from '$lib/server/library/scanner';

export const load = () => ({
	sources: listSources(),
	library: libraryStatus(),
	navidrome: navidromeConfigured()
});
