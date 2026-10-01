import fs from 'node:fs';
import { LoginRefusedError, SlskClient } from 'slsk-client';
import type { SlskHit, SlskRef } from '$lib/soulseek';
import type { SoulseekStatus } from '$lib/types';
import type { DownloadProgress } from './pipeline/download';
import { getSettings } from './settings';

/** The network throttles (and can ban) clients that search too fast. */
const SEARCH_GAP_MS = 2500;
const RECENT_SEARCHES = 40;

export interface SlskDownloadHooks {
	signal: AbortSignal;
	onLog: (line: string) => void;
	onProgress: (p: DownloadProgress) => void;
}

/**
 * Calliope's own Soulseek session: one login, kept open and reused by searches and downloads.
 * Connects on first use and again whenever the credentials or port change.
 */
class Soulseek {
	private client: SlskClient | null = null;
	private key = '';
	private pending: { key: string; promise: Promise<SlskClient> } | null = null;
	private state: SoulseekStatus['state'] = 'offline';
	private error: string | null = null;
	private searches: Promise<unknown> = Promise.resolve();
	private lastSearchAt = 0;
	/** Recent results by query, so the tracks of one album don't repeat the same search */
	private recent = new Map<string, { at: number; hits: SlskHit[] }>();

	private config() {
		const s = getSettings().soulseek;
		return { ...s, key: [s.username, s.password, s.listenPort].join('\n') };
	}

	status(): SoulseekStatus {
		const c = this.config();
		return {
			enabled: c.enabled,
			configured: !!c.username && !!c.password,
			state: c.enabled ? this.state : 'offline',
			username: c.username,
			listenPort: c.listenPort,
			error: this.error
		};
	}

	/** Drop the session when Soulseek was turned off or its settings changed. */
	sync() {
		const c = this.config();
		if (!c.enabled || c.key !== this.key) this.disconnect();
	}

	disconnect() {
		this.client?.destroy();
		this.client = null;
		this.pending = null;
		this.key = '';
		this.state = 'offline';
	}

	connect(): Promise<SlskClient> {
		const c = this.config();
		if (!c.enabled)
			throw new Error('Soulseek is turned off — enable it in Settings › Integrations');
		if (!c.username || !c.password)
			throw new Error('Add your Soulseek username and password in Settings › Integrations');
		if (this.client && this.key === c.key) return Promise.resolve(this.client);
		if (this.pending?.key === c.key) return this.pending.promise;
		this.disconnect();

		this.state = 'connecting';
		this.error = null;
		const client = new SlskClient({
			incomingPort: c.listenPort,
			timeout: 15_000,
			userInfo: { description: 'Calliope' }
		});
		client.on('server-error', (err) => (this.error = err.message));
		client.on('server-disconnect', ({ reconnecting }) => {
			if (this.client !== client) return;
			this.state = reconnecting ? 'connecting' : 'offline';
			if (!reconnecting) this.disconnect();
		});
		client.on('server-reconnect', () => {
			if (this.client === client) this.state = 'online';
		});

		const promise = client.login(c.username, c.password).then(
			() => {
				if (this.pending?.promise !== promise) {
					client.destroy();
					throw new Error('Soulseek settings changed while connecting — try again');
				}
				this.pending = null;
				this.client = client;
				this.key = c.key;
				this.state = 'online';
				console.log(`[soulseek] logged in as ${c.username}, listening on ${c.listenPort}`);
				return client;
			},
			(err: Error) => {
				client.destroy();
				if (this.pending?.promise === promise) {
					this.pending = null;
					this.state = 'offline';
				}
				this.error =
					err instanceof LoginRefusedError
						? `Soulseek refused the login: ${err.message}`
						: `Could not reach Soulseek: ${err.message}`;
				throw new Error(this.error);
			}
		);
		this.pending = { key: c.key, promise };
		return promise;
	}

	/** Fresh login with the saved settings, for the Test button. */
	async test() {
		this.disconnect();
		await this.connect();
		const c = this.config();
		return `Logged in as ${c.username} — listening for peers on port ${c.listenPort}`;
	}

	/**
	 * One search at a time, spaced out. Resolves with everything that arrived within `timeoutMs`.
	 * With `reuseMs`, an identical search made that recently is answered from memory.
	 */
	search(query: string, opts: { timeoutMs?: number; reuseMs?: number } = {}): Promise<SlskHit[]> {
		const run = async () => {
			const cached = this.recent.get(query);
			if (opts.reuseMs && cached && Date.now() - cached.at < opts.reuseMs) return cached.hits;
			const client = await this.connect();
			const wait = this.lastSearchAt + SEARCH_GAP_MS - Date.now();
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			this.lastSearchAt = Date.now();
			const hits = (await client.search({
				req: query,
				timeout: opts.timeoutMs ?? 8000
			})) as SlskHit[];
			this.recent.delete(query);
			this.recent.set(query, { at: Date.now(), hits });
			while (this.recent.size > RECENT_SEARCHES)
				this.recent.delete(this.recent.keys().next().value!);
			return hits;
		};
		const result = this.searches.then(run, run);
		this.searches = result.catch(() => {});
		return result;
	}

	/**
	 * Fetch one file from a peer into `dest`. The peer decides when the transfer starts: it may
	 * keep us in its queue, so a download that hasn't started after the configured wait is
	 * abandoned (and retried later by the pipeline).
	 */
	async download(ref: SlskRef, dest: string, hooks: SlskDownloadHooks, waitMs?: number) {
		const client = await this.connect();
		const waitMinutes = getSettings().soulseek.queueTimeoutMinutes;
		waitMs ??= waitMinutes * 60_000;
		const abort = new AbortController();
		const onAbort = () => abort.abort();
		hooks.signal.addEventListener('abort', onAbort, { once: true });
		let started = false;
		let timedOut = false;
		const timer = setTimeout(() => {
			if (started) return;
			timedOut = true;
			abort.abort();
		}, waitMs);

		const dl = client.download({ ...ref, path: dest, signal: abort.signal });
		let lastPlace = -1;
		dl.on('queue', (place) => {
			if (place === lastPlace) return;
			lastPlace = place;
			hooks.onLog(
				place > 0 ? `Waiting in ${ref.user}'s queue — position ${place}` : 'Transfer starting'
			);
		});
		dl.on('interrupted', ({ receivedBytes, attempts }) =>
			hooks.onLog(`Transfer interrupted at ${receivedBytes} bytes — resuming (attempt ${attempts})`)
		);
		let sample = { at: Date.now(), bytes: 0 };
		let speed: number | null = null;
		dl.on('progress', (p) => {
			if (!started) hooks.onLog(`Receiving from ${ref.user}`);
			started = true;
			const now = Date.now();
			if (now - sample.at >= 1000) {
				const rate = ((p.receivedBytes - sample.bytes) / (now - sample.at)) * 1000;
				speed = speed === null ? rate : speed * 0.6 + rate * 0.4;
				sample = { at: now, bytes: p.receivedBytes };
			}
			const total = p.totalBytes ?? null;
			hooks.onProgress({
				downloaded: p.receivedBytes,
				total,
				speed,
				eta: total && speed ? Math.round((total - p.receivedBytes) / speed) : null,
				percent: Math.min(100, (p.progress ?? 0) * 100)
			});
		});

		try {
			const res = await dl;
			if (res.size && res.receivedBytes < res.size)
				throw new Error(`Transfer ended early (${res.receivedBytes} of ${res.size} bytes)`);
		} catch (err) {
			fs.rmSync(dest, { force: true });
			if (timedOut)
				throw new Error(
					waitMs < waitMinutes * 60_000
						? `${ref.user} did not start sending within ${Math.round(waitMs / 1000)}s`
						: `${ref.user} kept the file queued for over ${waitMinutes} min — try another peer or raise the wait in Settings`
				);
			throw err;
		} finally {
			clearTimeout(timer);
			hooks.signal.removeEventListener('abort', onAbort);
		}
	}
}

declare global {
	var __calliope_soulseek__: Soulseek | undefined;
}

export const soulseek = (globalThis.__calliope_soulseek__ ??= new Soulseek());
