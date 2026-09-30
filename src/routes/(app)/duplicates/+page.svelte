<script lang="ts">
	import {
		AudioLines,
		Check,
		CircleCheck,
		Copy,
		Crown,
		Fingerprint,
		LoaderCircle,
		Play,
		RefreshCw,
		RotateCcw,
		ShieldAlert,
		Trash2,
		X
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { api } from '$lib/client/api';
	import { ago, bytes, duration } from '$lib/client/format';
	import { library } from '$lib/client/library.svelte';
	import { live } from '$lib/client/live.svelte';
	import { player } from '$lib/client/player.svelte';
	import { toasts } from '$lib/client/toasts.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	type Reason = 'exact' | 'metadata' | 'acoustic';
	interface DupFile {
		id: string;
		path: string;
		relPath: string;
		title: string | null;
		artist: string | null;
		album: string | null;
		albumArtist: string | null;
		year: number | null;
		trackNumber: number | null;
		genre: string | null;
		format: string | null;
		codec: string | null;
		lossless: boolean | null;
		bitrate: number | null;
		sampleRate: number | null;
		bitsPerSample: number | null;
		durationMs: number | null;
		size: number;
		hasArtwork: boolean;
		hasLyrics: boolean;
		mbRecordingId: string | null;
		addedAt: number;
		fromPipeline: boolean;
		quality: number;
		completeness: number;
	}
	interface Group {
		key: string;
		reasons: Reason[];
		similarity: number | null;
		keeperId: string;
		files: DupFile[];
	}
	interface QItem {
		id: number;
		from: string;
		to: string;
		at: number;
		title?: string;
		artist?: string;
		size?: number;
	}

	let tab = $state<'groups' | 'quarantine'>('groups');
	let groups = $state<Group[]>([]);
	let fp = $state({ total: 0, done: 0, running: false });
	let fpcalc = $state(true);
	let loading = $state(true);
	let threshold = $state(0.82);
	let reasonFilter = $state<Reason | 'all'>('all');
	let keepers = $state<Record<string, string>>({});
	let merge = $state(true);
	let busyKey = $state<string | null>(null);
	let quarantine = $state<QItem[]>([]);
	let purgeConfirm = $state('');
	let showPurge = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await api.get<{ groups: Group[]; fingerprints: typeof fp; fpcalc: boolean }>(
				`/api/duplicates?threshold=${threshold}`
			);
			groups = res.groups;
			fp = res.fingerprints;
			fpcalc = res.fpcalc;
			keepers = Object.fromEntries(res.groups.map((g) => [g.key, keepers[g.key] ?? g.keeperId]));
		} finally {
			loading = false;
		}
	}
	const loadQuarantine = async () =>
		(quarantine = await api.get<QItem[]>('/api/duplicates/quarantine'));

	onMount(() => {
		void load();
		void loadQuarantine();
		let was: string | undefined = live.library?.phase;
		return live.subscribe((event, data) => {
			if (event !== 'library') return;
			const phase = (data as { phase: string }).phase;
			if (was === 'analyzing' && phase !== 'analyzing') void load();
			was = phase;
		});
	});

	const shown = $derived(
		groups.filter((g) => reasonFilter === 'all' || g.reasons.includes(reasonFilter))
	);
	const counts = $derived({
		exact: groups.filter((g) => g.reasons.includes('exact')).length,
		acoustic: groups.filter((g) => g.reasons.includes('acoustic')).length,
		metadata: groups.filter((g) => g.reasons.includes('metadata')).length
	});
	const reclaimable = $derived(
		shown.reduce(
			(n, g) => n + g.files.filter((f) => f.id !== keepers[g.key]).reduce((m, f) => m + f.size, 0),
			0
		)
	);
	const fingerprinting = $derived(fp.running || live.library?.phase === 'analyzing');

	async function fingerprintAll() {
		fp = await api.post('/api/duplicates/fingerprint');
		toasts.push({
			level: 'info',
			title: 'Fingerprinting started',
			message: 'Progress shows in the sidebar; results refresh when done.'
		});
	}

	async function resolve(g: Group, mergeTags = merge) {
		const keepId = keepers[g.key];
		busyKey = g.key;
		try {
			const res = await api.post<{ removed: number }>('/api/duplicates/resolve', {
				keepId,
				removeIds: g.files.filter((f) => f.id !== keepId).map((f) => f.id),
				mergeTags
			});
			groups = groups.filter((x) => x.key !== g.key);
			toasts.push({
				level: 'success',
				title: `Moved ${res.removed} file${res.removed === 1 ? '' : 's'} to quarantine`,
				message: mergeTags
					? 'Missing tags, artwork and lyrics were merged into the keeper.'
					: undefined
			});
			void loadQuarantine();
			void library.load(true);
		} finally {
			busyKey = null;
		}
	}

	async function dismiss(g: Group) {
		await api.post('/api/duplicates/dismiss', { key: g.key });
		groups = groups.filter((x) => x.key !== g.key);
	}

	async function resolveAllExact() {
		const exact = groups.filter((g) => g.reasons.includes('exact'));
		if (
			!confirm(
				`Resolve ${exact.length} exact-duplicate groups? Each keeps its best copy (tags merged) and moves the rest to quarantine, where they can be restored.`
			)
		)
			return;
		for (const g of exact) await resolve(g, true);
	}

	async function restore(item: QItem) {
		await api.post('/api/duplicates/quarantine/restore', { id: item.id });
		quarantine = quarantine.filter((q) => q.id !== item.id);
		toasts.push({ level: 'success', title: 'Restored', message: item.from });
		void load();
	}

	async function purge() {
		const res = await api.post<{ deleted: number }>('/api/duplicates/quarantine/purge', {
			ids: quarantine.map((q) => q.id),
			confirm: purgeConfirm
		});
		toasts.push({
			level: 'success',
			title: `Permanently deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`
		});
		showPurge = false;
		purgeConfirm = '';
		void loadQuarantine();
	}

	// ---- comparison matrix helpers ----
	type Row = {
		label: string;
		value: (f: DupFile) => string;
		best?: (f: DupFile, all: DupFile[]) => boolean;
		diff?: boolean;
	};
	const fmtQuality = (f: DupFile) =>
		f.lossless
			? `${(f.format ?? '').toUpperCase()} ${f.bitsPerSample ?? '?'}-bit / ${f.sampleRate ? f.sampleRate / 1000 : '?'} kHz`
			: `${(f.format ?? '').toUpperCase()} ${f.bitrate ?? '?'} kbps`;
	const max = (all: DupFile[], k: (f: DupFile) => number) => Math.max(...all.map(k));
	const ROWS: Row[] = [
		{
			label: 'Quality',
			value: fmtQuality,
			best: (f, all) =>
				f.quality === max(all, (x) => x.quality) && new Set(all.map((x) => x.quality)).size > 1
		},
		{
			label: 'Sample rate',
			value: (f) => (f.sampleRate ? `${(f.sampleRate / 1000).toFixed(1)} kHz` : '—')
		},
		{ label: 'Size', value: (f) => bytes(f.size) },
		{ label: 'Duration', value: (f) => duration(f.durationMs), diff: true },
		{ label: 'Title', value: (f) => f.title ?? '—', diff: true },
		{ label: 'Artist', value: (f) => f.artist ?? '—', diff: true },
		{ label: 'Album', value: (f) => f.album ?? '—', diff: true },
		{ label: 'Year', value: (f) => String(f.year ?? '—'), diff: true },
		{ label: 'Track', value: (f) => String(f.trackNumber ?? '—'), diff: true },
		{ label: 'Genre', value: (f) => f.genre ?? '—', diff: true },
		{
			label: 'Artwork',
			value: (f) => (f.hasArtwork ? 'Yes' : 'No'),
			best: (f, all) => f.hasArtwork && all.some((x) => !x.hasArtwork)
		},
		{
			label: 'Lyrics',
			value: (f) => (f.hasLyrics ? 'Yes' : 'No'),
			best: (f, all) => f.hasLyrics && all.some((x) => !x.hasLyrics)
		},
		{
			label: 'Tag completeness',
			value: (f) => `${f.completeness}/11`,
			best: (f, all) =>
				f.completeness === max(all, (x) => x.completeness) &&
				new Set(all.map((x) => x.completeness)).size > 1
		},
		{ label: 'Added', value: (f) => `${ago(f.addedAt)}${f.fromPipeline ? ' · downloaded' : ''}` }
	];
	const differs = (row: Row, files: DupFile[]) =>
		row.diff && new Set(files.map(row.value)).size > 1;

	const REASON_META: Record<Reason, { label: string; cls: string }> = {
		exact: { label: 'Identical audio', cls: 'border-bad/40 bg-bad/10 text-bad' },
		acoustic: { label: 'Acoustic match', cls: 'border-violet/40 bg-violet/10 text-violet-glow' },
		metadata: { label: 'Same tags', cls: 'border-warn/30 bg-warn/10 text-warn' }
	};
	const asTrack = (f: DupFile) => ({
		id: f.id,
		title: f.title,
		artist: f.artist,
		album: f.album,
		durationMs: f.durationMs,
		hasArtwork: f.hasArtwork
	});
</script>

<svelte:head><title>Duplicates · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Duplicate Inspector</h1>
		<p class="mt-1 text-sm text-ink-400">
			{#if loading}Scanning index…{:else}{groups.length} group{groups.length === 1 ? '' : 's'} · {bytes(
					reclaimable
				)} reclaimable{/if}
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="btn"
			onclick={fingerprintAll}
			disabled={!fpcalc || fingerprinting || fp.done >= fp.total}
			title={fpcalc
				? 'Compute acoustic fingerprints for files that lack one'
				: 'Install Chromaprint (fpcalc) to enable acoustic matching'}
		>
			{#if fingerprinting}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Fingerprint
					class="h-3.5 w-3.5"
				/>{/if}
			Fingerprints {fp.done.toLocaleString()}/{fp.total.toLocaleString()}
		</button>
		<button class="btn" onclick={load} disabled={loading}
			><RefreshCw class="h-3.5 w-3.5 {loading ? 'animate-spin' : ''}" /> Rescan</button
		>
	</div>
</header>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<div class="flex rounded-lg border border-white/8 bg-ink-900/60 p-0.5 text-xs">
		<button
			class="rounded-md px-3 py-1.5 {tab === 'groups' ? 'bg-white/10 text-ink-50' : 'text-ink-400'}"
			onclick={() => (tab = 'groups')}>Groups · {groups.length}</button
		>
		<button
			class="rounded-md px-3 py-1.5 {tab === 'quarantine'
				? 'bg-white/10 text-ink-50'
				: 'text-ink-400'}"
			onclick={() => (tab = 'quarantine')}>Quarantine · {quarantine.length}</button
		>
	</div>
	{#if tab === 'groups'}
		<div class="flex flex-wrap gap-1 text-xs">
			{#each [['all', `All ${groups.length}`], ['exact', `Identical ${counts.exact}`], ['acoustic', `Acoustic ${counts.acoustic}`], ['metadata', `Same tags ${counts.metadata}`]] as [k, label] (k)}
				<button
					class="rounded-full border px-2.5 py-1 transition {reasonFilter === k
						? 'border-amber/40 bg-amber/10 text-amber-glow'
						: 'border-white/8 text-ink-300'}"
					onclick={() => (reasonFilter = k as Reason | 'all')}>{label}</button
				>
			{/each}
		</div>
		<label
			class="ml-auto flex items-center gap-2 text-xs text-ink-300"
			title="Minimum fingerprint similarity for an acoustic match"
		>
			<AudioLines class="h-3.5 w-3.5" /> Acoustic ≥
			<input
				type="range"
				min="0.7"
				max="0.98"
				step="0.02"
				bind:value={threshold}
				onchange={load}
				class="w-24 accent-violet"
			/>
			<span class="w-8 font-mono">{Math.round(threshold * 100)}%</span>
		</label>
		<label class="flex items-center gap-1.5 text-xs text-ink-300"
			><input type="checkbox" class="accent-amber" bind:checked={merge} /> Merge tags into keeper</label
		>
		{#if counts.exact > 1}<button class="btn btn-sm" onclick={resolveAllExact}
				><Check class="h-3 w-3" /> Resolve all identical</button
			>{/if}
	{/if}
</div>

{#if !fpcalc && tab === 'groups'}
	<div class="glass mb-4 flex items-start gap-3 p-3 text-xs text-ink-300">
		<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-warn" />
		<div>
			Acoustic matching is off because Chromaprint's <span class="font-mono">fpcalc</span> isn't
			installed. Identical-audio and same-tag detection still work. The Docker image includes it;
			locally install <span class="font-mono">chromaprint</span> or set its path in
			<a href="/settings/binaries" class="text-amber-glow hover:underline">Settings › Binaries</a>.
		</div>
	</div>
{/if}

{#if tab === 'groups'}
	{#if loading && !groups.length}
		<div class="space-y-3">
			{#each Array(3) as _, i (i)}<div class="glass skeleton h-48"></div>{/each}
		</div>
	{:else if !shown.length}
		<div class="glass">
			<EmptyState icon={CircleCheck} title="No duplicates found"
				>Nothing in your library looks duplicated{reasonFilter !== 'all'
					? ' for this filter'
					: ''}.</EmptyState
			>
		</div>
	{:else}
		<div class="space-y-4">
			{#each shown as g (g.key)}
				{@const keepId = keepers[g.key]}
				<section class="glass animate-rise overflow-hidden">
					<div class="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3">
						<Copy class="h-4 w-4 text-ink-400" />
						<span class="text-[14px] font-medium text-ink-50"
							>{g.files[0].artist ?? 'Unknown'} — {g.files[0].title ?? 'Untitled'}</span
						>
						{#each g.reasons as r (r)}<span class="chip {REASON_META[r].cls}"
								>{REASON_META[r].label}{r === 'acoustic' && g.similarity
									? ` ${Math.round(g.similarity * 100)}%`
									: ''}</span
							>{/each}
						<div class="ml-auto flex gap-2">
							<button class="btn btn-ghost btn-sm" onclick={() => dismiss(g)}
								><X class="h-3 w-3" /> Not duplicates</button
							>
							<button
								class="btn btn-primary btn-sm"
								onclick={() => resolve(g)}
								disabled={busyKey === g.key}
							>
								{#if busyKey === g.key}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<Trash2
										class="h-3 w-3"
									/>{/if}
								Keep 1, quarantine {g.files.length - 1}
							</button>
						</div>
					</div>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-[12.5px]">
							<thead>
								<tr>
									<th class="w-36"></th>
									{#each g.files as f (f.id)}
										<th class="p-2 text-left align-top font-normal">
											<button
												class="w-full rounded-lg border p-2.5 text-left transition {keepId === f.id
													? 'border-amber/50 bg-amber/10 shadow-[0_0_24px_-10px_rgb(245_165_36/0.8)]'
													: 'border-white/6 bg-white/[0.02] hover:border-white/15'}"
												onclick={() => (keepers[g.key] = f.id)}
											>
												<div class="flex items-center justify-between gap-2">
													{#if keepId === f.id}
														<span class="chip border-amber/50 bg-amber/20 text-amber-glow"
															><Crown class="h-3 w-3" /> Keep</span
														>
													{:else}
														<span class="chip border-bad/30 bg-bad/5 text-bad/90">Quarantine</span>
													{/if}
													<span
														role="button"
														tabindex="0"
														class="btn btn-ghost btn-icon btn-sm"
														title="Preview"
														onclick={(e) => {
															e.stopPropagation();
															player.playList([asTrack(f)]);
														}}
														onkeydown={() => {}}><Play class="h-3 w-3" fill="currentColor" /></span
													>
												</div>
												<div
													class="mt-2 font-mono text-[10.5px] leading-snug break-all text-ink-300"
													title={f.path}
												>
													{f.relPath}
												</div>
											</button>
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each ROWS as row (row.label)}
									{@const mismatch = differs(row, g.files)}
									<tr class="border-t border-white/[0.04]">
										<td class="px-4 py-1.5 text-[11px] tracking-wide text-ink-400 uppercase"
											>{row.label}</td
										>
										{#each g.files as f (f.id)}
											{@const best = row.best?.(f, g.files)}
											<td
												class="px-4 py-1.5 {best
													? 'font-medium text-ok'
													: mismatch
														? 'text-warn'
														: 'text-ink-200'}"
											>
												{row.value(f)}{#if best}<Check class="ml-1 inline h-3 w-3" />{/if}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/each}
		</div>
	{/if}
{:else}
	<section class="glass overflow-hidden">
		<div class="flex items-center justify-between border-b border-white/5 px-4 py-3">
			<p class="text-xs text-ink-400">
				Removed duplicates wait here. Restore puts a file back where it was.
			</p>
			<button
				class="btn btn-danger btn-sm"
				disabled={!quarantine.length}
				onclick={() => (showPurge = true)}><Trash2 class="h-3 w-3" /> Delete permanently…</button
			>
		</div>
		{#each quarantine as q (q.id)}
			<div class="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-[13px]">
				<div class="min-w-0 flex-1">
					<div class="truncate text-ink-100">{q.artist ?? '?'} — {q.title ?? '?'}</div>
					<div class="truncate font-mono text-[10.5px] text-ink-500" title={q.to}>{q.from}</div>
				</div>
				<span class="text-[11px] text-ink-500">{bytes(q.size)} · {ago(q.at)}</span>
				<button class="btn btn-sm" onclick={() => restore(q)}
					><RotateCcw class="h-3 w-3" /> Restore</button
				>
			</div>
		{:else}
			<EmptyState icon={CircleCheck} title="Quarantine is empty" />
		{/each}
	</section>
{/if}

{#if showPurge}
	<button
		class="fixed inset-0 z-50 cursor-default bg-black/60 backdrop-blur-sm"
		onclick={() => (showPurge = false)}
		aria-label="Close"
	></button>
	<div
		class="glass fixed top-1/3 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 !bg-ink-850 p-5"
	>
		<h2 class="text-[15px] font-semibold text-ink-50">
			Delete {quarantine.length} file{quarantine.length === 1 ? '' : 's'} permanently?
		</h2>
		<p class="mt-2 text-xs leading-relaxed text-ink-300">
			This cannot be undone. Type <span class="font-mono text-bad">DELETE</span> to confirm.
		</p>
		<input class="input mt-3 font-mono" bind:value={purgeConfirm} placeholder="DELETE" />
		<div class="mt-4 flex justify-end gap-2">
			<button class="btn" onclick={() => (showPurge = false)}>Cancel</button>
			<button class="btn btn-danger" disabled={purgeConfirm !== 'DELETE'} onclick={purge}
				>Delete forever</button
			>
		</div>
	</div>
{/if}
