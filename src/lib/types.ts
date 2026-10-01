// DTOs shared between server and browser. Timestamps are epoch milliseconds.
import type { TrackStatus } from '$lib/status';
export type { TrackStatus };

export interface TrackDTO {
	id: string;
	status: TrackStatus;
	priority: number;
	position: number;
	provider: 'spotify' | 'youtube' | 'soulseek';
	sourceId: string | null;
	requestedUrl: string | null;
	spotifyId: string | null;
	youtubeId: string | null;
	title: string | null;
	artist: string | null;
	album: string | null;
	durationMs: number | null;
	artworkUrl: string | null;
	matchUrl: string | null;
	matchTitle: string | null;
	matchScore: number | null;
	formatPreset: string;
	hasLyrics: boolean;
	hasSyncedLyrics: boolean;
	hasArtwork: boolean;
	filePath: string | null;
	fileSize: number | null;
	bitrate: number | null;
	attempts: number;
	error: string | null;
	skipReason: string | null;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
}

export interface SoulseekStatus {
	enabled: boolean;
	/** Username and password are filled in */
	configured: boolean;
	state: 'offline' | 'connecting' | 'online';
	username: string;
	listenPort: number;
	error: string | null;
}

export interface SourceDTO {
	id: string;
	provider: 'spotify' | 'youtube';
	kind: 'playlist' | 'album' | 'channel';
	url: string;
	name: string;
	owner: string | null;
	artworkUrl: string | null;
	enabled: boolean;
	autoQueue: boolean;
	intervalMinutes: number;
	formatPreset: string | null;
	lastCheckedAt: number | null;
	nextCheckAt: number | null;
	lastError: string | null;
	itemCount: number;
	truncated: boolean;
	/** Items whose track finished (or exists in library) */
	haveCount: number;
	/** Items with no track record and not ignored */
	missingCount: number;
	syncing: boolean;
}

export interface SourceItemDTO {
	externalId: string;
	title: string;
	artist: string;
	album: string | null;
	durationMs: number | null;
	artworkUrl: string | null;
	position: number;
	present: boolean;
	ignored: boolean;
	firstSeenAt: number;
	/** Pipeline state for this item, or 'library' if found in the library index, or 'new' */
	state: TrackStatus | 'library' | 'new';
	trackId: string | null;
}

export interface WorkerTelemetry {
	trackId: string;
	stage: TrackStatus;
	percent: number;
	/** bytes/sec */
	speed: number | null;
	etaSec: number | null;
	downloaded: number | null;
	total: number | null;
}

export interface Telemetry {
	ts: number;
	paused: boolean;
	concurrency: number;
	/** Aggregate bytes/sec across workers */
	speed: number;
	workers: WorkerTelemetry[];
	counts: Record<'queued' | 'active' | 'done' | 'failed' | 'skipped', number>;
	doneToday: number;
}

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
	id: string;
	level: ToastLevel;
	title: string;
	message?: string;
	href?: string;
}

export interface BinaryStatus {
	name: 'ytdlp' | 'ffmpeg' | 'ffprobe' | 'fpcalc';
	label: string;
	path: string | null;
	version: string | null;
	required: boolean;
	error: string | null;
}

export interface LibraryStatus {
	scanning: boolean;
	phase: 'idle' | 'walking' | 'reading' | 'hashing' | 'analyzing' | 'tagging' | 'done';
	processed: number;
	total: number;
	current: string | null;
	lastScanAt: number | null;
	fileCount: number;
}

export interface ServerEvents {
	track: TrackDTO;
	'track:removed': { id: string };
	telemetry: Telemetry;
	log: { trackId: string; line: string; ts: number };
	source: SourceDTO;
	'source:removed': { id: string };
	toast: Toast;
	settings: unknown;
	library: LibraryStatus;
}
