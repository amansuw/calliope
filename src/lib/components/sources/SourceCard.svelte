<script lang="ts">
	import { CircleAlert, Clock, RefreshCw } from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { ago } from '$lib/client/format';
	import { POLL_INTERVALS } from '$lib/formats';
	import type { SourceDTO } from '$lib/types';
	import Artwork from '../Artwork.svelte';
	import ProviderBadge from '../ProviderBadge.svelte';
	import Switch from '../Switch.svelte';

	let { source }: { source: SourceDTO } = $props();

	const pct = $derived(
		source.itemCount ? Math.round((source.haveCount / source.itemCount) * 100) : 0
	);
	const schedule = $derived(
		POLL_INTERVALS.find((p) => p.minutes === source.intervalMinutes)?.label ??
			`${source.intervalMinutes} min`
	);
</script>

<div class="glass group flex animate-rise flex-col p-4 transition hover:border-white/12">
	<div class="flex gap-3">
		<a href="/sources/{source.id}"
			><Artwork src={source.artworkUrl} title={source.name} size={64} rounded="rounded-xl" /></a
		>
		<div class="min-w-0 flex-1">
			<a
				href="/sources/{source.id}"
				class="line-clamp-2 text-[14px] leading-snug font-medium text-ink-50 hover:text-amber-glow"
				>{source.name}</a
			>
			<div class="mt-0.5 truncate text-xs text-ink-400">{source.owner ?? ''}</div>
			<div class="mt-2"><ProviderBadge provider={source.provider} kind={source.kind} /></div>
		</div>
		<Switch
			checked={source.enabled}
			label="Enabled"
			onchange={(enabled) => api.patch(`/api/sources/${source.id}`, { enabled })}
		/>
	</div>

	<div class="mt-4">
		<div class="mb-1.5 flex items-baseline justify-between text-xs">
			<span class="text-ink-300"
				><span class="font-mono text-ink-100">{source.haveCount}</span> / {source.itemCount} in library</span
			>
			{#if source.missingCount}
				<span class="font-medium text-violet-glow">{source.missingCount} missing</span>
			{:else}
				<span class="text-ok">Complete</span>
			{/if}
		</div>
		<div class="h-1.5 overflow-hidden rounded-full bg-white/5">
			<div
				class="h-full rounded-full bg-gradient-to-r from-violet to-amber transition-[width] duration-700"
				style="width:{pct}%"
			></div>
		</div>
	</div>

	{#if source.lastError}
		<div class="mt-3 flex items-start gap-1.5 text-xs text-bad">
			<CircleAlert class="mt-0.5 h-3 w-3 shrink-0" /><span class="line-clamp-2"
				>{source.lastError}</span
			>
		</div>
	{/if}
	{#if source.truncated}
		<div class="mt-2 text-[11px] text-warn/90">
			Listing is partial (provider limit) — only the first entries are tracked.
		</div>
	{/if}

	<div
		class="mt-auto flex items-center gap-2 border-t border-white/5 pt-3 text-[11px] text-ink-400"
		style="margin-top:1rem"
	>
		<Clock class="h-3 w-3" />
		<span>{schedule}</span>
		<span class="text-ink-600">·</span>
		<span title={source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : ''}
			>checked {ago(source.lastCheckedAt)}</span
		>
		{#if source.enabled && source.nextCheckAt}
			<span class="hidden text-ink-600 sm:inline">·</span><span class="hidden sm:inline"
				>next {ago(source.nextCheckAt)}</span
			>
		{/if}
		<button
			class="btn btn-sm ml-auto"
			disabled={source.syncing}
			onclick={() => api.post(`/api/sources/${source.id}/sync`)}
		>
			<RefreshCw class="h-3 w-3 {source.syncing ? 'animate-spin' : ''}" />
			{source.syncing ? 'Syncing' : 'Sync now'}
		</button>
	</div>
</div>
