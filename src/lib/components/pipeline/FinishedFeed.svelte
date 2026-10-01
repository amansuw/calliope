<script lang="ts">
	import { CircleCheck, ExternalLink, FileText, Image, RotateCcw, Trash2 } from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { ago, bytes } from '$lib/client/format';
	import { FORMAT_PRESETS } from '$lib/formats';
	import type { TrackDTO } from '$lib/types';
	import Artwork from '../Artwork.svelte';
	import EmptyState from '../EmptyState.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import LogConsole from './LogConsole.svelte';
	import { live } from '$lib/client/live.svelte';

	let { items, lowConfidence = 0.6 }: { items: TrackDTO[]; lowConfidence?: number } = $props();
	let open = $state<string | null>(null);

	function toggle(id: string) {
		if (open) live.unwatchLog(open);
		open = open === id ? null : id;
		if (open) live.watchLog(open);
	}
</script>

{#if !items.length}
	<EmptyState icon={CircleCheck} title="No finished items"
		>Completed, skipped and failed downloads show up here.</EmptyState
	>
{:else}
	<div class="divide-y divide-white/[0.04]">
		{#each items as t (t.id)}
			<div class="group animate-rise px-3 py-2.5">
				<div class="flex items-start gap-3">
					<Artwork src={t.artworkUrl} title={t.title ?? t.artist} size={36} />
					<button class="min-w-0 flex-1 cursor-pointer text-left" onclick={() => toggle(t.id)}>
						<div class="truncate text-[13px] text-ink-100">{t.title ?? t.requestedUrl}</div>
						<div class="truncate text-xs text-ink-400">{t.artist ?? '—'}</div>
						<div class="mt-1.5 flex flex-wrap items-center gap-1">
							<StatusBadge status={t.status} />
							{#if t.status === 'done'}
								<span class="chip border-white/8 bg-white/[0.03] text-ink-300">
									{FORMAT_PRESETS[t.formatPreset as keyof typeof FORMAT_PRESETS]?.label ??
										t.formatPreset}{t.bitrate ? ` · ${t.bitrate}k` : ''}
								</span>
								{#if t.matchUrl?.startsWith('soulseek:')}
									<span
										class="chip border-ok/25 bg-ok/5 text-ok"
										title="Original file from a Soulseek peer{t.matchTitle
											? `: ${t.matchTitle}`
											: ''}">Soulseek</span
									>
								{:else if t.formatPreset === 'flac'}
									<span
										class="chip border-warn/30 bg-warn/10 text-warn"
										title="No lossless copy was found, so this FLAC holds YouTube's lossy audio"
										>from YouTube</span
									>
								{/if}
								{#if t.matchScore != null && t.provider === 'spotify'}
									<span
										class="chip {t.matchScore >= lowConfidence
											? 'border-ok/25 bg-ok/5 text-ok'
											: 'border-warn/30 bg-warn/10 text-warn'}"
										title="{t.matchUrl?.startsWith('soulseek:')
											? 'Soulseek'
											: 'YouTube'} match confidence{t.matchTitle ? `: ${t.matchTitle}` : ''}"
									>
										{t.matchScore >= lowConfidence ? 'Match' : 'Check match'}
										{Math.round(t.matchScore * 100)}%
									</span>
								{/if}
								<span
									class="chip {t.hasArtwork
										? 'border-violet/30 bg-violet/10 text-violet-glow'
										: 'border-white/6 text-ink-500'}"
									title="Cover art"
								>
									<Image class="h-3 w-3" />
								</span>
								<span
									class="chip {t.hasLyrics
										? 'border-violet/30 bg-violet/10 text-violet-glow'
										: 'border-white/6 text-ink-500'}"
									title={t.hasSyncedLyrics
										? 'Synced lyrics'
										: t.hasLyrics
											? 'Plain lyrics'
											: 'No lyrics'}
								>
									<FileText class="h-3 w-3" />{t.hasSyncedLyrics ? 'LRC' : ''}
								</span>
							{/if}
						</div>
						{#if t.status === 'failed' && t.error}
							<div class="mt-1.5 line-clamp-2 text-xs text-bad/90">{t.error}</div>
						{:else if t.status === 'skipped' && t.skipReason}
							<div class="mt-1.5 truncate text-xs text-ink-400">{t.skipReason}</div>
						{/if}
					</button>
					<div class="flex flex-col items-end gap-1">
						<span class="text-[11px] whitespace-nowrap text-ink-500">{ago(t.finishedAt)}</span>
						<div class="flex opacity-0 transition group-hover:opacity-100">
							{#if t.matchUrl?.startsWith('http')}
								<a
									class="btn btn-ghost btn-icon btn-sm"
									href={t.matchUrl}
									target="_blank"
									rel="noreferrer"
									title="Open source video"
								>
									<ExternalLink class="h-3.5 w-3.5" />
								</a>
							{/if}
							{#if t.status !== 'done'}
								<button
									class="btn btn-ghost btn-icon btn-sm"
									title="Retry (ignores duplicate checks)"
									onclick={() => api.post(`/api/tracks/${t.id}`, { action: 'retry' })}
								>
									<RotateCcw class="h-3.5 w-3.5" />
								</button>
							{/if}
							<button
								class="btn btn-ghost btn-icon btn-sm hover:!text-bad"
								title="Remove from history (file stays)"
								onclick={() => api.del(`/api/tracks/${t.id}`)}
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				</div>
				{#if open === t.id}
					<div class="mt-2">
						{#if t.filePath}<div
								class="mb-1.5 truncate font-mono text-[11px] text-ink-400"
								title={t.filePath}
							>
								{t.filePath} · {bytes(t.fileSize)}
							</div>{/if}
						<LogConsole lines={live.logs.get(t.id) ?? []} height="h-40" />
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
