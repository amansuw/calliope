<script lang="ts">
	import { studio, type Field } from '$lib/client/studio.svelte';
	import { parseWithPattern } from '$lib/studio-transforms';

	let pattern = $state('%artist% - %title%');
	let useFolder = $state(false);
	const PRESETS = [
		'%artist% - %title%',
		'%track% - %title%',
		'%track% - %artist% - %title%',
		'%track%. %title%',
		'%artist% - %album% - %track% - %title%'
	];

	const name = (relPath: string) => {
		const parts = relPath.replace(/\.[^.]+$/, '').split('/');
		return useFolder ? parts.slice(-3).join(' - ') : parts.at(-1)!;
	};
	const results = $derived(
		studio.targets.map((t) => ({
			file: t,
			name: name(t.relPath),
			parsed: parseWithPattern(name(t.relPath), pattern)
		}))
	);
	const matched = $derived(results.filter((r) => r.parsed).length);

	function apply() {
		for (const r of results) {
			if (!r.parsed) continue;
			for (const [k, v] of Object.entries(r.parsed)) studio.set(r.file.id, k as Field, v);
		}
	}

	function number() {
		studio.targets.forEach((t, i) => {
			studio.set(t.id, 'trackNumber', i + 1);
			studio.set(t.id, 'trackTotal', studio.targets.length);
		});
	}
</script>

<p class="mb-3 text-xs text-ink-400">
	Fill tags from file names. Use %artist% %title% %album% %albumartist% %track% %disc% %year%
	%genre% %ignore%.
</p>
<input class="input !h-8 font-mono" bind:value={pattern} />
<div class="mt-2 flex flex-wrap gap-1">
	{#each PRESETS as p (p)}
		<button
			class="rounded-md border border-white/8 px-2 py-0.5 font-mono text-[10.5px] text-ink-300 hover:text-ink-100"
			onclick={() => (pattern = p)}>{p}</button
		>
	{/each}
</div>
<label class="mt-3 flex items-center gap-1.5 text-xs text-ink-300">
	<input type="checkbox" class="accent-amber" bind:checked={useFolder} /> Include parent folders (Artist/Album/File
	joined by " - ")
</label>

<div
	class="mt-3 max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/5 bg-ink-950/60 p-2 text-[11px]"
>
	{#each results.slice(0, 40) as r (r.file.id)}
		<div>
			<div class="truncate font-mono text-ink-400">{r.name}</div>
			{#if r.parsed}
				<div class="truncate text-ok">
					{Object.entries(r.parsed)
						.map(([k, v]) => `${k}: ${v}`)
						.join(' · ')}
				</div>
			{:else}
				<div class="text-bad/80">no match</div>
			{/if}
		</div>
	{/each}
</div>
<div class="mt-3 flex items-center justify-between">
	<span class="text-xs text-ink-400">{matched}/{results.length} match</span>
	<button class="btn btn-primary btn-sm" disabled={!matched} onclick={apply}>Stage {matched}</button
	>
</div>

<div class="mt-5 border-t border-white/5 pt-4">
	<div class="label">Track numbers</div>
	<button class="btn btn-sm w-full" onclick={number} disabled={!studio.targets.length}
		>Number 1–{studio.targets.length} in grid order</button
	>
</div>
