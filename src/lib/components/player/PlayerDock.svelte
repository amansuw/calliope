<script lang="ts">
	import {
		ListMusic,
		LoaderCircle,
		Pause,
		Play,
		SkipBack,
		SkipForward,
		Volume1,
		Volume2,
		VolumeX,
		X
	} from '@lucide/svelte';
	import { fly, slide } from 'svelte/transition';
	import { duration as fmt } from '$lib/client/format';
	import { player } from '$lib/client/player.svelte';
	import Artwork from '../Artwork.svelte';
	import Visualizer from './Visualizer.svelte';
	import Waveform from './Waveform.svelte';

	let showQueue = $state(false);
	let lastVolume = 0.8;

	const t = $derived(player.current);
	const art = (id: string, has: boolean) => (has ? `/api/library/${id}/art` : null);

	function onkey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (!t || target.closest('input, textarea, select, [contenteditable]')) return;
		if (e.code === 'Space') {
			e.preventDefault();
			player.toggle();
		} else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
		else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
	}
</script>

<svelte:window onkeydown={onkey} />

{#if t}
	<div
		transition:fly={{ y: 80, duration: 250 }}
		class="fixed right-3 bottom-3 left-3 z-40 lg:left-[252px]"
	>
		{#if showQueue}
			<div
				transition:slide={{ duration: 180 }}
				class="glass mb-2 ml-auto max-h-[50dvh] w-full max-w-md overflow-y-auto !bg-ink-850/95 p-2"
			>
				<div class="flex items-center justify-between px-2 py-1.5">
					<span class="panel-title">Play queue · {player.queue.length}</span>
					<button class="btn btn-ghost btn-sm" onclick={() => player.clear()}>Clear</button>
				</div>
				{#each player.queue as q, i (q.id + i)}
					<button
						class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5 {i ===
						player.index
							? 'bg-amber/10'
							: ''}"
						onclick={() => player.playList(player.queue, i)}
					>
						<span class="w-5 text-right font-mono text-[10px] text-ink-500">{i + 1}</span>
						<Artwork src={art(q.id, q.hasArtwork)} title={q.title} size={28} rounded="rounded" />
						<div class="min-w-0 flex-1">
							<div
								class="truncate text-[12.5px] {i === player.index
									? 'text-amber-glow'
									: 'text-ink-100'}"
							>
								{q.title}
							</div>
							<div class="truncate text-[11px] text-ink-400">{q.artist}</div>
						</div>
						<span class="font-mono text-[10px] text-ink-500">{fmt(q.durationMs)}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div
			class="glass flex items-center gap-4 !bg-ink-850/90 px-3 py-2.5 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]"
		>
			<div class="flex w-[min(280px,40%)] min-w-0 items-center gap-3">
				<div class="relative">
					<Artwork src={art(t.id, t.hasArtwork)} title={t.title} size={46} rounded="rounded-lg" />
					{#if player.buffering}
						<div class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
							<LoaderCircle class="h-4 w-4 animate-spin text-amber" />
						</div>
					{/if}
				</div>
				<div class="min-w-0">
					<div class="truncate text-[13px] font-medium text-ink-50">{t.title ?? 'Unknown'}</div>
					<div class="truncate text-xs text-ink-400">
						{t.artist ?? ''}{t.album ? ` · ${t.album}` : ''}
					</div>
				</div>
				<div class="hidden xl:block"><Visualizer /></div>
			</div>

			<div class="flex shrink-0 items-center gap-1">
				<button class="btn btn-ghost btn-icon" onclick={() => player.prev()} aria-label="Previous"
					><SkipBack class="h-4 w-4" /></button
				>
				<button
					class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-glow to-amber text-ink-950 shadow-[0_0_20px_-4px_rgb(245_165_36/0.7)] transition hover:scale-105 active:scale-95"
					onclick={() => player.toggle()}
					aria-label={player.playing ? 'Pause' : 'Play'}
				>
					{#if player.playing}<Pause class="h-4 w-4" fill="currentColor" />{:else}<Play
							class="ml-0.5 h-4 w-4"
							fill="currentColor"
						/>{/if}
				</button>
				<button
					class="btn btn-ghost btn-icon"
					onclick={() => player.next()}
					disabled={player.index >= player.queue.length - 1}
					aria-label="Next"
				>
					<SkipForward class="h-4 w-4" />
				</button>
			</div>

			<div class="hidden min-w-0 flex-1 items-center gap-3 md:flex">
				<span class="w-10 text-right font-mono text-[11px] text-ink-300"
					>{fmt(player.time * 1000)}</span
				>
				<div class="min-w-0 flex-1">
					<Waveform
						peaks={player.analysis?.peaks ?? null}
						progress={player.duration ? player.time / player.duration : 0}
						duration={player.duration}
						onseek={(s) => player.seek(s)}
					/>
				</div>
				<span class="w-10 font-mono text-[11px] text-ink-400">{fmt(player.duration * 1000)}</span>
			</div>

			<div class="ml-auto flex shrink-0 items-center gap-1">
				<button
					class="chip hidden cursor-pointer transition sm:inline-flex {player.normalize
						? 'border-violet/40 bg-violet/10 text-violet-glow'
						: 'border-white/8 text-ink-500'}"
					title={player.normalize
						? `Loudness normalized (${player.normGainDb >= 0 ? '+' : ''}${player.normGainDb} dB)`
						: 'Loudness normalization off'}
					onclick={() => player.setNormalize(!player.normalize)}
				>
					Norm{player.normalize && player.analysis
						? ` ${player.normGainDb >= 0 ? '+' : ''}${player.normGainDb}`
						: ''}
				</button>
				<button
					class="btn btn-ghost btn-icon"
					aria-label="Mute"
					onclick={() => {
						if (player.volume > 0) {
							lastVolume = player.volume;
							player.setVolume(0);
						} else player.setVolume(lastVolume);
					}}
				>
					{#if player.volume === 0}<VolumeX class="h-4 w-4" />{:else if player.volume < 0.5}<Volume1
							class="h-4 w-4"
						/>{:else}<Volume2 class="h-4 w-4" />{/if}
				</button>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={player.volume}
					oninput={(e) => player.setVolume(Number(e.currentTarget.value))}
					class="hidden w-20 accent-amber lg:block"
					aria-label="Volume"
				/>
				<button
					class="btn btn-ghost btn-icon {showQueue ? '!text-amber' : ''}"
					onclick={() => (showQueue = !showQueue)}
					aria-label="Queue"
				>
					<ListMusic class="h-4 w-4" />
				</button>
				<button
					class="btn btn-ghost btn-icon"
					onclick={() => player.clear()}
					aria-label="Close player"><X class="h-4 w-4" /></button
				>
			</div>
		</div>
	</div>
{/if}
