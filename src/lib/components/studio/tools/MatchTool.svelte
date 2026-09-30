<script lang="ts">
	import {
		AudioLines,
		Check,
		Disc3,
		LoaderCircle,
		Search,
		Sparkles,
		X,
		ZoomIn
	} from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import { portal } from '$lib/client/portal';
	import { api } from '$lib/client/api';
	import { studio, type StudioFile } from '$lib/client/studio.svelte';
	import { toasts } from '$lib/client/toasts.svelte';

	type Kind =
		'album' | 'ep' | 'single' | 'soundtrack' | 'compilation' | 'live' | 'bootleg' | 'other';
	interface AlbumOption {
		key: string;
		recordingId: string;
		title: string;
		artist: string;
		artistId: string | null;
		durationMs: number | null;
		releaseId: string;
		releaseGroupId: string | null;
		album: string;
		albumArtist: string | null;
		year: number | null;
		country: string | null;
		trackNumber: number | null;
		trackTotal: number | null;
		discNumber: number | null;
		kind: Kind;
		confidence: number;
		verified: boolean;
		coverThumb: string;
	}
	interface Enrichment {
		recordingId: string;
		releaseId: string | null;
		artistId: string | null;
		album: string | null;
		trackTotal: number | null;
		genres: string[];
		artworkUrl: string | null;
		confidence: number;
		verified: boolean;
	}

	let options = $state<AlbumOption[]>([]);
	let notes = $state<string[]>([]);
	let acoustic = $state<'matched' | 'no-match' | 'unavailable' | 'error' | null>(null);
	let forId = $state<string | null>(null);
	let busy = $state<'find' | 'auto' | string | null>(null);
	let showAll = $state(false);
	let autoProgress = $state({ done: 0, total: 0, matched: 0 });
	let autoArt = $state<'replace' | 'missing' | 'keep'>('replace');
	let useArt = $state(true);
	let noCover = $state<Record<string, boolean>>({});
	let preview = $state<AlbumOption | null>(null);
	let previewSrc = $state('');
	let previewLoaded = $state(false);

	/** Cover Art Archive serves larger sizes at the same path. */
	function openPreview(o: AlbumOption) {
		preview = o;
		previewLoaded = false;
		previewSrc = o.coverThumb.replace(/front-250$/, 'front-1200');
	}

	const file = $derived(studio.focused);
	const SHOWN = 6;
	const MAIN_KINDS: Kind[] = ['album', 'ep', 'single', 'soundtrack'];
	const main = $derived(options.filter((o) => MAIN_KINDS.includes(o.kind)));
	const other = $derived(options.filter((o) => !MAIN_KINDS.includes(o.kind)));
	const visible = $derived(showAll ? [...main, ...other] : main.slice(0, SHOWN));

	const KIND_LABEL: Record<Kind, string> = {
		album: 'Album',
		ep: 'EP',
		single: 'Single',
		soundtrack: 'Soundtrack',
		compilation: 'Compilation',
		live: 'Live',
		bootleg: 'Bootleg',
		other: 'Other'
	};
	const staged = (f: StudioFile) => ({
		title: studio.value(f, 'title') ? String(studio.value(f, 'title')) : undefined,
		artist: studio.value(f, 'artist') ? String(studio.value(f, 'artist')).split(';')[0] : undefined
	});

	async function find(f: StudioFile) {
		busy = 'find';
		forId = f.id;
		showAll = false;
		try {
			const res = await api.post<{
				options: AlbumOption[];
				notes: string[];
				acoustic: typeof acoustic;
			}>('/api/studio/options', { id: f.id, ...staged(f) });
			options = res.options;
			notes = res.notes;
			acoustic = res.acoustic;
		} finally {
			busy = null;
		}
	}

	async function use(f: StudioFile, o: AlbumOption, withArt = useArt) {
		busy = o.key;
		try {
			const extras = await api.post<{
				year: number | null;
				genres: string[];
				artworkUrl: string | null;
			}>('/api/studio/extras', {
				releaseId: o.releaseId,
				releaseGroupId: o.releaseGroupId,
				year: o.year,
				artistId: o.artistId
			});
			studio.set(f.id, 'title', o.title);
			studio.set(f.id, 'artist', o.artist);
			studio.set(f.id, 'album', o.album);
			studio.set(f.id, 'albumArtist', o.albumArtist ?? o.artist);
			studio.set(f.id, 'year', extras.year ?? o.year);
			studio.set(f.id, 'trackNumber', o.trackNumber);
			studio.set(f.id, 'trackTotal', o.trackTotal);
			studio.set(f.id, 'discNumber', o.discNumber);
			if (extras.genres.length) studio.set(f.id, 'genre', extras.genres.join('; '));
			if (withArt && extras.artworkUrl) studio.artwork[f.id] = extras.artworkUrl;
			studio.mb[f.id] = {
				recordingId: o.recordingId,
				releaseId: o.releaseId,
				artistId: o.artistId,
				label: `${o.artist} — ${o.album}`
			};
		} finally {
			busy = null;
		}
	}

	/** Same matching as the pipeline and library Auto-tag; results are staged for review. */
	async function autoMatch() {
		busy = 'auto';
		const targets = [...studio.targets];
		autoProgress = { done: 0, total: targets.length, matched: 0 };
		const unmatched: string[] = [];
		try {
			for (const f of targets) {
				const res = await api
					.post<{
						enrichment: Enrichment | null;
						patch: Record<string, string | number | null> | null;
					}>('/api/studio/enrich', { id: f.id, ...staged(f) }, { quiet: true })
					.catch(() => ({ enrichment: null, patch: null }));
				const e = res.enrichment;
				if (e && res.patch && e.confidence >= 0.65) {
					for (const k of [
						'title',
						'artist',
						'album',
						'albumArtist',
						'year',
						'trackNumber',
						'discNumber',
						'genre'
					] as const) {
						if (res.patch[k] !== undefined && res.patch[k] !== null)
							studio.set(f.id, k, res.patch[k]);
					}
					if (e.trackTotal) studio.set(f.id, 'trackTotal', e.trackTotal);
					if (e.artworkUrl && (autoArt === 'replace' || (autoArt === 'missing' && !f.hasArtwork)))
						studio.artwork[f.id] = e.artworkUrl;
					studio.mb[f.id] = {
						recordingId: e.recordingId,
						releaseId: e.releaseId,
						artistId: e.artistId,
						label: e.album ?? ''
					};
					autoProgress.matched++;
				} else {
					unmatched.push(String(studio.value(f, 'title') ?? f.relPath));
				}
				autoProgress.done++;
			}
			const { matched, total } = autoProgress;
			toasts.push({
				level: matched === total ? 'success' : matched ? 'warning' : 'error',
				title: matched ? `Matched ${matched} of ${total}` : 'No confident matches',
				message:
					[
						matched ? 'Changes are staged — review the highlighted cells, then save.' : '',
						unmatched.length
							? `Not matched: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''} — use Identify to pick an album by hand.`
							: ''
					]
						.filter(Boolean)
						.join('\n') || undefined
			});
		} finally {
			busy = null;
		}
	}

	const confTone = (c: number) =>
		c >= 0.85
			? 'border-ok/30 bg-ok/10 text-ok'
			: c >= 0.65
				? 'border-warn/30 bg-warn/10 text-warn'
				: 'border-white/10 text-ink-400';
</script>

<div class="mb-4 rounded-lg border border-white/6 bg-white/[0.02] p-3">
	<div class="flex items-center justify-between gap-2">
		<div>
			<div class="text-[13px] font-medium text-ink-100">Auto-match</div>
			<div class="text-xs text-ink-400">
				Stage album, track numbers, year, genres{autoArt === 'keep' ? '' : ' and cover art'} for {studio
					.targets.length} file{studio.targets.length === 1 ? '' : 's'}.
			</div>
		</div>
		<button
			class="btn btn-sm btn-violet"
			onclick={autoMatch}
			disabled={!!busy || !studio.targets.length}
		>
			{#if busy === 'auto'}<LoaderCircle class="h-3 w-3 animate-spin" />
				{autoProgress.done}/{autoProgress.total}{:else}<Sparkles class="h-3 w-3" /> Run{/if}
		</button>
	</div>
	<div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
		<span class="mr-1 text-ink-400">Cover art:</span>
		{#each [['replace', 'Replace'], ['missing', 'Only if missing'], ['keep', "Don't change"]] as const as [value, label] (value)}
			<button
				class="rounded-full border px-2.5 py-0.5 transition {autoArt === value
					? 'border-violet/50 bg-violet/15 text-violet-glow'
					: 'border-white/8 text-ink-300'}"
				onclick={() => (autoArt = value)}
				disabled={busy === 'auto'}>{label}</button
			>
		{/each}
	</div>
	{#if busy === 'auto'}<p class="mt-1 text-[11px] text-ink-500">
			MusicBrainz allows one request per second — a few seconds per track.
		</p>{/if}
</div>

{#if file}
	<div class="label">Focused file</div>
	<div class="mb-2 truncate text-[13px] text-ink-100">
		{studio.value(file, 'artist') ?? '?'} — {studio.value(file, 'title') ?? '?'}
	</div>
	<button class="btn btn-sm w-full" onclick={() => find(file)} disabled={!!busy}>
		{#if busy === 'find'}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<Search
				class="h-3 w-3"
			/>{/if} Identify
	</button>
	<p class="hint !mt-1.5">
		Audio fingerprint (AcoustID) plus MusicBrainz search, ranked by confidence.
	</p>
	<label class="mt-2 flex items-center gap-1.5 text-xs text-ink-300">
		<input type="checkbox" class="accent-amber" bind:checked={useArt} /> Use the album's cover art
	</label>

	{#if forId === file.id}
		{#if acoustic}
			<p
				class="mt-2 flex items-center gap-1.5 text-[11px] {acoustic === 'matched'
					? 'text-ok'
					: acoustic === 'error'
						? 'text-bad'
						: 'text-ink-400'}"
			>
				<AudioLines class="h-3 w-3 shrink-0" />
				{acoustic === 'matched'
					? 'Audio fingerprint matched — results marked Audio are confirmed by the recording itself.'
					: acoustic === 'no-match'
						? 'Audio fingerprint: no match in AcoustID — ranked by tags and duration.'
						: acoustic === 'error'
							? 'Audio fingerprint lookup failed — ranked by tags and duration.'
							: 'Audio fingerprint off — add an AcoustID application key and install fpcalc for audio matching.'}
			</p>
		{/if}
		{#each notes as n (n)}<p class="mt-1 text-[11px] text-warn">{n}</p>{/each}
		{#if options.length}
			<div class="mt-3 space-y-2">
				{#each visible as o, i (o.key)}
					<div class="group relative">
						<button
							class="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition hover:border-white/15
							{i === 0 && !showAll ? 'border-violet/40 bg-violet/[0.06]' : 'border-white/6 bg-ink-900/60'}
							{MAIN_KINDS.includes(o.kind) ? '' : 'opacity-70'}"
							onclick={() => use(file, o)}
							disabled={!!busy}
						>
							<div
								class="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-white/8 bg-ink-800"
							>
								<img
									src={o.coverThumb}
									alt=""
									loading="lazy"
									class="h-full w-full object-cover"
									onerror={(e) => {
										(e.currentTarget as HTMLImageElement).style.display = 'none';
										noCover[o.key] = true;
									}}
								/>
								<Disc3 class="absolute inset-0 -z-10 m-auto h-5 w-5 text-ink-500" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<span class="truncate text-[13px] text-ink-50">{o.album}</span>
									{#if i === 0 && !showAll}<span
											class="chip shrink-0 border-violet/40 bg-violet/15 text-violet-glow"
											>Best</span
										>{/if}
								</div>
								<div class="truncate text-[11px] text-ink-400">
									{KIND_LABEL[o.kind]}{o.year ? ` · ${o.year}` : ''}{o.country
										? ` · ${o.country}`
										: ''}{o.trackNumber
										? ` · #${o.trackNumber}${o.trackTotal ? `/${o.trackTotal}` : ''}`
										: ''}
								</div>
							</div>
							<div class="flex shrink-0 flex-col items-end gap-1">
								{#if busy === o.key}<LoaderCircle class="h-3.5 w-3.5 animate-spin text-ink-300" />
								{:else}<span class="chip {confTone(o.confidence)}"
										>{Math.round(o.confidence * 100)}%</span
									>{/if}
								{#if o.verified}<span
										class="chip border-ok/30 bg-ok/5 text-ok"
										title="Confirmed by audio fingerprint"
										><AudioLines class="h-3 w-3" /> Audio</span
									>{/if}
							</div>
						</button>
						{#if !noCover[o.key]}
							<button
								class="absolute top-[9px] left-[9px] flex h-12 w-12 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
								onclick={() => openPreview(o)}
								aria-label="Preview cover of {o.album}"
								title="Preview cover"
							>
								<ZoomIn class="h-4 w-4" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
			{#if !showAll && (main.length > SHOWN || other.length)}
				<button class="btn btn-ghost btn-sm mt-2 w-full" onclick={() => (showAll = true)}>
					Show {main.length - Math.min(main.length, SHOWN) + other.length} more (live, compilations, bootlegs…)
				</button>
			{/if}
			<p class="hint flex items-center gap-1">
				<Check class="h-3 w-3" /> Click an album to stage its tags{useArt ? ' and cover art' : ''}.
			</p>
		{:else if !busy}
			<p class="mt-3 text-xs text-ink-400">
				No albums found. Check the title and artist, then try again.
			</p>
		{/if}
	{/if}
{:else}
	<p class="text-xs text-ink-400">Click a row to look it up.</p>
{/if}

<svelte:window onkeydown={(e) => preview && e.key === 'Escape' && (preview = null)} />

{#if preview}
	{@const p = preview}
	<div use:portal>
		<button
			transition:fade={{ duration: 120 }}
			class="fixed inset-0 z-50 cursor-zoom-out bg-black/75 backdrop-blur-sm"
			onclick={() => (preview = null)}
			aria-label="Close preview"
		></button>
		<div
			transition:scale={{ start: 0.96, duration: 160 }}
			class="pointer-events-none fixed top-1/2 left-1/2 z-50 flex w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3"
		>
			<div
				class="pointer-events-auto relative aspect-square max-h-[75vh] w-full overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl"
			>
				<!-- Thumbnail shows instantly, full-size image fades in over it -->
				<img
					src={p.coverThumb}
					alt=""
					class="absolute inset-0 h-full w-full object-contain blur-sm"
				/>
				<img
					src={previewSrc}
					alt="Cover of {p.album}"
					class="absolute inset-0 h-full w-full object-contain transition-opacity duration-200 {previewLoaded
						? 'opacity-100'
						: 'opacity-0'}"
					onload={() => (previewLoaded = true)}
					onerror={() => {
						if (previewSrc !== p.coverThumb) previewSrc = p.coverThumb;
					}}
				/>
				{#if !previewLoaded}
					<LoaderCircle class="absolute top-3 left-3 h-4 w-4 animate-spin text-white/80" />
				{/if}
				<button
					class="btn btn-ghost btn-icon absolute top-2 right-2 bg-black/50"
					onclick={() => (preview = null)}
					aria-label="Close"><X class="h-4 w-4" /></button
				>
			</div>
			<div class="pointer-events-auto flex items-center justify-between gap-3">
				<div class="min-w-0">
					<div class="truncate text-sm text-ink-50">{p.album}</div>
					<div class="truncate text-xs text-ink-400">
						{p.albumArtist ?? p.artist} · {KIND_LABEL[p.kind]}{p.year ? ` · ${p.year}` : ''}
					</div>
				</div>
				{#if file}
					{@const f = file}
					<div class="flex shrink-0 gap-2">
						<button
							class="btn btn-sm"
							disabled={!!busy}
							title="Stage tags but keep the file's current artwork"
							onclick={async () => {
								preview = null;
								await use(f, p, false);
							}}>Tags only</button
						>
						<button
							class="btn btn-sm btn-violet"
							disabled={!!busy}
							onclick={async () => {
								preview = null;
								await use(f, p, true);
							}}><Check class="h-3 w-3" /> Tags + cover</button
						>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
