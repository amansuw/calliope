<script lang="ts">
	import { ExternalLink, ListEnd, Play, Sparkles, WandSparkles, X } from '@lucide/svelte';
	import { fly, fade } from 'svelte/transition';
	import { api } from '$lib/client/api';
	import { ago, bytes, duration } from '$lib/client/format';
	import { player } from '$lib/client/player.svelte';
	import Artwork from '../Artwork.svelte';

	let {
		id,
		onclose,
		onstudio,
		onautotag
	}: {
		id: string;
		onclose: () => void;
		onstudio: (id: string) => void;
		onautotag: (id: string) => void;
	} = $props();

	interface Detail {
		id: string;
		path: string;
		folder: string;
		title: string | null;
		artist: string | null;
		album: string | null;
		albumArtist: string | null;
		year: number | null;
		genre: string | null;
		trackNumber: number | null;
		trackTotal: number | null;
		discNumber: number | null;
		durationMs: number | null;
		format: string | null;
		codec: string | null;
		lossless: boolean | null;
		bitrate: number | null;
		sampleRate: number | null;
		bitsPerSample: number | null;
		channels: number | null;
		size: number;
		isrc: string | null;
		hasArtwork: boolean;
		hasLyrics: boolean;
		mbRecordingId: string | null;
		acoustidId: string | null;
		audioHash: string | null;
		loudness: number | null;
		addedAt: number;
		download: {
			matchUrl: string | null;
			matchScore: number | null;
			provider: string;
			sourceId: string | null;
			finishedAt: number | null;
		} | null;
	}

	let d = $state<Detail | null>(null);
	$effect(() => {
		d = null;
		api.get<Detail>(`/api/library/${id}`).then((r) => (d = r));
	});

	const asTrack = (x: Detail) => ({
		id: x.id,
		title: x.title,
		artist: x.artist,
		album: x.album,
		durationMs: x.durationMs,
		hasArtwork: x.hasArtwork
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button
	transition:fade={{ duration: 150 }}
	class="fixed inset-0 z-40 cursor-default bg-black/40"
	onclick={onclose}
	aria-label="Close details"
></button>
<aside
	transition:fly={{ x: 420, duration: 220 }}
	class="glass fixed top-3 right-3 bottom-3 z-50 flex w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden !bg-ink-850/95"
>
	<div class="flex items-center justify-between border-b border-white/5 px-4 py-3">
		<span class="panel-title">Track details</span>
		<button class="btn btn-ghost btn-icon btn-sm" onclick={onclose} aria-label="Close"
			><X class="h-4 w-4" /></button
		>
	</div>
	{#if d}
		<div class="flex-1 overflow-y-auto p-4">
			<Artwork
				src={d.hasArtwork ? `/api/library/${d.id}/art` : null}
				title={d.album ?? d.title}
				size={368}
				rounded="rounded-xl"
				class="aspect-square !h-auto !w-full"
			/>
			<h2 class="mt-4 text-lg leading-tight font-semibold text-ink-50">{d.title ?? '—'}</h2>
			<p class="mt-1 text-sm text-ink-300">{d.artist ?? '—'}</p>
			<p class="text-xs text-ink-400">{d.album ?? 'No album'}{d.year ? ` · ${d.year}` : ''}</p>

			<div class="mt-4 flex gap-2">
				<button class="btn btn-primary flex-1" onclick={() => player.playList([asTrack(d!)])}
					><Play class="h-3.5 w-3.5" fill="currentColor" /> Play</button
				>
				<button class="btn" onclick={() => player.playNext(asTrack(d!))} title="Play next"
					><ListEnd class="h-3.5 w-3.5" /></button
				>
				<button class="btn btn-violet" onclick={() => onstudio(d!.id)}
					><WandSparkles class="h-3.5 w-3.5" /> Edit</button
				>
			</div>
			<button
				class="btn btn-sm btn-ghost mt-2 w-full !text-violet-glow"
				onclick={() => onautotag(d!.id)}
				><Sparkles class="h-3.5 w-3.5" /> Auto-tag from MusicBrainz</button
			>

			<dl class="mt-5 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
				{#each [['Album artist', d.albumArtist], ['Track', d.trackNumber ? `${d.trackNumber}${d.trackTotal ? ` / ${d.trackTotal}` : ''}${d.discNumber ? ` · disc ${d.discNumber}` : ''}` : null], ['Genre', d.genre], ['Duration', duration(d.durationMs)], ['Format', `${(d.format ?? '').toUpperCase()}${d.codec && d.codec.toLowerCase() !== d.format?.toLowerCase() ? ` · ${d.codec}` : ''}${d.lossless ? ' · lossless' : ''}`], ['Bitrate', d.bitrate ? `${d.bitrate} kbps` : null], ['Sample rate', d.sampleRate ? `${(d.sampleRate / 1000).toFixed(1)} kHz${d.bitsPerSample ? ` · ${d.bitsPerSample}-bit` : ''}${d.channels ? ` · ${d.channels}ch` : ''}` : null], ['Loudness', d.loudness != null ? `${d.loudness} dBFS RMS` : null], ['Size', bytes(d.size)], ['ISRC', d.isrc], ['MusicBrainz', d.mbRecordingId], ['Lyrics', d.hasLyrics ? 'Embedded' : 'None'], ['Added', ago(d.addedAt)]] as [label, value] (label)}
					{#if value}
						<dt class="text-ink-400">{label}</dt>
						<dd class="min-w-0 truncate text-ink-100" title={String(value)}>{value}</dd>
					{/if}
				{/each}
			</dl>

			<div class="mt-5">
				<div class="panel-title mb-1.5 !text-[10px]">File</div>
				<div
					class="rounded-lg border border-white/5 bg-ink-950/60 p-2.5 font-mono text-[11px] break-all text-ink-300"
				>
					{d.path}
				</div>
			</div>

			{#if d.download}
				<div class="mt-5">
					<div class="panel-title mb-1.5 !text-[10px]">Downloaded by Calliope</div>
					<div class="text-xs text-ink-300">
						From {d.download.provider === 'spotify' ? 'Spotify' : 'YouTube'}
						{ago(d.download.finishedAt)}{d.download.matchScore != null
							? ` · match ${Math.round(d.download.matchScore * 100)}%`
							: ''}
					</div>
					{#if d.download.matchUrl}
						<a
							href={d.download.matchUrl}
							target="_blank"
							rel="noreferrer"
							class="mt-1 inline-flex items-center gap-1 text-xs text-amber-glow hover:underline"
						>
							<ExternalLink class="h-3 w-3" /> Source video
						</a>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<div class="space-y-3 p-4">
			<div class="skeleton aspect-square"></div>
			<div class="skeleton h-5 w-2/3"></div>
			<div class="skeleton h-4 w-1/2"></div>
		</div>
	{/if}
</aside>
