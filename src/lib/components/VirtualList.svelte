<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	let {
		items,
		rowHeight,
		overscan = 8,
		row,
		class: cls = '',
		scroller = $bindable()
	}: {
		items: T[];
		rowHeight: number;
		overscan?: number;
		row: Snippet<[T, number]>;
		class?: string;
		scroller?: HTMLDivElement;
	} = $props();

	let scrollTop = $state(0);
	let viewport = $state(600);

	const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
	const end = $derived(
		Math.min(items.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
	);
	const visible = $derived(items.slice(start, end));
</script>

<div
	bind:this={scroller}
	bind:clientHeight={viewport}
	onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
	class="overflow-y-auto {cls}"
>
	<div style="height:{items.length * rowHeight}px; position:relative">
		<div style="transform:translateY({start * rowHeight}px)">
			{#each visible as item, i (start + i)}
				{@render row(item, start + i)}
			{/each}
		</div>
	</div>
</div>
