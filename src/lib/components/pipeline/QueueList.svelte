<script lang="ts">
	import { ArrowUpToLine, ChevronsUp, Clock, GripVertical, ListMusic, X } from '@lucide/svelte';
	import { flip } from 'svelte/animate';
	import { api } from '$lib/client/api';
	import { ago, duration } from '$lib/client/format';
	import { live } from '$lib/client/live.svelte';
	import { FORMAT_PRESETS } from '$lib/formats';
	import type { TrackDTO } from '$lib/types';
	import Artwork from '../Artwork.svelte';
	import EmptyState from '../EmptyState.svelte';

	let { items, total }: { items: TrackDTO[]; total: number } = $props();

	const LIMIT = 200;
	let dragId = $state<string | null>(null);
	let overId = $state<string | null>(null);
	let overEnd = $state(false);

	const shown = $derived(items.slice(0, LIMIT));
	const sourceName = (id: string | null) => (id ? live.sources.get(id)?.name : null);

	function move(id: string, beforeId: string | null) {
		// Optimistic: compute the new position locally so the row jumps immediately.
		const t = live.tracks.get(id);
		if (!t) return;
		const idx = beforeId ? items.findIndex((i) => i.id === beforeId) : -1;
		let position: number;
		if (idx === -1) position = (items.at(-1)?.position ?? Date.now()) + 1;
		else
			position =
				((idx > 0 ? items[idx - 1].position : items[idx].position - 2) + items[idx].position) / 2;
		live.tracks.set(id, { ...t, position, priority: 0 });
		api.post(`/api/tracks/${id}`, { action: 'reorder', beforeId });
	}

	function bump(t: TrackDTO) {
		live.tracks.set(t.id, { ...t, position: (items[0]?.position ?? 0) - 1, priority: 0 });
		api.post(`/api/tracks/${t.id}`, { action: 'bump' });
	}

	function ondrop(e: DragEvent) {
		e.preventDefault();
		if (dragId && (overId || overEnd) && dragId !== overId) move(dragId, overEnd ? null : overId);
		dragId = overId = null;
		overEnd = false;
	}
</script>

{#if !items.length}
	<EmptyState icon={ListMusic} title="Nothing queued"
		>Paste a link above, or add a source to keep a playlist in sync.</EmptyState
	>
{:else}
	<div role="list" class="text-[13px]" ondragover={(e) => e.preventDefault()} {ondrop}>
		{#each shown as t, i (t.id)}
			<div
				role="listitem"
				animate:flip={{ duration: 200 }}
				draggable="true"
				ondragstart={(e) => {
					dragId = t.id;
					e.dataTransfer!.effectAllowed = 'move';
				}}
				ondragend={() => (dragId = overId = null)}
				ondragover={(e) => {
					e.preventDefault();
					overId = t.id;
					overEnd = false;
				}}
				class="row-hover group flex items-center gap-3 px-3 py-2 {dragId === t.id
					? 'opacity-40'
					: ''} {overId === t.id && dragId !== t.id
					? 'shadow-[inset_0_2px_0_0_var(--color-amber)]'
					: ''}"
			>
				<GripVertical
					class="h-3.5 w-3.5 shrink-0 cursor-grab text-ink-500 group-hover:text-ink-300"
				/>
				<span class="w-6 shrink-0 text-right font-mono text-[11px] text-ink-500">{i + 1}</span>
				<Artwork src={t.artworkUrl} title={t.title ?? t.artist} size={32} />
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="truncate text-ink-100"
							>{t.title ?? t.requestedUrl ?? t.spotifyId ?? t.youtubeId}</span
						>
						{#if t.priority > 0}<ChevronsUp class="h-3.5 w-3.5 shrink-0 text-amber" />{/if}
					</div>
					<div class="truncate text-xs text-ink-400">
						{t.artist ?? (t.provider === 'spotify' ? 'Spotify' : 'YouTube')}
						{#if sourceName(t.sourceId)}<span class="text-ink-500">
								· from {sourceName(t.sourceId)}</span
							>{/if}
					</div>
				</div>
				{#if t.error}
					<span
						class="chip hidden border-warn/30 bg-warn/10 text-warn md:inline-flex"
						title={t.error}
					>
						<Clock class="h-3 w-3" /> retry {t.attempts}
					</span>
				{/if}
				<span class="chip hidden border-white/8 bg-white/[0.03] text-ink-300 md:inline-flex">
					{FORMAT_PRESETS[t.formatPreset as keyof typeof FORMAT_PRESETS]?.label ?? t.formatPreset}
				</span>
				<span class="hidden w-10 text-right font-mono text-[11px] text-ink-400 sm:block"
					>{duration(t.durationMs)}</span
				>
				<span class="hidden w-16 text-right text-[11px] text-ink-500 xl:block"
					>{ago(t.createdAt)}</span
				>
				<div class="flex opacity-60 transition group-hover:opacity-100">
					<button
						class="btn btn-ghost btn-icon btn-sm"
						title="Move to top"
						onclick={() => bump(t)}
						disabled={i === 0}
					>
						<ArrowUpToLine class="h-3.5 w-3.5" />
					</button>
					<button
						class="btn btn-ghost btn-icon btn-sm hover:!text-bad"
						title="Remove"
						onclick={() => api.del(`/api/tracks/${t.id}`)}
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/each}
		<div
			role="listitem"
			class="h-6 {overEnd ? 'shadow-[inset_0_2px_0_0_var(--color-amber)]' : ''}"
			ondragover={(e) => {
				e.preventDefault();
				overEnd = true;
				overId = null;
			}}
		></div>
		{#if total > shown.length}
			<div class="px-3 pb-3 text-center text-xs text-ink-400">
				…and {(total - shown.length).toLocaleString()} more
			</div>
		{/if}
	</div>
{/if}
