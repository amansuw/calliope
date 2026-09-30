<script lang="ts">
	import { ChevronDown, ExternalLink, Square, Terminal } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { api } from '$lib/client/api';
	import { bytes, eta, rate } from '$lib/client/format';
	import { live } from '$lib/client/live.svelte';
	import type { TrackDTO, WorkerTelemetry } from '$lib/types';
	import Artwork from '../Artwork.svelte';
	import ProgressRing from '../ProgressRing.svelte';
	import LogConsole from './LogConsole.svelte';

	let { track, telemetry }: { track: TrackDTO; telemetry?: WorkerTelemetry } = $props();
	let expanded = $state(false);

	const STAGES = [
		{ key: 'resolving', label: 'Resolve' },
		{ key: 'matching', label: 'Match' },
		{ key: 'downloading', label: 'Download' },
		{ key: 'processing', label: 'Convert' },
		{ key: 'tagging', label: 'Tag' },
		{ key: 'moving', label: 'File' }
	] as const;

	const stage = $derived(telemetry?.stage ?? track.status);
	const stageIdx = $derived(STAGES.findIndex((s) => s.key === stage));
	const downloading = $derived(stage === 'downloading');
	// Overall progress: stages before download are quick, download dominates.
	const overall = $derived(
		stageIdx < 2
			? stageIdx * 5 + 3
			: stageIdx === 2
				? 12 + (telemetry?.percent ?? 0) * 0.72
				: 84 + (stageIdx - 2) * 4
	);

	$effect(() => {
		if (expanded) live.watchLog(track.id);
		return () => live.unwatchLog(track.id);
	});
</script>

<div
	class="animate-rise rounded-xl border border-white/6 bg-ink-850/60 transition hover:border-white/10"
>
	<div class="flex items-center gap-3 p-3">
		<div class="relative">
			<Artwork
				src={track.artworkUrl}
				title={track.title ?? track.artist}
				size={52}
				rounded="rounded-lg"
			/>
			{#if downloading}<div
					class="absolute inset-0 animate-pulse-soft rounded-lg ring-1 ring-amber/40"
				></div>{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="truncate text-[13.5px] font-medium text-ink-50">
				{track.title ?? 'Resolving…'}
			</div>
			<div class="truncate text-xs text-ink-300">
				{track.artist ?? track.spotifyId ?? track.youtubeId}{track.album ? ` · ${track.album}` : ''}
			</div>
			<div class="mt-2 flex items-center gap-1">
				{#each STAGES as s, i (s.key)}
					<div class="flex items-center gap-1">
						<span
							class="text-[10px] font-medium tracking-wide uppercase transition
							{i < stageIdx ? 'text-ink-300' : i === stageIdx ? 'text-amber-glow' : 'text-ink-500'}"
							>{s.label}</span
						>
						{#if i < STAGES.length - 1}<span
								class="h-px w-2.5 {i < stageIdx ? 'bg-ink-400' : 'bg-ink-600'}"
							></span>{/if}
					</div>
				{/each}
			</div>
		</div>
		<div class="hidden text-right font-mono text-[11px] leading-5 text-ink-300 sm:block">
			{#if downloading}
				<div class="text-amber-glow">{rate(telemetry?.speed)}</div>
				<div>ETA {eta(telemetry?.etaSec)}</div>
				<div class="text-ink-400">{bytes(telemetry?.downloaded)} / {bytes(telemetry?.total)}</div>
			{:else if track.matchScore != null}
				<div class={track.matchScore >= 0.6 ? 'text-ok' : 'text-warn'}>
					match {(track.matchScore * 100).toFixed(0)}%
				</div>
			{/if}
		</div>
		<div class="relative flex items-center justify-center">
			<ProgressRing
				value={overall}
				indeterminate={!downloading && stageIdx < 2}
				tone={downloading ? 'amber' : 'violet'}
			/>
			<span class="absolute font-mono text-[10px] text-ink-200">{Math.round(overall)}</span>
		</div>
		<div class="flex flex-col gap-1">
			<button
				class="btn btn-ghost btn-icon btn-sm"
				title="Cancel"
				onclick={() => api.post(`/api/tracks/${track.id}`, { action: 'cancel' })}
			>
				<Square class="h-3 w-3" />
			</button>
			<button
				class="btn btn-ghost btn-icon btn-sm"
				title="Live log"
				onclick={() => (expanded = !expanded)}
			>
				{#if expanded}<ChevronDown class="h-3.5 w-3.5 rotate-180" />{:else}<Terminal
						class="h-3.5 w-3.5"
					/>{/if}
			</button>
		</div>
	</div>
	{#if downloading}
		<div class="mx-3 mb-3 h-1 overflow-hidden rounded-full bg-white/5">
			<div
				class="h-full rounded-full bg-gradient-to-r from-violet via-amber to-amber-glow shadow-[0_0_10px] shadow-amber/50 transition-[width] duration-700"
				style="width:{telemetry?.percent ?? 0}%"
			></div>
		</div>
	{/if}
	{#if expanded}
		<div transition:slide={{ duration: 180 }} class="border-t border-white/5 p-2">
			{#if track.matchUrl}
				<a
					href={track.matchUrl}
					target="_blank"
					rel="noreferrer"
					class="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-ink-400 hover:text-ink-200"
				>
					<ExternalLink class="h-3 w-3" />{track.matchTitle ?? track.matchUrl}
				</a>
			{/if}
			<LogConsole lines={live.logs.get(track.id) ?? []} />
		</div>
	{/if}
</div>
