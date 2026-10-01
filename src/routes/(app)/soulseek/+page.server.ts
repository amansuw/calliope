import { soulseek } from '$lib/server/soulseek';

export const load = ({ url }) => ({
	status: soulseek.status(),
	q: url.searchParams.get('q') ?? ''
});
