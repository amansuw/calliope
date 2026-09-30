<script lang="ts">
	import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/svelte';
	import { toasts } from '$lib/client/toasts.svelte';
	import { fly } from 'svelte/transition';

	const icon = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
	const tone = {
		info: 'text-violet-glow',
		success: 'text-ok',
		warning: 'text-warn',
		error: 'text-bad'
	};
</script>

<div
	class="pointer-events-none fixed right-4 bottom-24 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
>
	{#each toasts.items as t (t.id)}
		{@const Icon = icon[t.level]}
		<div
			transition:fly={{ x: 24, duration: 220 }}
			class="glass pointer-events-auto flex gap-3 !bg-ink-850/90 p-3 pr-2"
		>
			<Icon class="mt-0.5 h-4 w-4 shrink-0 {tone[t.level]}" />
			<div class="min-w-0 flex-1">
				{#if t.href}
					<a href={t.href} class="text-[13px] font-medium text-ink-50 hover:underline">{t.title}</a>
				{:else}
					<div class="text-[13px] font-medium text-ink-50">{t.title}</div>
				{/if}
				{#if t.message}<div class="mt-0.5 line-clamp-4 text-xs whitespace-pre-line text-ink-300">
						{t.message}
					</div>{/if}
			</div>
			<button
				class="btn btn-ghost btn-icon btn-sm"
				onclick={() => toasts.dismiss(t.id)}
				aria-label="Dismiss"><X class="h-3.5 w-3.5" /></button
			>
		</div>
	{/each}
</div>
