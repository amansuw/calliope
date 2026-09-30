import { asc, desc, inArray } from 'drizzle-orm';
import { ACTIVE_STATUSES, FINISHED_STATUSES } from '$lib/status';
import { db, schema } from '$lib/server/db';
import { pipeline } from '$lib/server/pipeline/queue';
import { toTrackDTO } from '$lib/server/pipeline/tracks';
import { getSettings } from '$lib/server/settings';

export const load = () => {
	const open = db
		.select()
		.from(schema.tracks)
		.where(inArray(schema.tracks.status, ['queued', ...ACTIVE_STATUSES]))
		.orderBy(desc(schema.tracks.priority), asc(schema.tracks.position))
		.limit(500)
		.all();
	const finished = db
		.select()
		.from(schema.tracks)
		.where(inArray(schema.tracks.status, [...FINISHED_STATUSES]))
		.orderBy(desc(schema.tracks.finishedAt))
		.limit(150)
		.all();
	return {
		tracks: [...open, ...finished].map(toTrackDTO),
		telemetry: pipeline.telemetry(),
		lowConfidence: getSettings().pipeline.lowConfidenceScore
	};
};
