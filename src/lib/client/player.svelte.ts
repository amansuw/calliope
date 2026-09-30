/**
 * In-app player.
 *
 * Two <audio> elements feed a Web Audio graph:
 *   element → per-deck gain (loudness normalization) → master gain (volume) → analyser → speakers
 * The next track is preloaded on the idle deck and started a few milliseconds before the current
 * one ends, which gets close to gapless playback for continuous albums.
 */
import { browser } from '$app/environment';

export interface PlayerTrack {
	id: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	durationMs: number | null;
	hasArtwork: boolean;
}

interface Analysis {
	peaks: number[];
	loudness: number;
}

interface Deck {
	el: HTMLAudioElement;
	gain: GainNode | null;
	trackId: string | null;
}

/** RMS level to level tracks to. RMS reads ~4 dB below LUFS, so this sits near a -14 LUFS target. */
const TARGET_DBFS = -18;
const HANDOFF_SEC = 0.06;

function load<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(`calliope:${key}`);
		return v === null ? fallback : (JSON.parse(v) as T);
	} catch {
		return fallback;
	}
}
function save(key: string, value: unknown) {
	try {
		localStorage.setItem(`calliope:${key}`, JSON.stringify(value));
	} catch {
		/* private mode etc. */
	}
}

class Player {
	queue = $state<PlayerTrack[]>([]);
	index = $state(-1);
	playing = $state(false);
	time = $state(0);
	duration = $state(0);
	buffering = $state(false);
	volume = $state(browser ? load('volume', 0.85) : 0.85);
	normalize = $state(browser ? load('normalize', true) : true);
	analysis = $state<Analysis | null>(null);
	/** Gain applied by normalization, in dB, for display */
	normGainDb = $state(0);

	current = $derived(this.index >= 0 ? (this.queue[this.index] ?? null) : null);

	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	analyser: AnalyserNode | null = null;
	private decks: [Deck, Deck] | null = null;
	private active = 0;
	private raf = 0;
	private analyses = new Map<string, Analysis>();
	private preloadedFor: string | null = null;

	private setup() {
		if (this.decks) return;
		const make = (): Deck => {
			const el = new Audio();
			el.preload = 'auto';
			el.crossOrigin = 'anonymous';
			el.addEventListener('waiting', () => el === this.deck.el && (this.buffering = true));
			el.addEventListener('playing', () => el === this.deck.el && (this.buffering = false));
			el.addEventListener('ended', () => el === this.deck.el && this.onEnded());
			el.addEventListener('error', () => el === this.deck.el && this.onError());
			return { el, gain: null, trackId: null };
		};
		this.decks = [make(), make()];
		try {
			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.analyser = this.ctx.createAnalyser();
			this.analyser.fftSize = 256;
			this.analyser.smoothingTimeConstant = 0.78;
			this.master.connect(this.analyser).connect(this.ctx.destination);
			for (const d of this.decks) {
				d.gain = this.ctx.createGain();
				this.ctx.createMediaElementSource(d.el).connect(d.gain).connect(this.master);
			}
		} catch {
			// Web Audio unavailable: plain element playback still works, minus visualizer/normalization.
			this.ctx = null;
		}
		this.applyVolume();
	}

	private get deck() {
		return this.decks![this.active];
	}
	private get idle() {
		return this.decks![1 - this.active];
	}

	// ---------------- public API ----------------

	playList(tracks: PlayerTrack[], start = 0) {
		this.queue = tracks;
		this.startAt(start);
	}

	playNext(track: PlayerTrack) {
		if (this.index < 0) return this.playList([track]);
		this.queue = [
			...this.queue.slice(0, this.index + 1),
			track,
			...this.queue.slice(this.index + 1)
		];
		this.preloadedFor = null;
	}

	enqueue(tracks: PlayerTrack[]) {
		if (this.index < 0) return this.playList(tracks);
		this.queue = [...this.queue, ...tracks];
	}

	toggle() {
		if (!this.current) return;
		if (this.deck.el.paused) {
			void this.ctx?.resume();
			void this.deck.el.play();
			this.playing = true;
			this.loop();
		} else {
			this.deck.el.pause();
			this.playing = false;
		}
	}

	next() {
		if (this.index < this.queue.length - 1) this.startAt(this.index + 1);
		else this.stop();
	}

	prev() {
		if (this.time > 3 || this.index === 0) this.seek(0);
		else this.startAt(this.index - 1);
	}

	seek(sec: number) {
		if (!this.decks) return;
		this.deck.el.currentTime = Math.max(0, Math.min(sec, this.duration || sec));
		this.time = this.deck.el.currentTime;
	}

	setVolume(v: number) {
		this.volume = Math.max(0, Math.min(1, v));
		save('volume', this.volume);
		this.applyVolume();
	}

	setNormalize(on: boolean) {
		this.normalize = on;
		save('normalize', on);
		this.applyNormalization(this.deck, this.current?.id ?? null);
	}

	stop() {
		if (this.decks) for (const d of this.decks) d.el.pause();
		this.playing = false;
		cancelAnimationFrame(this.raf);
	}

	clear() {
		this.stop();
		this.queue = [];
		this.index = -1;
		this.analysis = null;
	}

	// ---------------- internals ----------------

	private startAt(i: number) {
		this.setup();
		const track = this.queue[i];
		if (!track) return;
		this.index = i;
		void this.ctx?.resume();
		// If the idle deck already holds this track (preloaded), just flip decks.
		if (this.idle.trackId === track.id) this.active = 1 - this.active;
		else this.loadInto(this.deck, track);
		this.idle.el.pause();
		this.deck.el.currentTime = 0;
		void this.deck.el.play().catch(() => (this.playing = false));
		this.playing = true;
		this.time = 0;
		this.duration = (track.durationMs ?? 0) / 1000;
		this.preloadedFor = null;
		void this.loadAnalysis(track.id).then((a) => {
			if (this.current?.id === track.id) this.analysis = a;
			this.applyNormalization(this.deck, track.id);
		});
		this.analysis = this.analyses.get(track.id) ?? null;
		this.updateMediaSession();
		this.loop();
	}

	private loadInto(deck: Deck, track: PlayerTrack) {
		deck.trackId = track.id;
		deck.el.src = `/api/library/${track.id}/stream`;
		deck.el.load();
		this.applyNormalization(deck, track.id);
	}

	private async loadAnalysis(id: string): Promise<Analysis | null> {
		const cached = this.analyses.get(id);
		if (cached) return cached;
		try {
			const res = await fetch(`/api/library/${id}/analysis`);
			if (!res.ok) return null;
			const a = (await res.json()) as Analysis;
			this.analyses.set(id, a);
			return a;
		} catch {
			return null;
		}
	}

	private applyVolume() {
		if (!this.decks) return;
		// Perceptual curve: slider position squared
		const v = this.volume * this.volume;
		if (this.master) this.master.gain.value = v;
		else for (const d of this.decks) d.el.volume = v;
	}

	private applyNormalization(deck: Deck, id: string | null) {
		const a = id ? this.analyses.get(id) : null;
		let db = 0;
		if (this.normalize && a) {
			// Never boost past the track's own peak headroom (minus 1 dB) — gain > 1 would clip.
			const peak = Math.max(1, ...a.peaks) / 255;
			const headroom = -20 * Math.log10(peak) - 1;
			db = Math.max(-12, Math.min(TARGET_DBFS - a.loudness, Math.max(0, headroom), 6));
		}
		if (deck.gain) deck.gain.gain.value = Math.pow(10, db / 20);
		if (deck === this.decks?.[this.active]) this.normGainDb = Math.round(db * 10) / 10;
	}

	private loop() {
		cancelAnimationFrame(this.raf);
		const tick = () => {
			if (!this.decks) return;
			const el = this.deck.el;
			this.time = el.currentTime;
			if (Number.isFinite(el.duration) && el.duration > 0) this.duration = el.duration;
			const remaining = this.duration - this.time;
			const next = this.queue[this.index + 1];

			// Preload the next track onto the idle deck ~15s before the end.
			if (next && remaining < 15 && this.preloadedFor !== next.id) {
				this.preloadedFor = next.id;
				this.loadInto(this.idle, next);
				void this.loadAnalysis(next.id).then(() => this.applyNormalization(this.idle, next.id));
			}
			// Hand off just before the end for (near) gapless transitions.
			if (
				next &&
				this.playing &&
				remaining > 0 &&
				remaining < HANDOFF_SEC &&
				this.idle.trackId === next.id
			) {
				this.startAt(this.index + 1);
				return;
			}
			if (this.playing) this.raf = requestAnimationFrame(tick);
		};
		this.raf = requestAnimationFrame(tick);
	}

	private onEnded() {
		if (this.index < this.queue.length - 1) this.startAt(this.index + 1);
		else {
			this.playing = false;
			this.time = this.duration;
		}
	}

	private onError() {
		console.warn('[player] playback error for', this.current?.id);
		this.next();
	}

	private updateMediaSession() {
		if (!('mediaSession' in navigator) || !this.current) return;
		const t = this.current;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: t.title ?? '',
			artist: t.artist ?? '',
			album: t.album ?? '',
			artwork: t.hasArtwork ? [{ src: `/api/library/${t.id}/art`, sizes: '512x512' }] : []
		});
		navigator.mediaSession.setActionHandler('play', () => this.toggle());
		navigator.mediaSession.setActionHandler('pause', () => this.toggle());
		navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
		navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
	}
}

export const player = new Player();
