<script module lang="ts">
	import type { Field, MbStaged, StudioFile, Value } from '$lib/client/studio.svelte';

	/** What a match would stage on one file */
	export interface Proposal {
		file: StudioFile;
		confidence: number;
		verified: boolean;
		tags: Partial<Record<Field, Value>>;
		artworkUrl: string | null;
		mb: MbStaged;
	}
</script>

<script lang="ts">
	import { ArrowRight, AudioLines, Check, X } from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import { portal } from '$lib/client/portal';
	import { FIELDS, studio } from '$lib/client/studio.svelte';
	import Artwork from '../Artwork.svelte';

	let {
		items,
		threshold,
		onapply,
		onskip,
		onclose
	}: {
		items: Proposal[];
		threshold: number;
		onapply: (items: Proposal[]) => void;
		onskip: (items: Proposal[]) => void;
		onclose: () => void;
	} = $props();

	const show = (v: Value | undefined) => (v === null || v === undefined || v === '' ? '—' : v);
	const rows = (p: Proposal) =>
		FIELDS.map((f) => {
			const current = studio.value(p.file, f.key);
			const proposed = f.key in p.tags ? (p.tags[f.key] ?? null) : current;
			return { ...f, current, proposed, changed: String(show(current)) !== String(show(proposed)) };
		});
	const currentArt = (p: Proposal) =>
		studio.artwork[p.file.id] ??
		(p.file.hasArtwork ? `/api/library/${p.file.id}/art?v=${studio.artVersion}` : null);
	// Cover Art Archive serves smaller sizes at the same path
	const thumb = (url: string) => url.replace(/front-1200$/, 'front-250');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div use:portal>
	<button
		transition:fade={{ duration: 120 }}
		class="fixed inset-0 z-50 cursor-default bg-black/60 backdrop-blur-sm"
		onclick={onclose}
		aria-label="Close"
	></button>
	<div
		transition:scale={{ start: 0.97, duration: 160 }}
		class="glass fixed top-[6vh] left-1/2 z-50 flex max-h-[88vh] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 flex-col !bg-ink-850/98"
	>
		<div class="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
			<div>
				<h2 class="text-[15px] font-semibold text-ink-50">
					Review {items.length} low-confidence match{items.length === 1 ? '' : 'es'}
				</h2>
				<p class="mt-1 text-xs text-ink-400">
					These scored below {Math.round(threshold * 100)}% and were not staged. Compare the tags,
					then apply or skip each one.
				</p>
			</div>
			<button class="btn btn-ghost btn-icon" onclick={onclose} aria-label="Close"
				><X class="h-4 w-4" /></button
			>
		</div>

		<div class="space-y-3 overflow-y-auto p-4">
			{#each items as p (p.file.id)}
				{@const art = currentArt(p)}
				<section class="overflow-hidden rounded-lg border border-white/6 bg-ink-900/60">
					<div class="flex items-center gap-3 border-b border-white/5 px-4 py-2.5">
						<div class="min-w-0 flex-1">
							<div class="truncate font-mono text-[11px] text-ink-200" title={p.file.relPath}>
								{p.file.relPath}
							</div>
						</div>
						{#if p.verified}<span
								class="chip border-ok/30 bg-ok/5 text-ok"
								title="Confirmed by audio fingerprint"><AudioLines class="h-3 w-3" /> Audio</span
							>{/if}
						<span class="chip border-warn/30 bg-warn/10 text-warn"
							>{Math.round(p.confidence * 100)}%</span
						>
						<button class="btn btn-sm" onclick={() => onskip([p])}>Skip</button>
						<button class="btn btn-sm btn-violet" onclick={() => onapply([p])}
							><Check class="h-3 w-3" /> Apply</button
						>
					</div>
					<table class="w-full table-fixed text-xs">
						<thead>
							<tr class="text-left text-[10.5px] tracking-wider text-ink-400 uppercase">
								<th class="w-28 px-4 py-1.5 font-medium"></th>
								<th class="px-4 py-1.5 font-medium">Current</th>
								<th class="px-4 py-1.5 font-medium">Match</th>
							</tr>
						</thead>
						<tbody>
							<tr class="border-t border-white/[0.04]">
								<td class="px-4 py-1.5 text-[11px] tracking-wide text-ink-400 uppercase">Cover</td>
								<td class="px-4 py-1.5">
									<Artwork
										src={art}
										title={String(show(studio.value(p.file, 'album')))}
										size={44}
									/>
								</td>
								<td class="px-4 py-1.5">
									{#if p.artworkUrl}
										<div class="flex items-center gap-2">
											<Artwork
												src={thumb(p.artworkUrl)}
												title={String(show(p.tags.album))}
												size={44}
											/>
											<span class="text-warn">{art ? 'Replaces cover' : 'Adds cover'}</span>
										</div>
									{:else}
										<span class="text-ink-400">Unchanged</span>
									{/if}
								</td>
							</tr>
							{#each rows(p) as r (r.key)}
								<tr class="border-t border-white/[0.04]">
									<td class="px-4 py-1.5 text-[11px] tracking-wide text-ink-400 uppercase"
										>{r.label === '#' ? 'Track' : r.label === 'of' ? 'Track total' : r.label}</td
									>
									<td class="truncate px-4 py-1.5 {r.changed ? 'text-warn' : 'text-ink-300'}"
										>{show(r.current)}</td
									>
									<td
										class="truncate px-4 py-1.5 {r.changed
											? 'font-medium text-ok'
											: 'text-ink-300'}"
									>
										{#if r.changed}<ArrowRight class="mr-1 inline h-3 w-3" />{/if}{show(r.proposed)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/each}
		</div>

		<div class="flex items-center justify-between gap-2 border-t border-white/5 px-5 py-3">
			<p class="text-[11px] text-ink-400">
				Applied matches are only staged — nothing is written until you save.
			</p>
			<div class="flex shrink-0 gap-2">
				<button class="btn btn-sm" onclick={() => onskip(items)}>Skip all</button>
				<button class="btn btn-sm btn-violet" onclick={() => onapply(items)}
					><Check class="h-3 w-3" /> Apply all {items.length}</button
				>
			</div>
		</div>
	</div>
</div>
