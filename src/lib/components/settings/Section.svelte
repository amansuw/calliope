<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		children,
		actions
	}: { title: string; description?: string; children: Snippet; actions?: Snippet } = $props();
</script>

<section class="glass p-5">
	<div class="mb-1 flex items-start justify-between gap-4">
		<div>
			<h2 class="text-[15px] font-semibold text-ink-50">{title}</h2>
			{#if description}<p class="mt-0.5 text-xs leading-relaxed text-ink-400">{description}</p>{/if}
		</div>
		{#if actions}<div class="flex shrink-0 gap-2">{@render actions()}</div>{/if}
	</div>
	<div class="divide-y divide-white/[0.05]">{@render children()}</div>
</section>
