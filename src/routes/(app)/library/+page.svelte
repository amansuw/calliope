<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		ArrowDown,
		ArrowUp,
		Disc3,
		Info,
		LayoutGrid,
		Library,
		ListPlus,
		LoaderCircle,
		Play,
		RefreshCw,
		Rows3,
		Search,
		SlidersHorizontal,
		Sparkles,
		WandSparkles,
		X
	} from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';
	import { api } from '$lib/client/api';
	import { bytes, duration, plural } from '$lib/client/format';
	import { artUrl, library, toPlayerTrack } from '$lib/client/library.svelte';
	import { live } from '$lib/client/live.svelte';
	import { player } from '$lib/client/player.svelte';
	import type { LibraryRow } from '$lib/library-columns';
	import {
		filterRows,
		haystack,
		ISSUE_LABELS,
		sortRows,
		type Issue,
		type LibraryFilter,
		type Quality,
		type SortKey,
		type SortSpec
	} from '$lib/library-filter';
	import Artwork from '$lib/components/Artwork.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import AutoTagDialog from '$lib/components/library/AutoTagDialog.svelte';
	import TrackDetail from '$lib/components/library/TrackDetail.svelte';
	import VirtualList from '$lib/components/VirtualList.svelte';

	let view = $state<'tracks' | 'albums'>('tracks');
	let filter = $state<LibraryFilter>({
		q: '',
		formats: [],
		quality: 'all',
		issues: [],
		artist: null,
		album: null
	});
	let sort = $state<SortSpec[]>([
		{ key: 'artist', dir: 1 },
		{ key: 'album', dir: 1 }
	]);
	let showFilters = $state(false);
	let artistQuery = $state('');
	let selected = $state(new Set<string>());
	let lastClicked = -1;
	let detailId = $state<string | null>(null);
	let autoTagIds = $state<string[] | null>(null);

	onMount(() => {
		library.load();
		// Refresh once a scan finishes
		let wasScanning = live.library?.scanning ?? false;
		return live.subscribe((event, data) => {
			if (event !== 'library') return;
			const scanning = (data as { scanning: boolean }).scanning;
			if (wasScanning && !scanning) library.load(true);
			wasScanning = scanning;
		});
	});

	// Search haystacks are built once per load, not per keystroke
	const hay = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of library.rows) m.set(r.id, haystack(r));
		return m;
	});
	const filtered = $derived(filterRows(library.rows, filter, (r) => hay.get(r.id) ?? ''));
	const rows = $derived(sortRows(filtered, sort));
	const totals = $derived({
		size: filtered.reduce((n, r) => n + r.size, 0),
		ms: filtered.reduce((n, r) => n + (r.durationMs ?? 0), 0)
	});
	const formats = $derived(
		[...new Set(library.rows.map((r) => r.format ?? ''))].filter(Boolean).sort()
	);

	const artists = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const r of library.rows) {
			const a = r.albumArtist ?? r.artist ?? 'Unknown';
			counts.set(a, (counts.get(a) ?? 0) + 1);
		}
		const q = artistQuery.toLowerCase();
		return [...counts.entries()]
			.filter(([a]) => !q || a.toLowerCase().includes(q))
			.sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
	});

	const albums = $derived.by(() => {
		const map = new Map<
			string,
			{
				key: string;
				album: string;
				artist: string;
				year: number | null;
				tracks: LibraryRow[];
				cover: LibraryRow | null;
			}
		>();
		for (const r of rows) {
			const album = r.album ?? '(no album)';
			const artist = r.albumArtist ?? r.artist ?? 'Unknown';
			const key = `${artist}\u0000${album}`;
			let a = map.get(key);
			if (!a) map.set(key, (a = { key, album, artist, year: r.year, tracks: [], cover: null }));
			a.tracks.push(r);
			if (!a.cover && r.hasArtwork) a.cover = r;
		}
		return [...map.values()];
	});

	const activeFilterCount = $derived(
		filter.formats.length + filter.issues.length + (filter.quality !== 'all' ? 1 : 0)
	);

	// `head` repeats the responsive visibility with flex, spelled out so Tailwind can see the classes.
	const COLUMNS: { key: SortKey; label: string; head: string }[] = [
		{ key: 'title', label: 'Title', head: 'flex flex-[3] min-w-0' },
		{ key: 'artist', label: 'Artist', head: 'hidden md:flex flex-[2] min-w-0' },
		{ key: 'album', label: 'Album', head: 'hidden lg:flex flex-[2] min-w-0' },
		{ key: 'year', label: 'Year', head: 'hidden xl:flex w-12' },
		{ key: 'genre', label: 'Genre', head: 'hidden 2xl:flex w-24' },
		{ key: 'durationMs', label: 'Time', head: 'flex w-12 justify-end' },
		{ key: 'format', label: 'Format', head: 'hidden sm:flex w-24' },
		{ key: 'size', label: 'Size', head: 'hidden xl:flex w-16 justify-end' }
	];

	function toggleSort(key: SortKey, add: boolean) {
		const existing = sort.find((s) => s.key === key);
		if (add) {
			sort = existing
				? sort.map((s) => (s.key === key ? { ...s, dir: (s.dir * -1) as 1 | -1 } : s))
				: [...sort, { key, dir: 1 }];
		} else {
			sort = [{ key, dir: existing && sort[0].key === key ? ((existing.dir * -1) as 1 | -1) : 1 }];
		}
	}

	function toggleIn<T>(list: T[], v: T): T[] {
		return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
	}

	function clickRow(e: MouseEvent, r: LibraryRow, i: number) {
		if (e.shiftKey && lastClicked >= 0) {
			const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
			selected = new Set([...selected, ...rows.slice(a, b + 1).map((x) => x.id)]);
		} else if (e.metaKey || e.ctrlKey) {
			const next = new Set(selected);
			if (next.has(r.id)) next.delete(r.id);
			else next.add(r.id);
			selected = next;
		} else {
			selected = new Set([r.id]);
		}
		lastClicked = i;
	}

	const playFrom = (i: number) => player.playList(rows.map(toPlayerTrack), i);
	const selectedRows = () => rows.filter((r) => selected.has(r.id));

	function openInStudio(ids: string[]) {
		sessionStorage.setItem('calliope:studio-ids', JSON.stringify(ids));
		goto('/studio');
	}

	const scanning = $derived(live.library?.scanning ?? false);
	async function scan(full = false) {
		await api.post('/api/library/scan', { full });
	}

	function formatLabel(r: LibraryRow) {
		const f = (r.format ?? '?').toUpperCase();
		if (r.lossless)
			return `${f} ${r.bitsPerSample ? `${r.bitsPerSample}/` : ''}${r.sampleRate ? Math.round(r.sampleRate / 100) / 10 : ''}`;
		return `${f} ${r.bitrate ?? ''}`;
	}

	// Keep the selection tidy when filters hide rows
	$effect(() => {
		const visible = new Set(rows.map((r) => r.id));
		untrack(() => {
			if ([...selected].some((id) => !visible.has(id)))
				selected = new Set([...selected].filter((id) => visible.has(id)));
		});
	});
</script>

<svelte:head><title>Library · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Library Explorer</h1>
		<p class="mt-1 text-sm text-ink-400">
			{#if library.loaded}
				{plural(filtered.length, 'track')}{filtered.length !== library.rows.length
					? ` of ${library.rows.length.toLocaleString()}`
					: ''} · {bytes(totals.size)} ·
				{Math.round(totals.ms / 3_600_000).toLocaleString()} hours
			{:else}Loading index…{/if}
		</p>
	</div>
	<div class="flex items-center gap-2">
		{#if scanning && live.library}
			<div
				class="flex items-center gap-2 rounded-lg border border-amber/20 bg-amber/5 px-3 py-1.5 text-xs text-amber-glow"
			>
				<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
				<span class="capitalize">{live.library.phase}</span>
				{#if live.library.total}<span class="font-mono"
						>{live.library.processed.toLocaleString()}/{live.library.total.toLocaleString()}</span
					>{/if}
			</div>
		{/if}
		<button
			class="btn"
			onclick={() => scan(false)}
			disabled={scanning}
			title="Index new and changed files"
		>
			<RefreshCw class="h-3.5 w-3.5 {scanning ? 'animate-spin' : ''}" /> Scan
		</button>
		<button
			class="btn btn-ghost"
			onclick={() => scan(true)}
			disabled={scanning}
			title="Re-read every file">Full rescan</button
		>
	</div>
</header>

<div class="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
	<!-- Artist facet -->
	<aside
		class="glass hidden h-[calc(100dvh-170px)] flex-col overflow-hidden xl:sticky xl:top-3 xl:flex"
	>
		<div class="border-b border-white/5 p-2">
			<input class="input !h-8 !text-xs" placeholder="Artists" bind:value={artistQuery} />
		</div>
		<div class="flex-1 overflow-y-auto p-1 text-[12.5px]">
			<button
				class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition {!filter.artist
					? 'bg-white/[0.07] text-ink-50'
					: 'text-ink-300 hover:bg-white/[0.04]'}"
				onclick={() => (filter.artist = null)}
			>
				All artists <span class="font-mono text-[10px] text-ink-500">{library.rows.length}</span>
			</button>
			{#each artists as [name, count] (name)}
				<button
					class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition {filter.artist ===
					name
						? 'bg-amber/10 text-amber-glow'
						: 'text-ink-300 hover:bg-white/[0.04] hover:text-ink-100'}"
					onclick={() => {
						filter.artist = filter.artist === name ? null : name;
						filter.album = null;
					}}
				>
					<span class="truncate">{name}</span><span class="font-mono text-[10px] text-ink-500"
						>{count}</span
					>
				</button>
			{/each}
		</div>
	</aside>

	<div class="min-w-0">
		<!-- Toolbar -->
		<div class="glass mb-3 flex flex-wrap items-center gap-2 p-2">
			<div class="relative min-w-[200px] flex-1">
				<Search class="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-ink-400" />
				<input
					class="input !h-8 pl-9"
					placeholder="Search title, artist, album, genre, path…"
					bind:value={filter.q}
				/>
			</div>
			{#if filter.artist || filter.album}
				<button
					class="chip h-7 cursor-pointer border-amber/30 bg-amber/10 px-2 text-amber-glow normal-case"
					onclick={() => ((filter.artist = null), (filter.album = null))}
				>
					{filter.album ?? filter.artist}
					<X class="h-3 w-3" />
				</button>
			{/if}
			<button
				class="btn btn-sm {showFilters || activeFilterCount
					? '!border-violet/40 !text-violet-glow'
					: ''}"
				onclick={() => (showFilters = !showFilters)}
			>
				<SlidersHorizontal class="h-3 w-3" /> Filters{activeFilterCount
					? ` · ${activeFilterCount}`
					: ''}
			</button>
			<div class="flex rounded-lg border border-white/8 bg-ink-900/60 p-0.5">
				<button
					class="rounded-md px-2 py-1 {view === 'tracks'
						? 'bg-white/10 text-ink-50'
						: 'text-ink-400'}"
					onclick={() => (view = 'tracks')}
					aria-label="Track list"><Rows3 class="h-3.5 w-3.5" /></button
				>
				<button
					class="rounded-md px-2 py-1 {view === 'albums'
						? 'bg-white/10 text-ink-50'
						: 'text-ink-400'}"
					onclick={() => (view = 'albums')}
					aria-label="Album grid"><LayoutGrid class="h-3.5 w-3.5" /></button
				>
			</div>
			<button class="btn btn-sm btn-primary" disabled={!rows.length} onclick={() => playFrom(0)}
				><Play class="h-3 w-3" fill="currentColor" /> Play all</button
			>

			{#if showFilters}
				<div
					class="flex w-full flex-wrap gap-x-6 gap-y-3 border-t border-white/5 px-1 pt-3 pb-1 text-xs"
				>
					<div>
						<div class="panel-title mb-1.5 !text-[10px]">Format</div>
						<div class="flex flex-wrap gap-1">
							{#each formats as f (f)}
								<button
									class="rounded-full border px-2.5 py-0.5 uppercase transition {filter.formats.includes(
										f
									)
										? 'border-amber/40 bg-amber/10 text-amber-glow'
										: 'border-white/8 text-ink-300'}"
									onclick={() => (filter.formats = toggleIn(filter.formats, f))}>{f}</button
								>
							{/each}
						</div>
					</div>
					<div>
						<div class="panel-title mb-1.5 !text-[10px]">Quality</div>
						<div class="flex gap-1">
							{#each [['all', 'Any'], ['lossless', 'Lossless'], ['high', '≥256k / lossless'], ['low', '<192k']] as [q, label] (q)}
								<button
									class="rounded-full border px-2.5 py-0.5 transition {filter.quality === q
										? 'border-amber/40 bg-amber/10 text-amber-glow'
										: 'border-white/8 text-ink-300'}"
									onclick={() => (filter.quality = q as Quality)}>{label}</button
								>
							{/each}
						</div>
					</div>
					<div>
						<div class="panel-title mb-1.5 !text-[10px]">Missing</div>
						<div class="flex flex-wrap gap-1">
							{#each Object.entries(ISSUE_LABELS) as [issue, label] (issue)}
								<button
									class="rounded-full border px-2.5 py-0.5 transition {filter.issues.includes(
										issue as Issue
									)
										? 'border-violet/50 bg-violet/15 text-violet-glow'
										: 'border-white/8 text-ink-300'}"
									onclick={() => (filter.issues = toggleIn(filter.issues, issue as Issue))}
									>{label}</button
								>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		</div>

		{#if !library.loaded}
			<div class="glass space-y-2 p-4">
				{#each Array(10) as _, i (i)}<div class="skeleton h-8"></div>{/each}
			</div>
		{:else if !library.rows.length}
			<div class="glass">
				<EmptyState icon={Library} title="Library is empty">
					Nothing indexed yet. Run a scan to pick up files in your library folder, or download
					something from the Pipeline.
				</EmptyState>
			</div>
		{:else if view === 'tracks'}
			<div class="glass overflow-hidden">
				<div
					class="flex items-center gap-3 border-b border-white/5 px-3 py-2 text-[11px] tracking-wider text-ink-400 uppercase select-none"
				>
					<span class="w-8"></span>
					{#each COLUMNS as c (c.key)}
						{@const idx = sort.findIndex((s) => s.key === c.key)}
						<button
							class="{c.head} items-center gap-1 truncate text-left hover:text-ink-100"
							onclick={(e) => toggleSort(c.key, e.shiftKey)}
							title="Click to sort · Shift-click to add a secondary sort"
						>
							{c.label}
							{#if idx >= 0}
								{#if sort[idx].dir === 1}<ArrowUp class="h-3 w-3 text-amber" />{:else}<ArrowDown
										class="h-3 w-3 text-amber"
									/>{/if}
								{#if sort.length > 1}<sup class="text-[9px] text-amber">{idx + 1}</sup>{/if}
							{/if}
						</button>
					{/each}
					<span class="w-7"></span>
				</div>
				<VirtualList items={rows} rowHeight={44} class="h-[calc(100dvh-280px)] min-h-[320px]">
					{#snippet row(r, i)}
						{@const playing = player.current?.id === r.id}
						<div
							role="row"
							tabindex="-1"
							class="group flex h-11 cursor-default items-center gap-3 border-b border-white/[0.03] px-3 text-[13px] transition-colors select-none
								{selected.has(r.id) ? 'bg-amber/[0.07]' : 'hover:bg-white/[0.025]'}"
							onclick={(e) => clickRow(e, r, i)}
							ondblclick={() => playFrom(i)}
							onkeydown={(e) => e.key === 'Enter' && playFrom(i)}
						>
							<div class="relative w-8 shrink-0">
								<Artwork src={artUrl(r)} title={r.album ?? r.title} size={30} rounded="rounded" />
								<button
									class="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 transition group-hover:opacity-100 {playing
										? '!opacity-100'
										: ''}"
									onclick={(e) => {
										e.stopPropagation();
										if (playing) player.toggle();
										else playFrom(i);
									}}
									aria-label="Play"
								>
									{#if playing && player.playing}<span class="flex h-3 items-end gap-[2px]"
											>{#each [0, 1, 2] as b (b)}<span
													class="w-[3px] animate-pulse-soft bg-amber"
													style="height:{6 + b * 3}px;animation-delay:{b * 0.2}s"
												></span>{/each}</span
										>
									{:else}<Play class="h-3.5 w-3.5 text-white" fill="currentColor" />{/if}
								</button>
							</div>
							<div class="min-w-0 flex-[3]">
								<div class="truncate {playing ? 'text-amber-glow' : 'text-ink-100'}">
									{r.title ?? '—'}
								</div>
								<div class="truncate text-[11px] text-ink-400 md:hidden">{r.artist}</div>
							</div>
							<div class="hidden min-w-0 flex-[2] truncate text-ink-300 md:block">
								{r.artist ?? '—'}
							</div>
							<div class="hidden min-w-0 flex-[2] truncate text-ink-300 lg:block">
								{r.album ?? '—'}
							</div>
							<div class="hidden w-12 font-mono text-[11px] text-ink-400 xl:block">
								{r.year ?? ''}
							</div>
							<div class="hidden w-24 truncate text-[12px] text-ink-400 2xl:block">
								{r.genre ?? ''}
							</div>
							<div class="w-12 text-right font-mono text-[11px] text-ink-400">
								{duration(r.durationMs)}
							</div>
							<div class="hidden w-24 sm:block">
								<span
									class="chip {r.lossless
										? 'border-violet/30 bg-violet/10 text-violet-glow'
										: (r.bitrate ?? 0) < 192
											? 'border-warn/30 bg-warn/5 text-warn'
											: 'border-white/8 text-ink-300'}">{formatLabel(r)}</span
								>
							</div>
							<div class="hidden w-16 text-right font-mono text-[11px] text-ink-500 xl:block">
								{bytes(r.size)}
							</div>
							<button
								class="btn btn-ghost btn-icon btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100"
								title="Details"
								onclick={(e) => {
									e.stopPropagation();
									detailId = r.id;
								}}><Info class="h-3.5 w-3.5" /></button
							>
						</div>
					{/snippet}
				</VirtualList>
			</div>
		{:else}
			<div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 pb-6">
				{#each albums as a (a.key)}
					<div class="group [contain-intrinsic-size:220px] [content-visibility:auto]">
						<button
							class="relative block w-full"
							onclick={() => (
								(filter.artist = a.artist),
								(filter.album = a.album),
								(view = 'tracks')
							)}
						>
							<div
								class="aspect-square overflow-hidden rounded-xl border border-white/8 bg-ink-800 shadow-lg transition group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)]"
							>
								{#if a.cover}
									<img
										src={artUrl(a.cover)}
										alt=""
										loading="lazy"
										class="h-full w-full object-cover"
									/>
								{:else}
									<div
										class="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-700 to-ink-850"
									>
										<Disc3 class="h-10 w-10 text-ink-500" />
									</div>
								{/if}
							</div>
							<span
								role="button"
								tabindex="-1"
								class="absolute right-2 bottom-2 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-amber text-ink-950 opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100"
								onclick={(e) => {
									e.stopPropagation();
									player.playList(
										sortRows(a.tracks, [{ key: 'album', dir: 1 }]).map(toPlayerTrack)
									);
								}}
								onkeydown={() => {}}
							>
								<Play class="ml-0.5 h-4 w-4" fill="currentColor" />
							</span>
						</button>
						<div class="mt-2 truncate text-[13px] font-medium text-ink-100">{a.album}</div>
						<div class="truncate text-xs text-ink-400">
							{a.artist}{a.year ? ` · ${a.year}` : ''} · {a.tracks.length}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if selected.size > 1}
	<div class="fixed right-0 bottom-24 left-0 z-40 flex justify-center px-4 lg:left-64">
		<div class="glass flex animate-rise items-center gap-2 !bg-ink-850/95 py-2 pr-2 pl-4 text-xs">
			<span class="mr-1 text-amber-glow">{selected.size} selected</span>
			<button
				class="btn btn-sm btn-primary"
				onclick={() => player.playList(selectedRows().map(toPlayerTrack))}
				><Play class="h-3 w-3" /> Play</button
			>
			<button class="btn btn-sm" onclick={() => player.enqueue(selectedRows().map(toPlayerTrack))}
				><ListPlus class="h-3 w-3" /> Add to queue</button
			>
			<button class="btn btn-sm btn-violet" onclick={() => openInStudio([...selected])}
				><WandSparkles class="h-3 w-3" /> Edit tags</button
			>
			<button class="btn btn-sm btn-violet" onclick={() => (autoTagIds = [...selected])}
				><Sparkles class="h-3 w-3" /> Auto-tag</button
			>
			<button class="btn btn-sm btn-ghost" onclick={() => (selected = new Set())}>Clear</button>
		</div>
	</div>
{/if}

{#if detailId}
	<TrackDetail
		id={detailId}
		onclose={() => (detailId = null)}
		onstudio={(id) => openInStudio([id])}
		onautotag={(id) => (autoTagIds = [id])}
	/>
{/if}

{#if autoTagIds}
	<AutoTagDialog ids={autoTagIds} onclose={() => (autoTagIds = null)} />
{/if}
