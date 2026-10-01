import { api } from './api';
import { library } from './library.svelte';
import { toasts } from './toasts.svelte';

export const FIELDS = [
	{ key: 'title', label: 'Title', width: 'w-56', numeric: false },
	{ key: 'artist', label: 'Artist', width: 'w-44', numeric: false },
	{ key: 'album', label: 'Album', width: 'w-48', numeric: false },
	{ key: 'albumArtist', label: 'Album artist', width: 'w-40', numeric: false },
	{ key: 'year', label: 'Year', width: 'w-16', numeric: true },
	{ key: 'trackNumber', label: '#', width: 'w-12', numeric: true },
	{ key: 'trackTotal', label: 'of', width: 'w-12', numeric: true },
	{ key: 'discNumber', label: 'Disc', width: 'w-12', numeric: true },
	{ key: 'genre', label: 'Genre', width: 'w-32', numeric: false }
] as const;

export type Field = (typeof FIELDS)[number]['key'] | 'comment';
export type Value = string | number | null;

export interface StudioFile {
	id: string;
	path: string;
	relPath: string;
	format: string | null;
	durationMs: number | null;
	hasArtwork: boolean;
	hasLyrics: boolean;
	mbRecordingId: string | null;
	tags: Record<Field, Value>;
}

export interface MbStaged {
	recordingId: string;
	releaseId: string | null;
	artistId: string | null;
	label: string;
}

const norm = (v: Value | undefined) =>
	v === undefined || v === null || v === '' ? null : typeof v === 'number' ? v : String(v);

function readPref(key: string, fallback: boolean): boolean {
	try {
		const v = localStorage.getItem(`calliope:${key}`);
		return v === null ? fallback : v === 'true';
	} catch {
		return fallback;
	}
}
function writePref(key: string, value: boolean) {
	try {
		localStorage.setItem(`calliope:${key}`, String(value));
	} catch {
		/* storage unavailable */
	}
}

class Studio {
	files = $state<StudioFile[]>([]);
	/** Staged tag edits per file */
	edits = $state<Record<string, Partial<Record<Field, Value>>>>({});
	artwork = $state<Record<string, string>>({});
	mb = $state<Record<string, MbStaged>>({});
	selected = $state<string[]>([]);
	focusId = $state<string | null>(null);
	loading = $state(false);
	saving = $state(false);
	/** Re-file saved files to match the folder template (remembered per browser) */
	organizeOnSave = $state(readPref('studio-organize', true));
	/** Bumped after saves so artwork thumbnails refetch */
	artVersion = $state(0);

	dirtyIds = $derived([
		...new Set([
			...Object.keys(this.edits).filter((id) => Object.keys(this.edits[id] ?? {}).length),
			...Object.keys(this.artwork),
			...Object.keys(this.mb)
		])
	]);
	/** Selected rows that have staged changes */
	dirtySelected = $derived(this.dirtyIds.filter((id) => this.selected.includes(id)));
	/** Rows tools act on: the selection, or everything when nothing is selected */
	targets = $derived(
		this.selected.length ? this.files.filter((f) => this.selected.includes(f.id)) : this.files
	);
	focused = $derived(this.files.find((f) => f.id === this.focusId) ?? null);

	async add(ids: string[]) {
		const fresh = ids.filter((id) => !this.files.some((f) => f.id === id));
		if (!fresh.length) return;
		this.loading = true;
		try {
			const loaded = await api.post<StudioFile[]>('/api/studio/files', { ids: fresh });
			this.files = [...this.files, ...loaded];
			this.focusId ??= loaded[0]?.id ?? null;
		} finally {
			this.loading = false;
		}
	}

	remove(ids: string[]) {
		this.files = this.files.filter((f) => !ids.includes(f.id));
		for (const id of ids) {
			delete this.edits[id];
			delete this.artwork[id];
			delete this.mb[id];
		}
		this.selected = this.selected.filter((id) => !ids.includes(id));
		if (this.focusId && ids.includes(this.focusId)) this.focusId = this.files[0]?.id ?? null;
	}

	clear() {
		this.files = [];
		this.edits = {};
		this.artwork = {};
		this.mb = {};
		this.selected = [];
		this.focusId = null;
	}

	value(file: StudioFile, field: Field): Value {
		const e = this.edits[file.id];
		return e && field in e ? (e[field] ?? null) : file.tags[field];
	}

	isDirty(file: StudioFile, field: Field) {
		const e = this.edits[file.id];
		return !!e && field in e;
	}

	/** Stage a value; staging the original value again un-dirties the cell. */
	set(id: string, field: Field, raw: Value) {
		const file = this.files.find((f) => f.id === id);
		if (!file) return;
		const isNumeric = FIELDS.find((f) => f.key === field)?.numeric;
		let v: Value = raw;
		if (isNumeric) {
			const n = Number(String(raw ?? '').trim());
			v =
				raw === null || String(raw).trim() === ''
					? null
					: Number.isFinite(n) && n > 0
						? Math.round(n)
						: file.tags[field];
		} else if (typeof raw === 'string') v = raw;
		const edits = { ...(this.edits[id] ?? {}) };
		if (norm(v) === norm(file.tags[field])) delete edits[field];
		else edits[field] = v;
		this.edits[id] = edits;
	}

	/** Apply a transform to one field across the target rows. */
	transform(field: Field, fn: (value: string, file: StudioFile, index: number) => Value) {
		this.targets.forEach((f, i) => {
			const cur = this.value(f, field);
			this.set(f.id, field, fn(cur === null ? '' : String(cur), f, i));
		});
	}

	revert(ids = this.dirtyIds) {
		for (const id of ids) {
			delete this.edits[id];
			delete this.artwork[id];
			delete this.mb[id];
		}
	}

	async save() {
		const changes = this.dirtyIds.map((id) => ({
			id,
			tags: this.edits[id] && Object.keys(this.edits[id]).length ? this.edits[id] : undefined,
			artworkUrl: this.artwork[id] ?? undefined,
			mb: this.mb[id]
				? {
						recordingId: this.mb[id].recordingId,
						releaseId: this.mb[id].releaseId,
						artistId: this.mb[id].artistId
					}
				: undefined
		}));
		if (!changes.length) return;
		this.saving = true;
		try {
			const res = await api.post<{
				saved: number;
				moved: number;
				errors: { id: string; error: string }[];
			}>('/api/studio/save', { changes, organize: this.organizeOnSave });
			const failed = new Set(res.errors.map((e) => e.id));
			const done = changes.map((c) => c.id).filter((id) => !failed.has(id));
			// Reload saved files from disk so the grid shows what was actually written
			const reloaded = await api.post<StudioFile[]>('/api/studio/files', { ids: done });
			const byId = new Map(reloaded.map((f) => [f.id, f]));
			this.files = this.files.map((f) => byId.get(f.id) ?? f);
			this.revert(done);
			this.artVersion++;
			toasts.push({
				level: res.errors.length ? 'warning' : 'success',
				title: `Saved ${res.saved} file${res.saved === 1 ? '' : 's'}`,
				message:
					[
						res.moved
							? `Moved ${res.moved} file${res.moved === 1 ? '' : 's'} to match the folder template.`
							: '',
						...res.errors.map((e) => e.error)
					]
						.filter(Boolean)
						.join('\n') || undefined
			});
			void library.load(true);
		} finally {
			this.saving = false;
		}
	}

	async reload(ids: string[]) {
		const reloaded = await api.post<StudioFile[]>('/api/studio/files', { ids });
		const byId = new Map(reloaded.map((f) => [f.id, f]));
		this.files = this.files.map((f) => byId.get(f.id) ?? f);
	}
}

export const studio = new Studio();

$effect.root(() => {
	$effect(() => writePref('studio-organize', studio.organizeOnSave));
});
