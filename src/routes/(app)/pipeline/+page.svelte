<script lang="ts">
	import {
		Activity,
		CircleCheck,
		Cpu,
		Ellipsis,
		ListOrdered,
		Pause,
		Play,
		RotateCcw,
		Trash2,
		XCircle
	} from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { api } from '$lib/client/api';
	import { rate } from '$lib/client/format';
	import { live } from '$lib/client/live.svelte';
	import { ACTIVE_STATUSES, FINISHED_STATUSES } from '$lib/status';
	import AddBar from '$lib/components/AddBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FinishedFeed from '$lib/components/pipeline/FinishedFeed.svelte';
	import QueueList from '$lib/components/pipeline/QueueList.svelte';
	import WorkerCard from '$lib/components/pipeline/WorkerCard.svelte';
	import SpeedChart from '$lib/components/SpeedChart.svelte';

	let { data } = $props();

	const seed = () => live.seedTracks(data.tracks);
	seed();
	$effect(seed);

	type Tab = 'all' | 'done' | 'failed' | 'skipped';
	let tab = $state<Tab>('all');
	let menu = $state(false);

	const t = $derived(live.telemetry ?? data.telemetry);
	const all = $derived(browser ? [...live.tracks.values()] : data.tracks);
	const active = $derived(
		all
			.filter((x) => ACTIVE_STATUSES.includes(x.status))
			.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
	);
	const queued = $derived(
		all
			.filter((x) => x.status === 'queued')
			.sort((a, b) => b.priority - a.priority || a.position - b.position)
	);
	const finished = $derived(
		all
			.filter(
				(x) =>
					FINISHED_STATUSES.includes(x.status) &&
					(tab === 'all' || x.status === tab || (tab === 'skipped' && x.status === 'cancelled'))
			)
			.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
			.slice(0, 150)
	);
	const workerTelemetry = $derived(new Map(t.workers.map((w) => [w.trackId, w])));

	const control = (action: string, extra = {}) => {
		menu = false;
		return api.post('/api/pipeline/control', { action, ...extra });
	};
</script>

<svelte:head><title>Pipeline · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Pipeline</h1>
		<p class="mt-1 text-sm text-ink-400">
			Live download queue: match, fetch, tag and file into your library.
		</p>
	</div>
	<div class="flex items-center gap-2">
		{#if t.counts.failed}
			<button class="btn" onclick={() => control('retryFailed')}
				><RotateCcw class="h-3.5 w-3.5" /> Retry {t.counts.failed} failed</button
			>
		{/if}
		{#if t.paused}
			<button class="btn btn-primary" onclick={() => control('resume')}
				><Play class="h-3.5 w-3.5" /> Resume</button
			>
		{:else}
			<button class="btn" onclick={() => control('pause')}
				><Pause class="h-3.5 w-3.5" /> Pause</button
			>
		{/if}
		<div class="relative">
			<button class="btn btn-icon" onclick={() => (menu = !menu)} aria-label="More actions"
				><Ellipsis class="h-4 w-4" /></button
			>
			{#if menu}
				<button
					class="fixed inset-0 z-10 cursor-default"
					onclick={() => (menu = false)}
					aria-label="Close menu"
				></button>
				<div class="glass absolute right-0 z-20 mt-1 w-56 !bg-ink-850/95 p-1 text-[13px]">
					<button
						class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/5"
						onclick={() => control('clear', { statuses: ['done'] })}
					>
						<CircleCheck class="h-3.5 w-3.5 text-ink-400" /> Clear completed
					</button>
					<button
						class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/5"
						onclick={() => control('clear', { statuses: ['skipped', 'cancelled'] })}
					>
						<Trash2 class="h-3.5 w-3.5 text-ink-400" /> Clear skipped & cancelled
					</button>
					<button
						class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/5"
						onclick={() => control('clear', { statuses: ['failed'] })}
					>
						<Trash2 class="h-3.5 w-3.5 text-ink-400" /> Clear failed
					</button>
					<div class="my-1 h-px bg-white/5"></div>
					<button
						class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-bad hover:bg-bad/10"
						onclick={() => control('cancelQueued')}
					>
						<XCircle class="h-3.5 w-3.5" /> Cancel everything queued
					</button>
				</div>
			{/if}
		</div>
	</div>
</header>

<AddBar />

<!-- Telemetry strip -->
<section class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
	<div class="glass col-span-2 overflow-hidden p-0 md:col-span-4 xl:col-span-3">
		<div class="flex items-baseline justify-between px-4 pt-3">
			<span class="panel-title flex items-center gap-1.5"
				><Activity class="h-3 w-3" /> Throughput</span
			>
			<span class="font-mono text-lg font-medium text-amber-glow">{rate(t.speed)}</span>
		</div>
		<SpeedChart samples={live.speedHistory} />
	</div>
	{#each [{ label: 'Workers', value: `${t.counts.active}/${t.concurrency}`, icon: Cpu, tone: t.counts.active ? 'text-amber-glow' : 'text-ink-100' }, { label: 'Up next', value: t.counts.queued.toLocaleString(), icon: ListOrdered, tone: 'text-violet-glow' }, { label: 'Today', value: t.doneToday.toLocaleString(), icon: CircleCheck, tone: 'text-ok', sub: t.counts.failed ? `${t.counts.failed} failed` : `${t.counts.done.toLocaleString()} all-time` }] as s (s.label)}
		<div class="glass flex flex-col justify-between p-4">
			<span class="panel-title flex items-center gap-1.5"><s.icon class="h-3 w-3" /> {s.label}</span
			>
			<div class="mt-3 font-mono text-2xl font-medium {s.tone}">{s.value}</div>
			{#if s.sub}<div class="mt-0.5 text-[11px] text-ink-400">{s.sub}</div>{/if}
		</div>
	{/each}
</section>

<div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
	<div class="min-w-0 space-y-4">
		<section class="glass p-3">
			<div class="mb-3 flex items-center justify-between px-1">
				<h2 class="panel-title">Active downloads</h2>
				{#if t.paused}<span class="chip border-warn/30 bg-warn/10 text-warn">Paused</span>{/if}
			</div>
			{#if active.length}
				<div class="space-y-2">
					{#each active as track (track.id)}
						<WorkerCard {track} telemetry={workerTelemetry.get(track.id)} />
					{/each}
				</div>
			{:else}
				<EmptyState icon={Cpu} title={t.paused ? 'Pipeline paused' : 'All workers idle'}>
					{t.paused
						? 'Resume to start processing the queue.'
						: 'Workers pick up queued tracks automatically.'}
				</EmptyState>
			{/if}
		</section>

		<section class="glass overflow-hidden">
			<div class="flex items-center justify-between px-4 pt-3 pb-2">
				<h2 class="panel-title">Up next</h2>
				<span class="text-[11px] text-ink-500">Drag to reorder</span>
			</div>
			<QueueList items={queued} total={Math.max(t.counts.queued, queued.length)} />
		</section>
	</div>

	<section class="glass h-fit overflow-hidden xl:sticky xl:top-3">
		<div class="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5">
			<h2 class="panel-title pl-1">Recent</h2>
			<div class="flex rounded-lg border border-white/6 bg-ink-900/60 p-0.5 text-[11px]">
				{#each ['all', 'done', 'failed', 'skipped'] as const as key (key)}
					<button
						class="rounded-md px-2 py-1 capitalize transition {tab === key
							? 'bg-white/10 text-ink-50'
							: 'text-ink-400 hover:text-ink-200'}"
						onclick={() => (tab = key)}>{key}</button
					>
				{/each}
			</div>
		</div>
		<div class="max-h-[calc(100dvh-140px)] overflow-y-auto">
			<FinishedFeed items={finished} lowConfidence={data.lowConfidence} />
		</div>
	</section>
</div>
