<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		hint,
		children,
		row = false
	}: { label: string; hint?: string; children: Snippet; row?: boolean } = $props();
</script>

{#if row}
	<div class="flex items-start justify-between gap-6 py-3.5">
		<div class="min-w-0">
			<div class="text-[13px] font-medium text-ink-100">{label}</div>
			{#if hint}<div class="hint !mt-0.5">{hint}</div>{/if}
		</div>
		<div class="shrink-0 pt-0.5">{@render children()}</div>
	</div>
{:else}
	<div class="py-3.5">
		<div class="label">{label}</div>
		{@render children()}
		{#if hint}<div class="hint">{hint}</div>{/if}
	</div>
{/if}
