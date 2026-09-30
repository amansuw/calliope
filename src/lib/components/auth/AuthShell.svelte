<script lang="ts">
	import type { Snippet } from 'svelte';
	import { AudioWaveform } from '@lucide/svelte';

	let {
		title,
		subtitle,
		children,
		wide = false
	}: { title: string; subtitle: string; children: Snippet; wide?: boolean } = $props();
</script>

<div class="flex min-h-dvh items-center justify-center p-4">
	<div class="w-full {wide ? 'max-w-lg' : 'max-w-sm'} animate-rise">
		<div class="mb-6 flex flex-col items-center text-center">
			<div
				class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber to-violet shadow-[0_0_48px_-6px_rgb(245_165_36/0.6)]"
			>
				<AudioWaveform class="h-6 w-6 text-ink-950" strokeWidth={2.5} />
			</div>
			<h1 class="text-xl font-semibold tracking-tight text-ink-50">{title}</h1>
			<p class="mt-1 text-sm text-ink-400">{subtitle}</p>
		</div>
		<div class="glass p-6">{@render children()}</div>
	</div>
</div>
