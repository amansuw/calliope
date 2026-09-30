<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import { duration } from '$lib/client/format';
	import { library } from '$lib/client/library.svelte';
	import { filterRows, haystack, ISSUE_LABELS, type Issue } from '$lib/library-filter';

	let { onpick, onclose }: { onpick: (ids: string[]) => void; onclose: () => void } = $props();

	let q = $state('');
	let issues = $state<Issue[]>([]);
	let picked = $state(new Set<string>());

	$effect(() => {
		library.load();
	});

	const rows = $derived(
		filterRows(
			library.rows,
			{ q, formats: [], quality: 'all', issues, artist: null, album: null },
			haystack
		).slice(0, 500)
	);
	const toggleIssue = (i: Issue) =>
		(issues = issues.includes(i) ? issues.filter((x) => x !== i) : [...issues, i]);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button
	transition:fade={{ duration: 120 }}
	class="fixed inset-0 z-50 cursor-default bg-black/60 backdrop-blur-sm"
	onclick={onclose}
	aria-label="Close"
></button>
<div
	transition:scale={{ start: 0.97, duration: 160 }}
	class="glass fixed top-[8vh] left-1/2 z-50 flex max-h-[80vh] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col !bg-ink-850/98"
>
	<div class="flex items-center gap-2 border-b border-white/5 p-3">
		<div class="relative flex-1">
			<Search class="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-ink-400" />
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input pl-9" placeholder="Search the library…" bind:value={q} autofocus />
		</div>
		<button class="btn btn-ghost btn-icon" onclick={onclose} aria-label="Close"
			><X class="h-4 w-4" /></button
		>
	</div>
	<div class="flex flex-wrap gap-1 border-b border-white/5 px-3 py-2 text-xs">
		<span class="mr-1 self-center text-ink-400">Missing:</span>
		{#each Object.entries(ISSUE_LABELS) as [key, label] (key)}
			<button
				class="rounded-full border px-2.5 py-0.5 transition {issues.includes(key as Issue)
					? 'border-violet/50 bg-violet/15 text-violet-glow'
					: 'border-white/8 text-ink-300'}"
				onclick={() => toggleIssue(key as Issue)}>{label}</button
			>
		{/each}
	</div>
	<div class="flex-1 overflow-y-auto">
		{#each rows as r (r.id)}
			<label
				class="flex cursor-pointer items-center gap-3 border-b border-white/[0.03] px-4 py-2 text-[13px] hover:bg-white/[0.03]"
			>
				<input
					type="checkbox"
					class="accent-amber"
					checked={picked.has(r.id)}
					onchange={() => {
						const n = new Set(picked);
						if (n.has(r.id)) n.delete(r.id);
						else n.add(r.id);
						picked = n;
					}}
				/>
				<div class="min-w-0 flex-1">
					<div class="truncate text-ink-100">{r.title ?? '—'}</div>
					<div class="truncate text-xs text-ink-400">
						{r.artist ?? '—'} · {r.album ?? 'no album'}
					</div>
				</div>
				<span class="font-mono text-[11px] text-ink-500">{duration(r.durationMs)}</span>
			</label>
		{:else}
			<div class="py-10 text-center text-sm text-ink-400">
				{library.loaded ? 'No matching tracks' : 'Loading…'}
			</div>
		{/each}
	</div>
	<div class="flex items-center justify-between gap-2 border-t border-white/5 p-3">
		<button
			class="btn btn-ghost btn-sm"
			onclick={() => (picked = new Set(rows.map((r) => r.id)))}
			disabled={!rows.length}>Select all {rows.length}</button
		>
		<div class="flex gap-2">
			<button class="btn" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={!picked.size} onclick={() => onpick([...picked])}
				>Add {picked.size || ''} to studio</button
			>
		</div>
	</div>
</div>
