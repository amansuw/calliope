<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import {
		ArrowLeft,
		EyeOff,
		ExternalLink,
		Eye,
		ListPlus,
		RefreshCw,
		Search,
		Trash2
	} from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { api } from '$lib/client/api';
	import { ago, duration } from '$lib/client/format';
	import { live } from '$lib/client/live.svelte';
	import { toasts } from '$lib/client/toasts.svelte';
	import { FORMAT_PRESETS, POLL_INTERVALS } from '$lib/formats';
	import { ACTIVE_STATUSES } from '$lib/status';
	import type { SourceItemDTO, TrackDTO } from '$lib/types';
	import Artwork from '$lib/components/Artwork.svelte';
	import ProviderBadge from '$lib/components/ProviderBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Switch from '$lib/components/Switch.svelte';

	let { data } = $props();

	let items = $state<SourceItemDTO[]>([]);
	$effect.pre(() => {
		items = data.items;
	});
	const source = $derived((browser && live.sources.get(data.source.id)) || data.source);

	type Filter = 'missing' | 'pipeline' | 'have' | 'ignored' | 'removed' | 'all';
	let filter = $state<Filter>('all');
	let query = $state('');
	let selected = $state(new Set<string>());

	const inPipeline = (s: SourceItemDTO['state']) =>
		s === 'queued' || ACTIVE_STATUSES.includes(s as never);
	const classify = (i: SourceItemDTO): Filter => {
		if (!i.present) return 'removed';
		if (i.ignored) return 'ignored';
		if (i.state === 'done' || i.state === 'library' || i.state === 'skipped') return 'have';
		if (inPipeline(i.state)) return 'pipeline';
		return 'missing';
	};
	const counts = $derived(
		items.reduce(
			(acc, i) => {
				acc[classify(i)]++;
				return acc;
			},
			{ missing: 0, pipeline: 0, have: 0, ignored: 0, removed: 0, all: items.length } as Record<
				Filter,
				number
			>
		)
	);
	const shown = $derived(
		items.filter((i) => {
			if (filter !== 'all' && classify(i) !== filter) return false;
			if (!query) return true;
			const q = query.toLowerCase();
			return (
				i.title.toLowerCase().includes(q) ||
				i.artist.toLowerCase().includes(q) ||
				(i.album ?? '').toLowerCase().includes(q)
			);
		})
	);
	const allSelected = $derived(shown.length > 0 && shown.every((i) => selected.has(i.externalId)));

	// Keep item states fresh as tracks move through the pipeline
	let timer: ReturnType<typeof setTimeout> | undefined;
	const refresh = () => {
		clearTimeout(timer);
		timer = setTimeout(
			async () =>
				(items = await api.get<SourceItemDTO[]>(`/api/sources/${data.source.id}/items`, {
					quiet: true
				})),
			700
		);
	};
	const off = live.subscribe((event, payload) => {
		if (event === 'source' && (payload as { id: string }).id === data.source.id) refresh();
		if (event === 'track' && (payload as TrackDTO).sourceId === data.source.id) refresh();
	});
	onDestroy(() => {
		off();
		clearTimeout(timer);
	});

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function act(action: 'queue' | 'ignore' | 'unignore' | 'queueMissing') {
		const ids = [...selected];
		const res = await api.post<{ queued?: number }>(`/api/sources/${data.source.id}/items`, {
			action,
			ids
		});
		if (res.queued !== undefined)
			toasts.push({
				level: 'success',
				title: `Queued ${res.queued} track${res.queued === 1 ? '' : 's'}`
			});
		selected = new Set();
		refresh();
	}

	const patch = (body: object) => api.patch(`/api/sources/${data.source.id}`, body);

	async function remove() {
		if (!confirm(`Stop monitoring "${source.name}"? Downloaded files are kept.`)) return;
		await api.del(`/api/sources/${data.source.id}`);
		goto('/sources');
	}
</script>

<svelte:head><title>{source.name} · Calliope</title></svelte:head>

<div class="pt-6">
	<a href="/sources" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200"
		><ArrowLeft class="h-3 w-3" /> Sources</a
	>
</div>

<header class="glass mt-3 flex flex-col gap-5 p-5 md:flex-row">
	<Artwork
		src={source.artworkUrl}
		title={source.name}
		size={128}
		rounded="rounded-xl"
		class="shadow-2xl"
	/>
	<div class="min-w-0 flex-1">
		<ProviderBadge provider={source.provider} kind={source.kind} />
		<h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink-50">{source.name}</h1>
		<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
			{#if source.owner}<span>{source.owner}</span>{/if}
			<span>{source.itemCount} tracks</span>
			<span>checked {ago(source.lastCheckedAt)}</span>
			{#if source.enabled && source.nextCheckAt}<span>next {ago(source.nextCheckAt)}</span>{/if}
			<a
				href={source.url}
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-1 hover:text-ink-200"
				><ExternalLink class="h-3 w-3" /> Open</a
			>
		</div>
		{#if source.lastError}<p class="mt-2 text-xs text-bad">{source.lastError}</p>{/if}
		{#if source.truncated}
			<p class="mt-2 text-xs text-warn/90">
				{source.provider === 'spotify'
					? "Only the first 100 tracks could be read on the last check — Spotify's full listing was unavailable. The next check tries again."
					: 'Only the most recent uploads are tracked for channels.'}
			</p>
		{/if}

		<div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-ink-300">
			<label class="flex items-center gap-2">
				<Switch
					checked={source.enabled}
					label="Enabled"
					onchange={(enabled) => patch({ enabled })}
				/> Enabled
			</label>
			<label class="flex items-center gap-2">
				<Switch
					checked={source.autoQueue}
					label="Auto-queue"
					onchange={(autoQueue) => patch({ autoQueue })}
				/> Auto-queue new tracks
			</label>
			<label class="flex items-center gap-2">
				Check
				<select
					class="input !h-7 !w-auto !py-0 !text-xs"
					value={source.intervalMinutes}
					onchange={(e) => patch({ intervalMinutes: Number(e.currentTarget.value) })}
				>
					{#each POLL_INTERVALS as p (p.minutes)}<option value={p.minutes}>{p.label}</option>{/each}
				</select>
			</label>
			<label class="flex items-center gap-2">
				Format
				<select
					class="input !h-7 !w-auto !py-0 !text-xs"
					value={source.formatPreset ?? ''}
					onchange={(e) => patch({ formatPreset: e.currentTarget.value || null })}
				>
					<option value="">Default</option>
					{#each Object.entries(FORMAT_PRESETS) as [id, p] (id)}<option value={id}>{p.label}</option
						>{/each}
				</select>
			</label>
		</div>
	</div>
	<div class="flex shrink-0 flex-row gap-2 md:flex-col">
		<button
			class="btn"
			disabled={source.syncing}
			onclick={() => api.post(`/api/sources/${source.id}/sync`)}
		>
			<RefreshCw class="h-3.5 w-3.5 {source.syncing ? 'animate-spin' : ''}" />
			{source.syncing ? 'Syncing…' : 'Sync now'}
		</button>
		<button class="btn btn-primary" disabled={!counts.missing} onclick={() => act('queueMissing')}>
			<ListPlus class="h-3.5 w-3.5" /> Queue {counts.missing} missing
		</button>
		<button class="btn btn-ghost hover:!text-bad" onclick={remove}
			><Trash2 class="h-3.5 w-3.5" /> Remove</button
		>
	</div>
</header>

<section class="glass mt-4 overflow-hidden">
	<div class="flex flex-wrap items-center gap-2 border-b border-white/5 p-3">
		<div class="flex flex-wrap gap-1 text-xs">
			{#each [['all', 'All'], ['missing', 'New'], ['pipeline', 'In pipeline'], ['have', 'Have'], ['ignored', 'Ignored'], ['removed', 'Removed from source']] as [key, label] (key)}
				{#if key === 'all' || counts[key as Filter]}
					<button
						class="rounded-full border px-2.5 py-1 transition {filter === key
							? 'border-amber/40 bg-amber/10 text-amber-glow'
							: 'border-white/8 text-ink-300 hover:text-ink-100'}"
						onclick={() => (filter = key as Filter)}
						>{label}
						<span class="ml-0.5 font-mono opacity-70">{counts[key as Filter]}</span></button
					>
				{/if}
			{/each}
		</div>
		<div class="relative ml-auto w-full sm:w-64">
			<Search class="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-ink-400" />
			<input class="input !h-8 pl-8" placeholder="Filter tracks" bind:value={query} />
		</div>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full min-w-[640px] text-[13px]">
			<thead>
				<tr
					class="border-b border-white/5 text-left text-[11px] tracking-wider text-ink-400 uppercase"
				>
					<th class="w-10 py-2 pl-3">
						<input
							type="checkbox"
							class="accent-amber"
							checked={allSelected}
							onchange={() =>
								(selected = allSelected ? new Set() : new Set(shown.map((i) => i.externalId)))}
						/>
					</th>
					<th class="w-10 py-2 font-medium">#</th>
					<th class="py-2 font-medium">Title</th>
					<th class="hidden py-2 font-medium lg:table-cell">Album</th>
					<th class="py-2 text-right font-medium">Time</th>
					<th class="py-2 pl-4 font-medium">Status</th>
					<th class="hidden py-2 pr-3 text-right font-medium md:table-cell">Added</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as item (item.externalId)}
					<tr class="row-hover {!item.present || item.ignored ? 'opacity-50' : ''}">
						<td class="py-2 pl-3"
							><input
								type="checkbox"
								class="accent-amber"
								checked={selected.has(item.externalId)}
								onchange={() => toggle(item.externalId)}
							/></td
						>
						<td class="py-2 font-mono text-[11px] text-ink-500">{item.position}</td>
						<td class="py-2">
							<div class="flex items-center gap-2.5">
								<Artwork
									src={item.artworkUrl ?? source.artworkUrl}
									title={item.title}
									size={30}
									rounded="rounded"
								/>
								<div class="min-w-0">
									<div class="truncate text-ink-100">{item.title}</div>
									<div class="truncate text-xs text-ink-400">{item.artist}</div>
								</div>
							</div>
						</td>
						<td class="hidden max-w-[220px] truncate py-2 text-ink-300 lg:table-cell"
							>{item.album ?? '—'}</td
						>
						<td class="py-2 text-right font-mono text-[11px] text-ink-400"
							>{duration(item.durationMs)}</td
						>
						<td class="py-2 pl-4">
							{#if item.ignored}<span class="chip border-white/8 text-ink-400">Ignored</span>
							{:else}<StatusBadge status={item.state} />{/if}
						</td>
						<td class="hidden py-2 pr-3 text-right text-[11px] text-ink-500 md:table-cell"
							>{ago(item.firstSeenAt)}</td
						>
					</tr>
				{:else}
					<tr
						><td colspan="7" class="py-10 text-center text-sm text-ink-400">No tracks match.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</section>

{#if selected.size}
	<!-- Floating so the table doesn't jump when a selection starts -->
	<div class="fixed right-0 bottom-4 left-0 z-40 flex justify-center px-4 lg:left-64">
		<div class="glass flex animate-rise items-center gap-2 !bg-ink-850/95 py-2 pr-2 pl-4 text-xs">
			<span class="mr-1 text-amber-glow">{selected.size} selected</span>
			<button class="btn btn-sm btn-primary" onclick={() => act('queue')}
				><ListPlus class="h-3 w-3" /> Queue</button
			>
			<button class="btn btn-sm" onclick={() => act('ignore')}
				><EyeOff class="h-3 w-3" /> Ignore</button
			>
			<button class="btn btn-sm" onclick={() => act('unignore')}
				><Eye class="h-3 w-3" /> Unignore</button
			>
			<button class="btn btn-sm btn-ghost" onclick={() => (selected = new Set())}>Clear</button>
		</div>
	</div>
{/if}
