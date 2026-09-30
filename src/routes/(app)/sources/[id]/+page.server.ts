import { error } from '@sveltejs/kit';
import { getSource, sourceItems, toSourceDTO } from '$lib/server/sync/sources';

export const load = ({ params }) => {
	const source = getSource(params.id);
	if (!source) error(404, 'Source not found');
	return { source: toSourceDTO(source), items: sourceItems(params.id) };
};
