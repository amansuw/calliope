import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { browser } from '$app/environment';
import type { LibraryStatus, ServerEvents, SourceDTO, Telemetry, TrackDTO } from '$lib/types';
import { toasts } from './toasts.svelte';

const HISTORY = 120;

/**
 * Single SSE connection shared by the whole app. Pages seed it with their load data,
 * then it stays current from server events.
 */
class Live {
	connected = $state(false);
	telemetry = $state<Telemetry | null>(null);
	/** Aggregate download speed samples, one per telemetry tick (bytes/sec) */
	speedHistory = $state<number[]>(Array(HISTORY).fill(0));
	tracks = new SvelteMap<string, TrackDTO>();
	sources = new SvelteMap<string, SourceDTO>();
	library = $state<LibraryStatus | null>(null);
	logs = new SvelteMap<string, string[]>();
	private logSubscriptions = new Set<string>();
	private es: EventSource | null = null;
	private listeners = new Set<(event: string, data: unknown) => void>();

	connect() {
		if (this.es || typeof window === 'undefined') return;
		const es = new EventSource('/api/events');
		this.es = es;
		es.onopen = () => (this.connected = true);
		es.onerror = () => (this.connected = false);
		const on = <K extends keyof ServerEvents>(name: K, fn: (d: ServerEvents[K]) => void) =>
			es.addEventListener(name, (e) => {
				const data = JSON.parse((e as MessageEvent).data);
				fn(data);
				for (const l of this.listeners) l(name, data);
			});

		on('telemetry', (t) => {
			this.telemetry = t;
			this.speedHistory = [...this.speedHistory.slice(1), t.speed];
		});
		on('track', (t) => this.tracks.set(t.id, t));
		on('track:removed', ({ id }) => this.tracks.delete(id));
		on('source', (s) => this.sources.set(s.id, s));
		on('source:removed', ({ id }) => this.sources.delete(id));
		on('library', (l) => (this.library = l));
		on('toast', (t) => toasts.push(t));
		on('log', ({ trackId, line }) => {
			if (!this.logSubscriptions.has(trackId)) return;
			const lines = this.logs.get(trackId) ?? [];
			this.logs.set(trackId, [...lines.slice(-399), line]);
		});
	}

	/** React to raw events (e.g. refetch a list when something changes) */
	subscribe(fn: (event: string, data: unknown) => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	// Seeding is browser-only: on the server this module is a process-wide singleton,
	// so pages render from their load data there instead.
	seedTracks(list: TrackDTO[]) {
		if (!browser) return;
		untrack(() => {
			for (const t of list) this.tracks.set(t.id, t);
		});
	}

	seedSources(list: SourceDTO[], replace = false) {
		if (!browser) return;
		untrack(() => {
			if (replace) this.sources.clear();
			for (const s of list) this.sources.set(s.id, s);
		});
	}

	seedLibrary(status: LibraryStatus | null) {
		if (!browser || !status) return;
		untrack(() => (this.library = status));
	}

	async watchLog(trackId: string) {
		this.logSubscriptions.add(trackId);
		const res = await fetch(`/api/tracks/${trackId}/log`);
		if (res.ok) this.logs.set(trackId, (await res.json()).lines);
	}

	unwatchLog(trackId: string) {
		this.logSubscriptions.delete(trackId);
		this.logs.delete(trackId);
	}
}

export const live = new Live();
