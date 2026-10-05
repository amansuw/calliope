import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ACTIVE_STATUSES, FINISHED_STATUSES, type TrackStatus } from '$lib/status';
import type { Telemetry, WorkerTelemetry } from '$lib/types';
import { db, schema } from '../db';
import type { NewTrack, Track } from '../db/schema';
import { bus } from '../events';
import { failureEmbed, notifyDiscord, queueCompletionNotice } from '../integrations/discord';
import { scheduleNavidromeScan } from '../integrations/navidrome';
import { getInternal, getSettings, setInternal } from '../settings';
import type { DownloadProgress } from './download';
import { getTrack, patchTrack, toTrackDTO } from './tracks';
import { PermanentError, processTrack, SkipError } from './worker';

const LOG_LINES = 400;

interface ActiveJob {
	track: Track;
	controller: AbortController;
	telemetry: WorkerTelemetry;
	log: string[];
}

class Pipeline {
	private active = new Map<string, ActiveJob>();
	/** Logs of recently finished jobs, so an expanded row doesn't go blank the moment it finishes */
	private recentLogs = new Map<string, string[]>();
	private telemetryTimer: NodeJS.Timeout | null = null;
	private retryTimer: NodeJS.Timeout | null = null;
	private started = false;
	paused = false;

	start() {
		if (this.started) return;
		this.started = true;
		this.paused = getInternal<boolean>('paused') ?? false;
		// Anything that was mid-flight when the process died goes back to the front of the queue.
		db.update(schema.tracks)
			.set({ status: 'queued', startedAt: null })
			.where(inArray(schema.tracks.status, [...ACTIVE_STATUSES]))
			.run();
		this.telemetryTimer = setInterval(() => this.emitTelemetry(), 1000);
		this.telemetryTimer.unref();
		this.tick();
	}

	setPaused(paused: boolean) {
		this.paused = paused;
		setInternal('paused', paused);
		this.emitTelemetry(true);
		if (!paused) this.tick();
	}

	/** Fill free worker slots from the queue. */
	tick() {
		if (!this.started || this.paused) return;
		const slots = getSettings().pipeline.concurrency - this.active.size;
		for (let i = 0; i < slots; i++) {
			const next = this.claimNext();
			if (!next) break;
			this.run(next);
		}
		this.scheduleRetryWake();
	}

	private claimNext(): Track | undefined {
		const now = new Date();
		const candidate = db
			.select({ id: schema.tracks.id })
			.from(schema.tracks)
			.where(
				and(
					eq(schema.tracks.status, 'queued'),
					or(isNull(schema.tracks.retryAt), lte(schema.tracks.retryAt, now))
				)
			)
			.orderBy(desc(schema.tracks.priority), asc(schema.tracks.position))
			.limit(1)
			.get();
		if (!candidate) return undefined;
		return db
			.update(schema.tracks)
			.set({
				status: 'resolving',
				startedAt: now,
				attempts: sql`${schema.tracks.attempts} + 1`,
				error: null,
				retryAt: null
			})
			.where(and(eq(schema.tracks.id, candidate.id), eq(schema.tracks.status, 'queued')))
			.returning()
			.get();
	}

	/** Wake up when the earliest backed-off retry becomes due. */
	private scheduleRetryWake() {
		if (this.retryTimer) clearTimeout(this.retryTimer);
		const next = db
			.select({ at: schema.tracks.retryAt })
			.from(schema.tracks)
			.where(and(eq(schema.tracks.status, 'queued'), sql`${schema.tracks.retryAt} is not null`))
			.orderBy(asc(schema.tracks.retryAt))
			.limit(1)
			.get();
		if (!next?.at) return;
		this.retryTimer = setTimeout(() => this.tick(), Math.max(1000, next.at.getTime() - Date.now()));
		this.retryTimer.unref();
	}

	private run(track: Track) {
		const job: ActiveJob = {
			track,
			controller: new AbortController(),
			telemetry: {
				trackId: track.id,
				stage: 'resolving',
				percent: 0,
				speed: null,
				etaSec: null,
				downloaded: null,
				total: null
			},
			log: []
		};
		this.active.set(track.id, job);
		bus.emit('track', toTrackDTO(track));

		const log = (line: string) => {
			job.log.push(line);
			if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
			bus.emit('log', { trackId: track.id, line, ts: Date.now() });
		};
		const ctx = {
			signal: job.controller.signal,
			log,
			stage: (status: TrackStatus) => {
				if (job.telemetry.stage === status) return;
				job.telemetry = {
					...job.telemetry,
					stage: status,
					percent: status === 'downloading' ? 0 : job.telemetry.percent
				};
				if (status !== 'downloading') job.telemetry.speed = null;
				patchTrack(track.id, { status });
			},
			progress: (p: DownloadProgress) => {
				job.telemetry = {
					...job.telemetry,
					percent: p.percent,
					speed: p.speed,
					etaSec: p.eta,
					downloaded: p.downloaded,
					total: p.total
				};
			}
		};

		processTrack(track, ctx)
			.then(() => this.finish(job, 'done'))
			.catch((err: unknown) => {
				if (job.controller.signal.aborted) return this.finish(job, 'cancelled');
				if (err instanceof SkipError) {
					log(`Skipped: ${err.message}`);
					return this.finish(job, 'skipped', { skipReason: err.message });
				}
				const message = err instanceof Error ? err.message : String(err);
				log(`Error: ${message}`);
				const fresh = getTrack(track.id);
				const attempts = fresh?.attempts ?? track.attempts;
				const retryable =
					!(err instanceof PermanentError) && attempts < getSettings().pipeline.maxAttempts;
				if (retryable) {
					const delay = Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1));
					log(`Retrying in ${Math.round(delay / 1000)}s (attempt ${attempts + 1})`);
					return this.finish(job, 'queued', {
						error: message,
						retryAt: new Date(Date.now() + delay)
					});
				}
				return this.finish(job, 'failed', { error: message });
			})
			.catch((err) => console.error('[pipeline] finish failed', err))
			.finally(() => {
				this.active.delete(track.id);
				this.recentLogs.set(track.id, job.log);
				if (this.recentLogs.size > 50) this.recentLogs.delete(this.recentLogs.keys().next().value!);
				this.emitTelemetry(true);
				setImmediate(() => this.tick());
			});
	}

	private finish(job: ActiveJob, status: TrackStatus, extra: Partial<Track> = {}) {
		const done = FINISHED_STATUSES.includes(status);
		const row = patchTrack(job.track.id, {
			status,
			...extra,
			finishedAt: done ? new Date() : null,
			log: job.log.slice(-200).join('\n')
		});
		if (!row) return;
		if (status === 'done') {
			queueCompletionNotice(row);
			scheduleNavidromeScan();
		}
		if (status === 'failed') {
			bus.toast(
				'error',
				`Failed: ${row.title ?? row.requestedUrl ?? 'track'}`,
				row.error ?? undefined,
				'/pipeline'
			);
			notifyDiscord('errors', failureEmbed(row)).catch(() => {});
		}
	}

	// ---------------- queue mutations ----------------

	enqueue(
		rows: Omit<NewTrack, 'id' | 'position' | 'formatPreset'>[],
		opts: { formatPreset?: string | null; top?: boolean } = {}
	) {
		if (!rows.length) return [];
		const preset = opts.formatPreset || getSettings().pipeline.formatPreset;
		const base = opts.top ? this.minPosition() - rows.length - 1 : Date.now();
		const inserted = db.transaction((tx) =>
			rows.map((r, i) =>
				tx
					.insert(schema.tracks)
					.values({
						...r,
						id: crypto.randomUUID(),
						status: 'queued',
						position: base + i,
						formatPreset: preset
					})
					.returning()
					.get()
			)
		);
		for (const t of inserted) bus.emit('track', toTrackDTO(t));
		this.tick();
		return inserted;
	}

	private minPosition() {
		const row = db
			.select({ p: sql<number>`min(${schema.tracks.position})` })
			.from(schema.tracks)
			.where(eq(schema.tracks.status, 'queued'))
			.get();
		return row?.p ?? Date.now();
	}

	/** Move a queued item to sit before `beforeId` (or to the end when null). */
	reorder(id: string, beforeId: string | null) {
		const queued = db
			.select({ id: schema.tracks.id, position: schema.tracks.position })
			.from(schema.tracks)
			.where(and(eq(schema.tracks.status, 'queued'), sql`${schema.tracks.id} != ${id}`))
			.orderBy(desc(schema.tracks.priority), asc(schema.tracks.position))
			.all();
		let position: number;
		if (!beforeId) {
			position = (queued.at(-1)?.position ?? Date.now()) + 1;
		} else {
			const idx = queued.findIndex((q) => q.id === beforeId);
			if (idx === -1) return;
			const after = queued[idx].position;
			const before = idx > 0 ? queued[idx - 1].position : after - 2;
			position = (before + after) / 2;
		}
		// Priority bumps would override manual ordering, so reset it on manual moves.
		patchTrack(id, { position, priority: 0 });
	}

	bump(id: string) {
		patchTrack(id, { position: this.minPosition() - 1, priority: 0 });
	}

	setPriority(id: string, priority: number) {
		patchTrack(id, { priority });
	}

	cancel(id: string) {
		const job = this.active.get(id);
		if (job) {
			job.controller.abort();
			return;
		}
		const t = getTrack(id);
		if (t?.status === 'queued')
			patchTrack(id, { status: 'cancelled', finishedAt: new Date(), retryAt: null });
	}

	remove(id: string) {
		this.cancel(id);
		db.delete(schema.tracks).where(eq(schema.tracks.id, id)).run();
		bus.emit('track:removed', { id });
	}

	retry(id: string, force = true) {
		const t = getTrack(id);
		if (!t || this.active.has(id)) return;
		patchTrack(id, {
			status: 'queued',
			error: null,
			skipReason: null,
			attempts: 0,
			retryAt: null,
			finishedAt: null,
			force,
			position: Date.now()
		});
		this.tick();
	}

	retryAllFailed() {
		const failed = db
			.select({ id: schema.tracks.id })
			.from(schema.tracks)
			.where(eq(schema.tracks.status, 'failed'))
			.all();
		for (const f of failed) this.retry(f.id, false);
		return failed.length;
	}

	clearFinished(statuses: TrackStatus[]) {
		const rows = db
			.delete(schema.tracks)
			.where(
				inArray(
					schema.tracks.status,
					statuses.filter((s) => FINISHED_STATUSES.includes(s))
				)
			)
			.returning({ id: schema.tracks.id })
			.all();
		for (const r of rows) bus.emit('track:removed', { id: r.id });
		return rows.length;
	}

	cancelAllQueued() {
		const rows = db
			.update(schema.tracks)
			.set({ status: 'cancelled', finishedAt: new Date() })
			.where(eq(schema.tracks.status, 'queued'))
			.returning()
			.all();
		for (const r of rows) bus.emit('track', toTrackDTO(r));
		return rows.length;
	}

	// ---------------- reads ----------------

	getLog(id: string): string[] {
		const job = this.active.get(id);
		if (job) return job.log;
		const recent = this.recentLogs.get(id);
		if (recent) return recent;
		return getTrack(id)?.log?.split('\n') ?? [];
	}

	telemetry(): Telemetry {
		const counts = db
			.select({ status: schema.tracks.status, n: sql<number>`count(*)` })
			.from(schema.tracks)
			.groupBy(schema.tracks.status)
			.all();
		const by = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<
			Record<TrackStatus, number>
		>;
		const startOfDay = new Date();
		startOfDay.setHours(0, 0, 0, 0);
		const doneToday =
			db
				.select({ n: sql<number>`count(*)` })
				.from(schema.tracks)
				.where(and(eq(schema.tracks.status, 'done'), gte(schema.tracks.finishedAt, startOfDay)))
				.get()?.n ?? 0;
		const workers = [...this.active.values()].map((j) => j.telemetry);
		return {
			ts: Date.now(),
			paused: this.paused,
			concurrency: getSettings().pipeline.concurrency,
			speed: workers.reduce((sum, w) => sum + (w.stage === 'downloading' ? (w.speed ?? 0) : 0), 0),
			workers,
			counts: {
				queued: by.queued ?? 0,
				active: this.active.size,
				done: by.done ?? 0,
				failed: by.failed ?? 0,
				skipped: by.skipped ?? 0
			},
			doneToday
		};
	}

	private lastIdleEmit = 0;
	private emitTelemetry(force = false) {
		// Every second while busy; every 10s when idle (keeps counters fresh without chatter).
		const now = Date.now();
		if (!force && !this.active.size && now - this.lastIdleEmit < 10_000) return;
		if (!this.active.size) this.lastIdleEmit = now;
		bus.emit('telemetry', this.telemetry());
	}
}

declare global {
	var __calliope_pipeline__: Pipeline | undefined;
}

export const pipeline = (globalThis.__calliope_pipeline__ ??= new Pipeline());
