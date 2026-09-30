<script lang="ts">
	import { onNavigate } from '$app/navigation';
	import { Menu, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { live } from '$lib/client/live.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import PlayerDock from '$lib/components/player/PlayerDock.svelte';
	import { player } from '$lib/client/player.svelte';

	let { children, data } = $props();
	let drawer = $state(false);

	const seed = () => {
		live.seedSources(data.sources, true);
		live.seedLibrary(data.library);
	};
	seed();
	$effect(seed);
	onMount(() => live.connect());
	onNavigate(() => {
		drawer = false;
	});
</script>

<div class="flex min-h-dvh">
	<aside
		class="glass sticky top-3 m-3 mr-0 hidden h-[calc(100dvh-24px)] w-60 shrink-0 !rounded-2xl lg:block"
	>
		<Sidebar />
	</aside>

	{#if drawer}
		<div class="fixed inset-0 z-40 lg:hidden">
			<button
				class="absolute inset-0 bg-black/60 backdrop-blur-sm"
				onclick={() => (drawer = false)}
				aria-label="Close menu"
			></button>
			<aside
				class="glass absolute top-0 bottom-0 left-0 w-64 !rounded-none !rounded-r-2xl !bg-ink-900/95"
			>
				<Sidebar onnavigate={() => (drawer = false)} />
			</aside>
		</div>
	{/if}

	<main class="min-w-0 flex-1 px-4 lg:px-6 {player.current ? 'pb-28' : 'pb-10'}">
		<div
			class="sticky top-0 z-30 -mx-4 mb-2 flex items-center gap-3 bg-ink-950/80 px-4 py-3 backdrop-blur lg:hidden"
		>
			<button class="btn btn-ghost btn-icon" onclick={() => (drawer = !drawer)} aria-label="Menu">
				{#if drawer}<X class="h-4 w-4" />{:else}<Menu class="h-4 w-4" />{/if}
			</button>
			<span class="text-sm font-semibold">Calliope</span>
			<span class="ml-auto h-2 w-2 rounded-full {live.connected ? 'bg-ok' : 'bg-bad'}"></span>
		</div>
		{@render children()}
	</main>
</div>

<PlayerDock />
<Toasts />
