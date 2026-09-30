<script lang="ts">
	import { Radio, RefreshCw } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { api } from '$lib/client/api';
	import { live } from '$lib/client/live.svelte';
	import AddBar from '$lib/components/AddBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SourceCard from '$lib/components/sources/SourceCard.svelte';

	let { data } = $props();
	let filter = $state<'all' | 'spotify' | 'youtube' | 'missing'>('all');

	// Layout data seeds the store; SSR renders straight from it.
	const sources = $derived(browser ? [...live.sources.values()] : data.sources);
	const shown = $derived(
		sources
			.filter(
				(s) =>
					filter === 'all' || (filter === 'missing' ? s.missingCount > 0 : s.provider === filter)
			)
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const totals = $derived({
		tracks: sources.reduce((n, s) => n + s.itemCount, 0),
		missing: sources.reduce((n, s) => n + s.missingCount, 0)
	});

	async function syncAll() {
		for (const s of sources.filter((s) => s.enabled))
			api.post(`/api/sources/${s.id}/sync`, {}, { quiet: true }).catch(() => {});
	}
</script>

<svelte:head><title>Sources · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Sources</h1>
		<p class="mt-1 text-sm text-ink-400">
			{sources.length} monitored · {totals.tracks.toLocaleString()} tracks tracked · {totals.missing.toLocaleString()}
			missing
		</p>
	</div>
	<button class="btn" onclick={syncAll} disabled={!sources.length}
		><RefreshCw class="h-3.5 w-3.5" /> Sync all</button
	>
</header>

<AddBar />

{#if sources.length}
	<div class="mt-5 mb-3 flex gap-1 text-xs">
		{#each [['all', 'All'], ['missing', 'Has missing'], ['spotify', 'Spotify'], ['youtube', 'YouTube']] as [key, label] (key)}
			<button
				class="rounded-full border px-3 py-1 transition {filter === key
					? 'border-amber/40 bg-amber/10 text-amber-glow'
					: 'border-white/8 text-ink-300 hover:text-ink-100'}"
				onclick={() => (filter = key as typeof filter)}>{label}</button
			>
		{/each}
	</div>
	<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
		{#each shown as source (source.id)}
			<SourceCard {source} />
		{/each}
	</div>
{:else}
	<div class="glass mt-5">
		<EmptyState icon={Radio} title="No sources yet">
			Paste a Spotify playlist or album, or a YouTube playlist or channel above and hit <b
				class="text-violet-glow">Monitor</b
			>. Calliope checks it on a schedule and queues anything you don't have.
		</EmptyState>
	</div>
{/if}
