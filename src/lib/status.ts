export const TRACK_STATUSES = [
	'queued',
	'resolving',
	'matching',
	'downloading',
	'processing',
	'tagging',
	'moving',
	'done',
	'failed',
	'skipped',
	'cancelled'
] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const ACTIVE_STATUSES: readonly TrackStatus[] = [
	'resolving',
	'matching',
	'downloading',
	'processing',
	'tagging',
	'moving'
];
export const FINISHED_STATUSES: readonly TrackStatus[] = ['done', 'failed', 'skipped', 'cancelled'];

export const STAGE_LABELS: Record<TrackStatus, string> = {
	queued: 'Queued',
	resolving: 'Resolving',
	matching: 'Matching',
	downloading: 'Downloading',
	processing: 'Converting',
	tagging: 'Tagging',
	moving: 'Filing',
	done: 'Done',
	failed: 'Failed',
	skipped: 'Skipped',
	cancelled: 'Cancelled'
};
