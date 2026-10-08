import { decodeRows, type LibraryRow } from '$lib/library-columns';
import type { PlayerTrack } from './player.svelte';

/** Client-side copy of the library index, shared by Explorer, Studio and Duplicates. */
class LibraryStore {
	rows = $state<LibraryRow[]>([]);
	loaded = $state(false);
	loading = $state(false);
	private pending: Promise<void> | null = null;

	load(force = false) {
		if (this.pending) return this.pending;
		if (this.loaded && !force) return Promise.resolve();
		this.loading = true;
		this.pending = fetch('/api/library')
			.then((r) => r.json())
			.then((data: { rows: unknown[][] }) => {
				this.rows = decodeRows(data.rows);
				this.loaded = true;
			})
			.finally(() => {
				this.loading = false;
				this.pending = null;
			});
		return this.pending;
	}

	/** Forget a file that was just deleted, without waiting for a reload. */
	remove(id: string) {
		this.rows = this.rows.filter((r) => r.id !== id);
	}

	byId(id: string) {
		return this.rows.find((r) => r.id === id);
	}
}

export const library = new LibraryStore();

export const toPlayerTrack = (r: LibraryRow): PlayerTrack => ({
	id: r.id,
	title: r.title,
	artist: r.artist,
	album: r.album,
	durationMs: r.durationMs,
	hasArtwork: r.hasArtwork
});

export const artUrl = (r: Pick<LibraryRow, 'id' | 'hasArtwork'>) =>
	r.hasArtwork ? `/api/library/${r.id}/art` : null;
