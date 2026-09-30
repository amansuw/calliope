<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Component } from 'svelte';

	let {
		icon: Icon,
		title,
		children
	}: { icon: Component<{ class?: string }>; title: string; children?: Snippet } = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
	<div class="mb-1 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-ink-400">
		<Icon class="h-5 w-5" />
	</div>
	<div class="text-sm font-medium text-ink-100">{title}</div>
	{#if children}<div class="max-w-sm text-xs leading-relaxed text-ink-400">
			{@render children()}
		</div>{/if}
</div>
