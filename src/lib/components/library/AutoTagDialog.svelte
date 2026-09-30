<script lang="ts">
	import { LoaderCircle, Sparkles } from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import { api } from '$lib/client/api';
	import { toasts } from '$lib/client/toasts.svelte';

	let { ids, onclose }: { ids: string[]; onclose: () => void } = $props();
	let organize = $state(true);
	let busy = $state(false);

	async function run() {
		busy = true;
		try {
			await api.post('/api/library/autotag', { ids, organize });
			toasts.push({
				level: 'info',
				title: `Auto-tagging ${ids.length} file${ids.length === 1 ? '' : 's'}`,
				message: 'MusicBrainz allows about one lookup per second — progress shows in the sidebar.'
			});
			onclose();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button
	transition:fade={{ duration: 120 }}
	class="fixed inset-0 z-50 cursor-default bg-black/60 backdrop-blur-sm"
	onclick={onclose}
	aria-label="Close"
></button>
<div
	transition:scale={{ start: 0.97, duration: 150 }}
	class="glass fixed top-1/3 left-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 !bg-ink-850 p-5"
>
	<h2 class="flex items-center gap-2 text-[15px] font-semibold text-ink-50">
		<Sparkles class="h-4 w-4 text-violet-glow" /> Auto-tag {ids.length} file{ids.length === 1
			? ''
			: 's'}
	</h2>
	<p class="mt-2 text-xs leading-relaxed text-ink-300">
		Looks each track up on MusicBrainz and writes the original studio album, track and disc numbers,
		release year, genres and the album's cover art (replacing embedded artwork). Tracks without a
		confident match are left untouched.
	</p>
	<label class="mt-4 flex items-start gap-2 text-xs text-ink-200">
		<input type="checkbox" class="mt-0.5 accent-amber" bind:checked={organize} />
		<span
			>Move files to match the folder template<span class="block text-ink-400"
				>e.g. Singles/Toxicity.mp3 → Toxicity/12 - Toxicity.mp3</span
			></span
		>
	</label>
	<div class="mt-5 flex justify-end gap-2">
		<button class="btn" onclick={onclose}>Cancel</button>
		<button class="btn btn-violet" onclick={run} disabled={busy}>
			{#if busy}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Sparkles
					class="h-3.5 w-3.5"
				/>{/if} Auto-tag
		</button>
	</div>
</div>
